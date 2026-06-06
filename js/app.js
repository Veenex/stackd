// app.js – Einstieg: Navigation, Rendering, Scan-Flow, Formular, Einstellungen.

import {
  getList, addItem, updateItem, deleteItem, moveItem,
  getSettings, saveSettings, exportAll, importAll,
  sortItems, filterItems,
  getPlaylists, createPlaylist, deletePlaylist, togglePlaylistItem,
  syncAll, clearUserCache,
  searchUsers, getFollowing, follow, unfollow, fetchFriendsFeed,
  fetchUserProfile, fetchUserItems, fetchUserPlaylists,
  toggleActivityLike, fetchLikeInfo, fetchComments, addComment, deleteComment,
  addPlay, fetchPlays, deletePlay, fetchUserPlays,
} from './store.js';
import { lookupBarcode, fetchTracklist, discogsSearch, lastfmTopArtists, fetchCoverArt, fetchCoverCandidates, fetchVinylColors, fetchPriceRange } from './api.js';
import { initAuth, getUser, getProfile, updateProfile, requireAuth, openAuth, signOut } from './auth.js';
import { startScanner, stopScanner, isRunning, isSupported } from './scanner.js';

// Anzeigename aus dem Supabase-Profil (display_name, sonst username).
function profileName() {
  const p = getProfile() || {};
  return (p.display_name || p.username || '').trim();
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const VIEW_TITLES = {
  home: 'Start',
  collection: 'Collection',
  search: 'Suche',
  add: 'Hinzufügen',
  settings: 'Mein Profil',
};

let currentView = 'collection';
let pendingResult = null; // Lookup-Ergebnis, das gespeichert werden kann
let editing = null;       // { list, id } im Detail-Dialog

// ---------- Navigation ----------
function switchView(view) {
  currentView = view;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  if (view === 'settings') {
    $('#view-title').textContent = profileName() || 'Mein Profil';
  } else {
    $('#view-title').textContent = VIEW_TITLES[view] || '';
  }
  $('#header-settings').classList.toggle('hidden', view !== 'settings');
  if (view !== 'add') {
    // Kamera schließen + Scan-UI zurücksetzen, sobald man den Tab verlässt
    stopScanner();
    $('#reader').classList.add('hidden');
    $('#btn-start-scan').classList.remove('hidden');
    $('#btn-stop-scan').classList.add('hidden');
    $('#scan-status').textContent = '';
  }
  renderCounts();
  if (view === 'collection') renderList('collection');
  if (view === 'home') renderHome();
  if (view === 'search') renderBrowse();
  if (view === 'settings') {
    renderProfile();
    renderPlaylists();
    renderList('wishlist');
  }
  const main = document.getElementById('main');
  if (main) main.scrollTop = 0;
}

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const view = tab.dataset.view;
    const detailWasOpen = !detailPage.classList.contains('hidden');
    if (detailWasOpen) closeDetail();
    if (!document.getElementById('user-page').classList.contains('hidden')) closeUserProfile();
    // Gast-Modus: Sammeln/Scannen/Profil nur für angemeldete Nutzer
    if (['add', 'collection', 'settings'].includes(view) && !getUser()) { openAuth('login'); return; }
    if (view === currentView && !detailWasOpen) {
      // erneutes Antippen des aktiven Tabs: nach oben scrollen
      if (view === 'settings') setProfileTab('profile');
      const main = document.getElementById('main');
      if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      switchView(view);
    }
  });
});

// ---------- Listen rendern ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Bewertung mit Musiknoten (0,5–5) ----------
const NOTE_PATH = 'M19.952 1.651a.75.75 0 0 1 .298.599V16.303a3 3 0 0 1-2.176 2.884l-1.32.377a2.553 2.553 0 1 1-1.403-4.909l2.311-.66a1.5 1.5 0 0 0 1.088-1.442V6.994l-9 2.572v9.737a3 3 0 0 1-2.176 2.884l-1.32.377a2.553 2.553 0 1 1-1.402-4.909l2.31-.66a1.5 1.5 0 0 0 1.088-1.442V5.25a.75.75 0 0 1 .544-.721l10.5-3a.75.75 0 0 1 .658.122Z';
const noteSvg = () => `<svg viewBox="0 0 24 24" fill="currentColor"><path d="${NOTE_PATH}"/></svg>`;

const HEART_PATH = 'M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 0 1-.383-.218 25.18 25.18 0 0 1-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0 1 12 5.052 5.5 5.5 0 0 1 16.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 0 1-4.244 3.17 15.247 15.247 0 0 1-.383.219l-.022.012-.007.004-.003.001a.752.752 0 0 1-.704 0l-.003-.001Z';
const heartSvg = () => `<svg class="heart-ico" viewBox="0 0 24 24" fill="currentColor"><path d="${HEART_PATH}"/></svg>`;

// Statische Anzeige (Liste): gefüllte Noten je nach Bewertung
function ratingDisplayHtml(rating) {
  const r = Number(rating) || 0;
  if (r <= 0) return '';
  let slots = '';
  for (let i = 1; i <= 5; i++) {
    const frac = Math.max(0, Math.min(1, r - (i - 1)));
    slots += `<span class="note-slot"><span class="note-empty">${noteSvg()}</span><span class="note-fill" style="width:${frac * 100}%">${noteSvg()}</span></span>`;
  }
  return `<div class="rating-display" title="${r} von 5">${slots}</div>`;
}

// Tippbare Eingabe: linke Hälfte = halbe Note, rechte = ganze; erneut tippen = zurücksetzen
function createRatingInput(container, initial, onChange) {
  let value = Number(initial) || 0;
  const fire = () => { if (typeof onChange === 'function') onChange(value); };
  container.classList.add('rating-input');
  container.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const slot = document.createElement('span');
    slot.className = 'note-slot';
    slot.dataset.pos = i;
    slot.innerHTML = `<span class="note-empty">${noteSvg()}</span><span class="note-fill">${noteSvg()}</span>`;
    container.appendChild(slot);
  }
  const render = () => {
    container.querySelectorAll('.note-slot').forEach((slot, idx) => {
      const frac = Math.max(0, Math.min(1, value - idx));
      slot.querySelector('.note-fill').style.width = frac * 100 + '%';
    });
  };
  container.onclick = (e) => {
    if (!requireAuth()) return; // Gäste: erst anmelden
    const slot = e.target.closest('.note-slot');
    if (!slot) return;
    const pos = +slot.dataset.pos;
    const rect = slot.getBoundingClientRect();
    const half = e.clientX - rect.left < rect.width / 2;
    let v = half ? pos - 0.5 : pos;
    if (v === value) v = 0; // erneut auf den gleichen Wert tippen = löschen
    value = v;
    render();
    fire();
  };
  render();
  return { getValue: () => value, setValue: (v) => { value = Number(v) || 0; render(); fire(); } };
}

let detailRating = null;
let resultRating = null;
let manualRating = null;

function recordItemHtml(item) {
  const hasCover = !!item.coverUrl;
  const cover = `<div class="tile-cover${hasCover ? '' : ' placeholder'}">${
    hasCover
      ? `<img src="${escapeHtml(item.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();" />`
      : ''
  }</div>`;
  const noteIco = `<svg class="note-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`;
  const note = item.note ? `<p class="tile-note">${noteIco}${escapeHtml(item.note)}</p>` : '';
  const rating = ratingDisplayHtml(item.rating);
  const heart = item.liked ? `<span class="tile-like">${heartSvg()}</span>` : '';
  const meta = rating || heart ? `<div class="tile-meta">${rating}${heart}</div>` : '';
  return `
    <li class="tile" data-id="${item.id}">
      ${cover}
      ${meta}
      <p class="tile-title">${escapeHtml(item.title) || '(ohne Titel)'}</p>
      <p class="tile-artist">${escapeHtml(item.artist) || '(unbekannt)'}</p>
      ${note}
    </li>`;
}

const EMPTY_TEXT = {
  collection: 'Noch keine Platten. Scanne einen Barcode oder füge manuell hinzu.',
  wishlist: 'Deine Wishlist ist leer.',
};

function renderList(list) {
  const query = $(`#search-${list}`).value;
  const mode = $(`#sort-${list}`).value;
  const favOnly = $(`#fav-${list}`).classList.contains('active');
  const rv = ratingFilter[list];

  let items = filterItems(getList(list), query);
  if (favOnly) items = items.filter((i) => i.liked);
  if (rv > 0) items = items.filter((i) => (Number(i.rating) || 0) === rv);
  items = sortItems(items, mode);

  const ul = $(`#list-${list}`);
  ul.innerHTML = items.map(recordItemHtml).join('');

  const hint = $(`#empty-${list}`);
  hint.textContent = getList(list).length === 0 ? EMPTY_TEXT[list] : 'Keine Treffer für Suche/Filter.';
  hint.classList.toggle('hidden', items.length > 0);

  ul.querySelectorAll('.tile').forEach((el) => {
    el.addEventListener('click', () => openDetail(list, el.dataset.id));
  });
}

function renderCounts() {
  const badge = $('#count-badge');
  if (currentView === 'collection') {
    badge.textContent = `${getList('collection').length}`;
    badge.style.display = '';
  } else {
    badge.textContent = '';
    badge.style.display = 'none';
  }
}

const ratingFilter = { collection: 0, wishlist: 0 };
const ratingFilterWidget = {};

['collection', 'wishlist'].forEach((list) => {
  $(`#search-${list}`).addEventListener('input', () => renderList(list));
  $(`#sort-${list}`).addEventListener('change', () => renderList(list));
  $(`#fav-${list}`).addEventListener('click', () => {
    $(`#fav-${list}`).classList.toggle('active');
    renderList(list);
  });
  ratingFilterWidget[list] = createRatingInput($(`#ratingfilter-${list}`), 0, (v) => {
    ratingFilter[list] = v;
    renderList(list);
  });
  $(`#ratingclear-${list}`).addEventListener('click', () => ratingFilterWidget[list].setValue(0));
});

// ---------- Album-Detailseite ----------
const detailPage = $('#detail-page');
let tracklistReq = 0; // verhindert, dass eine alte Tracklist-Antwort eine neue überschreibt
let discReq = 0; // dito für die Vinyl-Farben
let dpLiked = false;
let previewResult = null;

function setDetailCover(url) {
  const cover = $('#dp-cover');
  cover.className = 'dp-cover' + (url ? '' : ' placeholder');
  cover.innerHTML = url
    ? `<img src="${escapeHtml(url)}" alt="" onerror="this.parentElement.classList.add('placeholder');this.remove();" />`
    : '';
}

// Farbe der herausschauenden Vinyl-Scheibe setzen
function setVinylColor(css) {
  $('#dp-vinyl').style.setProperty('--vinyl', css || '#1a1a1a');
}

// Vinyl-Scheibe + farbige Varianten anzeigen, die das Album anbietet
async function renderDiscs(item) {
  setVinylColor('#1a1a1a'); // Standard sofort
  const wrap = $('#dp-variants');
  wrap.innerHTML = '';
  wrap.classList.add('hidden');
  const reqId = ++discReq;
  let colors = [];
  try { colors = await fetchVinylColors(item); } catch { /* ignorieren */ }
  if (reqId !== discReq) return; // ein neueres Album wurde geöffnet

  // bevorzugt eine echte Farbe (nicht Schwarz) für die große Scheibe
  const lead = colors.find((c) => c.name !== 'Schwarz') || colors[0];
  if (lead) setVinylColor(lead.css);
  if (colors.length < 2) return; // nur eine (oder keine) Farbe -> keine Auswahl

  wrap.classList.remove('hidden');
  wrap.innerHTML = '<span class="dp-variants-label">Erhältlich auf</span>' +
    colors.map((c, i) =>
      `<button type="button" class="dp-swatch${c === lead ? ' active' : ''}" data-css="${escapeHtml(c.css)}">
        <span class="dot" style="background:${escapeHtml(c.css)}"></span>${escapeHtml(c.name)}
      </button>`).join('');
  wrap.querySelectorAll('.dp-swatch').forEach((b) => b.addEventListener('click', () => {
    setVinylColor(b.dataset.css);
    wrap.querySelectorAll('.dp-swatch').forEach((x) => x.classList.toggle('active', x === b));
  }));
}

function setConditionDisplay(media, sleeve) {
  const parts = [];
  if (media) parts.push('Media ' + media);
  if (sleeve) parts.push('Hülle ' + sleeve);
  $('#dp-condition').textContent = parts.length ? 'Zustand: ' + parts.join('  ·  ') : '';
}

function openDetail(list, id) {
  const item = getList(list).find((i) => i.id === id);
  if (!item) return;
  editing = { list, id };
  previewResult = null;
  detailPage.classList.remove('preview');

  setDetailCover(item.coverUrl);

  $('#dp-title').textContent = item.title || '(ohne Titel)';
  $('#dp-artist').textContent = item.artist || '(unbekannt)';
  $('#dp-meta').textContent = [item.year, item.label, item.format].filter(Boolean).join('  ·  ');

  const q = encodeURIComponent(`${item.artist || ''} ${item.title || ''}`.trim());
  $('#dp-spotify').href = `https://open.spotify.com/search/${q}`;
  $('#dp-apple').href = `https://music.apple.com/search?term=${q}`;
  $('#dp-note').value = item.note || '';
  $('#dp-review').value = item.review || '';
  detailRating = createRatingInput($('#dp-rating'), item.rating);
  dpLiked = !!item.liked;
  $('#dp-like').classList.toggle('liked', dpLiked);

  $('#dp-edit-artist').value = item.artist || '';
  $('#dp-edit-title').value = item.title || '';
  $('#dp-edit-year').value = item.year || '';
  $('#dp-edit-label').value = item.label || '';
  $('#dp-edit-format').value = item.format || '';
  $('#dp-edit-barcode').value = item.barcode || '';
  $('#dp-edit-cover').value = item.coverUrl || '';
  $('#dp-edit-price').value = item.price ? item.price : '';
  $('#dp-edit-media').value = item.mediaCond || '';
  $('#dp-edit-sleeve').value = item.sleeveCond || '';
  setConditionDisplay(item.mediaCond, item.sleeveCond);
  $('.dp-edit').open = false;

  $('#dp-move').textContent = list === 'collection' ? 'In Wishlist' : 'In Collection';

  $('#dp-play-date').value = new Date().toISOString().slice(0, 10);
  $('#dp-play-note').value = '';
  renderDiaryPlays(item.id);
  renderDiscs(item);
  loadTracklist(item);

  detailPage.classList.remove('hidden');
  $('#detail-scroll').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  detailPage.classList.add('hidden');
  detailPage.classList.remove('preview');
  document.body.style.overflow = '';
  editing = null;
  previewResult = null;
}

// Album aus der Suche/Datenbank ansehen (noch nicht gespeichert) -> Detailseite mit Tracklist
function openPreview(result) {
  if (!result) return;
  editing = null;
  previewResult = result;
  detailPage.classList.add('preview');
  setDetailCover(result.coverUrl);
  $('#dp-title').textContent = result.title || '(ohne Titel)';
  $('#dp-artist').textContent = result.artist || '';
  $('#dp-meta').textContent = [result.year, result.label, result.format].filter(Boolean).join('  ·  ');
  const q = encodeURIComponent(`${result.artist || ''} ${result.title || ''}`.trim());
  $('#dp-spotify').href = `https://open.spotify.com/search/${q}`;
  $('#dp-apple').href = `https://music.apple.com/search?term=${q}`;
  $('#dp-note').value = '';
  $('#dp-review').value = '';
  setConditionDisplay('', '');
  detailRating = createRatingInput($('#dp-rating'), 0);
  dpLiked = false;
  $('#dp-like').classList.toggle('liked', false);
  renderDiscs(result);
  loadTracklist(result);
  detailPage.classList.remove('hidden');
  $('#detail-scroll').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

async function addPreviewTo(list) {
  if (!requireAuth()) return;
  if (!previewResult) return;
  const item = { ...previewResult };
  if (!item.coverUrl) {
    const c = await fetchCoverArt(item.artist, item.title);
    if (c) item.coverUrl = c;
  }
  addItem(list, {
    ...item,
    rating: detailRating ? detailRating.getValue() : 0,
    note: $('#dp-note').value.trim(),
    review: $('#dp-review').value.trim(),
    liked: dpLiked,
  });
  closeDetail();
  toast(list === 'collection' ? 'Zur Collection hinzugefügt' : 'Zur Wishlist hinzugefügt');
}

async function loadTracklist(item) {
  const ol = $('#dp-tracklist');
  const status = $('#dp-tracklist-status');
  ol.innerHTML = '';
  if (item.source === 'manual' || !item.sourceId) {
    status.textContent = 'Keine Tracklist (manuell hinzugefügt).';
    return;
  }
  const reqId = ++tracklistReq;
  status.textContent = 'Lade Tracklist…';
  let tracks = null;
  try {
    tracks = await fetchTracklist(item);
  } catch { /* ignorieren */ }
  if (reqId !== tracklistReq) return; // ein neueres Album wurde geöffnet
  if (!tracks || !tracks.length) {
    status.textContent = 'Keine Tracklist gefunden.';
    return;
  }
  status.textContent = '';
  ol.innerHTML = tracks
    .map((t) => `<li><span class="trk-pos">${escapeHtml(t.position)}</span><span class="trk-title">${escapeHtml(t.title)}</span><span class="trk-dur">${escapeHtml(t.duration)}</span></li>`)
    .join('');
}

// Tagebuch-Einträge eines Albums anzeigen
async function renderDiaryPlays(itemId) {
  const ul = $('#dp-plays'); ul.innerHTML = '';
  let plays = [];
  try { plays = await fetchPlays(itemId); } catch { /* ignorieren */ }
  if (!plays.length) { ul.innerHTML = '<li class="hint" style="border:none">Noch keine Einträge.</li>'; return; }
  ul.innerHTML = plays.map((p) => {
    const d = p.played_on ? new Date(p.played_on).toLocaleDateString('de-DE') : '';
    const note = p.note ? ' – ' + escapeHtml(p.note) : '';
    return `<li><span class="play-date">${d}</span><span class="play-note">${note}</span><button class="play-del" data-id="${p.id}">×</button></li>`;
  }).join('');
  ul.querySelectorAll('.play-del').forEach((b) => b.addEventListener('click', async () => { await deletePlay(b.dataset.id); renderDiaryPlays(itemId); }));
}
$('#dp-play-add').addEventListener('click', async () => {
  if (!requireAuth()) return;
  if (!editing) { toast('Album erst zur Collection hinzufügen'); return; }
  const date = $('#dp-play-date').value || new Date().toISOString().slice(0, 10);
  await addPlay(editing.id, date, $('#dp-play-note').value);
  $('#dp-play-note').value = '';
  renderDiaryPlays(editing.id);
  toast('Eingetragen');
});

// ---------- Stackd Wrapped (Jahresrückblick) ----------
async function openWrapped() {
  if (!requireAuth()) return;
  const year = new Date().getFullYear();
  $('#wrapped-title').textContent = 'Stackd Wrapped ' + year;
  $('#wrapped-body').innerHTML = '<p class="hint">Lade…</p>';
  $('#wrapped-dialog').showModal();
  const coll = getList('collection');
  const addedThisYear = coll.filter((i) => new Date(i.addedAt || 0).getFullYear() === year).length;
  const rated = coll.filter((i) => Number(i.rating) > 0);
  const avg = rated.length ? (rated.reduce((s, i) => s + Number(i.rating), 0) / rated.length) : 0;
  const topRated = [...rated].sort((a, b) => b.rating - a.rating).slice(0, 3);
  let plays = [];
  try { plays = await fetchUserPlays(getUser().id); } catch { /* ignorieren */ }
  const playsThisYear = plays.filter((p) => String(p.played_on || '').startsWith(String(year)));
  const counts = {};
  playsThisYear.forEach((p) => { counts[p.item_id] = (counts[p.item_id] || 0) + 1; });
  let mostId = null, mostN = 0;
  Object.entries(counts).forEach(([id, n]) => { if (n > mostN) { mostN = n; mostId = id; } });
  const mostItem = mostId ? coll.find((i) => i.id === mostId) : null;
  const cards = [
    { label: 'Alben hinzugefügt', val: addedThisYear },
    { label: 'Hör-Einträge', val: playsThisYear.length },
    { label: 'Alben gesamt', val: coll.length },
    { label: 'Ø Bewertung', val: avg ? avg.toFixed(1) + ' ♪' : '–' },
  ];
  let html = `<div class="wrapped-cards">${cards.map((c) => `<div class="wrapped-card"><span class="wrapped-num">${c.val}</span><span class="wrapped-lbl">${c.label}</span></div>`).join('')}</div>`;
  if (mostItem) {
    html += `<span class="dp-label wrapped-h">Meistgehört (${mostN}×)</span><button class="wrapped-album" data-id="${mostItem.id}"><div class="chart-cover${mostItem.coverUrl ? '' : ' placeholder'}">${mostItem.coverUrl ? `<img src="${escapeHtml(mostItem.coverUrl)}" alt="" />` : ''}</div><div class="chart-meta"><span class="chart-title">${escapeHtml(mostItem.title || '')}</span><span class="chart-artist">${escapeHtml(mostItem.artist || '')}</span></div></button>`;
  }
  if (topRated.length) {
    html += '<span class="dp-label wrapped-h">Top bewertet</span>' + topRated.map((it) => `<button class="wrapped-row" data-id="${it.id}"><span class="chart-title">${escapeHtml(it.artist || '')} – ${escapeHtml(it.title || '')}</span>${ratingDisplayHtml(it.rating)}</button>`).join('');
  }
  if (!coll.length && !playsThisYear.length) html = `<p class="hint">Noch keine Daten für ${year}. Füg Alben hinzu und log, was du hörst!</p>`;
  $('#wrapped-body').innerHTML = html;
  $('#wrapped-body').querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => { $('#wrapped-dialog').close(); openDetail('collection', b.dataset.id); }));
}
$('#btn-wrapped').addEventListener('click', openWrapped);
$('#btn-wrapped-close').addEventListener('click', () => $('#wrapped-dialog').close());

$('#detail-back').addEventListener('click', closeDetail);
$('#dp-rating-clear').addEventListener('click', () => detailRating && detailRating.setValue(0));
$('#dp-like').addEventListener('click', () => {
  if (!requireAuth()) return; // Gäste: erst anmelden
  dpLiked = !dpLiked;
  $('#dp-like').classList.toggle('liked', dpLiked);
});

$('#dp-add-collection').addEventListener('click', () => addPreviewTo('collection'));
$('#dp-add-wishlist').addEventListener('click', () => addPreviewTo('wishlist'));

$('#dp-newcover').addEventListener('click', openCoverPicker);
$('#btn-cover-close').addEventListener('click', () => $('#cover-dialog').close());

async function openCoverPicker() {
  if (!editing) return;
  const item = getList(editing.list).find((i) => i.id === editing.id);
  if (!item) return;
  const grid = $('#cover-grid');
  grid.innerHTML = '';
  $('#cover-status').textContent = 'Suche Cover…';
  $('#cover-dialog').showModal();
  let urls = [];
  try { urls = await fetchCoverCandidates(item); } catch { /* ignorieren */ }
  if (!urls.length) { $('#cover-status').textContent = 'Keine Cover gefunden.'; return; }
  $('#cover-status').textContent = '';
  grid.innerHTML = urls
    .map((u) => `<button data-url="${escapeHtml(u)}"><img src="${escapeHtml(u)}" alt="" loading="lazy" onerror="this.parentElement.remove()" /></button>`)
    .join('');
  grid.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const url = b.dataset.url;
    updateItem(editing.list, editing.id, { coverUrl: url });
    setDetailCover(url);
    $('#dp-edit-cover').value = url;
    renderList(editing.list);
    $('#cover-dialog').close();
    toast('Cover geändert');
  }));
}

$('#dp-save').addEventListener('click', () => {
  if (!editing) return;
  const list = editing.list;
  updateItem(list, editing.id, {
    artist: $('#dp-edit-artist').value.trim(),
    title: $('#dp-edit-title').value.trim(),
    year: $('#dp-edit-year').value.trim(),
    label: $('#dp-edit-label').value.trim(),
    format: $('#dp-edit-format').value.trim(),
    barcode: $('#dp-edit-barcode').value.trim(),
    coverUrl: $('#dp-edit-cover').value.trim(),
    price: parseFloat($('#dp-edit-price').value) || 0,
    mediaCond: $('#dp-edit-media').value,
    sleeveCond: $('#dp-edit-sleeve').value,
    note: $('#dp-note').value.trim(),
    review: $('#dp-review').value.trim(),
    rating: detailRating ? detailRating.getValue() : 0,
    liked: dpLiked,
  });
  closeDetail();
  renderList(list);
  toast('Gespeichert');
});

$('#dp-delete').addEventListener('click', () => {
  if (!editing) return;
  if (!confirm('Diesen Eintrag wirklich löschen?')) return;
  const list = editing.list;
  deleteItem(list, editing.id);
  closeDetail();
  renderList(list);
  renderCounts();
  toast('Gelöscht');
});

$('#dp-move').addEventListener('click', () => {
  if (!editing) return;
  const from = editing.list;
  const to = from === 'collection' ? 'wishlist' : 'collection';
  moveItem(from, to, editing.id);
  closeDetail();
  renderList('collection');
  renderList('wishlist');
  renderCounts();
  toast(to === 'wishlist' ? 'In Wishlist verschoben' : 'In Collection verschoben');
});

// ---------- Scannen ----------
const scanStatus = $('#scan-status');
function setScanStatus(msg, kind = '') {
  scanStatus.textContent = msg;
  scanStatus.className = 'scan-status ' + kind;
}

$('#btn-start-scan').addEventListener('click', async () => {
  if (!isSupported()) {
    setScanStatus('Scanner nicht verfügbar – bitte Barcode unten eintippen.', 'error');
    return;
  }
  setScanStatus('Kamera wird gestartet…');
  // Vorschau VOR dem Start einblenden, damit die Scanner-Bibliothek die
  // Größe des Bereichs messen kann (sonst nur schwarzer Balken ohne Bild).
  $('#reader').classList.remove('hidden');
  const ok = await startScanner('reader', onBarcode, (err) => setScanStatus(err, 'error'));
  if (ok) {
    $('#btn-start-scan').classList.add('hidden');
    $('#btn-stop-scan').classList.remove('hidden');
    setScanStatus('Halte den Barcode in den Rahmen.');
  } else {
    $('#reader').classList.add('hidden');
  }
});

$('#btn-stop-scan').addEventListener('click', async () => {
  await stopScanner();
  $('#reader').classList.add('hidden');
  $('#btn-start-scan').classList.remove('hidden');
  $('#btn-stop-scan').classList.add('hidden');
  setScanStatus('');
});

$('#btn-lookup-barcode').addEventListener('click', () => {
  const code = $('#manual-barcode').value.trim();
  if (code) onBarcode(code);
});
$('#manual-barcode').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#btn-lookup-barcode').click(); }
});

let lookupBusy = false;
async function onBarcode(code) {
  if (lookupBusy) return;
  lookupBusy = true;
  if (isRunning()) {
    await stopScanner();
    $('#reader').classList.add('hidden');
    $('#btn-start-scan').classList.remove('hidden');
    $('#btn-stop-scan').classList.add('hidden');
  }
  setScanStatus(`Suche Barcode ${code}…`);
  try {
    const result = await lookupBarcode(code);
    if (!result) {
      setScanStatus('Nichts gefunden. Du kannst die Platte manuell hinzufügen.', 'error');
      // Barcode in manuelles Formular übernehmen
      $('#manual-form').barcode.value = code;
    } else {
      setScanStatus('Gefunden!', 'ok');
      showResult(result);
    }
  } catch (err) {
    setScanStatus('Fehler bei der Suche: ' + (err?.message || err) + ' – ggf. manuell hinzufügen.', 'error');
    $('#manual-form').barcode.value = code;
  } finally {
    lookupBusy = false;
  }
}

// ---------- Ergebnis-Dialog ----------
const resultDialog = $('#result-dialog');
function showResult(result) {
  pendingResult = result;
  const cover = $('#result-cover');
  if (result.coverUrl) {
    cover.src = result.coverUrl;
    cover.style.display = '';
    cover.onerror = () => { cover.style.display = 'none'; };
  } else {
    cover.style.display = 'none';
  }
  $('#result-artist').textContent = result.artist || '(unbekannt)';
  $('#result-title').textContent = result.title || '(ohne Titel)';
  const sub = [result.year, result.label, result.format].filter(Boolean).join(' · ');
  $('#result-sub').textContent = sub + (result.source ? `  ·  Quelle: ${result.source}` : '');
  $('#result-note').value = '';
  resultRating = createRatingInput($('#result-rating'), 0);
  resultDialog.showModal();
}

async function saveResultTo(list) {
  if (!pendingResult) return;
  if (!pendingResult.coverUrl) {
    const c = await fetchCoverArt(pendingResult.artist, pendingResult.title);
    if (c) pendingResult.coverUrl = c;
  }
  addItem(list, {
    ...pendingResult,
    note: $('#result-note').value.trim(),
    rating: resultRating ? resultRating.getValue() : 0,
  });
  resultDialog.close();
  pendingResult = null;
  renderCounts();
  toast(list === 'collection' ? 'Zur Collection hinzugefügt' : 'Zur Wishlist hinzugefügt');
  setScanStatus('');
}

$('#btn-result-collection').addEventListener('click', () => saveResultTo('collection'));
$('#btn-result-wishlist').addEventListener('click', () => saveResultTo('wishlist'));
$('#btn-result-close').addEventListener('click', () => resultDialog.close());

// ---------- Datenbank durchsuchen (Lupe) + Vorschläge ----------
let searchResults = [];
let trendingCache = null;
let popularCache = null;
let friendsFeedCache = [];
let friendsFollowing = new Set();

const SUGG_GENRES = ['Rock', 'Electronic', 'Jazz', 'Hip Hop', 'Funk / Soul', 'Pop', 'Reggae', 'Classical', 'Blues'];
const SUGG_DECADES = [['60er', '1960-1969'], ['70er', '1970-1979'], ['80er', '1980-1989'], ['90er', '1990-1999'], ['2000er', '2000-2009'], ['2010er', '2010-2019']];
const DISCOVER_POOL = ['Pink Floyd', 'Daft Punk', 'Miles Davis', 'Fleetwood Mac', 'Kendrick Lamar', 'Radiohead', 'David Bowie', 'Nirvana', 'The Beatles', 'Tame Impala', 'Amy Winehouse', 'Led Zeppelin', 'Bob Marley', 'Arctic Monkeys', 'Kraftwerk', 'Michael Jackson', 'Queen', 'Talking Heads', 'Massive Attack', 'Stevie Wonder'];

// Kategorien mit Cover-Vorschau-Reihen
const FEATURED = [
  { label: 'Rock', params: { genre: 'Rock' } },
  { label: 'Electronic', params: { genre: 'Electronic' } },
  { label: 'Hip Hop', params: { genre: 'Hip Hop' } },
  { label: 'Jazz', params: { genre: 'Jazz' } },
  { label: 'Funk / Soul', params: { genre: 'Funk / Soul' } },
  { label: 'Pop', params: { genre: 'Pop' } },
];
const rowCache = {};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function chipHtml(label, params) {
  return `<button class="chip" data-params='${escapeHtml(JSON.stringify(params))}'>${escapeHtml(label)}</button>`;
}

function collectionArtists() {
  const counts = {};
  getList('collection').forEach((i) => { const a = (i.artist || '').trim(); if (a) counts[a] = (counts[a] || 0) + 1; });
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 6);
}

function bindChips(container) {
  container.querySelectorAll('.chip').forEach((el) => {
    el.addEventListener('click', () => {
      let params = {};
      try { params = JSON.parse(el.dataset.params); } catch { /* ignorieren */ }
      $('#search-db').value = el.textContent.replace(/^Mehr von /, '');
      runDbSearchWith(params);
    });
  });
}

async function loadTrending() {
  const block = $('#sugg-trending');
  if (!block) return;
  const chipsEl = block.querySelector('.chips');
  const key = (getSettings().lastfmKey || '').trim();
  if (!key) {
    chipsEl.innerHTML = '<span class="hint">Für Trending einen kostenlosen Last.fm-Key unter „Mehr" eintragen.</span>';
    return;
  }
  if (trendingCache) {
    chipsEl.innerHTML = trendingCache.map((a) => chipHtml(a, { artist: a })).join('');
    bindChips(block);
    return;
  }
  try {
    const artists = await lastfmTopArtists(14);
    if (!artists || !artists.length) { chipsEl.innerHTML = '<span class="hint">Keine Trending-Daten.</span>'; return; }
    trendingCache = artists;
    chipsEl.innerHTML = artists.map((a) => chipHtml(a, { artist: a })).join('');
    bindChips(block);
  } catch {
    chipsEl.innerHTML = '<span class="hint">Trending nicht verfügbar – Last.fm-Key prüfen.</span>';
  }
}

let browseResults = [];
const BROWSE_GENRES = ['Rock', 'Electronic', 'Jazz', 'Hip Hop', 'Funk / Soul', 'Pop', 'Reggae', 'Classical', 'Blues', 'Folk, World, & Country', 'Latin', 'Soundtrack'];
const BROWSE_TABS = [
  { id: 'release', label: 'Release date' },
  { id: 'genre', label: 'Genre' },
  { id: 'popular', label: 'Most Popular' },
  { id: 'rated', label: 'Highest Rated' },
  { id: 'top500', label: 'Top 500' },
];
const BROWSE_DECADES = [['2020er', '2020-2029'], ['2010er', '2010-2019'], ['2000er', '2000-2009'], ['1990er', '1990-1999'], ['1980er', '1980-1989'], ['1970er', '1970-1979'], ['1960er', '1960-1969'], ['1950er', '1950-1959']];

function renderBrowse() {
  const c = $('#browse-content');
  $('#search-status').textContent = '';
  c.innerHTML = `<ul class="browse-list">${BROWSE_TABS.map((t) => `<li class="browse-row" data-tab="${t.id}"><span>${t.label}</span><span class="chev">›</span></li>`).join('')}</ul>`;
  c.querySelectorAll('.browse-row[data-tab]').forEach((li) => li.addEventListener('click', () => openBrowseTab(li.dataset.tab)));
}

function openBrowseTab(name) {
  if (name === 'release') renderDrillList(BROWSE_DECADES.map(([l, y]) => ({ label: l, params: { year: y } })), 'Erscheinungsjahr');
  else if (name === 'genre') renderDrillList(BROWSE_GENRES.map((g) => ({ label: g, params: { genre: g } })), 'Genre');
  else if (name === 'popular') browseCovers({ sort: 'have', sort_order: 'desc', per_page: 60 }, 'Most Popular – meistgesammelt', renderBrowse);
  else if (name === 'rated') browseCovers({ sort: 'want', sort_order: 'desc', per_page: 60 }, 'Highest Rated – am meisten begehrt', renderBrowse);
  else if (name === 'top500') browseCovers({ sort: 'have', sort_order: 'desc', per_page: 100 }, 'Top 100 – meistgesammelt', renderBrowse);
}

function renderDrillList(items, title) {
  const c = $('#browse-content');
  c.innerHTML = `<button class="browse-back" id="browse-back">‹ zurück</button><p class="browse-title">${escapeHtml(title)}</p><ul class="browse-list">${items.map((it, i) => `<li class="browse-row" data-i="${i}"><span>${escapeHtml(it.label)}</span><span class="chev">›</span></li>`).join('')}</ul>`;
  $('#browse-back').addEventListener('click', renderBrowse);
  c.querySelectorAll('.browse-row[data-i]').forEach((li) => li.addEventListener('click', () => {
    const it = items[+li.dataset.i];
    browseCovers({ ...it.params, sort: 'have', sort_order: 'desc', per_page: 60 }, it.label, () => renderDrillList(items, title));
  }));
}

// Mehrfach-Pressungen desselben Albums zusammenfassen (nach Master-Release,
// sonst Künstler+Titel) – damit jedes Album nur einmal erscheint.
function dedupeAlbums(list) {
  const seen = new Set();
  return list.filter((r) => {
    const key = r.masterId
      ? 'm' + r.masterId
      : (`${r.artist || ''}|${r.title || ''}`).toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function browseCovers(params, title, backFn) {
  const c = $('#browse-content');
  const head = (extra) => `${backFn ? '<button class="browse-back" id="browse-back">‹ zurück</button>' : ''}<p class="browse-title">${escapeHtml(title)}</p>${extra}`;
  const wireBack = () => { if (backFn) { const b = $('#browse-back'); if (b) b.addEventListener('click', backFn); } };
  c.innerHTML = head('<p class="hint">Lade…</p>');
  wireBack();
  let res;
  try {
    res = await discogsSearch(params);
  } catch (err) {
    c.innerHTML = head(`<p class="hint">Fehler: ${escapeHtml(err?.message || String(err))}</p>`);
    wireBack();
    return;
  }
  browseResults = dedupeAlbums(res);
  const withCover = browseResults.filter((r) => r.coverUrl);
  const list = withCover.length ? withCover : browseResults;
  if (!list.length) {
    c.innerHTML = head('<p class="hint">Nichts gefunden.</p>');
    wireBack();
    return;
  }
  c.innerHTML = head(`<div class="browse-grid">${list.map((r) => {
    const idx = browseResults.indexOf(r);
    return `<button data-idx="${idx}">${r.coverUrl ? `<img src="${escapeHtml(r.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.remove()" />` : ''}</button>`;
  }).join('')}</div>`);
  wireBack();
  c.querySelectorAll('.browse-grid button[data-idx]').forEach((b) => b.addEventListener('click', () => openPreview(browseResults[+b.dataset.idx])));
}

async function loadCategoryRow(elId, label, params) {
  const el = document.getElementById(elId);
  if (!el) return;
  let results = rowCache[label];
  if (!results) {
    try { results = dedupeAlbums(await discogsSearch(params)); } catch { results = []; }
    rowCache[label] = results;
  }
  const withCover = results.filter((r) => r.coverUrl);
  const show = (withCover.length >= 5 ? withCover : results).slice(0, 5);
  if (!show.length) { el.innerHTML = '<span class="hint" style="grid-column:1/-1">Keine Vorschau verfügbar.</span>'; return; }
  el.innerHTML = show.map((r) => {
    const idx = results.indexOf(r);
    return `<button class="cat-cover${r.coverUrl ? '' : ' placeholder'}" data-idx="${idx}">${
      r.coverUrl ? `<img src="${escapeHtml(r.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();" />` : ''
    }</button>`;
  }).join('');
  el.querySelectorAll('.cat-cover[data-idx]').forEach((b) => b.addEventListener('click', () => openPreview(rowCache[label][+b.dataset.idx])));
}

function openCategory(label, params) {
  $('#search-db').value = label;
  if (rowCache[label] && rowCache[label].length) {
    searchResults = rowCache[label];
    renderSearchResults();
  } else {
    runDbSearchWith(params);
  }
}

function renderSearchResults() {
  const c = $('#browse-content');
  if (!searchResults.length) { c.innerHTML = ''; $('#search-status').textContent = 'Nichts gefunden.'; return; }
  $('#search-status').textContent = '';
  c.innerHTML = `<ul class="search-results">${searchResults.map((r, i) => {
    const cover = `<div class="sr-cover${r.coverUrl ? '' : ' placeholder'}">${
      r.coverUrl ? `<img src="${escapeHtml(r.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();" />` : ''
    }</div>`;
    const sub = [r.year, r.format].filter(Boolean).join(' · ');
    return `<li class="search-result" data-idx="${i}">${cover}<div class="sr-info"><p class="sr-title">${escapeHtml(r.title) || '(ohne Titel)'}</p><p class="sr-artist">${escapeHtml(r.artist)}</p><p class="sr-sub">${escapeHtml(sub)}</p></div></li>`;
  }).join('')}</ul>`;
  c.querySelectorAll('.search-result').forEach((el) => el.addEventListener('click', () => openPreview(searchResults[+el.dataset.idx])));
}

async function runDbSearchWith(params) {
  if (currentView !== 'search') switchView('search');
  $('#browse-content').innerHTML = '';
  $('#search-status').textContent = 'Suche…';
  try {
    searchResults = dedupeAlbums(await discogsSearch(params));
    renderSearchResults();
  } catch (err) {
    $('#search-status').textContent = 'Fehler bei der Suche: ' + (err?.message || err);
  }
}

function runDbSearch() {
  const q = $('#search-db').value.trim();
  if (!q) { renderBrowse(); return; }
  runDbSearchWith({ q });
}

$('#btn-search-db').addEventListener('click', runDbSearch);
$('#search-db').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); runDbSearch(); }
});
$('#search-db').addEventListener('input', () => {
  if (!$('#search-db').value.trim()) renderBrowse();
});

// ---------- Manuelles Formular ----------
$('#manual-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const list = f.list.value;
  addItem(list, {
    artist: f.artist.value.trim(),
    title: f.title.value.trim(),
    year: f.year.value.trim(),
    label: f.label.value.trim(),
    format: f.format.value.trim(),
    barcode: f.barcode.value.trim(),
    coverUrl: f.coverUrl.value.trim(),
    price: parseFloat(f.price.value) || 0,
    note: f.note.value.trim(),
    rating: manualRating ? manualRating.getValue() : 0,
    source: 'manual',
  });
  f.reset();
  if (manualRating) manualRating.setValue(0);
  renderCounts();
  toast(list === 'collection' ? 'Zur Collection hinzugefügt' : 'Zur Wishlist hinzugefügt');
  switchView(list);
});

// ---------- Mein Profil ----------
function loadSettings() {
  /* keine clientseitigen API-Einstellungen mehr (Discogs läuft über den Proxy) */
}

function setSetting(patch) {
  saveSettings({ ...getSettings(), ...patch });
}

function fmtEuro(n) {
  return (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

function renderProfile() {
  const p = getProfile() || {};
  $('#profile-banner').style.backgroundImage = p.banner_url ? `url("${p.banner_url}")` : '';
  const av = $('#profile-avatar-display');
  if (p.avatar_url) {
    av.style.backgroundImage = `url("${p.avatar_url}")`;
    av.innerHTML = '';
  } else {
    av.style.backgroundImage = '';
    av.innerHTML = '<svg class="avatar-ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
  }
  const loc = (p.location || '').trim();
  const web = (p.website || '').trim();
  const parts = [];
  if (loc) parts.push(`📍 ${escapeHtml(loc)}`);
  if (web) {
    const href = /^https?:\/\//.test(web) ? web : 'https://' + web;
    parts.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener">🔗 ${escapeHtml(web.replace(/^https?:\/\//, ''))}</a>`);
  }
  $('#profile-meta-line').innerHTML = parts.join('  ·  ');
  $('#profile-bio-display').textContent = p.bio || '';
  renderFavoritesDisplay();
  renderRecent();
  renderHisto();
  renderStatRows();
  renderValueRange();
}

function renderRecent() {
  const recent = [...getList('collection')].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 4);
  const el = $('#recent-activity');
  if (!recent.length) { el.innerHTML = '<span class="hint">Noch nichts hinzugefügt.</span>'; return; }
  el.innerHTML = recent.map((i) => {
    const cov = i.coverUrl
      ? `<img src="${escapeHtml(i.coverUrl)}" alt="" onerror="this.parentElement.classList.add('placeholder');this.remove()" />`
      : '';
    return `<button class="recent-cell" data-id="${i.id}"><div class="recent-cover${i.coverUrl ? '' : ' placeholder'}">${cov}</div>${ratingDisplayHtml(i.rating)}</button>`;
  }).join('');
  el.querySelectorAll('.recent-cell').forEach((b) => b.addEventListener('click', () => openDetail('collection', b.dataset.id)));
}

function renderHisto() {
  const coll = getList('collection');
  const steps = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  const counts = steps.map((v) => coll.filter((i) => (Number(i.rating) || 0) === v).length);
  const max = Math.max(1, ...counts);
  const bars = counts.map((c) => `<div class="histo-bar" data-count="${c}" style="height:${(c / max) * 100}%"><span class="histo-val">${c}</span></div>`).join('');
  const miniNote = `<svg class="mini-note" viewBox="0 0 24 24" fill="currentColor"><path d="${NOTE_PATH}"/></svg>`;
  $('#rating-histo').innerHTML =
    `<span class="histo-end">${miniNote}</span><div class="histo-bars">${bars}</div><span class="histo-end">${miniNote.repeat(5)}</span>`;

  // Touch/Halten am Handy: Zahl über dem berührten Balken zeigen (Hover macht CSS)
  const wrap = $('#rating-histo .histo-bars');
  const clear = () => wrap.querySelectorAll('.histo-bar.show-val').forEach((b) => b.classList.remove('show-val'));
  const showAt = (x, y) => {
    clear();
    const el = document.elementFromPoint(x, y);
    const b = el && el.closest ? el.closest('.histo-bar') : null;
    if (b && wrap.contains(b)) b.classList.add('show-val');
  };
  wrap.addEventListener('touchstart', (e) => showAt(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  wrap.addEventListener('touchmove', (e) => showAt(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  wrap.addEventListener('touchend', clear);
  wrap.addEventListener('touchcancel', clear);
}

function renderStatRows() {
  const coll = getList('collection');
  const wish = getList('wishlist');
  const total = coll.reduce((sum, i) => sum + (Number(i.price) || 0), 0);
  const rows = [
    { label: 'Alben', val: coll.length, go: () => switchView('collection') },
    { label: 'Wishlist', val: wish.length, go: () => setProfileTab('watchlist') },
    { label: 'Favoriten', val: coll.filter((i) => i.liked).length },
    { label: 'Bewertet', val: coll.filter((i) => Number(i.rating) > 0).length },
    { label: 'Notizen', val: coll.filter((i) => (i.note || '').trim()).length },
    { label: 'Sammlungswert', val: fmtEuro(total) },
  ];
  const ul = $('#stat-rows');
  ul.innerHTML = rows.map((r, idx) =>
    `<li${r.go ? ` data-i="${idx}"` : ''}><span>${r.label}</span><span class="stat-num">${r.val}${r.go ? ' ›' : ''}</span></li>`).join('');
  ul.querySelectorAll('li[data-i]').forEach((li) => li.addEventListener('click', () => rows[+li.dataset.i].go()));
}

// ---------- Sammlungswert (Marktschätzung, min–max) ----------
const PRICE_CACHE_KEY = 'vinyl.pricecache';
const PRICE_TTL = 7 * 24 * 3600 * 1000; // 7 Tage
let valueRangeReq = 0;
function readPriceCache() { try { return JSON.parse(localStorage.getItem(PRICE_CACHE_KEY)) || {}; } catch { return {}; } }
function writePriceCache(c) { try { localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(c)); } catch { /* voll */ } }

function valueRangeBar(min, max, valued, total, loading) {
  if (!valued && !loading) {
    return '<p class="hint">Noch keine Marktdaten. Tipp: eigene Preise im Album unter „Details bearbeiten" eintragen.</p>';
  }
  const note = `Marktwert ca. · automatisch von Discogs · ${valued}/${total} Alben` + (loading ? ' <span class="vr-loading">· aktualisiere…</span>' : '');
  return `<div class="vr-bar"><span class="vr-fill"></span></div>
    <div class="vr-labels"><span>${fmtEuro(min)}</span><span class="vr-dash">bis</span><span>${fmtEuro(max)}</span></div>
    <p class="vr-note">${note}</p>`;
}

async function renderValueRange() {
  const el = $('#value-range'); if (!el) return;
  const coll = getList('collection');
  if (!coll.length) { el.innerHTML = '<p class="hint">Noch keine Alben in der Sammlung.</p>'; return; }
  const cache = readPriceCache();
  const now = Date.now();
  let min = 0, max = 0, valued = 0;
  const toFetch = [];
  for (const it of coll) {
    if (Number(it.price) > 0) { min += Number(it.price); max += Number(it.price); valued++; continue; } // manuelle Übersteuerung
    if (it.source === 'discogs' && it.sourceId) {
      const c = cache[it.sourceId];
      if (c && (now - c.at) < PRICE_TTL) { if (c.min != null) { min += c.min; max += c.max; valued++; } }
      else toFetch.push(it);
    }
  }
  el.innerHTML = valueRangeBar(min, max, valued, coll.length, toFetch.length > 0);
  if (!toFetch.length) return;
  const reqId = ++valueRangeReq;
  const cap = toFetch.slice(0, 40); // pro Durchgang begrenzen (Rate-Limit)
  let idx = 0;
  const worker = async () => {
    while (idx < cap.length) {
      if (reqId !== valueRangeReq) return;
      const it = cap[idx++];
      let r = null;
      try { r = await fetchPriceRange(it); } catch { /* ignorieren */ }
      const cur = readPriceCache();
      cur[it.sourceId] = r ? { min: r.min, max: r.max, at: Date.now() } : { min: null, max: null, at: Date.now() };
      writePriceCache(cur);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (reqId === valueRangeReq && currentView === 'settings') renderValueRange();
}

function favSlotInner(item) {
  return item.coverUrl
    ? `<img src="${escapeHtml(item.coverUrl)}" alt="" onerror="this.remove()" />`
    : '<span class="fav-disc"></span>';
}

// Anzeige auf der Profilseite (klickbar -> Albumseite)
function renderFavoritesDisplay() {
  const favIds = (getProfile() || {}).favorites || [];
  const coll = getList('collection');
  const el = $('#profile-favorites');
  if (!el) return;
  let html = '';
  for (let i = 0; i < 4; i++) {
    const item = favIds[i] ? coll.find((x) => x.id === favIds[i]) : null;
    html += item ? `<button class="fav-slot filled" data-id="${item.id}">${favSlotInner(item)}</button>` : '<div class="fav-slot empty"></div>';
  }
  el.innerHTML = html;
  el.querySelectorAll('.fav-slot.filled').forEach((b) => b.addEventListener('click', () => openDetail('collection', b.dataset.id)));
}

// Bearbeitbare Slots im Profil-Popup
function renderFavoritesEdit() {
  const favIds = (getProfile() || {}).favorites || [];
  const coll = getList('collection');
  const el = $('#ps-favorites');
  if (!el) return;
  let html = '';
  for (let i = 0; i < 4; i++) {
    const item = favIds[i] ? coll.find((x) => x.id === favIds[i]) : null;
    html += item
      ? `<button type="button" class="fav-slot filled" data-slot="${i}">${favSlotInner(item)}<span class="fav-x">×</span></button>`
      : `<button type="button" class="fav-slot empty" data-slot="${i}">+</button>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('.fav-slot').forEach((b) => b.addEventListener('click', () => {
    const slot = +b.dataset.slot;
    if (b.classList.contains('filled')) removeFavorite(slot);
    else openFavPicker(slot);
  }));
}

function refreshFavorites() {
  renderFavoritesEdit();
  renderFavoritesDisplay();
}

function removeFavorite(slot) {
  const fav = ((getProfile() || {}).favorites || []).slice();
  fav[slot] = null;
  updateProfile({ favorites: fav });
  refreshFavorites();
}

function openFavPicker(slot) {
  const coll = getList('collection');
  const grid = $('#fav-pick-grid');
  $('#fav-pick-status').textContent = coll.length ? '' : 'Deine Collection ist leer.';
  grid.innerHTML = coll.map((i) => `<button data-id="${i.id}">${favSlotInner(i)}</button>`).join('');
  $('#fav-dialog').showModal();
  grid.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const fav = ((getProfile() || {}).favorites || []).slice();
    while (fav.length < 4) fav.push(null);
    fav[slot] = b.dataset.id;
    updateProfile({ favorites: fav });
    $('#fav-dialog').close();
    refreshFavorites();
  }));
}

function downscaleImage(file, maxW, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.naturalWidth);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve('');
    const fr = new FileReader();
    fr.onload = () => { img.src = fr.result; };
    fr.readAsDataURL(file);
  });
}

function openProfileSettings() {
  const p = getProfile() || {};
  $('#ps-name').value = p.display_name || p.username || '';
  $('#ps-email').value = (getUser() && getUser().email) || '';
  $('#ps-email').readOnly = true;
  $('#ps-location').value = p.location || '';
  $('#ps-website').value = p.website || '';
  $('#ps-bio').value = p.bio || '';
  renderFavoritesEdit();
  $('#profile-settings-dialog').showModal();
}
$('#header-settings').addEventListener('click', openProfileSettings);
$('#btn-psettings-close').addEventListener('click', () => $('#profile-settings-dialog').close());
$('#ps-save').addEventListener('click', () => {
  const name = $('#ps-name').value.trim();
  updateProfile({
    display_name: name,
    location: $('#ps-location').value.trim(),
    website: $('#ps-website').value.trim(),
    bio: $('#ps-bio').value.trim(),
  });
  if (currentView === 'settings') $('#view-title').textContent = profileName() || 'Mein Profil';
  $('#profile-settings-dialog').close();
  renderProfile();
  toast('Profil gespeichert');
});
$('#ps-banner-btn').addEventListener('click', () => $('#banner-file').click());
$('#ps-avatar-btn').addEventListener('click', () => $('#avatar-file').click());
$('#banner-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const dataUrl = await downscaleImage(file, 1280, 0.82);
  if (dataUrl) { updateProfile({ banner_url: dataUrl }); renderProfile(); }
  e.target.value = '';
});
$('#avatar-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const dataUrl = await downscaleImage(file, 400, 0.85);
  if (dataUrl) { updateProfile({ avatar_url: dataUrl }); renderProfile(); }
  e.target.value = '';
});
$('#btn-fav-close').addEventListener('click', () => $('#fav-dialog').close());

$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `schallplatten-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!confirm('Import überschreibt deine aktuelle Collection & Wishlist. Fortfahren?')) return;
    importAll(data);
    renderList('collection');
    renderList('wishlist');
    renderCounts();
    toast('Import erfolgreich');
  } catch (err) {
    toast('Import fehlgeschlagen: ' + (err?.message || err));
  } finally {
    e.target.value = '';
  }
});

// ---------- Toast ----------
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

// ---------- Service Worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

// ---------- Profil-Tabs (Profil / Playlist / Watchlist) ----------
function setProfileTab(name) {
  document.querySelectorAll('.ptab').forEach((b) => b.classList.toggle('active', b.dataset.ptab === name));
  document.querySelectorAll('.ptab-panel').forEach((p) => p.classList.toggle('active', p.id === 'ptab-' + name));
  if (name === 'profile') renderProfile();
  else if (name === 'playlist') renderPlaylists();
  else if (name === 'watchlist') renderList('wishlist');
}
document.querySelectorAll('.ptab').forEach((b) => b.addEventListener('click', () => setProfileTab(b.dataset.ptab)));

// ---------- Playlists ----------
function renderPlaylists() {
  const pls = getPlaylists();
  const c = $('#playlists-container');
  if (!pls.length) {
    c.innerHTML = '<p class="pl-none">Noch keine Playlists. Lege oben eine an und füge Alben über „+ Playlist" auf der Albumseite hinzu.</p>';
    return;
  }
  const coll = getList('collection');
  c.innerHTML = pls.map((p) => {
    const albums = p.itemIds.map((id) => coll.find((x) => x.id === id)).filter(Boolean);
    const covers = albums.length
      ? `<div class="playlist-albums">${albums.map((a) => `<button class="pa-cover" data-id="${a.id}">${a.coverUrl ? `<img src="${escapeHtml(a.coverUrl)}" alt="" onerror="this.parentElement.classList.add('placeholder');this.remove()" />` : ''}</button>`).join('')}</div>`
      : '<p class="playlist-empty">Noch leer.</p>';
    const desc = p.description ? `<p class="pl-desc">${escapeHtml(p.description)}</p>` : '';
    return `<div class="playlist-item"><div class="playlist-head"><span class="pl-title">${escapeHtml(p.name)}</span><span><span class="pl-count">${albums.length}</span> <button class="playlist-del" data-del="${p.id}">löschen</button></span></div>${desc}${covers}</div>`;
  }).join('');
  c.querySelectorAll('.pa-cover').forEach((b) => b.addEventListener('click', () => openDetail('collection', b.dataset.id)));
  c.querySelectorAll('.playlist-del').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm('Playlist löschen?')) { deletePlaylist(b.dataset.del); renderPlaylists(); }
  }));
}

$('#btn-new-playlist').addEventListener('click', () => $('#create-playlist-dialog').showModal());
$('#btn-create-pl-close').addEventListener('click', () => $('#create-playlist-dialog').close());
$('#btn-create-playlist').addEventListener('click', () => {
  const name = $('#new-playlist-name').value.trim();
  if (!name) return;
  createPlaylist(name, $('#new-playlist-desc').value.trim());
  $('#new-playlist-name').value = '';
  $('#new-playlist-desc').value = '';
  $('#create-playlist-dialog').close();
  renderPlaylists();
  toast('Playlist angelegt');
});
$('#new-playlist-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#btn-create-playlist').click(); }
});

// Album zu Playlist(s) hinzufügen (vom Detail)
function renderPlaylistChoice() {
  const pls = getPlaylists();
  const el = $('#playlist-choice');
  el.innerHTML = pls.length
    ? pls.map((p) => `<label><input type="checkbox" data-pl="${p.id}" ${p.itemIds.includes(editing.id) ? 'checked' : ''} /> ${escapeHtml(p.name)}</label>`).join('')
    : '<p class="pl-none">Noch keine Playlist – unten anlegen.</p>';
  el.querySelectorAll('input[data-pl]').forEach((cb) => cb.addEventListener('change', () => togglePlaylistItem(cb.dataset.pl, editing.id)));
}
$('#dp-add-playlist').addEventListener('click', () => {
  if (!editing) return;
  renderPlaylistChoice();
  $('#playlist-dialog').showModal();
});
$('#btn-playlist-close').addEventListener('click', () => $('#playlist-dialog').close());
$('#btn-pl-dialog-create').addEventListener('click', () => {
  const n = $('#pl-dialog-new').value.trim();
  if (!n || !editing) return;
  const p = createPlaylist(n);
  togglePlaylistItem(p.id, editing.id);
  $('#pl-dialog-new').value = '';
  renderPlaylistChoice();
});

// ---------- Startseite ----------
function goCategory(label, params) {
  if (currentView !== 'search') switchView('search');
  openCategory(label, params);
}

function buildBrowseRows(container, prefix) {
  container.innerHTML = FEATURED.map((f, i) =>
    `<div class="cat-row"><button class="cat-head" data-cat="${i}">${escapeHtml(f.label)}<span class="cat-more">alle ›</span></button><div class="cat-covers" id="${prefix}-${i}">${'<div class="cat-cover placeholder"></div>'.repeat(5)}</div></div>`).join('');
  container.querySelectorAll('.cat-head').forEach((h) => h.addEventListener('click', () => {
    const f = FEATURED[+h.dataset.cat];
    goCategory(f.label, f.params);
  }));
  FEATURED.forEach((f, i) => loadCategoryRow(`${prefix}-${i}`, f.label, f.params));
}

function greetingText() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Guten Morgen';
  if (h >= 12 && h < 18) return 'Hallo';
  return 'Guten Abend';
}

function renderHome() {
  const el = $('#home-content');
  el.innerHTML =
    '<div class="home-greet">' +
      '<button class="home-greet-av" id="home-greet-av" aria-label="Mein Profil"></button>' +
      '<div class="home-greet-text"><span class="home-greet-hello" id="home-greet-hello"></span></div>' +
      '<button class="home-bell" id="home-bell" aria-label="Benachrichtigungen">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' +
      '</button>' +
    '</div>' +
    '<div class="home-section"><span class="dp-label">Popular this week</span><ol id="home-pop-list" class="chart-list"><li class="hint">Lade…</li></ol></div>' +
    '<div class="home-section"><span class="dp-label">New from friends</span><div id="home-friends" class="home-friends"></div></div>' +
    `<div class="home-section"><span class="dp-label">Neu erschienen ${new Date().getFullYear()}</span><ol id="home-new-list" class="chart-list"><li class="hint">Lade…</li></ol></div>`;

  // Begrüßung je nach Tageszeit + Profilbild im Dusty-Rose-Rahmen
  const p = getProfile() || {};
  const name = profileName();
  $('#home-greet-hello').textContent = greetingText() + (name ? ', ' + name : '');
  const gav = $('#home-greet-av');
  if (p.avatar_url) {
    gav.style.backgroundImage = `url("${p.avatar_url}")`;
    gav.classList.remove('placeholder');
    gav.innerHTML = '';
  } else {
    gav.style.backgroundImage = '';
    gav.classList.add('placeholder');
    gav.innerHTML = '<svg class="avatar-ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
  }
  gav.addEventListener('click', () => { if (requireAuth()) switchView('settings'); });
  $('#home-bell').addEventListener('click', () => toast('Keine neuen Benachrichtigungen'));

  loadPopularThisWeek();
  renderFriendsRow();
  loadNewReleases();
}

// „Neu erschienen" – beliebte Releases des aktuellen Jahres (über Discogs).
let newReleasesCache = null;
async function loadNewReleases() {
  const ol = document.getElementById('home-new-list');
  if (!ol) return;
  let res = newReleasesCache;
  if (!res) {
    const year = new Date().getFullYear();
    try { res = dedupeAlbums(await discogsSearch({ year: String(year), sort: 'have', sort_order: 'desc', per_page: 40 })); }
    catch { res = []; }
    newReleasesCache = res;
  }
  const withCover = res.filter((r) => r.coverUrl);
  const list = (withCover.length >= 10 ? withCover : res).slice(0, 12);
  if (!list.length) { ol.innerHTML = '<li class="hint">Keine Daten verfügbar.</li>'; return; }
  ol.innerHTML = list.map((r) => {
    const idx = res.indexOf(r);
    const cov = r.coverUrl ? `<img src="${escapeHtml(r.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();" />` : '';
    return `<li class="chart-item" data-idx="${idx}"><div class="chart-cover${r.coverUrl ? '' : ' placeholder'}">${cov}</div><div class="chart-meta"><span class="chart-title">${escapeHtml(r.title || '')}</span><span class="chart-artist">${escapeHtml(r.artist || '')}</span></div></li>`;
  }).join('');
  ol.querySelectorAll('.chart-item').forEach((li) => li.addEventListener('click', () => openPreview(newReleasesCache[+li.dataset.idx])));
}

// „Popular this week" – Top 10. Echte Streaming-Abspielzahlen (Spotify/Apple/
// Amazon) gibt es clientseitig nicht; als verfügbare Quelle nutzen wir die
// meistgesammelten Alben von Discogs als Beliebtheits-Proxy.
async function loadPopularThisWeek() {
  const ol = document.getElementById('home-pop-list');
  if (!ol) return;
  let res = popularCache;
  if (!res) {
    try { res = dedupeAlbums(await discogsSearch({ sort: 'have', sort_order: 'desc', per_page: 40 })); }
    catch { res = []; }
    popularCache = res;
  }
  const withCover = res.filter((r) => r.coverUrl);
  const list = (withCover.length >= 10 ? withCover : res).slice(0, 10);
  if (!list.length) { ol.innerHTML = '<li class="hint">Keine Daten verfügbar.</li>'; return; }
  ol.innerHTML = list.map((r, i) => {
    const idx = res.indexOf(r);
    const cov = r.coverUrl
      ? `<img src="${escapeHtml(r.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();" />`
      : '';
    return `<li class="chart-item" data-idx="${idx}">
        <span class="chart-rank">${i + 1}</span>
        <div class="chart-cover${r.coverUrl ? '' : ' placeholder'}">${cov}</div>
        <div class="chart-meta"><span class="chart-title">${escapeHtml(r.title || '')}</span><span class="chart-artist">${escapeHtml(r.artist || '')}</span></div>
      </li>`;
  }).join('');
  ol.querySelectorAll('.chart-item').forEach((li) =>
    li.addEventListener('click', () => openPreview(popularCache[+li.dataset.idx])));
}

// „New from friends" – Neuzugänge von gefolgten Nutzern.
async function renderFriendsRow() {
  const el = document.getElementById('home-friends');
  if (!el) return;
  if (!getUser()) {
    el.innerHTML = '<div class="home-empty-card">Melde dich an, um Freunden zu folgen und ihre Neuzugänge zu sehen. <button id="friends-cta" class="link-btn">Anmelden</button></div>';
    const b = el.querySelector('#friends-cta'); if (b) b.onclick = () => openAuth('login');
    return;
  }
  el.innerHTML = '<div class="home-empty-card">Lade…</div>';
  let feed = [];
  try { feed = await fetchFriendsFeed(20); } catch { /* ignorieren */ }
  if (!feed.length) {
    el.innerHTML = '<div class="home-empty-card">Noch nichts von Freunden. <button id="friends-cta" class="link-btn">Freunde finden</button></div>';
    const b = el.querySelector('#friends-cta'); if (b) b.onclick = openFriendsDialog;
    return;
  }
  friendsFeedCache = feed;
  el.innerHTML = feed.map((r, i) => {
    const cov = r.coverUrl ? `<img src="${escapeHtml(r.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();" />` : '';
    const who = r.by ? (r.by.display_name || r.by.username || '') : '';
    const action = r.kind === 'play' ? 'gehört' : 'hinzugefügt';
    const noteSrc = r.kind === 'play' ? (r.playNote || '') : (r.review || '');
    const rev = noteSrc.trim() ? '<span class="friend-rev">„' + escapeHtml(noteSrc.trim().slice(0, 50)) + (noteSrc.trim().length > 50 ? '…' : '') + '"</span>' : '';
    const stars = Number(r.rating) > 0 ? `<span class="friend-rating">${ratingDisplayHtml(r.rating)}</span>` : '';
    return `<button class="chart-item friend-item" data-idx="${i}">
        <div class="chart-cover${r.coverUrl ? '' : ' placeholder'}">${cov}</div>
        <div class="chart-meta"><span class="chart-title">${escapeHtml(r.title || '')}</span><span class="chart-artist">${escapeHtml(r.artist || '')}</span><span class="friend-by">${escapeHtml(who)} · ${action}</span>${stars}${rev}</div>
      </button>`;
  }).join('');
  el.querySelectorAll('.friend-item').forEach((b) =>
    b.addEventListener('click', () => openActivity(friendsFeedCache[+b.dataset.idx])));
}

// ---------- Aktivitäts-Fenster (Review, Like, Kommentare) ----------
let activityItem = null;
async function openActivity(it) {
  if (!it) return;
  activityItem = it;
  const cov = $('#act-cover');
  cov.className = 'chart-cover' + (it.coverUrl ? '' : ' placeholder');
  cov.innerHTML = it.coverUrl ? `<img src="${escapeHtml(it.coverUrl)}" alt="" />` : '';
  $('#act-name').textContent = it.title || '';
  $('#act-artist').textContent = it.artist || '';
  let byText = 'von ' + (it.by ? (it.by.display_name || it.by.username || '') : '');
  if (it.kind === 'play' && it.playedOn) byText += ' · gehört am ' + new Date(it.playedOn).toLocaleDateString('de-DE');
  $('#act-by').textContent = byText;
  $('#act-rating').innerHTML = Number(it.rating) > 0 ? ratingDisplayHtml(it.rating) : '<span class="hint">Keine Bewertung</span>';
  const revParts = [];
  if (it.kind === 'play' && (it.playNote || '').trim()) revParts.push('🎧 ' + it.playNote.trim());
  if ((it.review || '').trim()) revParts.push(it.review.trim());
  $('#act-review').textContent = revParts.join('\n');
  $('#act-review').style.display = revParts.length ? '' : 'none';
  $('#act-like').classList.remove('liked');
  $('#act-like-count').textContent = '…';
  $('#act-comments').innerHTML = '<p class="hint">Lade…</p>';
  $('#act-comment-input').value = '';
  $('#activity-dialog').showModal();
  // Likes
  try { const li = await fetchLikeInfo(it.id); $('#act-like-count').textContent = li.count; $('#act-like').classList.toggle('liked', li.liked); }
  catch { $('#act-like-count').textContent = '0'; }
  renderActivityComments();
}
async function renderActivityComments() {
  if (!activityItem) return;
  let comments = [];
  try { comments = await fetchComments(activityItem.id); } catch { /* ignorieren */ }
  const box = $('#act-comments');
  if (!comments.length) { box.innerHTML = '<p class="hint">Noch keine Kommentare.</p>'; return; }
  const me = getUser();
  box.innerHTML = comments.map((c) => {
    const name = c.by ? (c.by.display_name || c.by.username || '?') : '?';
    const del = (me && me.id === c.userId) ? `<button class="act-c-del" data-id="${c.id}">×</button>` : '';
    return `<div class="act-comment"><span class="act-c-name">${escapeHtml(name)}</span><span class="act-c-text">${escapeHtml(c.text)}</span>${del}</div>`;
  }).join('');
  box.querySelectorAll('.act-c-del').forEach((b) => b.addEventListener('click', async () => {
    await deleteComment(b.dataset.id); renderActivityComments();
  }));
}

// ---------- Freunde finden (Suche + Folgen) ----------
let friendsSearchTimer = null;
async function openFriendsDialog() {
  if (!requireAuth()) return;
  try { friendsFollowing = new Set(await getFollowing()); } catch { /* ignorieren */ }
  $('#friends-search').value = '';
  $('#friends-results').innerHTML = '<p class="hint">Tippe einen Username, um Leute zu finden.</p>';
  $('#friends-dialog').showModal();
  setTimeout(() => $('#friends-search').focus(), 50);
}

async function runFriendsSearch(q) {
  const box = $('#friends-results');
  if (!q.trim()) { box.innerHTML = '<p class="hint">Tippe einen Username, um Leute zu finden.</p>'; return; }
  box.innerHTML = '<p class="hint">Suche…</p>';
  let users = [];
  try { users = await searchUsers(q); } catch { /* ignorieren */ }
  if (!users.length) { box.innerHTML = '<p class="hint">Niemand gefunden.</p>'; return; }
  box.innerHTML = users.map((u) => {
    const av = u.avatar_url ? `style="background-image:url('${escapeHtml(u.avatar_url)}')"` : '';
    return `<button class="friend-row" data-id="${u.id}">
        <span class="friend-av${u.avatar_url ? '' : ' placeholder'}" ${av}></span>
        <span class="friend-name">${escapeHtml(u.display_name || u.username)}<small>@${escapeHtml(u.username)}</small></span>
        <span class="friend-go">›</span>
      </button>`;
  }).join('');
  box.querySelectorAll('.friend-row').forEach((row) => row.addEventListener('click', () => {
    const u = users.find((x) => x.id === row.dataset.id);
    $('#friends-dialog').close();
    openUserProfile(u);
  }));
}

// ---------- Profil eines anderen Nutzers (mit Folgen/Entfolgen) ----------
let upCollectionCache = [];
function setFollowBtn(btn, following) {
  btn.textContent = following ? 'Entfolgen' : 'Folgen';
  btn.classList.toggle('ghost', following);
  btn.classList.toggle('primary', !following);
}
async function openUserProfile(user) {
  if (!user) return;
  const u = (await fetchUserProfile(user.id)) || user;
  friendsFollowing = new Set(await getFollowing().catch(() => []));
  $('#up-name').textContent = u.display_name || u.username || '';
  $('#up-handle').textContent = '@' + (u.username || '');
  $('#up-banner').style.backgroundImage = u.banner_url ? `url("${u.banner_url}")` : '';
  const av = $('#up-avatar');
  if (u.avatar_url) { av.style.backgroundImage = `url("${u.avatar_url}")`; av.innerHTML = ''; }
  else { av.style.backgroundImage = ''; av.innerHTML = '<svg class="avatar-ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>'; }
  const parts = [];
  if (u.location) parts.push(`📍 ${escapeHtml(u.location)}`);
  if (u.website) {
    const href = /^https?:\/\//.test(u.website) ? u.website : 'https://' + u.website;
    parts.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener">🔗 ${escapeHtml(u.website.replace(/^https?:\/\//, ''))}</a>`);
  }
  $('#up-meta').innerHTML = parts.join('  ·  ');
  $('#up-bio').textContent = u.bio || '';
  const fbtn = $('#up-follow');
  const isMe = getUser() && getUser().id === u.id;
  if (isMe) { fbtn.style.display = 'none'; }
  else {
    fbtn.style.display = '';
    setFollowBtn(fbtn, friendsFollowing.has(u.id));
    fbtn.onclick = async () => {
      if (!requireAuth()) return;
      if (friendsFollowing.has(u.id)) { friendsFollowing.delete(u.id); await unfollow(u.id); }
      else { friendsFollowing.add(u.id); await follow(u.id); }
      setFollowBtn(fbtn, friendsFollowing.has(u.id));
      if (currentView === 'home') renderFriendsRow();
    };
  }
  $('#up-collection').innerHTML = '';
  $('#up-wishlist').innerHTML = '';
  $('#up-stats').innerHTML = '';
  $('#up-favorites').innerHTML = '';
  // Sammlung/Wishlist starten eingeklappt
  $('#up-collection').classList.add('hidden');
  $('#up-wishlist').classList.add('hidden');
  $('#up-lists').innerHTML = '';
  $('#up-lists-section').hidden = true;
  $('#user-page').classList.remove('hidden');
  $('#user-scroll').scrollTop = 0;
  document.body.style.overflow = 'hidden';
  // Sammlung + Wishlist parallel laden
  let coll = [], wish = [];
  try { [coll, wish] = await Promise.all([fetchUserItems(u.id, 'collection'), fetchUserItems(u.id, 'wishlist')]); }
  catch { /* ignorieren */ }
  // Statistiken
  const rated = coll.filter((i) => Number(i.rating) > 0);
  const avg = rated.length ? (rated.reduce((s, i) => s + Number(i.rating), 0) / rated.length) : 0;
  $('#up-stats').innerHTML =
    `<li class="stat-toggle" data-panel="up-collection"><span>Sammlung</span><span class="stat-num">${coll.length}<span class="stat-chev">›</span></span></li>` +
    `<li class="stat-toggle" data-panel="up-wishlist"><span>Wishlist</span><span class="stat-num">${wish.length}<span class="stat-chev">›</span></span></li>` +
    `<li><span>Bewertet</span><span class="stat-num">${rated.length}</span></li>` +
    `<li><span>Ø Bewertung</span><span class="stat-num">${avg ? avg.toFixed(1) + ' ♪' : '–'}</span></li>`;
  $('#up-stats').querySelectorAll('.stat-toggle').forEach((li) => li.addEventListener('click', () => {
    const panel = document.getElementById(li.dataset.panel);
    const nowHidden = panel.classList.toggle('hidden');
    li.classList.toggle('open', !nowHidden);
  }));
  // Favoriten (aus dem Profil; verweisen auf Sammlungs-IDs)
  const favItems = ((u.favorites || []).map((id) => coll.find((x) => x.id === id)).filter(Boolean));
  let favHtml = '';
  for (let i = 0; i < 4; i++) {
    const it = favItems[i];
    favHtml += it ? `<button class="fav-slot filled" data-fav="${i}">${favSlotInner(it)}</button>` : '<div class="fav-slot empty"></div>';
  }
  $('#up-favorites').innerHTML = favHtml;
  $('#up-favorites').querySelectorAll('.fav-slot.filled').forEach((b) => b.addEventListener('click', () => openPreview(favItems[+b.dataset.fav])));
  // Sammlung + Wishlist Cover-Grids
  fillCoverGrid($('#up-collection'), coll);
  fillCoverGrid($('#up-wishlist'), wish);
  // Listen des Nutzers
  let lists = [];
  try { lists = await fetchUserPlaylists(u.id); } catch { /* ignorieren */ }
  renderUserLists(lists);
}
// Listen (Playlists) eines Nutzers anzeigen
function renderUserLists(lists) {
  const sec = $('#up-lists-section'); const box = $('#up-lists');
  if (!lists.length) { sec.hidden = true; box.innerHTML = ''; return; }
  sec.hidden = false;
  box.innerHTML = lists.map((pl) => {
    const covers = pl.items.length
      ? '<div class="playlist-albums">' + pl.items.map((a, i) => `<button class="pa-cover" data-pl="${pl.id}" data-i="${i}">${a.coverUrl ? `<img src="${escapeHtml(a.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();" />` : ''}</button>`).join('') + '</div>'
      : '<p class="playlist-empty">Leer.</p>';
    const desc = pl.description ? `<p class="pl-desc">${escapeHtml(pl.description)}</p>` : '';
    return `<div class="playlist-item"><div class="playlist-head"><span class="pl-title">${escapeHtml(pl.name)}</span><span class="pl-count">${pl.items.length}</span></div>${desc}${covers}</div>`;
  }).join('');
  box.querySelectorAll('.pa-cover').forEach((b) => b.addEventListener('click', () => {
    const pl = lists.find((x) => x.id === b.dataset.pl);
    if (pl) openPreview(pl.items[+b.dataset.i]);
  }));
}
// Cover-Grid mit Klick -> Album-Vorschau (Items im Closure)
function fillCoverGrid(el, items) {
  el.innerHTML = items.length
    ? items.map((it, i) => `<button class="cat-cover${it.coverUrl ? '' : ' placeholder'}" data-idx="${i}">${it.coverUrl ? `<img src="${escapeHtml(it.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();" />` : ''}</button>`).join('')
    : '<span class="hint" style="grid-column:1/-1">Leer.</span>';
  el.querySelectorAll('.cat-cover[data-idx]').forEach((b) => b.addEventListener('click', () => openPreview(items[+b.dataset.idx])));
}
function closeUserProfile() {
  $('#user-page').classList.add('hidden');
  document.body.style.overflow = '';
}

// ---------- Start ----------
manualRating = createRatingInput($('#manual-rating'), 0);
$('#manual-rating-clear').addEventListener('click', () => manualRating && manualRating.setValue(0));
loadSettings();
switchView('home');

// Freunde finden
$('#btn-find-friends').addEventListener('click', openFriendsDialog);
$('#btn-friends-close').addEventListener('click', () => $('#friends-dialog').close());
$('#user-back').addEventListener('click', closeUserProfile);
$('#btn-activity-close').addEventListener('click', () => $('#activity-dialog').close());
$('#act-album').addEventListener('click', () => { $('#activity-dialog').close(); if (activityItem) openPreview(activityItem); });
$('#act-like').addEventListener('click', async () => {
  if (!activityItem || !requireAuth()) return;
  const res = await toggleActivityLike(activityItem.id);
  if (res === null) return;
  $('#act-like').classList.toggle('liked', res);
  try { const li = await fetchLikeInfo(activityItem.id); $('#act-like-count').textContent = li.count; } catch { /* ignorieren */ }
});
$('#act-comment-send').addEventListener('click', async () => {
  if (!activityItem || !requireAuth()) return;
  const inp = $('#act-comment-input'); const t = inp.value.trim(); if (!t) return;
  inp.value = '';
  await addComment(activityItem.id, t);
  renderActivityComments();
});
$('#act-comment-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#act-comment-send').click(); } });
$('#friends-search').addEventListener('input', (e) => {
  clearTimeout(friendsSearchTimer);
  const q = e.target.value;
  friendsSearchTimer = setTimeout(() => runFriendsSearch(q), 300);
});

// Auth initialisieren (Login/Registrierung/Gast)
const logoutBtn = document.getElementById('btn-logout');
if (logoutBtn) logoutBtn.addEventListener('click', async () => {
  await signOut();
  toast('Abgemeldet');
  switchView('home');
});
initAuth({
  onChange: async (user) => {
    if (user) { try { await syncAll(); } catch (e) { console.warn('Sync:', e); } }
    else { clearUserCache(); }
    // sichtbare Ansicht mit (ggf. neu geladenen) Daten aktualisieren
    if (currentView === 'home') renderHome();
    else if (currentView === 'collection') { renderList('collection'); renderCounts(); }
    else if (currentView === 'settings') { renderProfile(); renderPlaylists(); renderList('wishlist'); }
  },
});
