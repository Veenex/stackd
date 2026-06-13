// api.js – Album-Lookup per Barcode (EAN) über MusicBrainz + Discogs.
// MusicBrainz ist kostenlos und braucht keinen Token; Discogs liefert mehr
// Vinyl-Details (Pressung, Farbe, Cover), benötigt aber einen Token.

import { getSettings } from './store.js';
import { SUPABASE_URL, SUPABASE_KEY } from './supabase.js';

const MB_BASE = 'https://musicbrainz.org/ws/2';
const CAA_BASE = 'https://coverartarchive.org';
const DISCOGS_BASE = 'https://api.discogs.com';

// Discogs läuft über unseren Supabase-Edge-Function-Proxy: der Token liegt
// serverseitig (Secret), niemand braucht mehr einen eigenen – auch Gäste nicht.
const DISCOGS_FN = `${SUPABASE_URL}/functions/v1/discogs`;
async function discogsProxy(action, params = {}) {
  const usp = new URLSearchParams({ action });
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') usp.set(k, String(v));
  }
  const res = await fetch(`${DISCOGS_FN}?${usp.toString()}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('Discogs-Proxy HTTP ' + res.status);
  return res.json();
}

// Normalisiertes Ergebnisobjekt
function normalize(partial) {
  return {
    artist: '',
    title: '',
    year: '',
    label: '',
    format: '',
    barcode: '',
    coverUrl: '',
    genre: '',
    source: '',
    sourceId: '',
    ...partial,
  };
}

// Primäres Genre aus einem Discogs-Treffer (genre[] bzw. style[]).
function pickGenre(hit) {
  const g = hit.genre || hit.genres;
  if (Array.isArray(g) && g.length) return g[0];
  if (typeof g === 'string' && g) return g;
  const s = hit.style || hit.styles;
  if (Array.isArray(s) && s.length) return s[0];
  return '';
}

// ---------- Discogs (über Proxy) ----------
async function lookupDiscogs(barcode) {
  const data = await discogsProxy('search', { barcode });
  const hit = (data.results || [])[0];
  if (!hit) return null;

  // hit.title ist üblicherweise "Künstler - Titel"
  let artist = '';
  let title = hit.title || '';
  const dash = title.indexOf(' - ');
  if (dash !== -1) {
    artist = title.slice(0, dash).trim();
    title = title.slice(dash + 3).trim();
  }
  return normalize({
    artist,
    title,
    year: hit.year || '',
    label: Array.isArray(hit.label) ? hit.label[0] : (hit.label || ''),
    format: Array.isArray(hit.format) ? hit.format.join(', ') : (hit.format || ''),
    barcode,
    coverUrl: hit.cover_image || hit.thumb || '',
    genre: pickGenre(hit),
    source: 'discogs',
    sourceId: String(hit.id || ''),
    masterId: hit.master_id || 0,
  });
}

// ---------- MusicBrainz ----------
async function lookupMusicBrainz(barcode) {
  const url = `${MB_BASE}/release?query=barcode:${encodeURIComponent(barcode)}&fmt=json&limit=5`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('MusicBrainz HTTP ' + res.status);
  const data = await res.json();
  const rel = (data.releases || [])[0];
  if (!rel) return null;

  const artist = (rel['artist-credit'] || [])
    .map((c) => c.name + (c.joinphrase || ''))
    .join('') || (rel['artist-credit']?.[0]?.artist?.name || '');

  const labelInfo = (rel['label-info'] || [])[0];
  const label = labelInfo?.label?.name || '';

  let format = '';
  const media = rel.media || [];
  if (media.length) {
    format = media.map((m) => m.format).filter(Boolean).join(', ');
  }

  const result = normalize({
    artist: artist.trim(),
    title: rel.title || '',
    year: (rel.date || '').slice(0, 4),
    label,
    format,
    barcode,
    source: 'musicbrainz',
    sourceId: rel.id || '',
  });

  // Cover Art Archive (kann fehlen -> ignorieren)
  if (rel.id) {
    result.coverUrl = `${CAA_BASE}/release/${rel.id}/front-500`;
  }
  return result;
}

// Barcode-Varianten erzeugen: UPC-A (12) <-> EAN-13 (13, führende Null) usw.
// Verschiedene Datenbanken speichern denselben Code mal mit, mal ohne Null.
function barcodeVariants(barcode) {
  const c = String(barcode).replace(/\D/g, '');
  const set = new Set();
  if (!c) return [];
  set.add(c);
  if (c.length === 12) set.add('0' + c);                 // UPC-A -> EAN-13
  if (c.length === 13 && c.startsWith('0')) set.add(c.slice(1)); // EAN-13 -> UPC-A
  return [...set];
}

// Kombinierte Suche: erst Discogs (falls Token, beste Vinyl-Abdeckung),
// sonst/zusätzlich MusicBrainz. Probiert mehrere Barcode-Varianten durch.
export async function lookupBarcode(barcode) {
  const variants = barcodeVariants(barcode);
  if (!variants.length) return null;
  let lastError = null;

  // 1. Discogs zuerst – beste Vinyl-Abdeckung. Mit Token (höheres Limit)
  //    und auch ohne Token (anonyme Barcode-Suche).
  for (const code of variants) {
    try {
      const result = await lookupDiscogs(code);
      if (result) {
        if (!result.coverUrl) {
          const mb = await safe(() => lookupMusicBrainzAny(variants));
          if (mb?.coverUrl) result.coverUrl = mb.coverUrl;
        }
        return result;
      }
    } catch (err) {
      lastError = err;
    }
  }

  // 2. MusicBrainz als Fallback.
  for (const code of variants) {
    try {
      const result = await lookupMusicBrainz(code);
      if (result) return result;
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) throw lastError;
  return null; // nichts gefunden
}

async function lookupMusicBrainzAny(variants) {
  for (const code of variants) {
    const r = await safe(() => lookupMusicBrainz(code));
    if (r) return r;
  }
  return null;
}

function normalizeDiscogsHit(hit) {
  let artist = '';
  let title = hit.title || '';
  const dash = title.indexOf(' - ');
  if (dash !== -1) {
    artist = title.slice(0, dash).trim();
    title = title.slice(dash + 3).trim();
  }
  return normalize({
    artist,
    title,
    year: hit.year || '',
    label: Array.isArray(hit.label) ? hit.label[0] : (hit.label || ''),
    format: Array.isArray(hit.format) ? hit.format.join(', ') : (hit.format || ''),
    barcode: Array.isArray(hit.barcode) ? hit.barcode[0] : '',
    coverUrl: hit.cover_image || hit.thumb || '',
    genre: pickGenre(hit),
    source: 'discogs',
    sourceId: String(hit.id || ''),
    masterId: hit.master_id || 0,
  });
}

// Öffentliche Discogs-Sammlung eines Nutzers laden (paginiert) → normalisierte Items.
export async function fetchDiscogsCollection(username) {
  const out = [];
  let page = 1, pages = 1;
  do {
    const data = await discogsProxy('collection', { username, per_page: 100, page });
    pages = data.pagination?.pages || 1;
    for (const r of (data.releases || [])) {
      const bi = r.basic_information || {};
      const artist = ((bi.artists || [])[0]?.name || '').replace(/\s*\(\d+\)$/, '').trim();
      out.push(normalize({
        artist,
        title: bi.title || '',
        year: bi.year ? String(bi.year) : '',
        label: ((bi.labels || [])[0]?.name) || '',
        format: (bi.formats || []).map((f) => f.name).filter(Boolean).join(', '),
        coverUrl: bi.cover_image || bi.thumb || '',
        genre: (bi.genres || [])[0] || '',
        source: 'discogs',
        sourceId: String(r.id || ''),
        masterId: bi.master_id || 0,
        rating: Number(r.rating) || 0,
      }));
    }
    page++;
  } while (page <= pages && page <= 20);
  return out;
}

// Genre eines Albums nachladen (Backfill bestehender Sammlungseinträge).
export async function fetchGenre(item) {
  if (!item || item.source !== 'discogs' || !item.sourceId) return '';
  try {
    const d = await discogsProxy('release', { id: item.sourceId });
    return pickGenre(d);
  } catch { return ''; }
}

// Flexible Discogs-Suche (q / artist / genre / style / year). Normalisierte Treffer.
export async function discogsSearch(params = {}) {
  const proxyParams = { per_page: params.per_page || 30 };
  ['q', 'artist', 'genre', 'style', 'year', 'sort', 'sort_order', 'page'].forEach((k) => {
    if (params[k]) proxyParams[k] = params[k];
  });
  const data = await discogsProxy('search', proxyParams);
  return (data.results || []).map(normalizeDiscogsHit);
}

// Freitext-Suche (Künstler/Album).
export async function searchByText(query) {
  const q = String(query).trim();
  if (!q) return [];
  return discogsSearch({ q });
}

// Hochauflösendes Cover über die iTunes/Apple-Datenbank (kein Key, CORS ok).
// Liefert eine 600px-Cover-URL oder null.
export async function fetchCoverArt(artist, title) {
  const term = `${artist || ''} ${title || ''}`.trim();
  if (!term) return null;
  try {
    const r = await fetch('https://itunes.apple.com/search?entity=album&limit=1&term=' + encodeURIComponent(term));
    if (!r.ok) return null;
    const d = await r.json();
    const a = d.results && d.results[0];
    if (a && a.artworkUrl100) return a.artworkUrl100.replace('100x100bb', '600x600bb');
  } catch { /* ignorieren */ }
  return null;
}

// Mehrere Cover-Kandidaten für ein konkretes Album (zum Auswählen).
// Quellen: Discogs-Bilder der Pressung + iTunes-Editionen + andere Discogs-Pressungen.
export async function fetchCoverCandidates(item) {
  const seen = new Set();
  const urls = [];
  const add = (u) => { if (u && !seen.has(u)) { seen.add(u); urls.push(u); } };

  const term = `${item.artist || ''} ${item.title || ''}`.trim();

  // 1. iTunes/Apple: offizielle Cover-Grafiken in hoher Auflösung (saubere Artworks, keine Fotos)
  if (term) {
    try {
      const r = await fetch('https://itunes.apple.com/search?entity=album&limit=12&term=' + encodeURIComponent(term));
      if (r.ok) {
        const d = await r.json();
        (d.results || []).forEach((a) => { if (a.artworkUrl100) add(a.artworkUrl100.replace('100x100bb', '600x600bb')); });
      }
    } catch { /* ignorieren */ }
  }

  // 2. Discogs: Bilder genau dieser Pressung (können auch Fotos sein)
  if (item.source === 'discogs' && item.sourceId) {
    try {
      const d = await discogsProxy('release', { id: item.sourceId });
      (d.images || []).forEach((img) => add(img.uri || img.resource_url));
    } catch { /* ignorieren */ }
  }

  // 3. Discogs: weitere Pressungen desselben Albums
  if (term) {
    try {
      const more = await discogsSearch({ q: term });
      more.forEach((m) => add(m.coverUrl));
    } catch { /* ignorieren */ }
  }

  return urls.slice(0, 24);
}

// Aktuell beliebte Künstler (Trending) via Last.fm. Braucht lastfmKey in Settings.
export async function lastfmTopArtists(limit = 14) {
  const key = (getSettings().lastfmKey || '').trim();
  if (!key) return null;
  const url = `https://ws.audioscrobbler.com/2.0/?method=chart.gettopartists&api_key=${encodeURIComponent(key)}&format=json&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Last.fm HTTP ' + res.status);
  const d = await res.json();
  if (d.error) throw new Error(d.message || 'Last.fm Fehler');
  return (d.artists && d.artists.artist ? d.artists.artist : []).map((a) => a.name);
}

async function safe(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function msToTime(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// Tracklist zu einem gespeicherten Eintrag holen (Discogs- oder MusicBrainz-Quelle).
// Liefert [{position, title, duration}] oder null.
// ---------- Vinyl-Farben ----------
// Bekannte Farbbegriffe (wie Discogs sie schreibt) -> Anzeigename + CSS-Farbe.
// Reihenfolge: längere/spezifische Begriffe zuerst, damit z. B. "Light Blue"
// vor "Blue" greift.
const VINYL_COLOR_MAP = [
  ['coke bottle', { name: 'Coke Bottle Clear', css: '#3f8f6b' }],
  ['light blue', { name: 'Hellblau', css: '#7cc4f0' }],
  ['baby blue', { name: 'Babyblau', css: '#9bd0f0' }],
  ['light green', { name: 'Hellgrün', css: '#86d98a' }],
  ['sea blue', { name: 'Meerblau', css: '#2f8fb3' }],
  ['transparent', { name: 'Transparent', css: '#dbe6ee' }],
  ['translucent', { name: 'Transluzent', css: '#dbe6ee' }],
  ['turquoise', { name: 'Türkis', css: '#19c2b4' }],
  ['magenta', { name: 'Magenta', css: '#d6249f' }],
  ['burgundy', { name: 'Bordeaux', css: '#7b1f2b' }],
  ['maroon', { name: 'Bordeaux', css: '#7b1f2b' }],
  ['crystal', { name: 'Kristallklar', css: '#dbe6ee' }],
  ['natural', { name: 'Natur', css: '#e7dcc2' }],
  ['cream', { name: 'Creme', css: '#f1e6c4' }],
  ['ivory', { name: 'Elfenbein', css: '#f3ecd8' }],
  ['bone', { name: 'Beinweiß', css: '#f0ead6' }],
  ['silver', { name: 'Silber', css: '#c4c7cc' }],
  ['gold', { name: 'Gold', css: '#d4af37' }],
  ['bronze', { name: 'Bronze', css: '#b08d57' }],
  ['copper', { name: 'Kupfer', css: '#b87333' }],
  ['clear', { name: 'Klar', css: '#dbe6ee' }],
  ['white', { name: 'Weiß', css: '#eef0f2' }],
  ['black', { name: 'Schwarz', css: '#1a1a1a' }],
  ['orange', { name: 'Orange', css: '#f5821f' }],
  ['yellow', { name: 'Gelb', css: '#f5c518' }],
  ['purple', { name: 'Lila', css: '#8b5cf6' }],
  ['violet', { name: 'Violett', css: '#8b5cf6' }],
  ['pink', { name: 'Pink', css: '#ec4899' }],
  ['brown', { name: 'Braun', css: '#8b5e34' }],
  ['green', { name: 'Grün', css: '#22a447' }],
  ['blue', { name: 'Blau', css: '#2f6bff' }],
  ['grey', { name: 'Grau', css: '#9aa0a6' }],
  ['gray', { name: 'Grau', css: '#9aa0a6' }],
  ['red', { name: 'Rot', css: '#e23b3b' }],
];
const VINYL_EFFECTS = ['splatter', 'marbled', 'marble', 'swirl', 'galaxy', 'haze', 'smoke', 'glitter'];

// Findet die Vinyl-Farbe in einem Discogs-Format-Text (z. B.
// "LP, Album, Limited Edition, Pink" oder "Translucent Red Splatter").
function parseVinylColor(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  for (const [key, val] of VINYL_COLOR_MAP) {
    if (t.includes(key)) {
      const effect = VINYL_EFFECTS.find((e) => t.includes(e));
      return { ...val, effect: effect || '' };
    }
  }
  return null;
}

// Liefert die farbigen Vinyl-Varianten, die es für ein Album gibt.
// Die Farbe steht bei Discogs im Feld formats[].text der einzelnen Pressung
// (z. B. "Pink", "Splattered Clear"), nicht in der Versions-Übersicht – daher
// werden die Releases einzeln geladen. Gibt eine Liste {name, css, effect}
// eindeutiger Farben zurück (max. 8); die Farbe der geöffneten Pressung steht
// vorne. Anonym (ohne Token) gibt Discogs keine farbigen Details her -> [].
export async function fetchVinylColors(item) {
  if (!item || item.source !== 'discogs' || !item.masterId) return [];

  // 1) Vinyl-Pressungen des Masters holen (über Proxy)
  let ids = [];
  try {
    const d = await discogsProxy('versions', { id: item.masterId, per_page: 100 });
    ids = (d.versions || [])
      .filter((v) => (v.major_formats || []).some((f) => /vinyl/i.test(f)))
      .map((v) => String(v.id))
      .filter(Boolean);
  } catch { /* ignorieren */ }

  // Geöffnete Pressung zuerst, danach die übrigen (max. 14 Anfragen)
  ids = [...new Set([String(item.sourceId || ''), ...ids].filter(Boolean))].slice(0, 14);
  if (!ids.length) return [];

  // 2) Pro Pressung die Farbe aus formats[].text lesen
  const byId = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const rd = await discogsProxy('release', { id });
      for (const f of (rd.formats || [])) {
        if (f.name && !/vinyl/i.test(f.name)) continue; // nur Vinyl
        const c = parseVinylColor(f.text || '');
        if (c) { byId[id] = c; break; }
      }
    } catch { /* ignorieren */ }
  }));

  // 3) In der Reihenfolge der ids eindeutige Farben sammeln
  const found = new Map();
  ids.forEach((id) => {
    const c = byId[id];
    if (c && !found.has(c.name)) found.set(c.name, c);
  });
  return [...found.values()].slice(0, 8);
}

// Marktwert-Bereich (min–max) eines Discogs-Releases.
// Quelle 1: Preisvorschläge pro Zustand (Poor … Mint). Quelle 2 (Fallback):
// aktueller niedrigster Marktpreis (lowest_price) mit grober Spanne.
export async function fetchPriceRange(item) {
  if (!item || item.source !== 'discogs' || !item.sourceId) return null;
  try {
    const d = await discogsProxy('price', { id: item.sourceId });
    const entries = Object.values(d || {}).filter((x) => x && typeof x.value === 'number' && x.value > 0);
    if (entries.length) {
      const vals = entries.map((x) => x.value);
      return { min: Math.min(...vals), max: Math.max(...vals), currency: entries[0].currency || 'EUR', source: 'suggestions' };
    }
  } catch { /* ignorieren */ }
  try {
    const r = await discogsProxy('release', { id: item.sourceId });
    if (r && typeof r.lowest_price === 'number' && r.lowest_price > 0) {
      return { min: r.lowest_price, max: Math.round(r.lowest_price * 1.6), currency: 'EUR', source: 'lowest' };
    }
  } catch { /* ignorieren */ }
  return null;
}

// Release-Infos + Tracklist in einem Discogs-Aufruf (für die Album-Infos).
export async function fetchReleaseInfo(item) {
  if (!item || item.source !== 'discogs' || !item.sourceId) return null;
  try {
    const d = await discogsProxy('release', { id: item.sourceId });
    const tracklist = (d.tracklist || [])
      .filter((t) => !t.type_ || t.type_ === 'track')
      .map((t) => ({ position: t.position || '', title: t.title || '', duration: t.duration || '' }));
    const labels = (d.labels || []).map((l) => ({ name: l.name, catno: l.catno || '' })).filter((l) => l.name);
    const formats = (d.formats || []).map((f) =>
      [f.qty && f.qty !== '1' ? f.qty + '×' : '', f.name, ...(f.descriptions || [])].filter(Boolean).join(' ')
    ).filter(Boolean);
    return {
      tracklist,
      genres: d.genres || [], styles: d.styles || [],
      country: d.country || '', year: d.year || '',
      labels, formats, notes: d.notes || '',
    };
  } catch { return null; }
}

export async function fetchTracklist(item) {
  if (!item || !item.sourceId) return null;

  if (item.source === 'discogs') {
    try {
      const d = await discogsProxy('release', { id: item.sourceId });
      const list = (d.tracklist || [])
        .filter((t) => !t.type_ || t.type_ === 'track')
        .map((t) => ({ position: t.position || '', title: t.title || '', duration: t.duration || '' }));
      if (list.length) return list;
    } catch { /* ignorieren */ }
  }

  if (item.source === 'musicbrainz') {
    try {
      const res = await fetch(
        `${MB_BASE}/release/${encodeURIComponent(item.sourceId)}?inc=recordings&fmt=json`,
        { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const d = await res.json();
        const tracks = [];
        (d.media || []).forEach((m) =>
          (m.tracks || []).forEach((t) =>
            tracks.push({ position: t.number || '', title: t.title || '', duration: t.length ? msToTime(t.length) : '' })));
        if (tracks.length) return tracks;
      }
    } catch { /* ignorieren */ }
  }

  return null;
}
