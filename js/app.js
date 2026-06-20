// app.js – Einstieg: Navigation, Rendering, Scan-Flow, Formular, Einstellungen.

import {
  getList, addItem, updateItem, deleteItem, moveItem,
  getSettings, saveSettings, exportAll, importAll,
  sortItems, filterItems,
  getPlaylists, createPlaylist, deletePlaylist, togglePlaylistItem, movePlaylistItem,
  syncAll, clearUserCache,
  searchUsers, getFollowing, follow, unfollow, fetchFriendsFeed,
  fetchReviewsFeed, fetchFriendsLists, searchReviews, searchPlaylists,
  fetchUserProfile, fetchUserItems, fetchUserPlaylists,
  toggleActivityLike, fetchLikeInfo, fetchComments, addComment, deleteComment,
  addPlay, fetchPlays, deletePlay, fetchUserPlays,
  recordValueSnapshot, fetchValueHistory, fetchAlbumRatings, fetchAlbumReviews,
  fetchSongLikes, toggleSongLike, fetchMyLikedSongs,
} from './store.js';
import { lookupBarcode, fetchTracklist, fetchReleaseInfo, fetchItunesTracklist, discogsSearch, fetchCoverArt, fetchCoverCandidates, fetchVinylColors, fetchPriceRange, fetchGenre, fetchDiscogsCollection } from './api.js';
import { initAuth, getUser, getProfile, updateProfile, requireAuth, openAuth, signOut, changePassword, sendPasswordReset, deleteAccount } from './auth.js';
import { startScanner, stopScanner, isRunning, isSupported } from './scanner.js';
import { t as tr, applyI18n, getLang, setLang } from './i18n.js';

// Anzeigename aus dem Supabase-Profil (display_name, sonst username).
function profileName() {
  const p = getProfile() || {};
  return (p.display_name || p.username || '').trim();
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const VIEW_TITLES = {
  home: 'title.home',
  collection: 'title.collection',
  search: 'title.search',
  add: 'title.add',
  settings: 'title.profile',
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
    $('#view-title').textContent = profileName() || tr('title.profile');
  } else {
    $('#view-title').textContent = tr(VIEW_TITLES[view] || '');
  }
  $('#header-settings').classList.toggle('hidden', view !== 'settings');
  $('#header-share').classList.toggle('hidden', view !== 'settings');
  if (view !== 'add') {
    // Kamera schließen + Scan-UI zurücksetzen, sobald man den Tab verlässt
    stopScanner();
    $('#reader').classList.add('hidden');
    $('#btn-start-scan').classList.remove('hidden');
    $('#btn-stop-scan').classList.add('hidden');
    $('#scan-status').textContent = '';
  }
  renderCounts();
  if (view === 'collection') { renderList('collection'); renderValueRange(); }
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
      // erneutes Antippen des aktiven Tabs
      if (view === 'settings') setProfileTab('profile');
      if (view === 'search') { focusSearch(); return; } // 2. Klick auf Lupe → direkt tippen
      const main = document.getElementById('main');
      if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      if (view !== 'search') clearSearch(); // beim Tab-Wechsel Suchleiste leeren
      switchView(view);
    }
  });
});

// ---------- Listen rendern ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Skeleton-Loader (Platzhalter beim Laden) ----------
const rep = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join('');
const skelCharts = (n = 6) => rep(n, () => '<div class="skel-chart"><span class="skel skel-cover"></span><span class="skel skel-line sk-80"></span><span class="skel skel-line sk-60"></span></div>');
const skelRevs = (n = 4) => rep(n, () => '<div class="skel-rev"><span class="skel skel-cover"></span><div class="skel-body"><span class="skel skel-line sk-80"></span><span class="skel skel-line sk-40"></span><span class="skel skel-line"></span></div></div>');
const skelLists = (n = 4) => rep(n, () => '<div class="skel-listrow"><span class="skel skel-cover"></span><div class="skel-body"><span class="skel skel-line sk-60"></span><span class="skel skel-line sk-40"></span></div></div>');
const skelGrid = (n = 12) => `<div class="browse-grid">${rep(n, () => '<span class="skel skel-grid-cell"></span>')}</div>`;
const skelSearchResults = (n = 6) => `<ul class="search-results">${rep(n, () => '<li class="skel-sr"><span class="skel skel-cover"></span><div class="skel-body"><span class="skel skel-line sk-80"></span><span class="skel skel-line sk-40"></span></div></li>')}</ul>`;

// ---------- Einheitlicher Empty State ----------
const ES_DISC = '<span class="es-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.4"/></svg></span>';
function emptyState({ icon = ES_DISC, title = '', text = '', ctaLabel = '', ctaAttr = '' } = {}) {
  return `<div class="empty-state">${icon}`
    + (title ? `<p class="es-title">${escapeHtml(title)}</p>` : '')
    + (text ? `<p class="es-text">${escapeHtml(text)}</p>` : '')
    + (ctaLabel ? `<button class="btn primary es-cta" ${ctaAttr}>${escapeHtml(ctaLabel)}</button>` : '')
    + '</div>';
}

// ---------- Onboarding (einmalige Willkommens-Karte) ----------
const ONBOARD_KEY = 'discend_onboarded';
function onboardCardHtml() {
  if (localStorage.getItem(ONBOARD_KEY)) return '';
  const step = (n, txt) => `<div class="onboard-step"><span class="onboard-num">${n}</span><span>${escapeHtml(txt)}</span></div>`;
  return `<div class="onboard" id="onboard">
      <button class="onboard-x" id="onboard-x" aria-label="${tr('a11y.close')}">×</button>
      <p class="onboard-title">${escapeHtml(tr('onboard.title'))}</p>
      <div class="onboard-steps">${step(1, tr('onboard.step1'))}${step(2, tr('onboard.step2'))}${step(3, tr('onboard.step3'))}</div>
      <button class="btn primary onboard-cta" id="onboard-go">${escapeHtml(tr('onboard.cta'))}</button>
    </div>`;
}
function dismissOnboard() {
  try { localStorage.setItem(ONBOARD_KEY, '1'); } catch { /* voll */ }
  const el = document.getElementById('onboard'); if (el) el.remove();
}

// Kleine „Pop"-Animation auf dem Herz-Icon, wenn ein Like aktiviert wird.
function popHeart(scopeEl) {
  const ic = scopeEl && scopeEl.querySelector('svg');
  if (!ic) return;
  ic.classList.remove('heart-pop'); void ic.offsetWidth; // Reflow → Animation neu starten
  ic.classList.add('heart-pop');
  ic.addEventListener('animationend', () => ic.classList.remove('heart-pop'), { once: true });
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
      <p class="tile-title">${escapeHtml(item.title) || tr('misc.untitled')}</p>
      <p class="tile-artist">${escapeHtml(item.artist) || '(unbekannt)'}</p>
      ${note}
    </li>`;
}


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
  if (getList(list).length === 0) {
    hint.innerHTML = list === 'collection'
      ? emptyState({ title: tr('empty.collectionTitle'), text: tr('empty.collectionText'), ctaLabel: tr('empty.collectionCta'), ctaAttr: 'data-go="add"' })
      : emptyState({ title: tr('empty.wishlistTitle'), text: tr('empty.wishlistText'), ctaLabel: tr('empty.wishlistCta'), ctaAttr: 'data-go="search"' });
    const cta = hint.querySelector('.es-cta');
    if (cta) cta.onclick = () => switchView(cta.dataset.go);
  } else {
    hint.innerHTML = `<p class="es-text">${escapeHtml(tr('list.noMatches'))}</p>`;
  }
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
  const heroBg = $('#dp-hero-bg');
  if (heroBg) {
    heroBg.style.backgroundImage = url ? `url("${url}")` : '';
    heroBg.classList.toggle('has-bg', !!url);
  }
}

// Farbe der herausschauenden Vinyl-Scheibe setzen
function setVinylColor(css) {
  const el = $('#dp-vinyl'); if (el) el.style.setProperty('--vinyl', css || '#1a1a1a');
}

// Vinyl-Scheibe + farbige Varianten anzeigen, die das Album anbietet
async function renderDiscs(item) {
  const wrap = $('#dp-variants');
  if (!wrap) return; // Vinyl-Anzeige entfernt
  setVinylColor('#1a1a1a'); // Standard sofort
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
  wrap.innerHTML = `<span class="dp-variants-label">${tr('dp.availableOn')}</span>` +
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
  if (media) parts.push(tr('cond.media') + ' ' + media);
  if (sleeve) parts.push(tr('cond.sleeve') + ' ' + sleeve);
  $('#dp-condition').textContent = parts.length ? tr('cond.label') + ' ' + parts.join('  ·  ') : '';
}

function openDetail(list, id) {
  const item = getList(list).find((i) => i.id === id);
  if (!item) return;
  editing = { list, id };
  previewResult = null;
  detailPage.classList.remove('preview');

  setDetailCover(item.coverUrl);

  $('#dp-title').textContent = item.title || tr('misc.untitled');
  $('#dp-artist').textContent = item.artist || '(unbekannt)';
  $('#dp-meta').textContent = [item.year, item.label, item.format].filter(Boolean).join('  ·  ');

  setListenLinks(encodeURIComponent(`${item.artist || ''} ${item.title || ''}`.trim()));
  $('#dp-note').value = item.note || '';
  $('#dp-review').value = item.review || '';
  detailRating = createRatingInput($('#dp-rating'), item.rating, (val) => {
    if (editing) updateItem(editing.list, editing.id, { rating: val }); // Sterne sofort speichern
  });
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

  $('#dp-move').textContent = list === 'collection' ? tr('btn.moveToWishlist') : tr('btn.moveToCollection');

  $('#dp-play-date').value = new Date().toISOString().slice(0, 10);
  $('#dp-play-note').value = '';
  renderDiaryPlays(item.id);
  loadTracklist(item);
  renderCommunityRating(item);
  renderAlbumReviews(item);

  { const as0 = $('#dp-actions'); if (as0 && as0.open) as0.close(); }
  detailPage.classList.remove('hidden');
  $('#detail-scroll').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  detailPage.classList.add('hidden');
  detailPage.classList.remove('preview');
  stopPreview();
  const as = $('#dp-actions'); if (as && as.open) as.close();
  document.body.style.overflow = '';
  editing = null;
  previewResult = null;
}

// ⋯-Button oben rechts → Aktions-Sheet (Sammlung/Liked/Wishlist, Bewertung, Optionen).
$('#dp-menu').addEventListener('click', openActionsSheet);
$('#as-done').addEventListener('click', () => $('#dp-actions').close());

function openActionsSheet() {
  if (!requireAuth()) return;
  const album = editing ? getList(editing.list).find((i) => i.id === editing.id) : previewResult;
  if (!album) return;
  $('#as-title').textContent = album.title || '';
  $('#as-year').textContent = album.year ? '· ' + album.year : '';
  $('#as-collection').classList.toggle('active', !!editing && editing.list === 'collection');
  $('#as-wishlist').classList.toggle('active', !!editing && editing.list === 'wishlist');
  $('#dp-like').classList.toggle('liked', dpLiked);
  $('#dp-actions').showModal();
}

// Toggle „Sammlung": Preview→hinzufügen, Wishlist→verschieben, schon drin→entfernen.
$('#as-collection').addEventListener('click', () => {
  if (!requireAuth()) return;
  if (previewResult) { addPreviewTo('collection'); return; }
  if (!editing) return;
  if (editing.list === 'wishlist') {
    moveItem('wishlist', 'collection', editing.id); closeDetail();
    renderList('collection'); renderList('wishlist'); renderCounts(); toast(tr('toast.movedToCollection'));
  } else if (confirm(tr('confirm.removeFromCollection'))) {
    deleteItem('collection', editing.id); closeDetail(); renderList('collection'); renderCounts(); toast(tr('toast.removed'));
  }
});
// Toggle „Wishlist": analog.
$('#as-wishlist').addEventListener('click', () => {
  if (!requireAuth()) return;
  if (previewResult) { addPreviewTo('wishlist'); return; }
  if (!editing) return;
  if (editing.list === 'collection') {
    moveItem('collection', 'wishlist', editing.id); closeDetail();
    renderList('collection'); renderList('wishlist'); renderCounts(); toast(tr('toast.movedToWishlist'));
  } else if (confirm(tr('confirm.removeFromWishlist'))) {
    deleteItem('wishlist', editing.id); closeDetail(); renderList('wishlist'); renderCounts(); toast(tr('toast.removed'));
  }
});

// Streaming-Such-Deeplinks (4 Dienste).
function setListenLinks(q) {
  $('#dp-spotify').href = `https://open.spotify.com/search/${q}`;
  $('#dp-apple').href = `https://music.apple.com/search?term=${q}`;
  $('#dp-amazon').href = `https://music.amazon.com/search/${q}`;
  $('#dp-youtube').href = `https://music.youtube.com/search?q=${q}`;
}

// ---------- Teilen (Web Share API, Fallback: Link kopieren) ----------
async function shareLink(text) {
  const url = location.origin + location.pathname;
  try {
    if (navigator.share) { await navigator.share({ title: 'Discend', text, url }); return; }
    await navigator.clipboard.writeText(text + ' ' + url);
    toast(tr('toast.linkCopied'));
  } catch { /* abgebrochen/ignorieren */ }
}
function shareProfile() {
  shareLink(`${profileName() || tr('title.profile')} ${tr('share.suffix')}`);
}
function shareAlbum() {
  const a = editing ? getList(editing.list).find((i) => i.id === editing.id) : previewResult;
  if (!a) return;
  shareLink(`${a.artist || ''} – ${a.title || ''} ${tr('share.suffix')}`.replace(/^ – /, '').trim());
}
$('#header-share').addEventListener('click', shareProfile);
$('#as-share').addEventListener('click', shareAlbum);

// Community-Bewertung: Histogramm (0,5–5) + Schnitt aus ALLEN Profilen.
let communityReq = 0;
async function renderCommunityRating(item) {
  const el = $('#dp-community'); if (!el) return;
  const rq = ++communityReq;
  el.innerHTML = '<span class="skel" style="display:block;height:58px;border-radius:10px"></span>';
  let ratings = [];
  try { ratings = await fetchAlbumRatings(item); } catch { /* ignorieren */ }
  if (rq !== communityReq) return;
  if (!ratings.length) { el.innerHTML = `<p class="hint">${tr('community.none')}</p>`; return; }
  const buckets = new Array(10).fill(0); // 0=0,5 … 9=5,0
  ratings.forEach((r) => { const i = Math.round(r * 2) - 1; if (i >= 0 && i < 10) buckets[i]++; });
  const maxN = Math.max(...buckets, 1);
  const avg = ratings.reduce((s, r) => s + r, 0) / ratings.length;
  const bars = buckets.map((n) => `<span class="cr-bar"><span class="cr-fill" style="height:${Math.round((n / maxN) * 100)}%"></span></span>`).join('');
  el.innerHTML = `<div class="cr-wrap">
      <span class="cr-min">${noteSvg()}</span>
      <div class="cr-bars">${bars}</div>
      <div class="cr-side"><span class="cr-avg">${avg.toFixed(1)}</span><span class="cr-stars">${ratingDisplayHtml(Math.round(avg * 2) / 2)}</span></div>
    </div>
    <p class="cr-count">${ratings.length} ${ratings.length === 1 ? tr('unit.rating') : tr('unit.ratings')}</p>`;
}

// Öffentliche Reviews aller Nutzer unter dem Album.
let reviewsReq = 0;
let albumReviewsCache = [];
async function renderAlbumReviews(item) {
  const el = $('#dp-reviews'); if (!el) return;
  const rq = ++reviewsReq;
  el.innerHTML = skelRevs(2);
  let revs = [];
  try { revs = await fetchAlbumReviews(item); } catch { /* ignorieren */ }
  if (rq !== reviewsReq) return;
  if (!revs.length) { el.innerHTML = `<p class="hint">${tr('reviews.none')}</p>`; return; }
  albumReviewsCache = revs;
  el.innerHTML = revs.map((r, i) => {
    const who = r.by ? (r.by.display_name || r.by.username || '') : '';
    const av = (r.by && r.by.avatar_url) ? `style="background-image:url('${escapeHtml(r.by.avatar_url)}')"` : '';
    const stars = r.rating > 0 ? `<span class="ar-rating">${ratingDisplayHtml(r.rating)}</span>` : '';
    return `<div class="ar-card" data-idx="${i}">
        <div class="ar-head"><span class="ar-av${(r.by && r.by.avatar_url) ? '' : ' placeholder'}" ${av}></span><span class="ar-name">${escapeHtml(who)}</span>${stars}</div>
        <p class="ar-text">${escapeHtml(r.review.trim())}</p>
      </div>`;
  }).join('');
  el.querySelectorAll('.ar-card').forEach((c) => c.addEventListener('click', () => {
    const r = albumReviewsCache[+c.dataset.idx]; if (r && r.by) openUserProfile(r.by);
  }));
}

// Album aus der Suche/Datenbank ansehen (noch nicht gespeichert) -> Detailseite mit Tracklist
function openPreview(result) {
  if (!result) return;
  editing = null;
  previewResult = result;
  detailPage.classList.add('preview');
  setDetailCover(result.coverUrl);
  $('#dp-title').textContent = result.title || tr('misc.untitled');
  $('#dp-artist').textContent = result.artist || '';
  $('#dp-meta').textContent = [result.year, result.label, result.format].filter(Boolean).join('  ·  ');
  setListenLinks(encodeURIComponent(`${result.artist || ''} ${result.title || ''}`.trim()));
  $('#dp-note').value = '';
  $('#dp-review').value = '';
  setConditionDisplay('', '');
  detailRating = createRatingInput($('#dp-rating'), 0);
  dpLiked = false;
  $('#dp-like').classList.toggle('liked', false);
  loadTracklist(result);
  renderCommunityRating(result);
  renderAlbumReviews(result);
  { const as0 = $('#dp-actions'); if (as0 && as0.open) as0.close(); }
  detailPage.classList.remove('hidden');
  $('#detail-scroll').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

async function addPreviewTo(list) {
  if (!requireAuth()) return;
  if (!previewResult) return;
  const item = { ...previewResult };
  // Bevorzugt offizielles Apple/iTunes-Artwork (saubere Grafik statt Foto); Discogs als Fallback.
  const clean = await fetchCoverArt(item.artist, item.title);
  if (clean) item.coverUrl = clean;
  addItem(list, {
    ...item,
    rating: detailRating ? detailRating.getValue() : 0,
    note: $('#dp-note').value.trim(),
    review: $('#dp-review').value.trim(),
    liked: dpLiked,
  });
  closeDetail();
  toast(list === 'collection' ? tr('toast.addedToCollection') : tr('toast.addedToWishlist'));
}

function renderAlbumInfo(info) {
  const sec = $('#dp-info-section'); const el = $('#dp-info'); if (!sec || !el) return;
  const rows = [];
  if (info) {
    const gs = [...(info.genres || []), ...(info.styles || [])];
    if (gs.length) rows.push([tr('info.genre'), gs.join(', ')]);
    if (info.labels && info.labels.length) rows.push([tr('field.label'), info.labels.map((l) => l.name + (l.catno ? ' · ' + l.catno : '')).join(', ')]);
    if (info.formats && info.formats.length) rows.push([tr('field.format'), info.formats.join(' · ')]);
    if (info.country) rows.push([tr('info.country'), info.country]);
    if (info.year) rows.push([tr('field.year'), String(info.year)]);
  }
  if (!rows.length) { el.innerHTML = ''; sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  el.innerHTML = rows.map(([k, v]) => `<div class="info-row"><span class="info-k">${k}</span><span class="info-v">${escapeHtml(v)}</span></div>`).join('')
    + (info.notes ? `<p class="info-notes">${escapeHtml(info.notes.slice(0, 400))}${info.notes.length > 400 ? '…' : ''}</p>` : '');
}

// Audio-Hörprobe (30s) – es spielt immer nur eine.
let previewAudio = null;
function stopPreview() {
  if (previewAudio) { try { previewAudio.pause(); } catch { /* ignorieren */ } previewAudio = null; }
  document.querySelectorAll('.trk-play.playing').forEach((b) => b.classList.remove('playing'));
}
function togglePreview(url, btn) {
  const wasPlaying = btn.classList.contains('playing');
  stopPreview();
  if (wasPlaying) return;
  previewAudio = new Audio(url);
  btn.classList.add('playing');
  previewAudio.play().catch(() => btn.classList.remove('playing'));
  previewAudio.onended = () => { btn.classList.remove('playing'); previewAudio = null; };
}

async function loadTracklist(item) {
  const ol = $('#dp-tracklist');
  const status = $('#dp-tracklist-status');
  ol.innerHTML = '';
  stopPreview();
  renderAlbumInfo(null);
  if (item.source === 'manual' || !item.sourceId) {
    status.textContent = tr('track.noneManual');
    return;
  }
  const reqId = ++tracklistReq;
  status.textContent = tr('track.loading');
  let tracks = null, info = null;
  try {
    if (item.source === 'discogs') { info = await fetchReleaseInfo(item); tracks = info ? info.tracklist : null; }
    else { tracks = await fetchTracklist(item); }
  } catch { /* ignorieren */ }
  if (reqId !== tracklistReq) return; // ein neueres Album wurde geöffnet
  renderAlbumInfo(info);
  // Fallback: bei spärlicher/fehlender Discogs-Tracklist die vollständige von Apple holen
  let fromItunes = false;
  if (!tracks || tracks.length < 2) {
    try {
      const it = await fetchItunesTracklist(item.artist, item.title);
      if (reqId !== tracklistReq) return;
      if (it && it.length > (tracks ? tracks.length : 0)) { tracks = it; fromItunes = true; }
    } catch { /* ignorieren */ }
  }
  if (!tracks || !tracks.length) {
    status.textContent = tr('track.notFound');
    return;
  }
  // Hörproben (30s) von Apple anhängen (wenn nicht ohnehin von dort)
  if (!fromItunes) {
    try {
      const its = await fetchItunesTracklist(item.artist, item.title);
      if (reqId !== tracklistReq) return;
      if (its && its.length) {
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const map = {}; its.forEach((t) => { if (t.preview) map[norm(t.title)] = t.preview; });
        tracks.forEach((t) => { if (!t.preview) { const p = map[norm(t.title)]; if (p) t.preview = p; } });
      }
    } catch { /* ignorieren */ }
  }
  status.textContent = '';
  ol.innerHTML = tracks.map((t, i) => {
    const play = t.preview
      ? `<button class="trk-play" data-i="${i}" aria-label="${tr('a11y.preview')}"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>`
      : '<span class="trk-play-none"></span>';
    return `<li><span class="trk-pos">${escapeHtml(t.position)}</span>${play}<span class="trk-title">${escapeHtml(t.title)}</span><span class="trk-dur">${escapeHtml(t.duration)}</span><button class="trk-like" data-pos="${escapeHtml(t.position)}" aria-label="${tr('a11y.likeSong')}">${heartSvg()}</button></li>`;
  }).join('');
  ol.querySelectorAll('.trk-play').forEach((b) => b.addEventListener('click', () => {
    const t = tracks[+b.dataset.i];
    if (t && t.preview) togglePreview(t.preview, b);
  }));
  ol.querySelectorAll('.trk-like').forEach((b) => b.addEventListener('click', async () => {
    if (!requireAuth()) return;
    const t = tracks.find((x) => String(x.position) === b.dataset.pos) || { position: b.dataset.pos };
    const res = await toggleSongLike(item, t);
    if (res !== null) { b.classList.toggle('liked', res); if (res) popHeart(b); }
  }));
  // Gelikte Songs nicht-blockierend nachladen und markieren.
  fetchSongLikes(item.sourceId).then((likes) => {
    if (reqId !== tracklistReq) return;
    ol.querySelectorAll('.trk-like').forEach((b) => { if (likes.has(String(b.dataset.pos))) b.classList.add('liked'); });
  }).catch(() => {});
}

// Tagebuch-Einträge eines Albums anzeigen
async function renderDiaryPlays(itemId) {
  const ul = $('#dp-plays'); ul.innerHTML = '';
  let plays = [];
  try { plays = await fetchPlays(itemId); } catch { /* ignorieren */ }
  if (!plays.length) { ul.innerHTML = `<li class="hint" style="border:none">${tr('diary.none')}</li>`; return; }
  ul.innerHTML = plays.map((p) => {
    const d = p.played_on ? new Date(p.played_on).toLocaleDateString('de-DE') : '';
    const note = p.note ? ' – ' + escapeHtml(p.note) : '';
    return `<li><span class="play-date">${d}</span><span class="play-note">${note}</span><button class="play-del" data-id="${p.id}">×</button></li>`;
  }).join('');
  ul.querySelectorAll('.play-del').forEach((b) => b.addEventListener('click', async () => { await deletePlay(b.dataset.id); renderDiaryPlays(itemId); }));
}
$('#dp-play-add').addEventListener('click', async () => {
  if (!requireAuth()) return;
  if (!editing) { toast(tr('toast.addAlbumFirst')); return; }
  const date = $('#dp-play-date').value || new Date().toISOString().slice(0, 10);
  await addPlay(editing.id, date, $('#dp-play-note').value);
  $('#dp-play-note').value = '';
  renderDiaryPlays(editing.id);
  toast(tr('toast.diaryAdded'));
});

// ---------- Stackd Wrapped (Jahresrückblick) ----------
async function openWrapped() {
  if (!requireAuth()) return;
  const year = new Date().getFullYear();
  $('#wrapped-title').textContent = 'Discend Wrapped ' + year;
  $('#wrapped-body').innerHTML = `<p class="hint">${tr('msg.loading')}</p>`;
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
    { label: tr('wrapped.albumsAdded'), val: addedThisYear },
    { label: tr('wrapped.listenEntries'), val: playsThisYear.length },
    { label: tr('wrapped.albumsTotal'), val: coll.length },
    { label: tr('wrapped.avgRating'), val: avg ? avg.toFixed(1) + ' ♪' : '–' },
  ];
  let html = `<div class="wrapped-cards">${cards.map((c) => `<div class="wrapped-card"><span class="wrapped-num">${c.val}</span><span class="wrapped-lbl">${c.label}</span></div>`).join('')}</div>`;
  if (mostItem) {
    html += `<span class="dp-label wrapped-h">${tr('wrapped.mostPlayed', { n: mostN })}</span><button class="wrapped-album" data-id="${mostItem.id}"><div class="chart-cover${mostItem.coverUrl ? '' : ' placeholder'}">${mostItem.coverUrl ? `<img src="${escapeHtml(mostItem.coverUrl)}" alt="" />` : ''}</div><div class="chart-meta"><span class="chart-title">${escapeHtml(mostItem.title || '')}</span><span class="chart-artist">${escapeHtml(mostItem.artist || '')}</span></div></button>`;
  }
  if (topRated.length) {
    html += `<span class="dp-label wrapped-h">${tr('wrapped.topRated')}</span>` + topRated.map((it) => `<button class="wrapped-row" data-id="${it.id}"><span class="chart-title">${escapeHtml(it.artist || '')} – ${escapeHtml(it.title || '')}</span>${ratingDisplayHtml(it.rating)}</button>`).join('');
  }
  if (!coll.length && !playsThisYear.length) html = `<p class="hint">${tr('wrapped.noData', { year })}</p>`;
  // Sammlungswert-Verlauf (heutigen Wert sichern + Verlauf zeichnen)
  try {
    const v = computeCachedValue();
    if (v > 0) await recordValueSnapshot(v);
    const hist = await fetchValueHistory(getUser().id);
    if (hist.length) {
      const last = hist[hist.length - 1].value;
      html += `<span class="dp-label wrapped-h">${tr('wrapped.valueHistory')}</span>`;
      if (hist.length >= 2) {
        const first = hist[0].value;
        const diff = last - first;
        const diffStr = (diff >= 0 ? '+' : '−') + fmtEuro(Math.abs(diff));
        html += `<div class="vh-wrap">${valueHistorySvg(hist)}<div class="vh-labels"><span>${fmtEuro(first)}</span><span class="vh-diff ${diff >= 0 ? 'up' : 'down'}">${diffStr}</span><span>${fmtEuro(last)}</span></div></div>`;
      } else {
        html += `<p class="hint">${tr('wrapped.currentValue', { v: fmtEuro(last) })}</p>`;
      }
    }
  } catch { /* ignorieren */ }
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
  if (dpLiked) popHeart($('#dp-like'));
  if (editing) updateItem(editing.list, editing.id, { liked: dpLiked }); // sofort speichern
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
  if (!urls.length) { $('#cover-status').textContent = tr('cover.none'); return; }
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
    toast(tr('toast.coverChanged'));
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
  toast(tr('toast.saved'));
});

$('#dp-delete').addEventListener('click', () => {
  if (!editing) return;
  if (!confirm(tr('confirm.deleteEntry'))) return;
  const list = editing.list;
  deleteItem(list, editing.id);
  closeDetail();
  renderList(list);
  renderCounts();
  toast(tr('toast.deleted'));
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
  toast(to === 'wishlist' ? tr('toast.movedToWishlist') : tr('toast.movedToCollection'));
});

// ---------- Scannen ----------
const scanStatus = $('#scan-status');
function setScanStatus(msg, kind = '') {
  scanStatus.textContent = msg;
  scanStatus.className = 'scan-status ' + kind;
}

$('#btn-start-scan').addEventListener('click', async () => {
  if (!isSupported()) {
    setScanStatus(tr('scan.unavailable'), 'error');
    return;
  }
  setScanStatus(tr('scan.starting'));
  // Vorschau VOR dem Start einblenden, damit die Scanner-Bibliothek die
  // Größe des Bereichs messen kann (sonst nur schwarzer Balken ohne Bild).
  $('#reader').classList.remove('hidden');
  const ok = await startScanner('reader', onBarcode, (err) => setScanStatus(err, 'error'));
  if (ok) {
    $('#btn-start-scan').classList.add('hidden');
    $('#btn-stop-scan').classList.remove('hidden');
    setScanStatus(tr('scan.aim'));
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
  setScanStatus(tr('scan.searching', { code }));
  try {
    const result = await lookupBarcode(code);
    if (!result) {
      setScanStatus(tr('scan.nothingFound'), 'error');
      // Barcode in manuelles Formular übernehmen
      $('#manual-form').barcode.value = code;
    } else {
      setScanStatus(tr('scan.found'), 'ok');
      showResult(result);
    }
  } catch (err) {
    setScanStatus(tr('scan.error', { msg: (err?.message || err) }), 'error');
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
  $('#result-title').textContent = result.title || tr('misc.untitled');
  const sub = [result.year, result.label, result.format].filter(Boolean).join(' · ');
  $('#result-sub').textContent = sub + (result.source ? `  ·  Quelle: ${result.source}` : '');
  $('#result-note').value = '';
  resultRating = createRatingInput($('#result-rating'), 0);
  resultDialog.showModal();
}

async function saveResultTo(list) {
  if (!pendingResult) return;
  const clean = await fetchCoverArt(pendingResult.artist, pendingResult.title);
  if (clean) pendingResult.coverUrl = clean;
  addItem(list, {
    ...pendingResult,
    note: $('#result-note').value.trim(),
    rating: resultRating ? resultRating.getValue() : 0,
  });
  resultDialog.close();
  pendingResult = null;
  renderCounts();
  toast(list === 'collection' ? tr('toast.addedToCollection') : tr('toast.addedToWishlist'));
  setScanStatus('');
}

$('#btn-result-collection').addEventListener('click', () => saveResultTo('collection'));
$('#btn-result-wishlist').addEventListener('click', () => saveResultTo('wishlist'));
$('#btn-result-close').addEventListener('click', () => resultDialog.close());

// ---------- Datenbank durchsuchen (Lupe) + Vorschläge ----------
let searchResults = [];
let popularCache = null;
let friendsFeedCache = [];
let homeTab = 'alben';        // 'alben' | 'reviews' | 'lists'
let homeReviewsCache = [];
let homeListsCache = [];
let searchFilter = 'alben';   // 'alben' | 'artist' | 'members' | 'reviews' | 'playlists'
let reviewSearchCache = [];
let playlistSearchCache = [];
let friendsFollowing = new Set();

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

let browseResults = [];
const BROWSE_GENRES = ['Rock', 'Electronic', 'Jazz', 'Hip Hop', 'Funk / Soul', 'Pop', 'Reggae', 'Classical', 'Blues', 'Folk, World, & Country', 'Latin', 'Soundtrack'];
const BROWSE_TABS = [
  { id: 'release', label: 'tab.release' },
  { id: 'genre', label: 'tab.genre' },
  { id: 'popular', label: 'tab.popular' },
  { id: 'rated', label: 'tab.rated' },
  { id: 'top500', label: 'tab.top500' },
];
const BROWSE_DECADES = [['2020er', '2020-2029'], ['2010er', '2010-2019'], ['2000er', '2000-2009'], ['1990er', '1990-1999'], ['1980er', '1980-1989'], ['1970er', '1970-1979'], ['1960er', '1960-1969'], ['1950er', '1950-1959']];

const INFO_PAGES = [
  { id: 'impressum', label: 'info.impressum' },
  { id: 'datenschutz', label: 'info.privacy' },
  { id: 'faq', label: 'info.faq' },
  { id: 'kontakt', label: 'info.contact' },
];
const INFO_CONTENT = {
  impressum: {
    title: { de: 'Impressum', en: 'Legal notice' },
    html: {
      de: `<p><strong>Angaben gemäß § 5 DDG</strong></p>
      <p>[Vorname Nachname]<br>[Straße und Hausnummer]<br>[PLZ Ort]<br>Deutschland</p>
      <p><strong>Kontakt</strong><br>E-Mail: [deine-E-Mail-Adresse]</p>
      <p><strong>Verantwortlich für den Inhalt</strong><br>[Vorname Nachname], Anschrift wie oben.</p>
      <p class="info-note">Entwurf – bitte die Platzhalter [&hellip;] durch deine echten Daten ersetzen. Eine ladungsfähige Anschrift ist für öffentlich zugängliche Dienste in Deutschland Pflicht.</p>`,
      en: `<p><strong>Information pursuant to § 5 DDG (German law)</strong></p>
      <p>[First name Last name]<br>[Street and number]<br>[Postal code City]<br>Germany</p>
      <p><strong>Contact</strong><br>Email: [your-email-address]</p>
      <p><strong>Responsible for content</strong><br>[First name Last name], address as above.</p>
      <p class="info-note">Draft – please replace the placeholders [&hellip;] with your real data. A valid postal address is mandatory for publicly accessible services in Germany.</p>`,
    },
  },
  datenschutz: {
    title: { de: 'Datenschutzerklärung', en: 'Privacy policy' },
    html: {
      de: `<h3>1. Verantwortlicher</h3>
      <p>[Vorname Nachname], [Anschrift], E-Mail: [deine-E-Mail-Adresse] (siehe Impressum).</p>
      <h3>2. Welche Daten wir verarbeiten</h3>
      <ul>
        <li><strong>Konto:</strong> E-Mail-Adresse, Username, verschlüsseltes Passwort.</li>
        <li><strong>Profil:</strong> Anzeigename, Ort, Website, Bio, Profil- und Bannerbild (sofern angegeben).</li>
        <li><strong>Inhalte:</strong> Sammlung, Wishlist, Listen, Bewertungen, öffentliche Reviews, Hör-Einträge, gelikte Songs, Lieblingsalben/-songs, optional importierte Discogs-Daten.</li>
        <li><strong>Technisch:</strong> Beim Laden von Inhalten/Bildern werden IP-Adresse und Geräteangaben an die unten genannten Dienste übermittelt.</li>
      </ul>
      <h3>3. Öffentlich sichtbar</h3>
      <p>Dein Profil (Name, Bio, Ort, Favoriten), deine Sammlung/Wishlist, Bewertungen und Reviews sind für andere Nutzer bzw. öffentlich sichtbar. Den Sammlungswert kannst du in den Einstellungen verbergen.</p>
      <h3>4. Dienste / Auftragsverarbeiter</h3>
      <ul>
        <li><strong>Supabase</strong> – Hosting, Datenbank, Anmeldung (Region EU).</li>
        <li><strong>Resend</strong> – Versand von Bestätigungs- und Passwort-E-Mails.</li>
        <li><strong>Discogs</strong> – Abruf von Album- und Marktwert-Daten.</li>
        <li><strong>Apple/iTunes</strong> – Cover-Grafiken und Tracklists.</li>
        <li><strong>Cloudflare</strong> (Domain/DNS) und <strong>GitHub Pages</strong> (Auslieferung der App).</li>
      </ul>
      <h3>5. Zwecke & Rechtsgrundlage</h3>
      <p>Verarbeitung zur Bereitstellung der App und deines Kontos (Art. 6 Abs. 1 lit. b DSGVO) sowie zur Funktion und Sicherheit (lit. f).</p>
      <h3>6. Speicherung</h3>
      <p>Daten werden gespeichert, solange dein Konto besteht. Anmelde-Token liegen lokal in deinem Browser. Es gibt kein Werbe-Tracking und keine Werbe-Cookies.</p>
      <h3>7. Deine Rechte</h3>
      <p>Du hast Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch. Dein Konto inkl. aller Daten kannst du jederzeit in den Einstellungen unter „Account löschen" selbst löschen. Es besteht ein Beschwerderecht bei einer Datenschutz-Aufsichtsbehörde.</p>
      <h3>8. Kontakt</h3>
      <p>Bei Fragen: [deine-E-Mail-Adresse].</p>
      <p class="info-note">Entwurf – bitte vor Veröffentlichung fachkundig prüfen lassen und Platzhalter ersetzen.</p>`,
      en: `<h3>1. Controller</h3>
      <p>[First name Last name], [address], email: [your-email-address] (see legal notice).</p>
      <h3>2. What data we process</h3>
      <ul>
        <li><strong>Account:</strong> email address, username, encrypted password.</li>
        <li><strong>Profile:</strong> display name, city, website, bio, profile and banner image (if provided).</li>
        <li><strong>Content:</strong> collection, wishlist, lists, ratings, public reviews, listening entries, liked songs, favorite albums/songs, optionally imported Discogs data.</li>
        <li><strong>Technical:</strong> when loading content/images, your IP address and device details are transmitted to the services listed below.</li>
      </ul>
      <h3>3. Publicly visible</h3>
      <p>Your profile (name, bio, city, favorites), your collection/wishlist, ratings and reviews are visible to other users or publicly. You can hide the collection value in the settings.</p>
      <h3>4. Services / processors</h3>
      <ul>
        <li><strong>Supabase</strong> – hosting, database, sign-in (EU region).</li>
        <li><strong>Resend</strong> – sending confirmation and password emails.</li>
        <li><strong>Discogs</strong> – fetching album and market value data.</li>
        <li><strong>Apple/iTunes</strong> – cover artwork and tracklists.</li>
        <li><strong>Cloudflare</strong> (domain/DNS) and <strong>GitHub Pages</strong> (app delivery).</li>
      </ul>
      <h3>5. Purposes & legal basis</h3>
      <p>Processing to provide the app and your account (Art. 6(1)(b) GDPR) and for functionality and security (lit. f).</p>
      <h3>6. Storage</h3>
      <p>Data is stored as long as your account exists. Sign-in tokens are stored locally in your browser. There is no advertising tracking and no advertising cookies.</p>
      <h3>7. Your rights</h3>
      <p>You have the right to access, rectification, erasure, restriction, data portability and objection. You can delete your account including all data at any time in the settings under "Delete account". You have the right to lodge a complaint with a data protection supervisory authority.</p>
      <h3>8. Contact</h3>
      <p>For questions: [your-email-address].</p>
      <p class="info-note">Draft – please have it reviewed by a professional before publishing and replace placeholders.</p>`,
    },
  },
  faq: {
    title: { de: 'FAQ', en: 'FAQ' },
    html: {
      de: `<h3>Was ist Discend?</h3><p>Eine App, um deine Musik-/Vinyl-Sammlung zu katalogisieren, zu bewerten, Listen zu führen und Freunden zu folgen.</p>
      <h3>Brauche ich ein Konto?</h3><p>Stöbern geht ohne Konto. Zum Sammeln, Bewerten, Liken, Folgen und für Listen brauchst du ein kostenloses Konto.</p>
      <h3>Woher kommen die Album-Daten?</h3><p>Aus Discogs (Alben, Marktwert) sowie Apple/iTunes (Cover, Tracklists).</p>
      <h3>Sind meine Daten öffentlich?</h3><p>Profil, Sammlung, Bewertungen und Reviews sind für andere sichtbar. Den Sammlungswert kannst du verbergen.</p>
      <h3>Wie lösche ich mein Konto?</h3><p>Profil → Einstellungen (Zahnrad) → ganz unten „Account löschen".</p>`,
      en: `<h3>What is Discend?</h3><p>An app to catalog your music/vinyl collection, rate it, keep lists and follow friends.</p>
      <h3>Do I need an account?</h3><p>You can browse without an account. To collect, rate, like, follow and keep lists you need a free account.</p>
      <h3>Where does the album data come from?</h3><p>From Discogs (albums, market value) and Apple/iTunes (covers, tracklists).</p>
      <h3>Is my data public?</h3><p>Profile, collection, ratings and reviews are visible to others. You can hide the collection value.</p>
      <h3>How do I delete my account?</h3><p>Profile → Settings (gear) → at the very bottom "Delete account".</p>`,
    },
  },
  kontakt: {
    title: { de: 'Kontakt', en: 'Contact' },
    html: {
      de: `<p>Fragen, Feedback oder ein Problem entdeckt? Schreib uns:</p>
      <p><a href="mailto:[deine-E-Mail-Adresse]">[deine-E-Mail-Adresse]</a></p>`,
      en: `<p>Questions, feedback or found a problem? Write to us:</p>
      <p><a href="mailto:[your-email-address]">[your-email-address]</a></p>`,
    },
  },
};

function renderBrowse() {
  const c = $('#browse-content');
  $('#search-status').textContent = '';
  c.innerHTML = `<ul class="browse-list">${BROWSE_TABS.map((t) => `<li class="browse-row" data-tab="${t.id}"><span>${tr(t.label)}</span><span class="chev">›</span></li>`).join('')}</ul>
    <p class="browse-section">Discend.app</p>
    <ul class="browse-list">${INFO_PAGES.map((p) => `<li class="browse-row" data-info="${p.id}"><span>${tr(p.label)}</span><span class="chev">›</span></li>`).join('')}</ul>`;
  c.querySelectorAll('.browse-row[data-tab]').forEach((li) => li.addEventListener('click', () => openBrowseTab(li.dataset.tab)));
  c.querySelectorAll('.browse-row[data-info]').forEach((li) => li.addEventListener('click', () => renderInfoPage(li.dataset.info)));
}

function renderInfoPage(key) {
  const page = INFO_CONTENT[key]; if (!page) return;
  const L = getLang();
  const title = page.title[L] || page.title.en;
  const html = page.html[L] || page.html.en;
  const c = $('#browse-content');
  c.innerHTML = `<button class="browse-back" id="browse-back">${tr('btn.backArrow')}</button><div class="info-page"><h2>${escapeHtml(title)}</h2>${html}</div>`;
  $('#browse-back').addEventListener('click', renderBrowse);
}

function openBrowseTab(name) {
  if (name === 'release') renderDrillList(BROWSE_DECADES.map(([l, y]) => ({ label: getLang() === 'de' ? l : l.replace('er', 's'), params: { year: y } })), tr('browse.releaseYear'));
  else if (name === 'genre') renderDrillList(BROWSE_GENRES.map((g) => ({ label: g, params: { genre: g } })), tr('browse.genre'));
  else if (name === 'popular') browseCovers({ sort: 'have', sort_order: 'desc', per_page: 60 }, tr('browse.mostPopular'), renderBrowse);
  else if (name === 'rated') browseCovers({ sort: 'want', sort_order: 'desc', per_page: 60 }, tr('browse.highestRated'), renderBrowse);
  else if (name === 'top500') browseCovers({ sort: 'have', sort_order: 'desc', per_page: 100, pages: 5 }, tr('browse.top500'), renderBrowse);
}

function renderDrillList(items, title) {
  const c = $('#browse-content');
  c.innerHTML = `<button class="browse-back" id="browse-back">${tr('btn.backArrow')}</button><p class="browse-title">${escapeHtml(title)}</p><ul class="browse-list">${items.map((it, i) => `<li class="browse-row" data-i="${i}"><span>${escapeHtml(it.label)}</span><span class="chev">›</span></li>`).join('')}</ul>`;
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
  const head = (extra) => `${backFn ? `<button class="browse-back" id="browse-back">${tr('btn.backArrow')}</button>` : ''}<p class="browse-title">${escapeHtml(title)}</p>${extra}`;
  const wireBack = () => { if (backFn) { const b = $('#browse-back'); if (b) b.addEventListener('click', backFn); } };
  c.innerHTML = head(skelGrid());
  wireBack();
  let res;
  try {
    const pages = params.pages || 1;
    if (pages > 1) {
      res = [];
      for (let pg = 1; pg <= pages; pg++) {
        const part = await discogsSearch({ ...params, per_page: 100, page: pg });
        res = res.concat(part);
        if (part.length < 100) break; // keine weiteren Seiten vorhanden
      }
    } else {
      res = await discogsSearch(params);
    }
  } catch (err) {
    c.innerHTML = head(`<p class="hint">Fehler: ${escapeHtml(err?.message || String(err))}</p>`);
    wireBack();
    return;
  }
  browseResults = dedupeAlbums(res);
  const withCover = browseResults.filter((r) => r.coverUrl);
  const list = withCover.length ? withCover : browseResults;
  if (!list.length) {
    c.innerHTML = head(`<p class="hint">${tr('msg.nothingFound')}</p>`);
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
  if (!show.length) { el.innerHTML = `<span class="hint" style="grid-column:1/-1">${tr('browse.noPreview')}</span>`; return; }
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
  if (!searchResults.length) { c.innerHTML = ''; $('#search-status').textContent = tr('msg.nothingFound'); return; }
  $('#search-status').textContent = '';
  c.innerHTML = `<ul class="search-results">${searchResults.map((r, i) => {
    const cover = `<div class="sr-cover${r.coverUrl ? '' : ' placeholder'}">${
      r.coverUrl ? `<img src="${escapeHtml(r.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();" />` : ''
    }</div>`;
    const sub = [r.year, r.format].filter(Boolean).join(' · ');
    return `<li class="search-result" data-idx="${i}">${cover}<div class="sr-info"><p class="sr-title">${escapeHtml(r.title) || tr('misc.untitled')}</p><p class="sr-artist">${escapeHtml(r.artist)}</p><p class="sr-sub">${escapeHtml(sub)}</p></div></li>`;
  }).join('')}</ul>`;
  c.querySelectorAll('.search-result').forEach((el) => el.addEventListener('click', () => openPreview(searchResults[+el.dataset.idx])));
}

async function runDbSearchWith(params) {
  if (currentView !== 'search') switchView('search');
  $('#browse-content').innerHTML = skelSearchResults();
  $('#search-status').textContent = '';
  try {
    searchResults = dedupeAlbums(await discogsSearch(params));
    renderSearchResults();
  } catch (err) {
    $('#search-status').textContent = tr('msg.searchError', { msg: (err?.message || err) });
  }
}

const SEARCH_PLACEHOLDERS = {
  alben: 'ph.searchAlbum', artist: 'ph.searchArtist', members: 'ph.searchMembers',
  reviews: 'ph.searchReviews', playlists: 'ph.searchPlaylists',
};
const SEARCH_HINTS = {
  artist: 'hint.searchArtist', members: 'hint.searchMembers',
  reviews: 'hint.searchReviews', playlists: 'hint.searchPlaylists',
};

function updateSearchPlaceholder() {
  const s = $('#search-db'); if (s) s.placeholder = tr(SEARCH_PLACEHOLDERS[searchFilter] || 'ph.searchGeneric');
}
function showFilterHint() {
  $('#browse-content').innerHTML = `<p class="hint">${SEARCH_HINTS[searchFilter] ? tr(SEARCH_HINTS[searchFilter]) : ''}</p>`;
  $('#search-status').textContent = '';
}
function setSearchFilter(f) {
  searchFilter = f;
  $$('.sfilter').forEach((b) => b.classList.toggle('active', b.dataset.sf === f));
  updateSearchPlaceholder();
  const q = $('#search-db').value.trim();
  if (q) runSearch();
  else if (f === 'alben') renderBrowse();
  else showFilterHint();
}
// Such-UI (Filter-Zeile + Cancel-Button) ein-/ausblenden.
function showSearchUI() {
  const sf = $('#search-filters'); if (sf) sf.classList.remove('hidden');
  const cb = $('#search-cancel'); if (cb) cb.classList.remove('hidden');
}
function hideSearchUI() {
  const sf = $('#search-filters'); if (sf) sf.classList.add('hidden');
  const cb = $('#search-cancel'); if (cb) cb.classList.add('hidden');
}
// Suchleiste leeren + Filter zurücksetzen (beim Tab-Wechsel).
function clearSearch() {
  const s = $('#search-db'); if (s) s.value = '';
  searchFilter = 'alben';
  $$('.sfilter').forEach((b) => b.classList.toggle('active', b.dataset.sf === 'alben'));
  updateSearchPlaceholder();
  hideSearchUI();
}
// Cancel-Button: Suche abbrechen, zurück zum Stöbern.
function cancelSearch() {
  const s = $('#search-db'); if (s) { s.value = ''; s.blur(); }
  searchFilter = 'alben';
  $$('.sfilter').forEach((b) => b.classList.toggle('active', b.dataset.sf === 'alben'));
  updateSearchPlaceholder();
  hideSearchUI();
  renderBrowse();
}
// 2. Klick auf den Such-Tab: Filter zeigen + direkt ins Eingabefeld.
function focusSearch() {
  showSearchUI();
  const s = $('#search-db'); if (s) { s.focus(); s.select(); }
}
// Aus den Home-CTAs „Freunde finden" → Suche mit Members-Filter.
function goMemberSearch() {
  if (!requireAuth()) return;
  switchView('search');
  setSearchFilter('members');
  showSearchUI();
  setTimeout(() => { const s = $('#search-db'); if (s) s.focus(); }, 60);
}

function runSearch() {
  const q = $('#search-db').value.trim();
  if (!q) { if (searchFilter === 'alben') renderBrowse(); else showFilterHint(); return; }
  if (searchFilter === 'artist') runDbSearchWith({ artist: q });
  else if (searchFilter === 'members') runMemberSearch(q);
  else if (searchFilter === 'reviews') runReviewSearch(q);
  else if (searchFilter === 'playlists') runPlaylistSearch(q);
  else runDbSearchWith({ q });
}

async function runMemberSearch(q) {
  const c = $('#browse-content'); $('#search-status').textContent = '';
  c.innerHTML = `<div class="lists-wrap">${skelLists()}</div>`;
  let users = [];
  try { users = await searchUsers(q); } catch { /* ignorieren */ }
  if (!users.length) { c.innerHTML = ''; $('#search-status').textContent = tr('search.nobodyFound'); return; }
  c.innerHTML = '<div class="friends-results">' + users.map((u) => {
    const av = u.avatar_url ? `style="background-image:url('${escapeHtml(u.avatar_url)}')"` : '';
    return `<button class="friend-row" data-id="${u.id}">
        <span class="friend-av${u.avatar_url ? '' : ' placeholder'}" ${av}></span>
        <span class="friend-name">${escapeHtml(u.display_name || u.username)}<small>@${escapeHtml(u.username)}</small></span>
        <span class="friend-go">›</span>
      </button>`;
  }).join('') + '</div>';
  c.querySelectorAll('.friend-row').forEach((row) => row.addEventListener('click', () => {
    const u = users.find((x) => x.id === row.dataset.id); if (u) openUserProfile(u);
  }));
}

async function runReviewSearch(q) {
  const c = $('#browse-content'); $('#search-status').textContent = '';
  c.innerHTML = `<div class="rev-list">${skelRevs()}</div>`;
  let revs = [];
  try { revs = await searchReviews(q); } catch { /* ignorieren */ }
  if (!revs.length) { c.innerHTML = ''; $('#search-status').textContent = tr('search.noReviews'); return; }
  reviewSearchCache = revs;
  c.innerHTML = '<div class="rev-list">' + revs.map((r, i) => reviewCardHtml(r, i)).join('') + '</div>';
  c.querySelectorAll('.rev-card').forEach((card) => card.addEventListener('click', () => openPreview(reviewSearchCache[+card.dataset.idx])));
}

async function runPlaylistSearch(q) {
  const c = $('#browse-content'); $('#search-status').textContent = '';
  c.innerHTML = `<div class="lists-wrap">${skelLists()}</div>`;
  let lists = [];
  try { lists = await searchPlaylists(q); } catch { /* ignorieren */ }
  if (!lists.length) { c.innerHTML = ''; $('#search-status').textContent = tr('search.noPlaylists'); return; }
  playlistSearchCache = lists;
  c.innerHTML = '<div class="lists-wrap">' + lists.map((l, i) => listCardHtml(l, i)).join('') + '</div>';
  c.querySelectorAll('.list-card').forEach((card) => card.addEventListener('click', () => {
    const l = playlistSearchCache[+card.dataset.idx]; if (l && l.by) openUserProfile(l.by);
  }));
}

let searchTimer = null;
$('#search-cancel').addEventListener('click', cancelSearch);
$('#search-db').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); runSearch(); $('#search-db').blur(); } // Enter startet die Suche + schließt die Tastatur
});
$('#search-db').addEventListener('input', () => {
  const v = $('#search-db').value.trim();
  if (!v) { if (searchFilter === 'alben') renderBrowse(); else showFilterHint(); return; }
  if (['members', 'reviews', 'playlists'].includes(searchFilter)) {
    clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 300);
  }
});
$('#search-db').addEventListener('focus', showSearchUI);
$$('.sfilter').forEach((b) => b.addEventListener('click', () => setSearchFilter(b.dataset.sf)));

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
  toast(list === 'collection' ? tr('toast.addedToCollection') : tr('toast.addedToWishlist'));
  switchView(list);
});

// ---------- Mein Profil ----------

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
  const PIN = '<svg class="meta-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  const LNK = '<svg class="meta-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  if (loc) parts.push(`${PIN} ${escapeHtml(loc)}`);
  if (web) {
    const href = /^https?:\/\//.test(web) ? web : 'https://' + web;
    parts.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${LNK} ${escapeHtml(web.replace(/^https?:\/\//, ''))}</a>`);
  }
  $('#profile-meta-line').innerHTML = parts.join('  ·  ');
  $('#profile-bio-display').textContent = p.bio || '';
  renderFavoritesDisplay();
  renderFavoriteSongs();
  renderRecent();
  renderHisto();
  renderStatRows();
  renderValueRange();
  renderGenreStats();
}

function renderRecent() {
  const recent = [...getList('collection')].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 4);
  const el = $('#recent-activity');
  if (!recent.length) { el.innerHTML = `<span class="hint">${tr('profile.nothingAdded')}</span>`; return; }
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
  const rows = [
    { label: tr('stat.albums'), val: coll.length, go: () => switchView('collection') },
    { label: tr('stat.wishlist'), val: wish.length, go: () => setProfileTab('watchlist') },
    { label: tr('lbl.favorites'), val: coll.filter((i) => i.liked).length },
    { label: tr('stat.rated'), val: coll.filter((i) => Number(i.rating) > 0).length },
    { label: tr('stat.notes'), val: coll.filter((i) => (i.note || '').trim()).length },
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
    return `<p class="hint">${tr('value.noMarketData')}</p>`;
  }
  const note = tr('value.note', { valued, total }) + (loading ? ` <span class="vr-loading">${tr('value.updating')}</span>` : '');
  return `<div class="vr-bar"><span class="vr-fill"></span></div>
    <div class="vr-labels"><span>${fmtEuro(min)}</span><span class="vr-dash">${tr('value.to')}</span><span>${fmtEuro(max)}</span></div>
    <p class="vr-note">${note}</p>`;
}

async function renderValueRange() {
  const els = document.querySelectorAll('.value-range'); if (!els.length) return;
  const setHtml = (h) => els.forEach((e) => { e.innerHTML = h; });
  const coll = getList('collection');
  if (!coll.length) {
    const pe = document.getElementById('value-range'); if (pe) pe.innerHTML = `<p class="hint">${tr('value.noAlbums')}</p>`;
    const ce = document.getElementById('value-collection'); if (ce) ce.innerHTML = '';
    return;
  }
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
  setHtml(valueRangeBar(min, max, valued, coll.length, toFetch.length > 0));
  if (!toFetch.length) { if (valued > 0) recordValueSnapshot(Math.round((min + max) / 2)); return; }
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
  if (reqId === valueRangeReq && (currentView === 'settings' || currentView === 'collection')) renderValueRange();
}

// ---------- Genre-Statistik + Entdecken nach Genre (#9) ----------
let genreLoadReq = 0;
function renderGenreStats() {
  const el = $('#genre-stats'); if (!el) return;
  const coll = getList('collection');
  if (!coll.length) { el.innerHTML = `<p class="hint">${tr('value.noAlbums')}</p>`; return; }
  const counts = {};
  for (const it of coll) {
    const g = (it.genre || '').trim();
    if (g) counts[g] = (counts[g] || 0) + 1;
  }
  const missing = coll.filter((it) => it.source === 'discogs' && it.sourceId && !(it.genre || '').trim());
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!entries.length) {
    el.innerHTML = `<p class="hint">${missing.length ? tr('genre.loading') : tr('genre.none')}</p>`;
  } else {
    const maxN = entries[0][1];
    el.innerHTML = entries.map(([g, n]) => `
      <button class="genre-row" data-genre="${escapeHtml(g)}">
        <span class="genre-name">${escapeHtml(g)}</span>
        <span class="genre-bar"><span class="genre-fill" style="width:${Math.round((n / maxN) * 100)}%"></span></span>
        <span class="genre-count">${n}</span>
      </button>`).join('') + (missing.length ? `<p class="hint genre-loading">${tr('genre.moreLoading')}</p>` : '');
    el.querySelectorAll('.genre-row').forEach((b) => b.addEventListener('click', () => openGenre(b.dataset.genre)));
  }
  if (missing.length) loadGenres(missing);
}

// Fehlende Genres im Hintergrund nachladen (gedrosselt, wie bei den Preisen).
async function loadGenres(missing) {
  const reqId = ++genreLoadReq;
  const cap = missing.slice(0, 40);
  let idx = 0;
  const worker = async () => {
    while (idx < cap.length) {
      if (reqId !== genreLoadReq) return;
      const it = cap[idx++];
      let g = '';
      try { g = await fetchGenre(it); } catch { /* ignorieren */ }
      if (g) updateItem('collection', it.id, { genre: g });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (reqId === genreLoadReq && currentView === 'settings') renderGenreStats();
}

// Genre antippen → in der Suche die Top-Alben dieses Genres zeigen (Entdecken).
function openGenre(genre) {
  switchView('search');
  browseCovers({ genre, sort: 'have', sort_order: 'desc', per_page: 60 }, 'Genre: ' + genre, renderBrowse);
}

// ---------- Discogs-Sammlung importieren (#18) ----------
function dedupeKey(it) {
  if (it.masterId) return 'm' + it.masterId;
  if (it.sourceId) return 's' + it.sourceId;
  return (String(it.artist) + '|' + String(it.title)).toLowerCase().trim();
}
async function importDiscogs() {
  if (!requireAuth()) return;
  const def = (getProfile() || {}).username || '';
  const username = prompt(tr('prompt.discogsUser'), def);
  if (username == null) return;
  const u = username.trim(); if (!u) return;
  toast(tr('toast.importing'));
  let items = [];
  try { items = await fetchDiscogsCollection(u); } catch { toast(tr('toast.importFailed')); return; }
  if (!items.length) { toast(tr('toast.noPublicCollection')); return; }
  const have = new Set(getList('collection').map(dedupeKey));
  let added = 0;
  for (const it of items) {
    const k = dedupeKey(it);
    if (have.has(k)) continue;
    have.add(k);
    addItem('collection', it);
    added++;
  }
  renderList('collection'); renderCounts(); renderProfile();
  toast(tr('toast.importedSummary', { added, dup: items.length - added }));
}
$('#btn-import-discogs').addEventListener('click', importDiscogs);

// Aktueller Sammlungswert (Mittel aus min–max) nur aus dem Cache – ohne Netz.
function computeCachedValue() {
  const coll = getList('collection'); if (!coll.length) return 0;
  const cache = readPriceCache(); const now = Date.now();
  let min = 0, max = 0, valued = 0;
  for (const it of coll) {
    if (Number(it.price) > 0) { min += Number(it.price); max += Number(it.price); valued++; continue; }
    if (it.source === 'discogs' && it.sourceId) {
      const c = cache[it.sourceId];
      if (c && c.min != null && (now - c.at) < PRICE_TTL) { min += c.min; max += c.max; valued++; }
    }
  }
  return valued ? Math.round((min + max) / 2) : 0;
}

// Mini-Liniendiagramm (SVG) für den Wertverlauf.
function valueHistorySvg(hist) {
  const vals = hist.map((h) => h.value);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const span = (maxV - minV) || 1;
  const W = 300, H = 70, pad = 5, n = hist.length;
  const pts = hist.map((h, i) => {
    const x = pad + (n > 1 ? (i * (W - 2 * pad)) / (n - 1) : (W - 2 * pad) / 2);
    const y = H - pad - ((h.value - minV) / span) * (H - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `${pad},${H - pad} ${pts.join(' ')} ${(W - pad)},${H - pad}`;
  return `<svg class="vh-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <polygon class="vh-area" points="${area}"/>
      <polyline class="vh-line" points="${pts.join(' ')}"/>
    </svg>`;
}

function favSlotInner(item) {
  return item.coverUrl
    ? `<img src="${escapeHtml(item.coverUrl)}" alt="" onerror="this.remove()" />`
    : '<span class="fav-disc"></span>';
}

// Lieblingssongs im Profil (selbst gewählt, gespeichert in profile.fav_songs).
let favSongsCache = [];
let songPickCache = [];
function renderFavoriteSongs() {
  const el = $('#profile-songs'); if (!el) return;
  const songs = ((getProfile() || {}).fav_songs || []).filter(Boolean).slice(0, 4);
  if (!songs.length) { el.innerHTML = `<p class="hint">${tr('favsongs.none')}</p>`; return; }
  favSongsCache = songs;
  el.innerHTML = songs.map((s, i) => `<button class="fav-song" data-idx="${i}"><span class="fs-title">${escapeHtml(s.title || '(Song)')}</span><span class="fs-artist">${escapeHtml(s.artist || s.album || '')}</span></button>`).join('');
  el.querySelectorAll('.fav-song').forEach((b) => b.addEventListener('click', () => {
    const s = favSongsCache[+b.dataset.idx];
    if (s && s.albumId) openPreview({ source: 'discogs', sourceId: s.albumId, title: s.album || '', artist: s.artist || '', coverUrl: '' });
  }));
}
// Bearbeiten im Einstellungs-Dialog (4 Slots).
function renderFavoriteSongsEdit() {
  const el = $('#ps-songs'); if (!el) return;
  const songs = (getProfile() || {}).fav_songs || [];
  let html = '';
  for (let i = 0; i < 4; i++) {
    const s = songs[i];
    html += s
      ? `<button type="button" class="fav-song-slot filled" data-slot="${i}"><span class="fs-title">${escapeHtml(s.title || '(Song)')}</span><span class="fs-artist">${escapeHtml(s.artist || s.album || '')}</span><span class="fav-x">×</span></button>`
      : `<button type="button" class="fav-song-slot empty" data-slot="${i}">+ Song</button>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('.fav-song-slot').forEach((b) => b.addEventListener('click', () => {
    const slot = +b.dataset.slot;
    if (b.classList.contains('filled')) removeFavSong(slot); else openSongPicker(slot);
  }));
}
function refreshFavSongs() { renderFavoriteSongsEdit(); renderFavoriteSongs(); }
function removeFavSong(slot) {
  const arr = ((getProfile() || {}).fav_songs || []).slice();
  arr[slot] = null;
  updateProfile({ fav_songs: arr });
  refreshFavSongs();
}
async function openSongPicker(slot) {
  const box = $('#song-pick-list');
  box.innerHTML = `<p class="hint">${tr('msg.loading')}</p>`;
  $('#song-dialog').showModal();
  let songs = [];
  try { songs = await fetchMyLikedSongs(50); } catch { /* ignorieren */ }
  if (!songs.length) { box.innerHTML = `<p class="hint">${tr('songpicker.none')}</p>`; return; }
  songPickCache = songs;
  box.innerHTML = songs.map((s, i) => `<button class="song-pick-row" data-i="${i}"><span class="fs-title">${escapeHtml(s.title || '(Song)')}</span><span class="fs-artist">${escapeHtml(s.artist || s.album || '')}</span></button>`).join('');
  box.querySelectorAll('.song-pick-row').forEach((b) => b.addEventListener('click', () => {
    const s = songPickCache[+b.dataset.i];
    const arr = ((getProfile() || {}).fav_songs || []).slice();
    while (arr.length < 4) arr.push(null);
    arr[slot] = { albumId: s.albumId, position: s.position, title: s.title, artist: s.artist, album: s.album };
    updateProfile({ fav_songs: arr });
    $('#song-dialog').close();
    refreshFavSongs();
  }));
}
$('#btn-song-close').addEventListener('click', () => $('#song-dialog').close());

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
  $('#profile-settings-dialog').classList.remove('show-auth', 'show-delete', 'show-lang');
  $('#ps-signed-name').textContent = p.display_name || p.username || '';
  $('#ps-name').value = p.display_name || p.username || '';
  $('#ps-email').value = (getUser() && getUser().email) || '';
  $('#ps-email').readOnly = true;
  $('#ps-location').value = p.location || '';
  $('#ps-website').value = p.website || '';
  $('#ps-bio').value = p.bio || '';
  $('#ps-hide-value').checked = !!p.hide_value;
  renderFavoritesEdit();
  renderFavoriteSongsEdit();
  $$('.set-lang-opt').forEach((b) => b.classList.toggle('active', b.dataset.lang === getLang()));
  $('#profile-settings-dialog').showModal();
}
$('#header-settings').addEventListener('click', openProfileSettings);
$('#ps-cancel').addEventListener('click', () => $('#profile-settings-dialog').close());
$('#ps-signout').addEventListener('click', async () => { $('#profile-settings-dialog').close(); await signOut(); });
$('#ps-auth-open').addEventListener('click', () => {
  $('#ps-auth-msg').textContent = ''; $('#ps-newpw').value = '';
  $('#profile-settings-dialog').classList.add('show-auth');
});
$('#ps-auth-back').addEventListener('click', () => $('#profile-settings-dialog').classList.remove('show-auth'));
$('#ps-pw-save').addEventListener('click', async () => {
  const msg = $('#ps-auth-msg'); msg.textContent = tr('msg.pleaseWait');
  const err = await changePassword($('#ps-newpw').value);
  msg.textContent = err || tr('msg.passwordChanged');
  if (!err) $('#ps-newpw').value = '';
});
$('#ps-pw-reset').addEventListener('click', async () => {
  const msg = $('#ps-auth-msg'); msg.textContent = tr('msg.sending');
  const err = await sendPasswordReset();
  msg.textContent = err || tr('msg.resetSent');
});
$('#ps-delete-open').addEventListener('click', () => {
  $('#ps-del-ack').checked = false; $('#ps-del-confirm').disabled = true; $('#ps-del-msg').textContent = '';
  $('#profile-settings-dialog').classList.add('show-delete');
});
$('#ps-del-back').addEventListener('click', () => $('#profile-settings-dialog').classList.remove('show-delete'));
$('#ps-del-ack').addEventListener('change', (e) => { $('#ps-del-confirm').disabled = !e.target.checked; });
$('#ps-del-confirm').addEventListener('click', async () => {
  if (!$('#ps-del-ack').checked) return;
  const msg = $('#ps-del-msg'); msg.textContent = tr('msg.deletingAccount');
  $('#ps-del-confirm').disabled = true;
  const err = await deleteAccount();
  if (err) { msg.textContent = err; $('#ps-del-confirm').disabled = false; return; }
  $('#profile-settings-dialog').close();
  toast(tr('toast.accountDeleted'));
});
$('#ps-save').addEventListener('click', () => {
  const name = $('#ps-name').value.trim();
  updateProfile({
    display_name: name,
    location: $('#ps-location').value.trim(),
    website: $('#ps-website').value.trim(),
    bio: $('#ps-bio').value.trim(),
    hide_value: $('#ps-hide-value').checked,
  });
  if (currentView === 'settings') $('#view-title').textContent = profileName() || tr('title.profile');
  $('#profile-settings-dialog').close();
  renderProfile();
  toast(tr('toast.profileSaved'));
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
    if (!confirm(tr('confirm.importOverwrite'))) return;
    importAll(data);
    renderList('collection');
    renderList('wishlist');
    renderCounts();
    toast(tr('toast.importSuccess'));
  } catch (err) {
    toast(tr('toast.importFailedMsg', { msg: (err?.message || err) }));
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
    c.innerHTML = emptyState({ title: tr('empty.playlistsTitle'), text: tr('empty.playlistsText') });
    return;
  }
  const coll = getList('collection');
  c.innerHTML = pls.map((p) => {
    const albums = p.itemIds.map((id) => coll.find((x) => x.id === id)).filter(Boolean);
    const covers = albums.length
      ? `<div class="playlist-albums">${albums.map((a) => `<button class="pa-cover" data-id="${a.id}">${a.coverUrl ? `<img src="${escapeHtml(a.coverUrl)}" alt="" onerror="this.parentElement.classList.add('placeholder');this.remove()" />` : ''}</button>`).join('')}</div>`
      : `<p class="playlist-empty">${tr('pl.emptyShort')}</p>`;
    const desc = p.description ? `<p class="pl-desc">${escapeHtml(p.description)}</p>` : '';
    return `<div class="playlist-item"><div class="playlist-head"><button class="pl-title" data-plopen="${p.id}">${escapeHtml(p.name)}</button><span><span class="pl-count">${albums.length}</span> <button class="playlist-del" data-del="${p.id}">${tr('btn.deleteSmall')}</button></span></div>${desc}${covers}</div>`;
  }).join('');
  c.querySelectorAll('.pl-title[data-plopen]').forEach((b) => b.addEventListener('click', () => openPlaylistView(b.dataset.plopen)));
  c.querySelectorAll('.pa-cover').forEach((b) => b.addEventListener('click', () => openDetail('collection', b.dataset.id)));
  c.querySelectorAll('.playlist-del').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm(tr('confirm.deletePlaylist'))) { deletePlaylist(b.dataset.del); renderPlaylists(); }
  }));
}

// ---------- Listen-Ansicht (sortierbar/ranked) ----------
let plvId = null;
function openPlaylistView(id) {
  plvId = id;
  renderPlaylistView();
  $('#playlist-view-dialog').showModal();
}
function renderPlaylistView() {
  const p = getPlaylists().find((x) => x.id === plvId);
  if (!p) { $('#playlist-view-dialog').close(); return; }
  $('#plv-title').textContent = p.name;
  const descEl = $('#plv-desc');
  descEl.textContent = p.description || '';
  descEl.style.display = p.description ? '' : 'none';
  const coll = getList('collection');
  const albums = p.itemIds.map((id) => coll.find((x) => x.id === id)).filter(Boolean);
  const list = $('#plv-list');
  if (!albums.length) { list.innerHTML = `<p class="pl-none">${tr('pl.empty')}</p>`; return; }
  list.innerHTML = albums.map((a, i) => `
    <div class="plv-row">
      <span class="plv-rank">${i + 1}</span>
      <button class="plv-album" data-open="${a.id}">
        <span class="plv-cover${a.coverUrl ? '' : ' placeholder'}">${a.coverUrl ? `<img src="${escapeHtml(a.coverUrl)}" alt="" onerror="this.parentElement.classList.add('placeholder');this.remove()" />` : ''}</span>
        <span class="plv-meta"><span class="chart-title">${escapeHtml(a.title || '')}</span><span class="chart-artist">${escapeHtml(a.artist || '')}</span></span>
      </button>
      <span class="plv-ctrls">
        <button class="plv-mv" data-up="${a.id}" ${i === 0 ? 'disabled' : ''} aria-label="${tr('a11y.moveUp')}">▲</button>
        <button class="plv-mv" data-down="${a.id}" ${i === albums.length - 1 ? 'disabled' : ''} aria-label="${tr('a11y.moveDown')}">▼</button>
        <button class="plv-rm" data-rm="${a.id}" aria-label="${tr('a11y.remove')}">×</button>
      </span>
    </div>`).join('');
  list.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { $('#playlist-view-dialog').close(); openDetail('collection', b.dataset.open); }));
  list.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => { movePlaylistItem(plvId, b.dataset.up, -1); renderPlaylistView(); }));
  list.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => { movePlaylistItem(plvId, b.dataset.down, 1); renderPlaylistView(); }));
  list.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { togglePlaylistItem(plvId, b.dataset.rm); renderPlaylistView(); renderPlaylists(); }));
}
$('#btn-plv-close').addEventListener('click', () => $('#playlist-view-dialog').close());

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
  toast(tr('toast.playlistCreated'));
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
  if (h >= 5 && h < 12) return tr('greet.morning');
  if (h >= 12 && h < 18) return tr('greet.noon');
  return tr('greet.evening');
}

function renderHome() {
  const el = $('#home-content');
  el.innerHTML =
    '<div class="home-tabs">' +
      `<button class="home-tab" data-htab="alben">${tr('htab.albums')}</button>` +
      `<button class="home-tab" data-htab="reviews">${tr('htab.reviews')}</button>` +
      `<button class="home-tab" data-htab="lists">${tr('htab.lists')}</button>` +
    '</div>' +
    '<div id="home-tabbody"></div>';
  el.querySelectorAll('.home-tab').forEach((b) => b.addEventListener('click', () => setHomeTab(b.dataset.htab)));
  setHomeTab(homeTab);
}

function setHomeTab(tab) {
  homeTab = tab;
  $$('.home-tab').forEach((b) => b.classList.toggle('active', b.dataset.htab === tab));
  const body = $('#home-tabbody');
  if (!body) return;
  if (tab === 'reviews') renderHomeReviews(body);
  else if (tab === 'lists') renderHomeLists(body);
  else renderHomeAlben(body);
}

// „Alben" = die normale Startseite (Begrüßung + Charts + Neuzugänge).
function renderHomeAlben(body) {
  body.innerHTML =
    onboardCardHtml() +
    '<div class="home-greet">' +
      `<button class="home-greet-av" id="home-greet-av" aria-label="${tr('a11y.myProfile')}"></button>` +
      '<div class="home-greet-text"><span class="home-greet-hello" id="home-greet-hello"></span></div>' +
      `<button class="home-bell" id="home-bell" aria-label="${tr('a11y.notifications')}">` +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' +
      '</button>' +
    '</div>' +
    `<div class="home-section"><span class="dp-label">${tr('home.popular')}</span><ol id="home-pop-list" class="chart-list">${skelCharts()}</ol></div>` +
    `<div class="home-section"><span class="dp-label">${tr('home.newFromFriends')}</span><div id="home-friends" class="home-friends"></div></div>` +
    `<div class="home-section"><span class="dp-label">${tr('home.newReleases', { year: new Date().getFullYear() })}</span><ol id="home-new-list" class="chart-list">${skelCharts()}</ol></div>`;

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
  $('#home-bell').addEventListener('click', () => toast(tr('toast.noNotifications')));
  if ($('#onboard')) {
    $('#onboard-x').addEventListener('click', dismissOnboard);
    $('#onboard-go').addEventListener('click', dismissOnboard);
  }

  loadPopularThisWeek();
  renderFriendsRow();
  loadNewReleases();
}

// „Reviews" = Reviews von Gefolgten zuerst, danach allgemein neueste.
async function renderHomeReviews(body) {
  body.innerHTML = `<div class="rev-list">${skelRevs()}</div>`;
  const wrap = body.querySelector('.rev-list');
  let revs = [];
  try { revs = await fetchReviewsFeed(30); } catch { /* ignorieren */ }
  if (!wrap) return;
  if (!revs.length) {
    wrap.innerHTML = emptyState({ title: tr('empty.reviewsTitle'), text: tr('home.noReviews') });
    return;
  }
  homeReviewsCache = revs;
  wrap.innerHTML = revs.map((r, i) => reviewCardHtml(r, i)).join('');
  wrap.querySelectorAll('.rev-card').forEach((c) => c.addEventListener('click', () => openPreview(homeReviewsCache[+c.dataset.idx])));
}

// Eine Review-Karte (für Reviews-Home-Tab und Review-Suche).
function reviewCardHtml(r, i) {
  const cov = r.coverUrl ? `<img src="${escapeHtml(r.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();" />` : '';
  const who = r.by ? (r.by.display_name || r.by.username || '') : '';
  const stars = Number(r.rating) > 0 ? `<span class="friend-rating">${ratingDisplayHtml(r.rating)}</span>` : '';
  const raw = (r.review || '').trim();
  const text = escapeHtml(raw.slice(0, 240)) + (raw.length > 240 ? '…' : '');
  return `<button class="rev-card" data-idx="${i}">
      <div class="rev-cover${r.coverUrl ? '' : ' placeholder'}">${cov}</div>
      <div class="rev-body">
        <div class="rev-head"><span class="rev-title">${escapeHtml(r.title || '')}</span><span class="rev-artist">${escapeHtml(r.artist || '')}</span></div>
        <div class="rev-who">${escapeHtml(who)}${stars}</div>
        <p class="rev-text">${text}</p>
      </div>
    </button>`;
}

// Eine Listen-Karte (für Lists-Home-Tab und Playlist-Suche).
function listCardHtml(l, i) {
  const covers = l.items.slice(0, 4).map((it) => (it && it.coverUrl)
    ? `<div class="ll-cover"><img src="${escapeHtml(it.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();" /></div>`
    : '<div class="ll-cover placeholder"></div>').join('');
  const who = l.by ? (l.by.display_name || l.by.username || '') : '';
  return `<button class="list-card" data-idx="${i}">
      <div class="ll-covers">${covers || '<div class="ll-cover placeholder"></div>'}</div>
      <div class="ll-meta"><span class="ll-name">${escapeHtml(l.name || tr('list.fallbackName'))}</span><span class="ll-by">${escapeHtml(who)} · ${tr('unit.albumsCount', { n: l.items.length })}</span></div>
    </button>`;
}

// „Lists" = Playlists von Gefolgten.
async function renderHomeLists(body) {
  if (!getUser()) {
    body.innerHTML = emptyState({ title: tr('empty.listsTitle'), text: tr('home.signInLists'), ctaLabel: tr('auth.login'), ctaAttr: 'id="lists-cta"' });
    const b = body.querySelector('#lists-cta'); if (b) b.onclick = () => openAuth('login');
    return;
  }
  body.innerHTML = `<div class="lists-wrap">${skelLists()}</div>`;
  const wrap = body.querySelector('.lists-wrap');
  let lists = [];
  try { lists = await fetchFriendsLists(20); } catch { /* ignorieren */ }
  if (!wrap) return;
  if (!lists.length) {
    wrap.innerHTML = emptyState({ title: tr('empty.listsTitle'), text: tr('home.noFriendLists'), ctaLabel: tr('dlg.findFriends'), ctaAttr: 'id="lists-cta"' });
    const b = wrap.querySelector('#lists-cta'); if (b) b.onclick = goMemberSearch;
    return;
  }
  homeListsCache = lists;
  wrap.innerHTML = lists.map((l, i) => listCardHtml(l, i)).join('');
  wrap.querySelectorAll('.list-card').forEach((c) => c.addEventListener('click', () => {
    const l = homeListsCache[+c.dataset.idx];
    if (l && l.by) openUserProfile(l.by);
  }));
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
  if (!list.length) { ol.innerHTML = `<li class="hint">${tr('msg.noData')}</li>`; return; }
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
  if (!list.length) { ol.innerHTML = `<li class="hint">${tr('msg.noData')}</li>`; return; }
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
    el.innerHTML = `<div class="home-empty-card">${tr('home.signInFollow')} <button id="friends-cta" class="link-btn">${tr('auth.login')}</button></div>`;
    const b = el.querySelector('#friends-cta'); if (b) b.onclick = () => openAuth('login');
    return;
  }
  el.innerHTML = skelCharts(5);
  let feed = [];
  try { feed = await fetchFriendsFeed(20); } catch { /* ignorieren */ }
  if (!feed.length) {
    el.innerHTML = `<div class="home-empty-card">${tr('home.nothingFriends')} <button id="friends-cta" class="link-btn">${tr('dlg.findFriends')}</button></div>`;
    const b = el.querySelector('#friends-cta'); if (b) b.onclick = goMemberSearch;
    return;
  }
  friendsFeedCache = feed;
  el.innerHTML = feed.map((r, i) => {
    const cov = r.coverUrl ? `<img src="${escapeHtml(r.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();" />` : '';
    const who = r.by ? (r.by.display_name || r.by.username || '') : '';
    const action = r.kind === 'play' ? tr('feed.listened') : tr('feed.added');
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
  let byText = tr('feed.by') + ' ' + (it.by ? (it.by.display_name || it.by.username || '') : '');
  if (it.kind === 'play' && it.playedOn) byText += ' · ' + tr('feed.listenedOn') + ' ' + new Date(it.playedOn).toLocaleDateString(getLang() === 'de' ? 'de-DE' : 'en-US');
  $('#act-by').textContent = byText;
  $('#act-rating').innerHTML = Number(it.rating) > 0 ? ratingDisplayHtml(it.rating) : `<span class="hint">${tr('stat.noRating')}</span>`;
  const revParts = [];
  if (it.kind === 'play' && (it.playNote || '').trim()) revParts.push('🎧 ' + it.playNote.trim());
  if ((it.review || '').trim()) revParts.push(it.review.trim());
  $('#act-review').textContent = revParts.join('\n');
  $('#act-review').style.display = revParts.length ? '' : 'none';
  $('#act-like').classList.remove('liked');
  $('#act-like-count').textContent = '…';
  $('#act-comments').innerHTML = `<p class="hint">${tr('msg.loading')}</p>`;
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
  if (!q.trim()) { box.innerHTML = `<p class="hint">${tr('hint.findPeople')}</p>`; return; }
  box.innerHTML = `<p class="hint">${tr('msg.searching')}</p>`;
  let users = [];
  try { users = await searchUsers(q); } catch { /* ignorieren */ }
  if (!users.length) { box.innerHTML = `<p class="hint">${tr('search.nobodyFound')}</p>`; return; }
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
  btn.textContent = following ? tr('btn.unfollow') : tr('btn.follow');
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
  let coll = [], wish = [], vhist = [];
  try { [coll, wish, vhist] = await Promise.all([fetchUserItems(u.id, 'collection'), fetchUserItems(u.id, 'wishlist'), u.hide_value ? Promise.resolve([]) : fetchValueHistory(u.id)]); }
  catch { /* ignorieren */ }
  const latestVal = vhist.length ? vhist[vhist.length - 1].value : 0;
  // Statistiken
  const rated = coll.filter((i) => Number(i.rating) > 0);
  const avg = rated.length ? (rated.reduce((s, i) => s + Number(i.rating), 0) / rated.length) : 0;
  $('#up-stats').innerHTML =
    `<li class="stat-toggle" data-panel="up-collection"><span>${tr('stat.collection')}</span><span class="stat-num">${coll.length}<span class="stat-chev">›</span></span></li>` +
    `<li class="stat-toggle" data-panel="up-wishlist"><span>${tr('stat.wishlist')}</span><span class="stat-num">${wish.length}<span class="stat-chev">›</span></span></li>` +
    `<li><span>${tr('stat.rated')}</span><span class="stat-num">${rated.length}</span></li>` +
    `<li><span>${tr('stat.avgRating')}</span><span class="stat-num">${avg ? avg.toFixed(1) + ' ♪' : '–'}</span></li>` +
    ((!u.hide_value && latestVal > 0) ? `<li><span>${tr('stat.collectionValue')}</span><span class="stat-num">${fmtEuro(latestVal)}</span></li>` : '');
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
document.documentElement.lang = getLang();
applyI18n();
// Sprach-Menü in den Einstellungen (slidet wie „Passwort & Anmeldung")
$('#ps-lang-open').addEventListener('click', () => $('#profile-settings-dialog').classList.add('show-lang'));
$('#ps-lang-back').addEventListener('click', () => $('#profile-settings-dialog').classList.remove('show-lang'));
$$('.set-lang-opt').forEach((b) => b.addEventListener('click', () => {
  setLang(b.dataset.lang);
  $$('.set-lang-opt').forEach((x) => x.classList.toggle('active', x.dataset.lang === getLang()));
}));
// Bei Sprachwechsel die sichtbare Ansicht neu aufbauen (dynamische Texte)
document.addEventListener('langchange', () => { switchView(currentView); });

manualRating = createRatingInput($('#manual-rating'), 0);
$('#manual-rating-clear').addEventListener('click', () => manualRating && manualRating.setValue(0));
switchView('home');

$('#btn-friends-close').addEventListener('click', () => $('#friends-dialog').close());
$('#user-back').addEventListener('click', closeUserProfile);
$('#btn-activity-close').addEventListener('click', () => $('#activity-dialog').close());
$('#act-album').addEventListener('click', () => { $('#activity-dialog').close(); if (activityItem) openPreview(activityItem); });
$('#act-like').addEventListener('click', async () => {
  if (!activityItem || !requireAuth()) return;
  const res = await toggleActivityLike(activityItem.id);
  if (res === null) return;
  $('#act-like').classList.toggle('liked', res);
  if (res) popHeart($('#act-like'));
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
  toast(tr('toast.signedOut'));
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
