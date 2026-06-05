// app.js – Einstieg: Navigation, Rendering, Scan-Flow, Formular, Einstellungen.

import {
  getList, addItem, updateItem, deleteItem, moveItem,
  getSettings, saveSettings, exportAll, importAll,
  sortItems, filterItems,
  getPlaylists, createPlaylist, deletePlaylist, togglePlaylistItem,
} from './store.js';
import { lookupBarcode, fetchTracklist, discogsSearch, lastfmTopArtists, fetchCoverArt, fetchCoverCandidates, fetchVinylColors } from './api.js';
import { startScanner, stopScanner, isRunning, isSupported } from './scanner.js';

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
    $('#view-title').textContent = (getSettings().profileName || '').trim() || 'Mein Profil';
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
  $('.dp-edit').open = false;

  $('#dp-move').textContent = list === 'collection' ? 'In Wishlist' : 'In Collection';

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

$('#detail-back').addEventListener('click', closeDetail);
$('#dp-rating-clear').addEventListener('click', () => detailRating && detailRating.setValue(0));
$('#dp-like').addEventListener('click', () => {
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
    note: $('#dp-note').value.trim(),
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
    c.innerHTML = head('<p class="hint">Nichts gefunden – für Cover ist ein Discogs-Token nötig.</p>');
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
  const s = getSettings();
  $('#discogs-token').value = s.discogsToken || '';
  $('#lastfm-key').value = s.lastfmKey || '';
}

function setSetting(patch) {
  saveSettings({ ...getSettings(), ...patch });
}

function fmtEuro(n) {
  return (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

function renderProfile() {
  const s = getSettings();
  $('#profile-banner').style.backgroundImage = s.profileBanner ? `url("${s.profileBanner}")` : '';
  const av = $('#profile-avatar-display');
  if (s.profileAvatar) {
    av.style.backgroundImage = `url("${s.profileAvatar}")`;
    av.innerHTML = '';
  } else {
    av.style.backgroundImage = '';
    av.innerHTML = '<svg class="avatar-ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
  }
  const loc = (s.profileLocation || '').trim();
  const web = (s.profileWebsite || '').trim();
  const parts = [];
  if (loc) parts.push(`📍 ${escapeHtml(loc)}`);
  if (web) {
    const href = /^https?:\/\//.test(web) ? web : 'https://' + web;
    parts.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener">🔗 ${escapeHtml(web.replace(/^https?:\/\//, ''))}</a>`);
  }
  $('#profile-meta-line').innerHTML = parts.join('  ·  ');
  $('#profile-bio-display').textContent = s.profileBio || '';
  renderFavoritesDisplay();
  renderRecent();
  renderHisto();
  renderStatRows();
  renderPriceList();
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

function renderPriceList() {
  const priced = getList('collection').filter((i) => Number(i.price) > 0).sort((a, b) => Number(b.price) - Number(a.price));
  $('#price-list').innerHTML = priced.length
    ? priced.map((i) => `<li><span class="pl-name">${escapeHtml(i.artist)} – ${escapeHtml(i.title)}</span><span class="pl-price">${fmtEuro(i.price)}</span></li>`).join('')
    : '<li style="border:none;color:var(--muted)">Noch keine Preise erfasst.</li>';
}

function favSlotInner(item) {
  return item.coverUrl
    ? `<img src="${escapeHtml(item.coverUrl)}" alt="" onerror="this.remove()" />`
    : '<span class="fav-disc"></span>';
}

// Anzeige auf der Profilseite (klickbar -> Albumseite)
function renderFavoritesDisplay() {
  const favIds = getSettings().profileFavorites || [];
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
  const favIds = getSettings().profileFavorites || [];
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
  const fav = (getSettings().profileFavorites || []).slice();
  fav[slot] = null;
  setSetting({ profileFavorites: fav });
  refreshFavorites();
}

function openFavPicker(slot) {
  const coll = getList('collection');
  const grid = $('#fav-pick-grid');
  $('#fav-pick-status').textContent = coll.length ? '' : 'Deine Collection ist leer.';
  grid.innerHTML = coll.map((i) => `<button data-id="${i.id}">${favSlotInner(i)}</button>`).join('');
  $('#fav-dialog').showModal();
  grid.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const fav = (getSettings().profileFavorites || []).slice();
    while (fav.length < 4) fav.push(null);
    fav[slot] = b.dataset.id;
    setSetting({ profileFavorites: fav });
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
  const s = getSettings();
  $('#ps-name').value = s.profileName || '';
  $('#ps-email').value = s.profileEmail || '';
  $('#ps-location').value = s.profileLocation || '';
  $('#ps-website').value = s.profileWebsite || '';
  $('#ps-bio').value = s.profileBio || '';
  renderFavoritesEdit();
  $('#profile-settings-dialog').showModal();
}
$('#header-settings').addEventListener('click', openProfileSettings);
$('#btn-psettings-close').addEventListener('click', () => $('#profile-settings-dialog').close());
$('#ps-save').addEventListener('click', () => {
  const name = $('#ps-name').value.trim();
  setSetting({
    profileName: name,
    profileEmail: $('#ps-email').value.trim(),
    profileLocation: $('#ps-location').value.trim(),
    profileWebsite: $('#ps-website').value.trim(),
    profileBio: $('#ps-bio').value.trim(),
  });
  if (currentView === 'settings') $('#view-title').textContent = name || 'Mein Profil';
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
  if (dataUrl) { setSetting({ profileBanner: dataUrl }); renderProfile(); }
  e.target.value = '';
});
$('#avatar-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const dataUrl = await downscaleImage(file, 400, 0.85);
  if (dataUrl) { setSetting({ profileAvatar: dataUrl }); renderProfile(); }
  e.target.value = '';
});
$('#btn-fav-close').addEventListener('click', () => $('#fav-dialog').close());

$('#btn-save-settings').addEventListener('click', () => {
  saveSettings({
    ...getSettings(),
    discogsToken: $('#discogs-token').value.trim(),
    lastfmKey: $('#lastfm-key').value.trim(),
  });
  trendingCache = null; // neuer Key -> Trending neu laden
  toast('Einstellungen gespeichert');
});

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
    c.innerHTML = '<p class="pl-none">Noch keine Playlists. Lege oben eine an (z. B. „2026" oder „MGK") und füge Alben über „+ Playlist" auf der Albumseite hinzu.</p>';
    return;
  }
  const coll = getList('collection');
  c.innerHTML = pls.map((p) => {
    const albums = p.itemIds.map((id) => coll.find((x) => x.id === id)).filter(Boolean);
    const covers = albums.length
      ? `<div class="playlist-albums">${albums.map((a) => `<button class="pa-cover" data-id="${a.id}">${a.coverUrl ? `<img src="${escapeHtml(a.coverUrl)}" alt="" onerror="this.parentElement.classList.add('placeholder');this.remove()" />` : ''}</button>`).join('')}</div>`
      : '<p class="playlist-empty">Noch leer.</p>';
    return `<div class="playlist-item"><div class="playlist-head"><span class="pl-title">${escapeHtml(p.name)}</span><span><span class="pl-count">${albums.length}</span> <button class="playlist-del" data-del="${p.id}">löschen</button></span></div>${covers}</div>`;
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
  createPlaylist(name);
  $('#new-playlist-name').value = '';
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
    '<div class="home-section"><span class="dp-label">New from friends</span><div id="home-friends" class="home-friends"></div></div>';

  // Begrüßung je nach Tageszeit + Profilbild im Dusty-Rose-Rahmen
  const s = getSettings();
  const name = (s.profileName || '').trim();
  $('#home-greet-hello').textContent = greetingText() + (name ? ', ' + name : '');
  const gav = $('#home-greet-av');
  if (s.profileAvatar) {
    gav.style.backgroundImage = `url("${s.profileAvatar}")`;
    gav.classList.remove('placeholder');
    gav.innerHTML = '';
  } else {
    gav.style.backgroundImage = '';
    gav.classList.add('placeholder');
    gav.innerHTML = '<svg class="avatar-ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
  }
  gav.addEventListener('click', () => switchView('settings'));
  $('#home-bell').addEventListener('click', () => toast('Keine neuen Benachrichtigungen'));

  loadPopularThisWeek();
  renderFriendsRow();
}

// „Popular this week" – Top 10. Echte Streaming-Abspielzahlen (Spotify/Apple/
// Amazon) gibt es clientseitig nicht; als verfügbare Quelle nutzen wir die
// meistgesammelten Alben von Discogs als Beliebtheits-Proxy.
async function loadPopularThisWeek() {
  const ol = document.getElementById('home-pop-list');
  if (!ol) return;
  const token = (getSettings().discogsToken || '').trim();
  if (!token) {
    ol.innerHTML = '<li class="hint">Für „Popular this week" wird ein Discogs-Token benötigt (Profil → Einstellungen).</li>';
    return;
  }
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

// „New from friends" – noch ohne Backend/Freunde; Platzhalter bis die App online ist.
function renderFriendsRow() {
  const el = document.getElementById('home-friends');
  if (!el) return;
  el.innerHTML = '<div class="home-empty-card">Sobald Stackd online ist und du Freunden folgst, erscheinen hier Alben, die sie hinzufügen, bewerten oder liken.</div>';
}

// ---------- Start ----------
manualRating = createRatingInput($('#manual-rating'), 0);
$('#manual-rating-clear').addEventListener('click', () => manualRating && manualRating.setValue(0));
loadSettings();
switchView('home');
