// app.js – Einstieg: Navigation, Rendering, Scan-Flow, Formular, Einstellungen.

import {
  getList, addItem, updateItem, deleteItem, moveItem,
  getSettings, saveSettings, exportAll, importAll,
  sortItems, filterItems,
  getPlaylists, createPlaylist, deletePlaylist, updatePlaylist, togglePlaylistItem, movePlaylistItem,
  syncAll, clearUserCache,
  searchUsers, getFollowing, follow, unfollow, fetchFriendsFeed,
  getBlocked, blockUser, unblockUser, reportTarget,
  fetchReviewsFeed, fetchFriendsLists, searchReviews, searchPlaylists,
  fetchUserProfile, fetchProfileByUsername, fetchUserItems, fetchUserPlaylists,
  toggleActivityLike, fetchLikeInfo, fetchLikers, fetchComments, addComment, deleteComment,
  fetchAlbumComments, addAlbumComment, deleteAlbumComment,
  addPlay, fetchPlays, deletePlay, fetchUserPlays,
  recordValueSnapshot, fetchValueHistory, fetchAlbumRatings, fetchAlbumReviews,
  fetchSongLikes, toggleSongLike, fetchMyLikedSongs,
  fetchNotifications, fetchUnreadCount, markNotificationsRead,
  sendFeedback,
} from './store.js';
import { lookupBarcode, fetchTracklist, fetchReleaseInfo, fetchItunesTracklist, fetchSongPreview, fetchItunesSongs, discogsSearch, fetchCoverArt, fetchCoverCandidates, fetchVinylColors, fetchPriceRange, fetchGenre, fetchDiscogsCollection, normTitle } from './api.js';
import { initAuth, getUser, getProfile, updateProfile, requireAuth, openAuth, signOut, changePassword, changeEmail, sendPasswordReset, deleteAccount, uploadProfileImage } from './auth.js';
import { startScanner, stopScanner, isRunning, isSupported } from './scanner.js';
import { t as tr, applyI18n, getLang, setLang } from './i18n.js';
import {
  $, $$, escapeHtml, skelCharts, skelRevs, skelLists, skelGrid, skelSearchResults,
  ES_DISC, ES_CRATE, ES_HEART, ES_LIST, ES_PEN, ES_BELL, emptyState,
  popHeart, animateSwap, NOTE_PATH, noteSvg, heartSvg, ratingDisplayHtml, fmtEuro,
} from './ui.js';
import { sortLetter, letterRank, dedupeAlbums, dedupeKey, commonAlbums, valueHistorySvg, weekIndex, rotateWindow, shuffle } from './util.js';

// Anzeigename aus dem Supabase-Profil (display_name, sonst username).
function profileName() {
  const p = getProfile() || {};
  return (p.display_name || p.username || '').trim();
}

// $, $$ und weitere reine UI-Helfer stehen jetzt in ./ui.js (siehe Import oben).

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
  if (selMode && view !== 'collection') setSelMode(false);
  currentView = view;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.tab').forEach((t) => {
    const on = t.dataset.view === view;
    t.classList.toggle('active', on);
    t.setAttribute('aria-current', on ? 'page' : 'false');
  });
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
  updateAzBar(); // A–Z-Leiste nur in der Sammlung zeigen
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

// escapeHtml, Skeleton-Helfer, Empty-State + Illustrationen: jetzt in ./ui.js.

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

// ---------- „Was ist neu" nach Update (Mini-Changelog) ----------
const WHATSNEW_KEY = 'discend_last_build';
// Aktuelle Build-Nummer aus der (immer im DOM vorhandenen) Profil-Version lesen.
function appBuild() {
  const el = document.querySelector('.profile-version');
  const m = el && el.textContent.match(/Build\s+(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}
// Pro Build ein paar nutzerfreundliche Zeilen (zweisprachig, neueste zuerst).
const CHANGELOG = [
  { build: 194, de: ['Rechtliches: Impressum und Datenquellen/Credits (Discogs, Apple Music u. a.) im Profil, plus Quellenhinweis auf jeder Albumseite'], en: ['Legal: imprint and data sources/credits (Discogs, Apple Music, etc.) in your profile, plus a source note on every album page'] },
  { build: 196, de: ['Datenschutzerklärung und Nutzungsbedingungen (Entwürfe) im Profil ergänzt – neben Impressum und Datenquellen'], en: ['Privacy policy and terms of use (drafts) added to your profile — next to imprint and data sources'] },
  { build: 195, de: ['„Discend Wrapped" heißt jetzt „Discend Jahresrückblick"'], en: ['"Discend Wrapped" is now called "Discend Year in Review"'] },
  { build: 193, de: ['Teilbare Statistik-Karte: Im „Discend Jahresrückblick" oben rechts auf das Teilen-Symbol tippen – erzeugt ein hübsches Bild mit deinen Zahlen, Top-Genres und Top-Künstler zum Teilen'], en: ['Shareable stats card: in "Discend Year in Review", tap the share icon (top right) to create a nice image of your numbers, top genres and top artist'] },
  { build: 190, de: ['Albumseite aufgeräumt: die lange Beschreibung wird nur noch kurz gezeigt und lässt sich ausklappen – so rückt die Tracklist nach oben'], en: ['Cleaner album page: the long description is shortened and expandable, so the tracklist moves up'] },
  { build: 189, de: ['Platten-Übersicht: Tippst du in deiner Sammlung auf ein Album, siehst du erst deine Infos dazu (hinzugefügt, wie oft gehört, Notiz, Regal, Review, wer sie geliked hat). Tipp aufs Cover führt zur Albumseite.', 'Bei Freundes-Aktivität siehst du genauso deren Infos zur Platte'], en: ['Record overview: tapping an album in your collection now shows your info first (added, plays, note, shelf, review, who liked it). Tap the cover to reach the album page.', 'Friends’ activity shows their info for the record the same way'] },
  { build: 188, de: ['Album-Kommentare: unter jedem Album könnt ihr jetzt diskutieren – öffentlich, für alle sichtbar'], en: ['Album comments: discuss under any album now — public, visible to everyone'] },
  { build: 187, de: ['Sparziel für Wunsch-Platten: trag ein, wie viel du schon gespart hast (privat, nur für dich sichtbar)'], en: ['Savings goal for wishlist records: track how much you have saved (private, only you can see it)'] },
  { build: 186, de: ['Verliehene Platten zeigen jetzt „seit wann" – und nach 3 Monaten eine Erinnerung zum Zurückfordern'], en: ['Lent records now show how long they have been out — after 3 months you get a reminder to ask for them back'] },
  { build: 185, de: ['Hör-Ziel fürs Jahr („50 Platten") mit Fortschrittsbalken auf dem Profil – gezählt werden deine Tagebuch-Einträge'], en: ['Yearly listening goal ("50 records") with a progress bar on your profile — your diary entries count'] },
  { build: 184, de: ['Neue Regal-Ansicht: deine Cover stehen nebeneinander wie Platten im Regal (Umschalter in der Sammlung)'], en: ['New shelf view: your covers stand side by side like records on a shelf (switch in your collection)'] },
  { build: 183, de: ['Sammlung sortieren nach Kaufdatum, Zustand, Regal/Standort und „Verliehene zuerst"'], en: ['Sort your collection by purchase date, condition, shelf/location and "lent out first"'] },
  { build: 182, de: ['„Ihr habt gemeinsam" auf fremden Profilen: zeigt, welche Platten ihr beide habt'], en: ['"You both have" on other profiles: see which records you share'] },
  { build: 181, de: ['Listen auf Startseite und in der Suche: Ranglisten-Nummern sichtbar, Antippen öffnet jetzt die Liste (statt des Profils)'], en: ['Lists on home and in search: ranking numbers visible, tapping opens the list (instead of the profile)'] },
  { build: 180, de: ['Ganze Tracklist am Stück anhören: neuer „Alle abspielen"-Knopf', 'Deutlich mehr Alben haben jetzt Hörproben (bessere Erkennung, z. B. Dookie, Nevermind, Dark Side of the Moon)'], en: ['Play the whole tracklist: new "Play all" button', 'Many more albums now have previews (better matching, e.g. Dookie, Nevermind, Dark Side of the Moon)'] },
  { build: 179, de: ['Akzentfarbe wählbar: Rosa, Petrol oder Indigo (Einstellungen → Erscheinungsbild)'], en: ['Pick your accent color: rose, petrol or indigo (Settings → Appearance)'] },
  { build: 178, de: ['„Was soll ich heute hören?" – neuer Zufalls-Knopf auf der Startseite zieht eine Platte aus deiner Sammlung'], en: ['"What should I play today?" — new shuffle button on home picks a record from your collection'] },
  { build: 177, de: ['Meilensteine auf dem Profil: Abzeichen für Platten, Bewertungen, Favoriten, Künstler und „Jahre dabei" – auch bei anderen sichtbar'], en: ['Milestones on your profile: badges for records, ratings, favorites, artists and years here — visible on other profiles too'] },
  { build: 176, de: ['Wunschzettel teilen: ein Link, der Freunden direkt deine Wunschliste zeigt'], en: ['Share your wishlist: one link that opens your wishlist for friends'] },
  { build: 175, de: ['Album-Seite: Spotify und Apple Music jetzt als große Knöpfe zum Direkt-Anhören'], en: ['Album page: Spotify and Apple Music are now prominent listen buttons'] },
  { build: 174, de: ['Aktivitäts-Feed: neuer „Aktivität"-Tab auf der Startseite – was deine Freunde hinzufügen, hören, bewerten und an Listen erstellen'], en: ['Activity feed: new "Activity" tab on home — what people you follow add, play, rate and list'] },
  { build: 173, de: ['Sammlung exportieren: als CSV (Tabelle) und als Versicherungs-Report zum Ausdrucken/als PDF'], en: ['Export your collection: as CSV (spreadsheet) and as a printable insurance report (PDF)'] },
  { build: 172, de: ['Eigene Tags pro Platte (z. B. signiert, farbig) – antippen filtert die Sammlung'], en: ['Your own tags per record (e.g. signed, colored) — tap one to filter your collection'] },
  { build: 168, de: ['„Zum Home-Bildschirm" als Overlay: Android auf einen Klick, iOS mit Anleitung'], en: ['"Add to home screen" as an overlay: one tap on Android, guide on iOS'] },
  { build: 166, de: ['Menüs schließen jetzt per Tipp daneben; Bewertungen stehen jetzt direkt unter den Favoriten'], en: ['Menus close by tapping outside; ratings now sit right under favorites'] },
  { build: 165, de: ['Fremde Profile: Sammlung antippbar, Bewertungs-Diagramm sichtbar; kein versehentliches Zoomen mehr'], en: ['Other profiles: browse their collection, see their ratings chart; no more accidental zoom'] },
  { build: 164, de: ['Fremde Profile: 3-Punkte-Menü oben rechts (Entfolgen, Teilen, Blockieren, Melden)'], en: ['Other profiles: 3-dot menu top right (unfollow, share, block, report)'] },
  { build: 163, de: ['Listen anderer Nutzer: gleiche Optik, mit Platzierungen, wenn der Ersteller sie anhat'], en: ['Other people\'s lists: same look, with placements if the creator enabled them'] },
  { build: 162, de: ['Listen im Letterboxd-Stil: antippen öffnet die Übersicht, Zahnrad für Platzierungen, Bearbeiten und Löschen'], en: ['Letterboxd-style lists: tap to open, gear for placements, edit and delete'] },
  { build: 160, de: ['Bessere Hörproben: passendere Treffer, weniger falsche oder fehlende Snippets'], en: ['Better previews: more accurate matches, fewer wrong or missing snippets'] },
  { build: 159, de: ['Sammlung-Ansicht wählbar: große/kleine Kacheln oder Liste'], en: ['Choose your collection view: large/small tiles or list'] },
  { build: 158, de: ['Schöne Vorschau beim Teilen von Links (mit Bild)'], en: ['Rich preview when sharing links (with image)'] },
  { build: 157, de: ['Hörkalender: dein Hörjahr als Heatmap im Wrapped'], en: ['Listening calendar: your year as a heatmap in Wrapped'] },
  { build: 156, de: ['Feedback-Knopf in den Einstellungen'], en: ['Feedback button in settings'] },
  { build: 155, de: ['Neu: „Was ist neu"-Übersicht nach jedem Update'], en: ['New: this "What\'s new" summary after each update'] },
  { build: 154, de: ['Schönere Illustrationen in leeren Bereichen'], en: ['Nicer illustrations for empty areas'] },
  { build: 153, de: ['Kaufdatum und Kaufort pro Platte'], en: ['Purchase date and place per record'] },
  { build: 152, de: ['Profile und Alben per Link direkt teilbar'], en: ['Share profiles and albums with a direct link'] },
  { build: 151, de: ['Leihliste: festhalten, wem du Platten geliehen hast', 'Regal/Standort pro Platte'], en: ['Lending list: track who borrowed your records', 'Shelf/location per record'] },
];
function whatsNewCardHtml() {
  let last = parseInt(localStorage.getItem(WHATSNEW_KEY), 10);
  const cur = appBuild();
  if (!cur) return '';
  if (isNaN(last)) {
    // Erstkontakt mit dem Changelog: ganz neue Nutzer (noch im Onboarding) nicht
    // stören; bestehende Nutzer sehen einmalig die jüngsten Neuerungen.
    if (!localStorage.getItem(ONBOARD_KEY)) { try { localStorage.setItem(WHATSNEW_KEY, String(cur)); } catch { /* voll */ } return ''; }
    last = 0;
  }
  if (last >= cur) return '';
  const lang = getLang();
  const items = [];
  for (const e of CHANGELOG) { if (e.build > last && e.build <= cur) (e[lang] || e.en || []).forEach((t) => items.push(t)); }
  if (!items.length) { try { localStorage.setItem(WHATSNEW_KEY, String(cur)); } catch { /* voll */ } return ''; }
  const li = items.slice(0, 6).map((t) => `<li>${escapeHtml(t)}</li>`).join('');
  return `<div class="onboard whatsnew" id="whatsnew">
      <button class="onboard-x" id="wn-x" aria-label="${tr('a11y.close')}">×</button>
      <p class="onboard-title">${escapeHtml(tr('whatsnew.title'))}</p>
      <ul class="whatsnew-list">${li}</ul>
      <button class="btn primary onboard-cta" id="wn-ok">${escapeHtml(tr('whatsnew.ok'))}</button>
    </div>`;
}
function dismissWhatsNew() {
  try { localStorage.setItem(WHATSNEW_KEY, String(appBuild())); } catch { /* voll */ }
  const el = document.getElementById('whatsnew'); if (el) el.remove();
}

// popHeart / animateSwap: jetzt in ./ui.js.

// Noten-/Herz-Icons (NOTE_PATH, noteSvg, heartSvg) + ratingDisplayHtml: jetzt in ./ui.js.

// Tippbare Eingabe: linke Hälfte = halbe Note, rechte = ganze; erneut tippen = zurücksetzen
function createRatingInput(container, initial, onChange) {
  let value = Number(initial) || 0;
  const fire = () => { if (typeof onChange === 'function') onChange(value); };
  container.classList.add('rating-input');
  container.innerHTML = '';
  // Barrierefrei: als Schieberegler bedienbar (Tab + Pfeiltasten).
  container.setAttribute('role', 'slider');
  container.setAttribute('tabindex', '0');
  container.setAttribute('aria-valuemin', '0');
  container.setAttribute('aria-valuemax', '5');
  container.setAttribute('aria-label', tr('a11y.rating'));
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
    container.setAttribute('aria-valuenow', value);
    container.setAttribute('aria-valuetext', value ? value + '/5' : '0');
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
  container.onkeydown = (e) => {
    let v = value;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = Math.min(5, value + 0.5);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = Math.max(0, value - 0.5);
    else if (e.key === 'Home') v = 0;
    else if (e.key === 'End') v = 5;
    else return;
    e.preventDefault();
    if (!requireAuth()) return;
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
  const lent = item.lentTo ? `<span class="tile-lent" title="${escapeHtml(item.lentTo)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg></span>` : '';
  return `
    <li class="tile" data-id="${item.id}">
      <span class="tile-sel" aria-hidden="true"></span>
      ${cover}
      ${lent}
      <div class="tile-body">
        ${meta}
        <p class="tile-title">${escapeHtml(item.title) || tr('misc.untitled')}</p>
        <p class="tile-artist">${escapeHtml(item.artist) || '(unbekannt)'}</p>
        ${note}
      </div>
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
  // Sprung-Buchstabe je Kachel (für die A–Z-Leiste), passend zum Sortiermodus
  for (let i = 0; i < items.length; i++) { if (ul.children[i]) ul.children[i].dataset.letter = sortLetter(items[i], mode); }

  const hint = $(`#empty-${list}`);
  if (getList(list).length === 0) {
    hint.innerHTML = list === 'collection'
      ? emptyState({ icon: ES_CRATE, title: tr('empty.collectionTitle'), text: tr('empty.collectionText'), ctaLabel: tr('empty.collectionCta'), ctaAttr: 'data-go="add"' })
      : emptyState({ icon: ES_HEART, title: tr('empty.wishlistTitle'), text: tr('empty.wishlistText'), ctaLabel: tr('empty.wishlistCta'), ctaAttr: 'data-go="search"' });
    const cta = hint.querySelector('.es-cta');
    if (cta) cta.onclick = () => switchView(cta.dataset.go);
  } else {
    hint.innerHTML = `<p class="es-text">${escapeHtml(tr('list.noMatches'))}</p>`;
  }
  hint.classList.toggle('hidden', items.length > 0);

  ul.querySelectorAll('.tile').forEach((el) => attachTileMenu(el, list));
  if (list === 'collection') {
    ul.classList.toggle('selecting', selMode);
    if (selMode) ul.querySelectorAll('.tile').forEach((t) => { if (selIds.has(t.dataset.id)) t.classList.add('selected'); });
    updateAzBar();
  }
}

// ---------- Sammlungs-Ansicht (große/kleine Kacheln, Liste) ----------
const COLLECTION_VIEW_KEY = 'discend_collection_view';
const COLLECTION_VIEWS = ['large', 'small', 'list', 'shelf'];
function getCollectionView() {
  const v = localStorage.getItem(COLLECTION_VIEW_KEY);
  return COLLECTION_VIEWS.includes(v) ? v : 'large';
}
function applyCollectionView(v) {
  if (!COLLECTION_VIEWS.includes(v)) v = 'large';
  try { localStorage.setItem(COLLECTION_VIEW_KEY, v); } catch { /* voll */ }
  const ul = document.getElementById('list-collection');
  if (ul) COLLECTION_VIEWS.forEach((x) => ul.classList.toggle('view-' + x, x === v));
  document.querySelectorAll('#view-switch-collection .vs-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
}

// ---------- Schnellmenü (Langdruck / Rechtsklick auf eine Kachel) ----------
let qmTarget = null;
function attachTileMenu(el, list) {
  let longFired = false, timer = null, sx = 0, sy = 0;
  el.addEventListener('click', () => {
    if (longFired) { longFired = false; return; } // Langdruck-Klick unterdrücken
    if (selMode && list === 'collection') { toggleSel(el); return; } // Auswahlmodus
    // Sammlung: erst die eigene Übersicht (Cover führt zur Albumseite). Wishlist: direkt bearbeiten.
    if (list === 'collection') { const it = getList('collection').find((i) => i.id === el.dataset.id); if (it) { openRecord(it, true); return; } }
    openDetail(list, el.dataset.id);
  });
  const startHold = (x, y) => {
    if (selMode && list === 'collection') return; // im Auswahlmodus kein Langdruck-Menü
    longFired = false; sx = x; sy = y;
    clearTimeout(timer);
    timer = setTimeout(() => {
      longFired = true;
      if (navigator.vibrate) { try { navigator.vibrate(10); } catch { /* */ } }
      openQuickMenu(list, el.dataset.id);
    }, 500);
  };
  el.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t) startHold(t.clientX, t.clientY); }, { passive: true });
  el.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t && (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10)) clearTimeout(timer); }, { passive: true });
  el.addEventListener('touchend', () => clearTimeout(timer));
  el.addEventListener('touchcancel', () => clearTimeout(timer));
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); openQuickMenu(list, el.dataset.id); });
}
function openQuickMenu(list, id) {
  if (!requireAuth()) return;
  const item = getList(list).find((i) => i.id === id);
  if (!item) return;
  qmTarget = { list, id };
  $('#qm-title').textContent = [item.artist, item.title].filter(Boolean).join(' – ') || tr('misc.untitled');
  $('#qm-like').classList.toggle('liked', !!item.liked);
  $('#qm-like-label').textContent = tr(item.liked ? 'qm.unlike' : 'qm.like');
  $('#qm-move-label').textContent = list === 'collection' ? tr('btn.moveToWishlist') : tr('btn.moveToCollection');
  $('#quick-menu').showModal();
}
$('#qm-cancel').addEventListener('click', () => $('#quick-menu').close());
$('#qm-like').addEventListener('click', () => {
  if (!qmTarget) return;
  const { list, id } = qmTarget;
  const item = getList(list).find((i) => i.id === id);
  if (item) { updateItem(list, id, { liked: !item.liked }); renderList(list); if (currentView === 'settings') renderProfile(); }
  $('#quick-menu').close();
});
$('#qm-move').addEventListener('click', () => {
  if (!qmTarget) return;
  const { list, id } = qmTarget;
  const to = list === 'collection' ? 'wishlist' : 'collection';
  moveItem(list, to, id);
  renderList('collection'); renderList('wishlist'); renderCounts();
  $('#quick-menu').close();
  toast(to === 'wishlist' ? tr('toast.movedToWishlist') : tr('toast.movedToCollection'));
});
$('#qm-share').addEventListener('click', () => {
  if (!qmTarget) return;
  const item = getList(qmTarget.list).find((i) => i.id === qmTarget.id);
  $('#quick-menu').close();
  if (item) shareLink(`${item.artist || ''} – ${item.title || ''} ${tr('share.suffix')}`.replace(/^ – /, '').trim());
});
$('#qm-delete').addEventListener('click', () => {
  if (!qmTarget) return;
  const { list, id } = qmTarget;
  $('#quick-menu').close();
  deleteWithUndo(list, id);
});

// ---------- Mehrfachauswahl (Sammlung) ----------
let selMode = false;
const selIds = new Set();
function toggleSel(el) {
  const id = el.dataset.id;
  if (selIds.has(id)) { selIds.delete(id); el.classList.remove('selected'); }
  else { selIds.add(id); el.classList.add('selected'); }
  updateSelBar();
}
function updateSelBar() {
  const c = document.getElementById('sel-count');
  if (c) c.textContent = tr('sel.count', { n: selIds.size });
  const dis = selIds.size === 0;
  ['sel-move', 'sel-delete'].forEach((id) => { const b = document.getElementById(id); if (b) b.disabled = dis; });
}
function setSelMode(on) {
  selMode = on;
  selIds.clear();
  const ul = document.getElementById('list-collection');
  if (ul) { ul.classList.toggle('selecting', on); ul.querySelectorAll('.tile.selected').forEach((t) => t.classList.remove('selected')); }
  const btn = document.getElementById('sel-toggle-collection');
  if (btn) btn.classList.toggle('active', on);
  const bar = document.getElementById('sel-bar');
  if (bar) bar.classList.toggle('hidden', !on);
  updateSelBar();
  updateAzBar();
}
function selMove() {
  if (!selIds.size) return;
  const ids = [...selIds];
  ids.forEach((id) => moveItem('collection', 'wishlist', id));
  setSelMode(false);
  renderList('collection'); renderList('wishlist'); renderCounts();
  toast(tr('sel.moved', { n: ids.length }));
}
function selDelete() {
  if (!selIds.size) return;
  const snapshots = [...selIds].map((id) => getList('collection').find((i) => i.id === id)).filter(Boolean).map((it) => ({ ...it }));
  snapshots.forEach((s) => deleteItem('collection', s.id));
  setSelMode(false);
  renderList('collection'); renderCounts();
  if (currentView === 'settings') renderProfile();
  toastUndo(tr('sel.deleted', { n: snapshots.length }), () => {
    snapshots.forEach((s) => addItem('collection', s));
    renderList('collection'); renderCounts();
    toast(tr('toast.restored'));
  });
}
{
  const b1 = document.getElementById('sel-toggle-collection'); if (b1) b1.addEventListener('click', () => setSelMode(!selMode));
  const b2 = document.getElementById('sel-cancel'); if (b2) b2.addEventListener('click', () => setSelMode(false));
  const b3 = document.getElementById('sel-move'); if (b3) b3.addEventListener('click', selMove);
  const b4 = document.getElementById('sel-delete'); if (b4) b4.addEventListener('click', selDelete);
}

// ---------- A–Z-Sprungleiste (Sammlung) ----------
// azWords / sortLetter / letterRank: jetzt in ./util.js

const AZ_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
let azBuilt = false;
function buildAzBar() {
  const bar = document.getElementById('az-bar');
  if (!bar || azBuilt) return;
  bar.innerHTML = AZ_LETTERS.map((L) => `<span class="az-letter">${L}</span>`).join('');
  const jump = (clientY) => {
    const r = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(0.999, (clientY - r.top) / r.height));
    azScrollTo(AZ_LETTERS[Math.floor(ratio * AZ_LETTERS.length)]);
  };
  let dragging = false;
  bar.addEventListener('pointerdown', (e) => { dragging = true; try { bar.setPointerCapture(e.pointerId); } catch { /* */ } jump(e.clientY); e.preventDefault(); });
  bar.addEventListener('pointermove', (e) => { if (dragging) jump(e.clientY); });
  const end = (e) => { dragging = false; try { bar.releasePointerCapture(e.pointerId); } catch { /* */ } };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
  azBuilt = true;
}
function azScrollTo(L) {
  const ul = document.getElementById('list-collection');
  if (!ul) return;
  const want = letterRank(L);
  let target = null;
  for (const t of ul.children) { if (letterRank(t.dataset.letter || '') >= want) { target = t; break; } }
  if (!target && ul.children.length) target = ul.children[ul.children.length - 1];
  if (target) target.scrollIntoView({ block: 'start' });
}
function updateAzBar() {
  const bar = document.getElementById('az-bar');
  if (!bar) return;
  const sortEl = document.getElementById('sort-collection');
  const alpha = sortEl && ['artist', 'firstname', 'lastname', 'title'].includes(sortEl.value);
  const tiles = document.querySelectorAll('#list-collection .tile').length;
  const show = currentView === 'collection' && alpha && tiles >= 15 && !selMode;
  bar.classList.toggle('hidden', !show);
  if (show) buildAzBar();
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

// Overlays (#detail-page, #user-page, #up-grid-page) teilen sich z-index 40 und stapeln sonst
// nur nach DOM-Reihenfolge. Das zuletzt geöffnete nach vorne holen (bleibt unter Dialogen/Toast).
const OVERLAY_SELS = ['#detail-page', '#user-page', '#up-grid-page', '#record-page'];
function bringOverlayFront(el) {
  OVERLAY_SELS.forEach((s) => { const o = $(s); if (o) o.style.zIndex = ''; });
  if (el) el.style.zIndex = '45';
}
// Tags: kommaseparierten Text in eine Liste (getrimmt, dedupliziert, ohne Leere).
function parseTags(str) {
  const seen = new Set();
  return String(str || '').split(',').map((t) => t.trim()).filter((t) => {
    if (!t) return false;
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
// Tags als anklickbare Chips auf der Albumseite (Klick filtert die Sammlung danach).
function renderTagChips(tags) {
  const el = $('#dp-tags'); if (!el) return;
  const list = Array.isArray(tags) ? tags : [];
  el.innerHTML = list.map((t) => `<button class="tag-chip" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('');
  el.querySelectorAll('.tag-chip').forEach((b) => b.addEventListener('click', () => {
    closeDetail();
    const inp = $('#search-collection'); if (inp) inp.value = b.dataset.tag;
    switchView('collection');
  }));
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
  $('#dp-edit-location').value = item.location || '';
  $('#dp-edit-purchase-date').value = item.purchaseDate || '';
  $('#dp-edit-purchase-place').value = item.purchasePlace || '';
  $('#dp-edit-tags').value = (item.tags || []).join(', ');
  renderTagChips(item.tags);
  setConditionDisplay(item.mediaCond, item.sleeveCond);
  const lendSec = $('#dp-lend-section');
  if (lendSec) lendSec.style.display = list === 'collection' ? '' : 'none';
  if (list === 'collection') renderLend(item);
  renderSavings(item, list);
  $('.dp-edit').open = false;

  $('#dp-move').textContent = list === 'collection' ? tr('btn.moveToWishlist') : tr('btn.moveToCollection');

  $('#dp-play-date').value = new Date().toISOString().slice(0, 10);
  $('#dp-play-note').value = '';
  renderDiaryPlays(item.id);
  loadTracklist(item);
  renderCommunityRating(item);
  renderAlbumReviews(item);
  renderAlbumComments(item);

  { const as0 = $('#dp-actions'); if (as0 && as0.open) as0.close(); }
  bringOverlayFront(detailPage); detailPage.classList.remove('hidden');
  $('#detail-scroll').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  resetUrl();
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
  } else {
    const id = editing.id; closeDetail(); deleteWithUndo('collection', id, tr('toast.removed'));
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
  } else {
    const id = editing.id; closeDetail(); deleteWithUndo('wishlist', id, tr('toast.removed'));
  }
});

// Streaming-Such-Deeplinks (4 Dienste).
function setListenLinks(q) {
  $('#dp-spotify').href = `https://open.spotify.com/search/${q}`;
  $('#dp-apple').href = `https://music.apple.com/search?term=${q}`;
  $('#dp-amazon').href = `https://music.amazon.com/search/${q}`;
  $('#dp-youtube').href = `https://music.youtube.com/search?q=${q}`;
}

// ---------- Deep-Links (teilbare URLs: /u/name und /album?a=&t=&y=) ----------
// Baut die öffentliche URL zu einem Profil.
function profileUrl(username) {
  return location.origin + '/u/' + encodeURIComponent(username || '');
}
// Baut die öffentliche URL zu einem Album (nur Künstler/Titel/Jahr – Cover wird
// beim Öffnen frisch geladen, so bleibt der Link kurz und stabil).
function albumUrl(a) {
  if (!a || (!a.artist && !a.title)) return location.origin + '/';
  const p = new URLSearchParams();
  if (a.artist) p.set('a', a.artist);
  if (a.title) p.set('t', a.title);
  if (a.year) p.set('y', String(a.year));
  return location.origin + '/album?' + p.toString();
}
// Adresszeile aktualisieren, ohne neuen History-Eintrag (Zurück verlässt die App
// wie bisher; die aktuelle URL ist aber jederzeit als Deep-Link kopierbar).
function setUrl(url) {
  try { history.replaceState(null, '', url); } catch { /* ignorieren */ }
}
function resetUrl() {
  if (location.pathname !== '/' || location.search) setUrl(location.origin + '/');
}
// Beim App-Start: Zeigt die URL auf ein Profil oder Album? Dann direkt öffnen.
async function routeFromUrl() {
  // Auth-Rückläufer (Passwort-Reset o. Ä.) nicht stören
  if (/pwreset=1|type=recovery/.test((location.search || '') + (location.hash || ''))) return;
  let path = '/'; try { path = decodeURIComponent(location.pathname || '/'); } catch { path = location.pathname || '/'; }
  const mu = path.match(/^\/u\/([^/]+)\/?$/);
  if (mu) {
    // Query VOR openUserProfile lesen – das setzt die Adresszeile auf /u/name um.
    const wantList = new URLSearchParams(location.search || '').get('list');
    try {
      const prof = await fetchProfileByUsername(mu[1]);
      if (prof) {
        await openUserProfile(prof);
        // Geteilter Wunschzettel-Link: direkt die Wunschliste aufschlagen
        if (wantList === 'wishlist') openUpGrid('wishlist');
      } else { toast(tr('deeplink.userNotFound')); resetUrl(); }
    } catch { resetUrl(); }
    return;
  }
  if (path.replace(/\/$/, '') === '/album' && location.search) {
    const q = new URLSearchParams(location.search);
    const artist = q.get('a') || ''; const title = q.get('t') || ''; const year = q.get('y') || '';
    if (artist || title) {
      const result = { artist, title, year, coverUrl: '' };
      try { const cover = await fetchCoverArt(artist, title); if (cover) result.coverUrl = cover; } catch { /* ignorieren */ }
      openPreview(result);
    } else { resetUrl(); }
    return;
  }
}

// ---------- Teilen (Web Share API, Fallback: Link kopieren) ----------
async function shareLink(text, url) {
  url = url || (location.origin + '/');
  try {
    if (navigator.share) { await navigator.share({ title: 'Discend', text, url }); return; }
    await navigator.clipboard.writeText(text + ' ' + url);
    toast(tr('toast.linkCopied'));
  } catch { /* abgebrochen/ignorieren */ }
}
function shareProfile() {
  const p = getProfile() || {};
  const url = p.username ? profileUrl(p.username) : location.origin + '/';
  shareLink(`${profileName() || tr('title.profile')} ${tr('share.suffix')}`, url);
}
function shareAlbum() {
  const a = editing ? getList(editing.list).find((i) => i.id === editing.id) : previewResult;
  if (!a) return;
  shareLink(`${a.artist || ''} – ${a.title || ''} ${tr('share.suffix')}`.replace(/^ – /, '').trim(), albumUrl(a));
}
// Wunschzettel teilen: Link aufs eigene Profil, der die Wunschliste direkt aufschlägt.
function shareWishlist() {
  const p = getProfile() || {};
  if (!p.username) { toast(tr('toast.wishlistNeedsProfile')); return; }
  shareLink(`${tr('share.myWishlist')} ${tr('share.suffix')}`, profileUrl(p.username) + '?list=wishlist');
}
$('#header-share').addEventListener('click', shareProfile);
$('#as-share').addEventListener('click', shareAlbum);
$('#share-wishlist').addEventListener('click', shareWishlist);

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

// ---------- Album-Kommentare (öffentliche Diskussion unter dem Album) ----------
let albumCommentsReq = 0;
let albumCommentItem = null;
async function renderAlbumComments(item) {
  albumCommentItem = item;
  const box = $('#dp-comments'); if (!box) return;
  const rq = ++albumCommentsReq;
  box.innerHTML = `<p class="hint">${tr('msg.loading')}</p>`;
  let comments = [];
  try { comments = await fetchAlbumComments(item); } catch { /* ignorieren */ }
  if (rq !== albumCommentsReq) return; // ein neueres Album wurde geöffnet
  const me = getUser();
  if (!comments.length) { box.innerHTML = `<p class="hint">${tr('albumComments.none')}</p>`; return; }
  box.innerHTML = comments.map((c) => {
    const name = c.by ? (c.by.display_name || c.by.username || '?') : '?';
    const av = (c.by && c.by.avatar_url) ? `style="background-image:url('${escapeHtml(c.by.avatar_url)}')"` : '';
    const del = (me && me.id === c.userId) ? `<button class="ac-del" data-id="${escapeHtml(c.id)}" aria-label="${tr('a11y.delete')}">×</button>` : '';
    return `<div class="ac-comment">
        <button class="ac-av${(c.by && c.by.avatar_url) ? '' : ' placeholder'}" data-uid="${escapeHtml(c.userId)}" ${av} aria-label="${escapeHtml(name)}"></button>
        <div class="ac-body"><span class="ac-name">${escapeHtml(name)}</span><span class="ac-text">${escapeHtml(c.text)}</span></div>${del}
      </div>`;
  }).join('');
  box.querySelectorAll('.ac-av[data-uid]').forEach((b) => b.addEventListener('click', () => {
    const c = comments.find((x) => x.userId === b.dataset.uid);
    if (c && c.by) openUserProfile(c.by);
  }));
  box.querySelectorAll('.ac-del').forEach((b) => b.addEventListener('click', async () => {
    await deleteAlbumComment(b.dataset.id); renderAlbumComments(albumCommentItem);
  }));
}
async function sendAlbumComment() {
  if (!requireAuth()) return;
  const inp = $('#dp-comment-input'); const t = (inp.value || '').trim();
  if (!t || !albumCommentItem) return;
  inp.value = '';
  const res = await addAlbumComment(albumCommentItem, t);
  if (res === null) { toast(tr('albumComments.failed')); inp.value = t; return; }
  renderAlbumComments(albumCommentItem);
}
$('#dp-comment-send').addEventListener('click', sendAlbumComment);
$('#dp-comment-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendAlbumComment(); } });

// ---------- Platten-Übersicht (eigene / Freundes-Infos zur Platte) ----------
// Klick auf ein Sammlungs-Album ODER auf Freundes-Aktivität öffnet erst diese
// Übersicht; das Cover führt von hier auf die echte Albumseite.
let recordCtx = null; // { item, mine }
function fmtRecDate(v) {
  if (!v) return '';
  const d = new Date(typeof v === 'number' ? v : (String(v).length <= 10 ? v + 'T00:00:00' : v));
  if (isNaN(d)) return '';
  return d.toLocaleDateString(getLang() === 'de' ? 'de-DE' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
async function openRecord(item, mine) {
  if (!item) return;
  recordCtx = { item, mine: !!mine };
  const cover = $('#rec-cover');
  cover.className = 'rec-cover' + (item.coverUrl ? '' : ' placeholder');
  cover.innerHTML = item.coverUrl ? `<img src="${escapeHtml(item.coverUrl)}" alt="" onerror="this.parentElement.classList.add('placeholder');this.remove()">` : '';
  $('#rec-bar-title').textContent = item.title || tr('misc.untitled');
  $('#rec-title').textContent = item.title || tr('misc.untitled');
  $('#rec-artist').textContent = item.artist || '';
  // „von …" nur bei fremden Platten
  const byEl = $('#rec-by');
  if (!mine && item.by) {
    const who = item.by.display_name || item.by.username || '';
    byEl.textContent = tr('rec.by', { who });
    byEl.hidden = false;
    byEl.onclick = () => openUserProfile(item.by);
  } else { byEl.hidden = true; byEl.onclick = null; }
  $('#rec-rating').innerHTML = Number(item.rating) > 0 ? ratingDisplayHtml(item.rating) : `<span class="hint">${tr('stat.noRating')}</span>`;

  // Info-Zeilen zusammenstellen
  const rows = [];
  const addedTs = item.addedAt || item.added_at;
  if (item.kind === 'play' && item.playedOn) rows.push([tr('feed.listenedOn'), fmtRecDate(item.playedOn)]);
  if (addedTs) rows.push([tr('rec.added'), fmtRecDate(addedTs)]);
  const cond = [item.mediaCond, item.sleeveCond].filter(Boolean).join(' · ');
  if (cond) rows.push([tr('cond.label').replace(/:$/, ''), cond]);
  if (mine) {
    if ((item.location || '').trim()) rows.push([tr('field.location'), item.location.trim()]);
    if ((item.purchaseDate || '').trim()) rows.push([tr('field.purchaseDate'), fmtRecDate(item.purchaseDate)]);
    if ((item.purchasePlace || '').trim()) rows.push([tr('field.purchasePlace'), item.purchasePlace.trim()]);
    if ((item.tags || []).length) rows.push([tr('field.tags'), item.tags.join(', ')]);
  }
  // Hörzähler (nur eigene Platte – fremde Plays sind nicht pro Nutzer abrufbar)
  const infoEl = $('#rec-info');
  infoEl.innerHTML = rows.map(([k, v]) => `<li><span>${escapeHtml(k)}</span><span class="stat-num">${escapeHtml(v)}</span></li>`).join('');
  if (mine) {
    fetchPlays(item.id).then((plays) => {
      if (!recordCtx || recordCtx.item !== item) return;
      const li = document.createElement('li');
      li.innerHTML = `<span>${escapeHtml(tr('rec.plays'))}</span><span class="stat-num">${plays.length}</span>`;
      infoEl.appendChild(li);
    }).catch(() => {});
  }

  // Notiz (nur eigene)
  const noteSec = $('#rec-note-section');
  const note = mine ? (item.note || '').trim() : '';
  const playNote = (item.kind === 'play' && item.playNote) ? item.playNote.trim() : '';
  const noteText = [playNote ? '🎧 ' + playNote : '', note].filter(Boolean).join('\n');
  if (noteText) { noteSec.hidden = false; $('#rec-note').textContent = noteText; }
  else noteSec.hidden = true;

  // Review + Likes
  const revSec = $('#rec-review-section');
  const review = (item.review || '').trim();
  if (review) {
    revSec.hidden = false;
    $('#rec-review').textContent = review;
  } else revSec.hidden = true;

  // Cover / „Albumseite öffnen" → echte Albumseite
  cover.onclick = () => openRecordAlbum();
  $('#rec-openalbum').onclick = () => openRecordAlbum();

  bringOverlayFront($('#record-page'));
  $('#record-page').classList.remove('hidden');
  $('#rec-scroll').scrollTop = 0;
  document.body.style.overflow = 'hidden';

  // Likes/Kommentare hängen an der Eintrags-ID (nur wenn in der Cloud vorhanden)
  renderRecordLikes(item);
  renderRecordComments(item);
}
function openRecordAlbum() {
  if (!recordCtx) return;
  const { item, mine } = recordCtx;
  if (mine) openDetail('collection', item.id);
  else openPreview(item);
}
async function renderRecordLikes(item) {
  const box = $('#rec-likers'); const btn = $('#rec-like');
  box.innerHTML = ''; btn.classList.remove('liked');
  if (!$('#rec-review-section') || $('#rec-review-section').hidden) { btn.onclick = null; return; }
  btn.onclick = async () => {
    if (!requireAuth()) return;
    const res = await toggleActivityLike(item.id);
    if (res !== null) { btn.classList.toggle('liked', res); if (res) popHeart(btn); renderRecordLikes(item); }
  };
  let info = { likers: [], liked: false };
  try { info = await fetchLikers(item.id); } catch { /* ignorieren */ }
  if (!recordCtx || recordCtx.item !== item) return;
  btn.classList.toggle('liked', info.liked);
  if (!info.likers.length) { box.innerHTML = `<span class="hint">${tr('rec.noLikes')}</span>`; return; }
  const names = info.likers.map((p) => p.display_name || p.username || '?');
  const shown = names.slice(0, 3).join(', ');
  const more = names.length > 3 ? tr('rec.andMore', { n: names.length - 3 }) : '';
  box.textContent = tr('rec.likedBy', { who: shown }) + more;
}
let recordCommentsReq = 0;
async function renderRecordComments(item) {
  const rq = ++recordCommentsReq;
  const box = $('#rec-comments');
  box.innerHTML = `<p class="hint">${tr('msg.loading')}</p>`;
  let comments = [];
  try { comments = await fetchComments(item.id); } catch { /* ignorieren */ }
  if (rq !== recordCommentsReq) return;
  const me = getUser();
  if (!comments.length) { box.innerHTML = `<p class="hint">${tr('albumComments.none')}</p>`; return; }
  box.innerHTML = comments.map((c) => {
    const name = c.by ? (c.by.display_name || c.by.username || '?') : '?';
    const av = (c.by && c.by.avatar_url) ? `style="background-image:url('${escapeHtml(c.by.avatar_url)}')"` : '';
    const del = (me && me.id === c.userId) ? `<button class="ac-del" data-id="${escapeHtml(c.id)}" aria-label="${tr('a11y.delete')}">×</button>` : '';
    return `<div class="ac-comment">
        <button class="ac-av${(c.by && c.by.avatar_url) ? '' : ' placeholder'}" data-uid="${escapeHtml(c.userId)}" ${av} aria-label="${escapeHtml(name)}"></button>
        <div class="ac-body"><span class="ac-name">${escapeHtml(name)}</span><span class="ac-text">${escapeHtml(c.text)}</span></div>${del}
      </div>`;
  }).join('');
  box.querySelectorAll('.ac-av[data-uid]').forEach((b) => b.addEventListener('click', () => {
    const c = comments.find((x) => x.userId === b.dataset.uid); if (c && c.by) openUserProfile(c.by);
  }));
  box.querySelectorAll('.ac-del').forEach((b) => b.addEventListener('click', async () => {
    await deleteComment(b.dataset.id); renderRecordComments(item);
  }));
}
async function sendRecordComment() {
  if (!requireAuth()) return;
  const inp = $('#rec-comment-input'); const t = (inp.value || '').trim();
  if (!t || !recordCtx) return;
  inp.value = '';
  const res = await addComment(recordCtx.item.id, t);
  if (res === null) { toast(tr('albumComments.failed')); inp.value = t; return; }
  renderRecordComments(recordCtx.item);
}
$('#rec-comment-send').addEventListener('click', sendRecordComment);
$('#rec-comment-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendRecordComment(); } });
$('#rec-back').addEventListener('click', () => {
  $('#record-page').classList.add('hidden');
  if ($('#user-page').classList.contains('hidden') && $('#detail-page').classList.contains('hidden')) document.body.style.overflow = '';
});

// Album aus der Suche/Datenbank ansehen (noch nicht gespeichert) -> Detailseite mit Tracklist
function openPreview(result) {
  if (!result) return;
  pushRecentAlbum(result); // „Zuletzt angesehen" merken
  editing = null;
  previewResult = result;
  setUrl(albumUrl(result)); // Deep-Link in der Adresszeile
  detailPage.classList.add('preview');
  { const ls = document.getElementById('dp-lend-section'); if (ls) ls.style.display = 'none'; }
  renderTagChips([]); // Vorschau (fremdes/ungespeichertes Album): keine eigenen Tags
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
  renderAlbumComments(result);
  { const as0 = $('#dp-actions'); if (as0 && as0.open) as0.close(); }
  bringOverlayFront(detailPage); detailPage.classList.remove('hidden');
  $('#detail-scroll').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

async function addPreviewTo(list) {
  if (!requireAuth()) return;
  if (!previewResult) return;
  const item = { ...previewResult };
  const dup = findDuplicate(item.artist, item.title, item.barcode);
  if (dup && !confirm(tr('confirm.duplicate', { title: (item.title || dup.item.title || '').trim(), list: tr(dup.list === 'collection' ? 'dup.collection' : 'dup.wishlist') }))) return;
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
  const notes = (info && info.notes || '').trim();
  if (!rows.length && !notes) { el.innerHTML = ''; sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  // Kurze Fakten immer sichtbar; die lange Beschreibung wird eingeklappt (3 Zeilen)
  // und lässt sich ausklappen – so bleibt die Seite kompakt und die Tracklist rutscht hoch.
  const rowsHtml = rows.map(([k, v]) => `<div class="info-row"><span class="info-k">${k}</span><span class="info-v">${escapeHtml(v)}</span></div>`).join('');
  // Beschriftung direkt hier (nicht über i18n-Schlüssel), damit ein alt
  // gecachtes i18n.js nie den Roh-Schlüssel „info.showMore" anzeigen kann.
  const infoLabel = (more) => getLang() === 'de'
    ? (more ? 'Mehr anzeigen ⌄' : 'Weniger anzeigen ⌃')
    : (more ? 'Show more ⌄' : 'Show less ⌃');
  const longNotes = notes.length > 160;
  const notesHtml = notes
    ? (longNotes
        ? `<p class="info-notes clamp" id="dp-info-notes">${escapeHtml(notes)}</p><button type="button" class="link-btn info-toggle" id="dp-info-toggle">${infoLabel(true)}</button>`
        : `<p class="info-notes">${escapeHtml(notes)}</p>`)
    : '';
  el.innerHTML = rowsHtml + notesHtml;
  const tgl = $('#dp-info-toggle');
  if (tgl) tgl.addEventListener('click', () => {
    const clamped = $('#dp-info-notes').classList.toggle('clamp');
    tgl.textContent = infoLabel(clamped);
  });
}

// Audio-Hörprobe (30s) – es spielt immer nur eine; gesteuert über den Mini-Player.
let previewAudio = null;
let previewBtn = null;
function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function hideMiniPlayer() { const mp = $('#mini-player'); if (mp) mp.classList.add('hidden'); }
function showMiniPlayer(meta) {
  const mp = $('#mini-player'); if (!mp) return;
  const label = meta && (meta.title || meta.artist)
    ? [meta.title, meta.artist].filter(Boolean).join(' · ')
    : tr('a11y.preview');
  $('#mp-title').textContent = label;
  $('#mp-fill').style.width = '0%';
  $('#mp-time').textContent = '';
  mp.classList.remove('paused', 'hidden');
}
// Nur den Ton stoppen – die Warteschlange („Alle abspielen") bleibt bestehen.
function stopAudio() {
  if (previewAudio) { try { previewAudio.pause(); } catch { /* ignorieren */ } previewAudio = null; }
  previewBtn = null;
  document.querySelectorAll('.playing').forEach((b) => b.classList.remove('playing'));
  document.querySelectorAll('.prog-fill').forEach((f) => { f.style.width = '0%'; });
  hideMiniPlayer();
}
// Alles stoppen (Ton + Warteschlange) – für Schließen, Albumwechsel, Einzel-Klick.
function stopPreview() { previewQueue = null; updatePlayAllBtn(); stopAudio(); }
// keepQueue: nur der Warteschlangen-Aufruf behält sie; jeder andere Klick beendet sie.
function togglePreview(url, btn, meta, keepQueue) {
  const wasPlaying = btn && btn.classList.contains('playing');
  if (keepQueue) stopAudio(); else stopPreview();
  if (wasPlaying) return;
  previewAudio = new Audio(url);
  previewBtn = btn || null;
  if (btn) btn.classList.add('playing');
  // Fortschrittsbalken der zugehörigen Zeile (falls vorhanden) mitlaufen lassen
  const row = btn ? btn.closest('li, .pfsong') : null;
  const fill = row ? row.querySelector('.prog-fill') : null;
  if (fill) fill.style.width = '0%';
  showMiniPlayer(meta);
  previewAudio.ontimeupdate = () => {
    if (!previewAudio || !previewAudio.duration) return;
    const pct = Math.min(100, (previewAudio.currentTime / previewAudio.duration) * 100);
    if (fill) fill.style.width = pct + '%';
    const mpf = $('#mp-fill'); if (mpf) mpf.style.width = pct + '%';
    const mpt = $('#mp-time'); if (mpt) mpt.textContent = fmtTime(previewAudio.currentTime) + ' / ' + fmtTime(previewAudio.duration);
  };
  previewAudio.onplay = () => { const mp = $('#mini-player'); if (mp) mp.classList.remove('paused'); };
  previewAudio.onpause = () => { const mp = $('#mini-player'); if (mp && previewAudio && !previewAudio.ended) mp.classList.add('paused'); };
  previewAudio.play().catch(() => { if (btn) btn.classList.remove('playing'); });
  previewAudio.onended = () => {
    if (btn) btn.classList.remove('playing');
    if (fill) fill.style.width = '0%';
    previewAudio = null; previewBtn = null;
    hideMiniPlayer();
    if (previewQueue) playQueueNext(); // „Alle abspielen": direkt weiter zum nächsten Song
  };
}

// ---------- Ganze Tracklist abspielen (Hörproben nacheinander) ----------
let previewQueue = null;      // { items: [{ i, preview, title }], pos, artist }
let tracklistTracks = [];     // aktuell angezeigte Tracks (für den „Alle abspielen"-Knopf)
let tracklistItem = null;
function updatePlayAllBtn() {
  const btn = $('#dp-playall'); if (!btn) return;
  const n = tracklistTracks.filter((t) => t.preview).length;
  btn.hidden = n < 2; // erst ab 2 Hörproben sinnvoll
  const lbl = $('#dp-playall-label');
  if (lbl) lbl.textContent = previewQueue ? tr('btn.stopAll') : tr('btn.playAll');
  btn.classList.toggle('playing', !!previewQueue);
}
function playQueueNext() {
  const q = previewQueue; if (!q) return;
  q.pos++;
  if (q.pos >= q.items.length) { previewQueue = null; updatePlayAllBtn(); return; } // Album durch
  const e = q.items[q.pos];
  const btn = document.querySelector(`#dp-tracklist .trk-play[data-i="${e.i}"]`);
  togglePreview(e.preview, btn, { title: e.title, artist: q.artist }, true);
  updatePlayAllBtn();
}
function togglePlayAll() {
  if (previewQueue) { stopPreview(); return; }
  const items = tracklistTracks.map((t, i) => ({ i, preview: t.preview, title: t.title })).filter((e) => e.preview);
  if (!items.length) return;
  stopPreview();
  previewQueue = { items, pos: -1, artist: (tracklistItem && tracklistItem.artist) || '' };
  playQueueNext();
}
$('#dp-playall').addEventListener('click', togglePlayAll);
// Mini-Player-Steuerung: Pause/Play, Spulen (Klick/Ziehen), Schließen.
(function wireMiniPlayer() {
  const mp = $('#mini-player'); if (!mp) return;
  $('#mp-toggle').addEventListener('click', () => {
    if (!previewAudio) return;
    if (previewAudio.paused) previewAudio.play().catch(() => {});
    else previewAudio.pause();
  });
  $('#mp-close').addEventListener('click', stopPreview);
  const bar = $('#mp-bar');
  const seekTo = (clientX) => {
    if (!previewAudio || !previewAudio.duration) return;
    const r = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    previewAudio.currentTime = ratio * previewAudio.duration;
    $('#mp-fill').style.width = (ratio * 100) + '%';
  };
  let dragging = false;
  bar.addEventListener('pointerdown', (e) => { dragging = true; try { bar.setPointerCapture(e.pointerId); } catch { /* */ } seekTo(e.clientX); });
  bar.addEventListener('pointermove', (e) => { if (dragging) seekTo(e.clientX); });
  const endDrag = (e) => { dragging = false; try { bar.releasePointerCapture(e.pointerId); } catch { /* */ } };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);
})();

async function loadTracklist(item) {
  const ol = $('#dp-tracklist');
  const status = $('#dp-tracklist-status');
  ol.innerHTML = '';
  stopPreview();
  tracklistTracks = []; tracklistItem = item; updatePlayAllBtn();
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
        const map = {}; its.forEach((t) => { const k = normTitle(t.title); if (t.preview && k) map[k] = t.preview; });
        tracks.forEach((t) => { if (!t.preview) { const k = normTitle(t.title); const p = k && map[k]; if (p) t.preview = p; } });
        // Positions-Fallback: gleich viele Tracks => sehr wahrscheinlich dasselbe Album,
        // also verbleibende fehlende Proben der Reihe nach zuordnen.
        if (its.length === tracks.length) tracks.forEach((t, i) => { if (!t.preview && its[i] && its[i].preview) t.preview = its[i].preview; });
      }
    } catch { /* ignorieren */ }
  }
  status.textContent = '';
  tracklistTracks = tracks; updatePlayAllBtn();
  ol.innerHTML = tracks.map((t, i) => {
    const play = t.preview
      ? `<button class="trk-play" data-i="${i}" aria-label="${tr('a11y.preview')}"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>`
      : '<span class="trk-play-none"></span>';
    return `<li><span class="trk-pos">${escapeHtml(t.position)}</span>${play}<span class="trk-title">${escapeHtml(t.title)}</span><span class="trk-dur">${escapeHtml(t.duration)}</span><button class="trk-like" data-pos="${escapeHtml(t.position)}" aria-label="${tr('a11y.likeSong')}">${heartSvg()}</button><span class="trk-prog"><i class="prog-fill"></i></span></li>`;
  }).join('');
  ol.querySelectorAll('.trk-play').forEach((b) => b.addEventListener('click', () => {
    const t = tracks[+b.dataset.i];
    if (t && t.preview) togglePreview(t.preview, b, { title: t.title, artist: item.artist });
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

// ---------- Sparziel (nur Wunschzettel; privat, steht nur in items) ----------
// Ziel ist der eingetragene Preis, „gespart" der Fortschritt darauf.
function renderSavings(item, list) {
  const sec = $('#dp-savings-section'); if (!sec) return;
  const show = list === 'wishlist' && !!item;
  sec.style.display = show ? '' : 'none';
  if (!show) return;
  const box = $('#dp-savings');
  const goal = Number(item.price) || 0;
  const saved = Number(item.saved) || 0;
  if (!goal) { box.innerHTML = `<p class="hint">${escapeHtml(tr('savings.noPrice'))}</p>`; return; }
  const pct = Math.min(100, Math.round((saved / goal) * 100));
  const rest = Math.max(0, goal - saved);
  const note = rest ? tr('savings.toGo', { amount: fmtEuro(rest) }) : tr('savings.done');
  box.innerHTML = `<p class="goal-count">${escapeHtml(tr('savings.count', { saved: fmtEuro(saved), goal: fmtEuro(goal) }))}</p>`
    + `<div class="ms-bar"><span style="width:${Math.max(2, pct)}%"></span></div>`
    + `<p class="ms-next">${escapeHtml(note)} · ${pct} %</p>`;
}
$('#dp-savings-edit').addEventListener('click', () => {
  if (!editing || editing.list !== 'wishlist') return;
  const item = getList('wishlist').find((i) => i.id === editing.id);
  if (!item) return;
  if (!Number(item.price)) { toast(tr('savings.noPrice')); return; }
  const inp = prompt(tr('savings.prompt', { goal: fmtEuro(Number(item.price)) }), String(Number(item.saved) || 0));
  if (inp === null) return;
  const n = Number(String(inp).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) { toast(tr('savings.invalid')); return; }
  updateItem('wishlist', item.id, { saved: Math.round(n * 100) / 100 });
  const fresh = getList('wishlist').find((i) => i.id === item.id);
  renderSavings(fresh, 'wishlist');
});

// ---------- Verleih (Leihliste) ----------
const LEND_PERSON = '<svg class="lend-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
function renderLend(item) {
  const el = $('#dp-lend'); if (!el || !item) return;
  if (item.lentTo) {
    const since = item.lentAt ? new Date(item.lentAt).toLocaleDateString(getLang() === 'de' ? 'de-DE' : 'en-US') : '';
    el.innerHTML = `<div class="lend-status"><span class="lend-who">${LEND_PERSON}<span>${escapeHtml(item.lentTo)}${since ? ' · ' + escapeHtml(tr('lend.since', { date: since })) : ''}</span></span><button type="button" id="dp-lend-return" class="btn ghost">${tr('lend.return')}</button></div>`;
    $('#dp-lend-return').onclick = () => {
      const upd = updateItem('collection', item.id, { lentTo: '', lentAt: 0 });
      renderLend(upd || { ...item, lentTo: '', lentAt: 0 });
      renderList('collection'); renderLentList();
      toast(tr('lend.returned'));
    };
  } else {
    el.innerHTML = `<div class="lend-add"><input type="text" id="dp-lend-name" placeholder="${escapeHtml(tr('ph.lendName'))}" /><button type="button" id="dp-lend-set" class="btn ghost">${tr('lend.mark')}</button></div>`;
    $('#dp-lend-set').onclick = () => {
      const name = $('#dp-lend-name').value.trim(); if (!name) return;
      const upd = updateItem('collection', item.id, { lentTo: name, lentAt: Date.now() });
      renderLend(upd || { ...item, lentTo: name, lentAt: Date.now() });
      renderList('collection'); renderLentList();
      toast(tr('lend.markedToast', { name }));
    };
  }
}
// „Verliehen"-Liste im Profil (alle Collection-Alben mit lentTo).
// Verliehen seit …: nach 3 Monaten wird aus der Info eine sanfte Erinnerung.
const LENT_REMIND_DAYS = 90;
function lentDays(lentAt) { return lentAt ? Math.floor((Date.now() - lentAt) / 86400000) : -1; }
function isLentTooLong(lentAt) { return lentDays(lentAt) >= LENT_REMIND_DAYS; }
function lentSinceText(lentAt) {
  const d = lentDays(lentAt);
  if (d < 0) return '';
  if (d < 1) return tr('lend.sinceToday');
  if (d < 31) return tr(d === 1 ? 'lend.sinceDay' : 'lend.sinceDays', { n: d });
  const m = Math.floor(d / 30);
  return tr(m === 1 ? 'lend.sinceMonth' : 'lend.sinceMonths', { n: m });
}
function renderLentList() {
  const sec = document.getElementById('lent-section'); const box = document.getElementById('lent-list');
  if (!sec || !box) return;
  const lent = getList('collection').filter((i) => (i.lentTo || '').trim());
  if (!lent.length) { sec.hidden = true; box.innerHTML = ''; return; }
  sec.hidden = false;
  // Länger als 3 Monate weg? Dann sanft erinnern (Zeile bekommt einen Hinweis).
  box.innerHTML = lent.map((i) => {
    const since = lentSinceText(i.lentAt);
    const old = isLentTooLong(i.lentAt);
    const note = since ? `<span class="lent-since${old ? ' overdue' : ''}">${escapeHtml(old ? tr('lend.remind', { since }) : since)}</span>` : '';
    return `<button class="lent-row" data-id="${i.id}"><span class="lent-cover${i.coverUrl ? '' : ' placeholder'}">${i.coverUrl ? `<img src="${escapeHtml(i.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();" />` : ''}</span><span class="lent-meta"><span class="chart-title">${escapeHtml(i.title || '')}</span><span class="lent-to">${escapeHtml(tr('lend.toShort', { name: i.lentTo }))}</span>${note}</span></button>`;
  }).join('');
  box.querySelectorAll('.lent-row').forEach((b) => b.addEventListener('click', () => openDetail('collection', b.dataset.id)));
}

// ---------- Stackd Wrapped (Jahresrückblick) ----------
// Längste Folge aufeinanderfolgender Tage (für die Hör-Streak im Wrapped).
function longestDayStreak(sortedDates) {
  let best = 0, run = 0, prev = null;
  for (const d of sortedDates) {
    const t = new Date(d + 'T00:00:00').getTime();
    if (prev !== null && t - prev === 86400000) run++; else run = 1;
    if (run > best) best = run;
    prev = t;
  }
  return best;
}
// Jahres-Heatmap der Höreinträge (GitHub-Stil: Wochen-Spalten x 7 Tage).
function listenHeatmap(playsThisYear, year) {
  const iso = (dt) => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  const counts = {};
  playsThisYear.forEach((p) => { const d = String(p.played_on || '').slice(0, 10); if (d) counts[d] = (counts[d] || 0) + 1; });
  let max = 0; for (const n of Object.values(counts)) if (n > max) max = n;
  const level = (n) => n <= 0 ? 0 : (max <= 1 ? 1 : n >= max * 0.75 ? 4 : n >= max * 0.5 ? 3 : n >= max * 0.25 ? 2 : 1);
  const end = new Date(year, 11, 31);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cur = new Date(year, 0, 1);
  cur.setDate(cur.getDate() - cur.getDay()); // Raster beginnt am Sonntag <= 1. Jan
  let cols = '';
  while (cur <= end) {
    let week = '';
    for (let d = 0; d < 7; d++) {
      const dstr = iso(cur);
      const inYear = cur.getFullYear() === year;
      const future = cur > today;
      const n = counts[dstr] || 0;
      let cls = 'hm-cell', title = '';
      if (!inYear || future) { cls += ' hm-out'; }
      else { const lv = level(n); if (lv > 0) cls += ' hm-l' + lv; title = `${dstr}: ${n} ${n === 1 ? tr('unit.play') : tr('unit.plays')}`; }
      week += `<span class="${cls}"${title ? ` title="${title}"` : ''}></span>`;
      cur.setDate(cur.getDate() + 1);
    }
    cols += `<span class="hm-col">${week}</span>`;
  }
  const legend = `<div class="hm-legend"><span>${tr('hm.less')}</span><span class="hm-cell"></span><span class="hm-cell hm-l1"></span><span class="hm-cell hm-l2"></span><span class="hm-cell hm-l3"></span><span class="hm-cell hm-l4"></span><span>${tr('hm.more')}</span></div>`;
  return `<div class="heatmap-wrap"><div class="heatmap">${cols}</div></div>${legend}`;
}
async function openWrapped() {
  if (!requireAuth()) return;
  const year = new Date().getFullYear();
  $('#wrapped-title').textContent = tr('dlg.wrapped') + ' ' + year;
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
  // Top-Künstler (nach Anzahl Alben in der Sammlung)
  const artistCounts = {};
  coll.forEach((i) => { const a = (i.artist || '').trim(); if (a) artistCounts[a] = (artistCounts[a] || 0) + 1; });
  const topArtists = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  // Top-Genres dieses Jahr (sonst gesamt) aus den lazy geladenen Genre-Daten
  const thisYearItems = coll.filter((i) => new Date(i.addedAt || 0).getFullYear() === year);
  const genreSource = thisYearItems.some((i) => (i.genre || '').trim()) ? thisYearItems : coll;
  const genreCounts = {};
  genreSource.forEach((i) => { const g = (i.genre || '').trim(); if (g) genreCounts[g] = (genreCounts[g] || 0) + 1; });
  const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  // Längste Hör-Streak (aufeinanderfolgende Tage mit Tagebuch-Eintrag) dieses Jahr
  const streakDates = [...new Set(playsThisYear.map((p) => String(p.played_on || '').slice(0, 10)).filter(Boolean))].sort();
  const streak = longestDayStreak(streakDates);
  // Für die teilbare Bild-Karte merken
  lastWrapped = {
    year, name: profileName(),
    albumsTotal: coll.length, addedThisYear, listenEntries: playsThisYear.length,
    avg: avg ? avg.toFixed(1) : null, streak,
    topGenres: topGenres.slice(0, 3), topArtist: topArtists[0] ? topArtists[0][0] : null,
  };
  const cards = [
    { label: tr('wrapped.albumsAdded'), val: addedThisYear },
    { label: tr('wrapped.listenEntries'), val: playsThisYear.length },
    { label: tr('wrapped.albumsTotal'), val: coll.length },
    { label: tr('wrapped.avgRating'), val: avg ? avg.toFixed(1) + ' ♪' : '–' },
  ];
  const streakCard = streak > 1 ? `<div class="wrapped-card wrapped-card-wide"><span class="wrapped-num">${streak}</span><span class="wrapped-lbl">${tr('wrapped.listenStreak')}</span></div>` : '';
  let html = `<div class="wrapped-cards">${cards.map((c) => `<div class="wrapped-card"><span class="wrapped-num">${c.val}</span><span class="wrapped-lbl">${c.label}</span></div>`).join('')}${streakCard}</div>`;
  if (playsThisYear.length) html += `<span class="dp-label wrapped-h">${tr('wrapped.heatmap')}</span>` + listenHeatmap(playsThisYear, year);
  if (mostItem) {
    html += `<span class="dp-label wrapped-h">${tr('wrapped.mostPlayed', { n: mostN })}</span><button class="wrapped-album" data-id="${mostItem.id}"><div class="chart-cover${mostItem.coverUrl ? '' : ' placeholder'}">${mostItem.coverUrl ? `<img src="${escapeHtml(mostItem.coverUrl)}" alt="" />` : ''}</div><div class="chart-meta"><span class="chart-title">${escapeHtml(mostItem.title || '')}</span><span class="chart-artist">${escapeHtml(mostItem.artist || '')}</span></div></button>`;
  }
  if (topRated.length) {
    html += `<span class="dp-label wrapped-h">${tr('wrapped.topRated')}</span>` + topRated.map((it) => `<button class="wrapped-row" data-id="${it.id}"><span class="chart-title">${escapeHtml(it.artist || '')} – ${escapeHtml(it.title || '')}</span>${ratingDisplayHtml(it.rating)}</button>`).join('');
  }
  if (topArtists.length) {
    const maxA = topArtists[0][1];
    html += `<span class="dp-label wrapped-h">${tr('wrapped.topArtists')}</span>` + topArtists.map(([a, n]) => `<button class="genre-row" data-artist="${escapeHtml(a)}"><span class="genre-name">${escapeHtml(a)}</span><span class="genre-bar"><span class="genre-fill" style="width:${Math.round((n / maxA) * 100)}%"></span></span><span class="genre-count">${n}</span></button>`).join('');
  }
  if (topGenres.length) {
    const maxG = topGenres[0][1];
    html += `<span class="dp-label wrapped-h">${tr('wrapped.topGenres', { year })}</span>` + topGenres.map(([g, n]) => `<button class="genre-row" data-genre="${escapeHtml(g)}"><span class="genre-name">${escapeHtml(g)}</span><span class="genre-bar"><span class="genre-fill" style="width:${Math.round((n / maxG) * 100)}%"></span></span><span class="genre-count">${n}</span></button>`).join('');
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
  $('#wrapped-body').querySelectorAll('[data-artist]').forEach((b) => b.addEventListener('click', () => { $('#wrapped-dialog').close(); runDbSearchWith({ artist: b.dataset.artist }); }));
  $('#wrapped-body').querySelectorAll('[data-genre]').forEach((b) => b.addEventListener('click', () => { $('#wrapped-dialog').close(); openGenre(b.dataset.genre); }));
}
$('#btn-wrapped').addEventListener('click', openWrapped);
$('#btn-wrapped-close').addEventListener('click', () => $('#wrapped-dialog').close());

// ---------- Teilbare Statistik-Karte (Bild) ----------
let lastWrapped = null;
// Text auf Breite kürzen (Ellipse), damit nichts über den Rand läuft.
function ctxTrim(ctx, text, maxW) {
  let t = String(text || '');
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
function drawWrappedCard(s) {
  const W = 1080, H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const cs = getComputedStyle(document.documentElement);
  const accent = (cs.getPropertyValue('--rose').trim() || '#d96a8a');
  const BG = '#14181C', SURF = '#1f2937', TEXT = '#f3f4f6', MUTED = '#8e97ad';
  // Hintergrund + dezenter Akzent-Schimmer oben
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  const grad = ctx.createRadialGradient(W / 2, -120, 80, W / 2, -120, 900);
  grad.addColorStop(0, accent + '55'); grad.addColorStop(1, BG + '00');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, 700);
  ctx.textAlign = 'center';
  // Kopf (Name je Sprache – hart, unabhängig von i18n.js)
  const headLabel = getLang() === 'de' ? 'DISCEND · JAHRESRÜCKBLICK' : 'DISCEND · YEAR IN REVIEW';
  ctx.fillStyle = accent; ctx.font = '700 40px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(ctxTrim(ctx, headLabel, W - 80), W / 2, 158);
  ctx.fillStyle = TEXT; ctx.font = '800 132px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(String(s.year), W / 2, 292);
  if (s.name) { ctx.fillStyle = MUTED; ctx.font = '500 40px -apple-system, "Segoe UI", Roboto, sans-serif'; ctx.fillText(ctxTrim(ctx, s.name, W - 160), W / 2, 356); }
  // 2×2 Statistik-Kacheln
  const stats = [
    [String(s.albumsTotal), tr('wrapped.albumsTotal')],
    [String(s.addedThisYear), tr('wrapped.albumsAdded')],
    [String(s.listenEntries), tr('wrapped.listenEntries')],
    [s.avg ? s.avg + ' ♪' : '–', tr('wrapped.avgRating')],
  ];
  const gx = 70, gy = 420, cw = (W - gx * 2 - 26) / 2, ch = 188, gap = 26;
  stats.forEach((st, i) => {
    const x = gx + (i % 2) * (cw + gap), y = gy + Math.floor(i / 2) * (ch + gap);
    ctx.fillStyle = SURF; roundRect(ctx, x, y, cw, ch, 26); ctx.fill();
    ctx.fillStyle = accent; ctx.font = '800 78px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(ctxTrim(ctx, st[0], cw - 40), x + cw / 2, y + 100);
    ctx.fillStyle = MUTED; ctx.font = '500 33px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(ctxTrim(ctx, st[1], cw - 40), x + cw / 2, y + 150);
  });
  // Top-Genres (Balken)
  let y = gy + 2 * ch + gap + 62;
  ctx.textAlign = 'left';
  if (s.topGenres && s.topGenres.length) {
    ctx.fillStyle = accent; ctx.font = '700 38px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(tr('card.topGenres'), gx, y);
    const maxG = s.topGenres[0][1] || 1, barX = gx, barW = W - gx * 2;
    s.topGenres.forEach(([g, n]) => {
      y += 58;
      ctx.fillStyle = '#2a3647'; roundRect(ctx, barX, y, barW, 44, 22); ctx.fill();
      ctx.fillStyle = accent; roundRect(ctx, barX, y, Math.max(60, barW * (n / maxG)), 44, 22); ctx.fill();
      ctx.fillStyle = TEXT; ctx.font = '600 31px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(ctxTrim(ctx, g, barW - 120), barX + 22, y + 31);
      ctx.textAlign = 'right'; ctx.fillText(String(n), barX + barW - 22, y + 31); ctx.textAlign = 'left';
    });
    y += 44 + 56;
  }
  // Top-Künstler
  if (s.topArtist) {
    ctx.fillStyle = accent; ctx.font = '700 38px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(tr('card.topArtist'), gx, y); y += 58;
    ctx.fillStyle = TEXT; ctx.font = '700 50px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(ctxTrim(ctx, s.topArtist, W - gx * 2), gx, y);
  }
  // Fußzeile
  ctx.textAlign = 'center'; ctx.fillStyle = MUTED; ctx.font = '600 34px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('discend.app', W / 2, H - 54);
  return canvas;
}
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
async function shareWrappedCard() {
  if (!lastWrapped) return;
  const canvas = drawWrappedCard(lastWrapped);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) { toast(tr('card.failed')); return; }
  const file = new File([blob], `discend-rueckblick-${lastWrapped.year}.png`, { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: tr('dlg.wrapped') + ' ' + lastWrapped.year, text: tr('card.shareText', { year: lastWrapped.year }) });
      return;
    }
  } catch { return; /* Nutzer hat abgebrochen */ }
  // Fallback (kein Datei-Teilen möglich): Bild herunterladen
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(tr('card.saved'));
}
$('#btn-wrapped-share').addEventListener('click', shareWrappedCard);

// ---------- Rechtliches: Impressum + Datenquellen ----------
$('#btn-impressum').addEventListener('click', () => $('#impressum-dialog').showModal());
$('#btn-impressum-close').addEventListener('click', () => $('#impressum-dialog').close());
$('#btn-credits').addEventListener('click', () => $('#credits-dialog').showModal());
$('#btn-credits-close').addEventListener('click', () => $('#credits-dialog').close());
$('#btn-datenschutz').addEventListener('click', () => $('#datenschutz-dialog').showModal());
$('#btn-datenschutz-close').addEventListener('click', () => $('#datenschutz-dialog').close());
$('#btn-agb').addEventListener('click', () => $('#agb-dialog').showModal());
$('#btn-agb-close').addEventListener('click', () => $('#agb-dialog').close());
{ const dc = $('#dp-credits'); if (dc) dc.addEventListener('click', () => $('#credits-dialog').showModal()); }

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
    location: $('#dp-edit-location').value.trim(),
    purchaseDate: $('#dp-edit-purchase-date').value || '',
    purchasePlace: $('#dp-edit-purchase-place').value.trim(),
    tags: parseTags($('#dp-edit-tags').value),
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
  const { list, id } = editing;
  closeDetail();
  deleteWithUndo(list, id);
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
  const dup = findDuplicate(pendingResult.artist, pendingResult.title, pendingResult.barcode);
  if (dup && !confirm(tr('confirm.duplicate', { title: (pendingResult.title || dup.item.title || '').trim(), list: tr(dup.list === 'collection' ? 'dup.collection' : 'dup.wishlist') }))) return;
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
  { id: 'agb', label: 'info.terms' },
  { id: 'faq', label: 'info.faq' },
  { id: 'kontakt', label: 'info.contact' },
];
const INFO_CONTENT = {
  impressum: {
    title: { de: 'Impressum', en: 'Legal notice' },
    html: {
      de: `<p><strong>Angaben gemäß § 5 DDG</strong></p>
      <p>Jan Simelka<br>Am Krüzweg 64<br>44879 Bochum<br>Deutschland</p>
      <p><strong>Kontakt</strong><br>E-Mail: j.simelka@protonmail.com</p>
      <p><strong>Verantwortlich für den Inhalt</strong><br>Jan Simelka, Anschrift wie oben.</p>
      <p>Discend ist ein privat betriebenes, nicht-kommerzielles Projekt.</p>`,
      en: `<p><strong>Information pursuant to § 5 DDG (German law)</strong></p>
      <p>Jan Simelka<br>Am Krüzweg 64<br>44879 Bochum<br>Germany</p>
      <p><strong>Contact</strong><br>Email: j.simelka@protonmail.com</p>
      <p><strong>Responsible for content</strong><br>Jan Simelka, address as above.</p>
      <p>Discend is a privately operated, non-commercial project.</p>`,
    },
  },
  datenschutz: {
    title: { de: 'Datenschutzerklärung', en: 'Privacy policy' },
    html: {
      de: `<h3>1. Verantwortlicher</h3>
      <p>Jan Simelka, Am Krüzweg 64, 44879 Bochum, E-Mail: j.simelka@protonmail.com (siehe Impressum).</p>
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
        <li><strong>Cloudflare</strong> (Domain/DNS sowie Hosting und Auslieferung der App über Cloudflare Pages).</li>
      </ul>
      <h3>5. Zwecke & Rechtsgrundlage</h3>
      <p>Verarbeitung zur Bereitstellung der App und deines Kontos (Art. 6 Abs. 1 lit. b DSGVO) sowie zur Funktion und Sicherheit (lit. f).</p>
      <h3>6. Speicherung</h3>
      <p>Daten werden gespeichert, solange dein Konto besteht. Anmelde-Token liegen lokal in deinem Browser. Es gibt kein Werbe-Tracking und keine Werbe-Cookies.</p>
      <h3>7. Deine Rechte</h3>
      <p>Du hast Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch. Dein Konto inkl. aller Daten kannst du jederzeit in den Einstellungen unter „Account löschen" selbst löschen. Es besteht ein Beschwerderecht bei einer Datenschutz-Aufsichtsbehörde.</p>
      <h3>8. Kontakt</h3>
      <p>Bei Fragen: j.simelka@protonmail.com.</p>
      <p class="info-note">Entwurf – für den vollständigen rechtlichen Rahmen vor dem öffentlichen Launch fachkundig prüfen lassen.</p>`,
      en: `<h3>1. Controller</h3>
      <p>Jan Simelka, Am Krüzweg 64, 44879 Bochum, Germany, email: j.simelka@protonmail.com (see legal notice).</p>
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
        <li><strong>Cloudflare</strong> (domain/DNS as well as hosting and app delivery via Cloudflare Pages).</li>
      </ul>
      <h3>5. Purposes & legal basis</h3>
      <p>Processing to provide the app and your account (Art. 6(1)(b) GDPR) and for functionality and security (lit. f).</p>
      <h3>6. Storage</h3>
      <p>Data is stored as long as your account exists. Sign-in tokens are stored locally in your browser. There is no advertising tracking and no advertising cookies.</p>
      <h3>7. Your rights</h3>
      <p>You have the right to access, rectification, erasure, restriction, data portability and objection. You can delete your account including all data at any time in the settings under "Delete account". You have the right to lodge a complaint with a data protection supervisory authority.</p>
      <h3>8. Contact</h3>
      <p>For questions: j.simelka@protonmail.com.</p>
      <p class="info-note">Draft – please have it professionally reviewed before the public launch.</p>`,
    },
  },
  agb: {
    title: { de: 'Nutzungsbedingungen', en: 'Terms of Use' },
    html: {
      de: `<h3>1. Geltungsbereich und Anbieter</h3>
      <p>Diese Nutzungsbedingungen regeln die Nutzung der App und Website Discend („Dienst"), bereitgestellt von Jan Simelka, Am Krüzweg 64, 44879 Bochum (siehe Impressum). Mit der Registrierung oder Nutzung des Dienstes erkennst du diese Bedingungen an.</p>
      <h3>2. Leistung</h3>
      <p>Discend ist ein kostenloser Dienst zum Katalogisieren und Bewerten von Musik-/Vinyl-Sammlungen, zum Führen von Listen und zum Folgen anderer Nutzer. Es besteht kein Anspruch auf einen bestimmten Funktionsumfang, eine bestimmte Verfügbarkeit oder den dauerhaften Fortbestand. Der Dienst kann jederzeit geändert, eingeschränkt oder eingestellt werden.</p>
      <h3>3. Registrierung und Konto</h3>
      <ul>
        <li>Für bestimmte Funktionen ist ein kostenloses Konto nötig; deine Angaben müssen wahrheitsgemäß sein.</li>
        <li>Du hältst deine Zugangsdaten geheim und haftest für Aktivitäten unter deinem Konto.</li>
        <li>Du musst mindestens 16 Jahre alt sein oder die Zustimmung der Erziehungsberechtigten haben.</li>
        <li>Pro Person ist grundsätzlich ein Konto vorgesehen.</li>
      </ul>
      <h3>4. Nutzerinhalte und Rechte</h3>
      <p>„Nutzerinhalte" sind alle von dir eingestellten Inhalte (z. B. Reviews, Notizen, Listen, Profilangaben, Bilder). Du behältst deine Rechte daran und räumst dem Anbieter ein einfaches, auf den Betrieb des Dienstes beschränktes Recht ein, deine Inhalte zu speichern, zu verarbeiten und im Rahmen des Dienstes anderen bzw. öffentlich anzuzeigen. Du sicherst zu, die nötigen Rechte zu haben und keine Rechte Dritter (Urheber-, Marken-, Persönlichkeitsrechte) zu verletzen.</p>
      <h3>5. Verhaltensregeln</h3>
      <p>Untersagt sind insbesondere:</p>
      <ul>
        <li>rechtswidrige, beleidigende, diffamierende, diskriminierende, gewaltverherrlichende, jugendgefährdende oder pornografische Inhalte;</li>
        <li>Belästigung, Bedrohung oder Mobbing anderer;</li>
        <li>Spam, Werbung oder massenhaftes/automatisiertes Verhalten;</li>
        <li>das Verletzen fremder Rechte;</li>
        <li>Schadsoftware sowie das Stören oder Umgehen der Sicherheit des Dienstes;</li>
        <li>das Vortäuschen einer fremden Identität.</li>
      </ul>
      <h3>6. Moderation</h3>
      <p>Der Anbieter darf Inhalte, die gegen diese Bedingungen oder geltendes Recht verstoßen, entfernen und Konten verwarnen, vorübergehend oder dauerhaft sperren. Eine lückenlose Überwachung aller Inhalte findet nicht statt; gemeldeten Verstößen wird jedoch nachgegangen.</p>
      <h3>7. Verfügbarkeit</h3>
      <p>Der Dienst wird „wie verfügbar" bereitgestellt. Wartungen, Störungen oder Ausfälle können auftreten; eine bestimmte Verfügbarkeit wird nicht garantiert.</p>
      <h3>8. Haftung</h3>
      <ul>
        <li>Unbeschränkte Haftung bei Vorsatz und grober Fahrlässigkeit sowie bei Verletzung von Leben, Körper oder Gesundheit.</li>
        <li>Bei einfacher Fahrlässigkeit nur bei Verletzung einer wesentlichen Vertragspflicht und begrenzt auf den vorhersehbaren, vertragstypischen Schaden.</li>
        <li>Da der Dienst unentgeltlich ist, ist die Haftung im gesetzlich zulässigen Rahmen weiter eingeschränkt. Die Haftung nach dem Produkthaftungsgesetz bleibt unberührt.</li>
        <li>Für Nutzerinhalte und für Inhalte/Dienste Dritter wird keine Haftung übernommen.</li>
      </ul>
      <h3>9. Inhalte Dritter</h3>
      <p>Album-Daten, Cover und Marktwerte stammen u. a. von Discogs und Apple/iTunes; für deren Richtigkeit und Verfügbarkeit wird keine Gewähr übernommen. Marken, Logos und Albumcover sind Eigentum der jeweiligen Rechteinhaber und dienen nur der Kennzeichnung.</p>
      <h3>10. Laufzeit und Kündigung</h3>
      <p>Du kannst dein Konto jederzeit ohne Gründe in den Einstellungen unter „Account löschen" löschen. Der Anbieter kann das Nutzungsverhältnis mit angemessener Frist beenden oder den Dienst einstellen; das Recht zur außerordentlichen Sperrung bei Verstößen bleibt unberührt.</p>
      <h3>11. Änderungen der Bedingungen</h3>
      <p>Der Anbieter kann diese Bedingungen mit Wirkung für die Zukunft ändern, soweit erforderlich (z. B. geänderte Rechtslage oder Funktionen). Über wesentliche Änderungen wird in geeigneter Form informiert; mit fortgesetzter Nutzung gelten sie als akzeptiert.</p>
      <h3>12. Schlussbestimmungen</h3>
      <ul>
        <li>Es gilt deutsches Recht; zwingende Verbraucherschutzvorschriften deines Wohnsitzlandes bleiben unberührt.</li>
        <li>Sollte eine Bestimmung unwirksam sein, bleibt die Wirksamkeit der übrigen unberührt.</li>
        <li>Verbraucherstreitbeilegung: Der Anbieter ist nicht verpflichtet und nicht bereit, an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen (§ 36 VSBG).</li>
      </ul>
      <p>Stand: Juni 2026.</p>
      <p class="info-note">Entwurf – für den vollständigen rechtlichen Rahmen vor dem öffentlichen Launch fachkundig prüfen lassen.</p>`,
      en: `<h3>1. Scope and provider</h3>
      <p>These Terms govern the use of the Discend app and website ("Service"), provided by Jan Simelka, Am Krüzweg 64, 44879 Bochum, Germany (see Legal notice). By registering or using the Service you accept these Terms.</p>
      <h3>2. The Service</h3>
      <p>Discend is a free service to catalog and rate music/vinyl collections, keep lists and follow other users. There is no claim to a specific feature set, availability or continued existence. The Service may be changed, restricted or discontinued at any time.</p>
      <h3>3. Registration and account</h3>
      <ul>
        <li>Some features require a free account; your information must be truthful.</li>
        <li>Keep your credentials secret; you are liable for activity under your account.</li>
        <li>You must be at least 16 years old or have parental consent.</li>
        <li>Generally one account per person.</li>
      </ul>
      <h3>4. User content and rights</h3>
      <p>"User content" is everything you post (e.g. reviews, notes, lists, profile data, images). You keep your rights and grant the provider a simple, operation-limited right to store, process and display your content within the Service to others or publicly. You warrant that you hold the necessary rights and do not infringe third-party rights (copyright, trademark, personality rights).</p>
      <h3>5. Rules of conduct</h3>
      <p>The following are prohibited in particular:</p>
      <ul>
        <li>unlawful, insulting, defamatory, discriminatory, violence-glorifying, youth-endangering or pornographic content;</li>
        <li>harassment, threats or bullying of others;</li>
        <li>spam, advertising or mass/automated behavior;</li>
        <li>infringing third-party rights;</li>
        <li>malware or disrupting/circumventing the Service's security;</li>
        <li>impersonating someone else.</li>
      </ul>
      <h3>6. Moderation</h3>
      <p>The provider may remove content that violates these Terms or applicable law and may warn, temporarily or permanently suspend accounts. There is no continuous monitoring of all content; reported violations will, however, be investigated.</p>
      <h3>7. Availability</h3>
      <p>The Service is provided "as available". Maintenance, faults or outages may occur; no specific availability is guaranteed.</p>
      <h3>8. Liability</h3>
      <ul>
        <li>Unlimited liability for intent and gross negligence and for injury to life, body or health.</li>
        <li>For slight negligence only upon breach of a material contractual duty, limited to foreseeable, typical damage.</li>
        <li>As the Service is free of charge, liability is further limited to the extent legally permitted. Liability under the German Product Liability Act remains unaffected.</li>
        <li>No liability is assumed for user content or third-party content/services.</li>
      </ul>
      <h3>9. Third-party content</h3>
      <p>Album data, covers and market values come from Discogs and Apple/iTunes, among others; no guarantee is given for their accuracy or availability. Trademarks, logos and album covers are the property of their respective owners and serve identification only.</p>
      <h3>10. Term and termination</h3>
      <p>You can delete your account at any time without reason in the settings under "Delete account". The provider may end the usage relationship with reasonable notice or discontinue the Service; the right to extraordinary suspension for violations remains unaffected.</p>
      <h3>11. Changes to these Terms</h3>
      <p>The provider may change these Terms with future effect where necessary (e.g. changed legal situation or features). Material changes will be communicated appropriately; continued use constitutes acceptance.</p>
      <h3>12. Final provisions</h3>
      <ul>
        <li>German law applies; mandatory consumer protection rules of your country of residence remain unaffected.</li>
        <li>If a provision is invalid, the validity of the remaining provisions is unaffected.</li>
        <li>Consumer dispute resolution: the provider is not obliged and not willing to participate in dispute resolution proceedings before a consumer arbitration board.</li>
      </ul>
      <p>Last updated: June 2026.</p>
      <p class="info-note">Draft – please have it professionally reviewed before the public launch.</p>`,
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

// ---------- Suchverlauf + „zuletzt angesehen" (lokal) ----------
const SEARCH_HIST_KEY = 'discend_search_history';
const RECENT_ALB_KEY = 'discend_recent_albums';
function loadJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
function saveJson(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* voll */ } }
function pushSearchHistory(q) {
  q = (q || '').trim(); if (!q) return;
  const h = loadJson(SEARCH_HIST_KEY, []).filter((x) => String(x).toLowerCase() !== q.toLowerCase());
  h.unshift(q);
  saveJson(SEARCH_HIST_KEY, h.slice(0, 10));
}
function recentAlbumKey(a) { return a.masterId ? 'm' + a.masterId : (a.sourceId ? 's' + a.sourceId : ((a.artist || '') + '|' + (a.title || '')).toLowerCase()); }
function pushRecentAlbum(a) {
  if (!a || (!a.title && !a.artist)) return;
  const rec = { title: a.title || '', artist: a.artist || '', coverUrl: a.coverUrl || '', source: a.source || '', sourceId: a.sourceId || '', masterId: a.masterId || '', year: a.year || '' };
  const k = recentAlbumKey(rec);
  const list = loadJson(RECENT_ALB_KEY, []).filter((x) => recentAlbumKey(x) !== k);
  list.unshift(rec);
  saveJson(RECENT_ALB_KEY, list.slice(0, 12));
}
function recentSectionsHtml() {
  let html = '';
  const hist = loadJson(SEARCH_HIST_KEY, []);
  if (hist.length) {
    html += `<div class="recent-searches"><div class="recent-head"><span class="dp-label">${tr('search.recent')}</span><button class="recent-clear" id="rs-clear">${tr('search.clearHistory')}</button></div><div class="chip-row">`
      + hist.map((q) => `<button class="search-chip" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')
      + '</div></div>';
  }
  const rec = loadJson(RECENT_ALB_KEY, []).filter((a) => a.coverUrl);
  if (rec.length) {
    html += `<div class="home-section"><span class="dp-label">${tr('search.recentlyViewed')}</span><ol class="chart-list" id="recent-viewed-list">`
      + rec.map((a, i) => `<li class="chart-item" data-ri="${i}"><div class="chart-cover"><img src="${escapeHtml(a.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();" /></div><div class="chart-meta"><span class="chart-title">${escapeHtml(a.title || '')}</span><span class="chart-artist">${escapeHtml(a.artist || '')}</span></div></li>`).join('')
      + '</ol></div>';
  }
  return html;
}

function renderBrowse() {
  const c = $('#browse-content');
  $('#search-status').textContent = '';
  c.innerHTML = recentSectionsHtml()
    + `<ul class="browse-list">${BROWSE_TABS.map((t) => `<li class="browse-row" data-tab="${t.id}"><span>${tr(t.label)}</span><span class="chev">›</span></li>`).join('')}</ul>
    <p class="browse-section">Discend.app</p>
    <ul class="browse-list">${INFO_PAGES.map((p) => `<li class="browse-row" data-info="${p.id}"><span>${tr(p.label)}</span><span class="chev">›</span></li>`).join('')}</ul>`;
  c.querySelectorAll('.browse-row[data-tab]').forEach((li) => li.addEventListener('click', () => openBrowseTab(li.dataset.tab)));
  c.querySelectorAll('.browse-row[data-info]').forEach((li) => li.addEventListener('click', () => renderInfoPage(li.dataset.info)));
  // Suchverlauf-Chips: erneut suchen
  c.querySelectorAll('.search-chip').forEach((b) => b.addEventListener('click', () => {
    const q = b.dataset.q; const inp = $('#search-db'); if (inp) inp.value = q;
    pushSearchHistory(q); showSearchUI(); setSearchFilter('alben');
  }));
  const clr = c.querySelector('#rs-clear');
  if (clr) clr.addEventListener('click', () => { saveJson(SEARCH_HIST_KEY, []); renderBrowse(); });
  // Zuletzt angesehen: Album erneut öffnen
  const rec = loadJson(RECENT_ALB_KEY, []).filter((a) => a.coverUrl);
  c.querySelectorAll('#recent-viewed-list .chart-item').forEach((li) => li.addEventListener('click', () => { const a = rec[+li.dataset.ri]; if (a) openPreview(a); }));
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
// dedupeAlbums: jetzt in ./util.js

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
    const l = playlistSearchCache[+card.dataset.idx]; if (l) openUserPlaylistView(l);
  }));
}

let searchTimer = null;
$('#search-cancel').addEventListener('click', cancelSearch);
$('#search-db').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); const q = $('#search-db').value.trim(); if (q) pushSearchHistory(q); runSearch(); $('#search-db').blur(); } // Enter startet die Suche + schließt die Tastatur
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
// Doppel-Erkennung: gleicher Barcode oder gleicher (normalisierter) Künstler+Titel
// in Sammlung oder Wishlist. Vorteil ggü. Discogs: warnt vor versehentlichen Dubletten.
function normKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function findDuplicate(artist, title, barcode) {
  const a = normKey(artist), t = normKey(title), bc = String(barcode || '').replace(/\D/g, '');
  for (const list of ['collection', 'wishlist']) {
    const hit = getList(list).find((i) => {
      if (bc && String(i.barcode || '').replace(/\D/g, '') === bc) return true;
      return t.length > 0 && normKey(i.artist) === a && normKey(i.title) === t;
    });
    if (hit) return { list, item: hit };
  }
  return null;
}
$('#manual-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const list = f.list.value;
  const dup = findDuplicate(f.artist.value, f.title.value, f.barcode.value);
  if (dup && !confirm(tr('confirm.duplicate', { title: f.title.value.trim() || dup.item.title || '', list: tr(dup.list === 'collection' ? 'dup.collection' : 'dup.wishlist') }))) return;
  addItem(list, {
    artist: f.artist.value.trim(),
    title: f.title.value.trim(),
    year: f.year.value.trim(),
    label: f.label.value.trim(),
    format: f.format.value.trim(),
    barcode: f.barcode.value.trim(),
    coverUrl: f.coverUrl.value.trim(),
    price: parseFloat(f.price.value) || 0,
    location: f.location.value.trim(),
    purchaseDate: f.purchaseDate.value || '',
    purchasePlace: f.purchasePlace.value.trim(),
    tags: parseTags(f.tags.value),
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

// fmtEuro: jetzt in ./ui.js.

function renderProfile() {
  const p = getProfile() || {};
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
  renderLentList();
  renderHisto();
  renderStatRows();
  renderListenGoal();
  renderMilestones();
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

function renderHisto(coll = getList('collection'), sel = '#rating-histo') {
  const root = $(sel); if (!root) return;
  const steps = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  const counts = steps.map((v) => coll.filter((i) => (Number(i.rating) || 0) === v).length);
  const max = Math.max(1, ...counts);
  const bars = counts.map((c) => `<div class="histo-bar" data-count="${c}" style="height:${(c / max) * 100}%"><span class="histo-val">${c}</span></div>`).join('');
  const miniNote = `<svg class="mini-note" viewBox="0 0 24 24" fill="currentColor"><path d="${NOTE_PATH}"/></svg>`;
  root.innerHTML =
    `<span class="histo-end">${miniNote}</span><div class="histo-bars">${bars}</div><span class="histo-end">${miniNote.repeat(5)}</span>`;

  // Touch/Halten am Handy: Zahl über dem berührten Balken zeigen (Hover macht CSS)
  const wrap = root.querySelector('.histo-bars');
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

// ---------- Hör-Ziel („50 Alben dieses Jahr") ----------
// Ziel steht in profiles.settings (jsonb) → gilt auf allen Geräten.
// Fortschritt = verschiedene Alben mit Tagebuch-Eintrag im laufenden Jahr.
const GOAL_MIN = 1, GOAL_MAX = 2000;
function listenGoal() { return Number(((getProfile() || {}).settings || {}).listenGoal) || 0; }
function playsThisYear(plays) {
  const y = String(new Date().getFullYear());
  const ids = new Set();
  (plays || []).forEach((p) => { if (String(p.played_on || '').startsWith(y) && p.item_id) ids.add(p.item_id); });
  return ids.size;
}
function goalBodyHtml(done, goal) {
  const year = new Date().getFullYear();
  if (!goal) return `<p class="hint">${escapeHtml(tr('goal.none', { year }))}</p>`;
  const pct = Math.min(100, Math.round((done / goal) * 100));
  const rest = Math.max(0, goal - done);
  const note = rest ? tr('goal.toGo', { n: rest }) : tr('goal.done');
  return `<p class="goal-count">${escapeHtml(tr('goal.count', { done, goal, year }))}</p>`
    + `<div class="ms-bar"><span style="width:${Math.max(2, pct)}%"></span></div>`
    + `<p class="ms-next">${escapeHtml(note)} · ${pct} %</p>`;
}
async function renderListenGoal() {
  const body = $('#goal-body'); if (!body) return;
  const goal = listenGoal();
  const u = getUser();
  if (!u) { body.innerHTML = ''; return; }
  body.innerHTML = goalBodyHtml(0, goal); // sofort etwas zeigen, Zahl kommt gleich
  let plays = [];
  try { plays = await fetchUserPlays(u.id); } catch { /* ignorieren */ }
  if (!$('#goal-body')) return;
  $('#goal-body').innerHTML = goalBodyHtml(playsThisYear(plays), listenGoal());
}
$('#goal-edit').addEventListener('click', () => {
  if (!requireAuth()) return;
  const cur = listenGoal();
  const inp = prompt(tr('goal.prompt', { year: new Date().getFullYear() }), cur ? String(cur) : '50');
  if (inp === null) return;
  const n = Math.round(Number(String(inp).replace(',', '.')));
  if (!n) { updateProfile({ settings: { ...((getProfile() || {}).settings || {}), listenGoal: 0 } }); renderListenGoal(); return; }
  if (!Number.isFinite(n) || n < GOAL_MIN || n > GOAL_MAX) { toast(tr('goal.invalid', { max: GOAL_MAX })); return; }
  updateProfile({ settings: { ...((getProfile() || {}).settings || {}), listenGoal: n } });
  renderListenGoal();
});

// ---------- Meilensteine (Badges) ----------
// Alles aus vorhandenen Daten gerechnet (Sammlung + Anmeldedatum) – keine neue Tabelle.
const MS_KEY = 'discend.milestones';
const MS_DEFS = [
  { id: 'records', key: 'ms.records', tiers: [10, 25, 50, 100, 250, 500] },
  { id: 'rated', key: 'ms.rated', tiers: [10, 50, 100, 250] },
  { id: 'liked', key: 'ms.liked', tiers: [5, 25, 50, 100] },
  { id: 'artists', key: 'ms.artists', tiers: [10, 50, 100, 200] },
  { id: 'years', key: 'ms.years', tiers: [1, 2, 3, 5] },
];
function msCounts(coll, createdAt) {
  const artists = new Set(coll.map((i) => String(i.artist || '').trim().toLowerCase()).filter(Boolean));
  const days = createdAt ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000) : 0;
  return {
    records: coll.length,
    rated: coll.filter((i) => Number(i.rating) > 0).length,
    liked: coll.filter((i) => i.liked).length,
    artists: artists.size,
    years: Math.max(0, Math.floor(days / 365)),
    days: Math.max(0, days), // nur für den Fortschritt innerhalb des laufenden Jahres
  };
}
function msLabel(def, n) {
  if (def.id === 'years') return tr(n === 1 ? 'ms.year1' : 'ms.years');
  return tr(def.key);
}
function msTier(def, n) { return def.tiers.filter((t) => n >= t).pop() || 0; }
// Neue Stufe erreicht? Einmal feiern und merken. Bei leerer Sammlung nichts tun –
// dann sind die Daten meist nur noch nicht geladen (sonst „Meilenstein" nach jedem Login).
function celebrateMilestones(c) {
  if (!c.records) return;
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(MS_KEY)); } catch { prev = null; }
  const now = {};
  MS_DEFS.forEach((d) => { now[d.id] = msTier(d, c[d.id] || 0); });
  if (prev) {
    const d = MS_DEFS.find((x) => (now[x.id] || 0) > (prev[x.id] || 0));
    if (d) toast(tr('ms.reached', { name: `${now[d.id]} ${msLabel(d, now[d.id])}` }));
  }
  try { localStorage.setItem(MS_KEY, JSON.stringify(now)); } catch { /* voll */ }
}
// earnedOnly: auf fremden Profilen nur Erreichtes zeigen (kein „noch 8 bis 100").
// Gibt die Anzahl gezeigter Badges zurück (fürs Ein-/Ausblenden der Sektion).
function renderMilestones(coll = getList('collection'), createdAt = (getProfile() || {}).created_at, sel = '#milestones', earnedOnly = false) {
  const root = $(sel); if (!root) return 0;
  const c = msCounts(coll, createdAt);
  const cards = [];
  for (const d of MS_DEFS) {
    const n = c[d.id] || 0;
    const cur = msTier(d, n);
    if (earnedOnly && !cur) continue;
    const next = d.tiers.find((t) => n < t) || 0;
    // „Jahre dabei" wächst in Tagen – sonst stünde der Balken ein ganzes Jahr auf 0 %.
    const [have, from, to] = d.id === 'years' ? [c.days, cur * 365, next * 365] : [n, cur, next];
    const pct = next ? Math.min(100, Math.max(3, Math.round(((have - from) / (to - from)) * 100))) : 100;
    const rest = next - n;
    const nextTxt = !next ? tr('ms.maxed')
      : d.id === 'years' ? tr(rest === 1 ? 'ms.toGoYear' : 'ms.toGoYears', { n: rest })
        : tr('ms.toGo', { n: rest, goal: next });
    const foot = earnedOnly ? ''
      : `<div class="ms-bar"><span style="width:${pct}%"></span></div>`
        + `<span class="ms-next">${escapeHtml(nextTxt)}</span>`;
    cards.push(`<div class="ms-badge${cur ? ' earned' : ''}">
      <div class="ms-medal">${cur || next}</div>
      <span class="ms-label">${escapeHtml(msLabel(d, cur || next))}</span>
      ${foot}
    </div>`);
  }
  root.innerHTML = cards.join('');
  if (!earnedOnly) celebrateMilestones(c);
  return cards.length;
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
// dedupeKey: jetzt in ./util.js
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

// valueHistorySvg: jetzt in ./util.js

function favSlotInner(item) {
  return item.coverUrl
    ? `<img src="${escapeHtml(item.coverUrl)}" alt="" onerror="this.remove()" />`
    : '<span class="fav-disc"></span>';
}
// Favorit = Collection-ID (alt) ODER Album-Objekt (neu, aus der Suche – auch Alben außerhalb der Collection).
function favAlbumObj(a) {
  return { title: a.title || '', artist: a.artist || '', coverUrl: a.coverUrl || '', source: a.source || 'discogs', sourceId: a.sourceId || '', masterId: a.masterId || '' };
}
function resolveFav(fav, coll) {
  if (!fav) return null;
  if (typeof fav === 'object') return fav;
  return (coll || getList('collection')).find((x) => x.id === fav) || null;
}
function openFav(item) {
  if (!item) return;
  if (item.id) openDetail('collection', item.id); // eigenes Collection-Album
  else openPreview(item);                          // beliebiges Album
}

// Lieblingssongs im Profil (selbst gewählt, gespeichert in profile.fav_songs).
let favSongsCache = [];
let songPickCache = [];
function renderFavoriteSongs() {
  const el = $('#profile-songs'); if (!el) return;
  const songs = ((getProfile() || {}).fav_songs || []).filter(Boolean).slice(0, 4);
  if (!songs.length) { el.innerHTML = `<p class="hint pfsong-none">${tr('favsongs.none')}</p>`; return; }
  favSongsCache = songs;
  el.innerHTML = songs.map((s, i) => `<div class="pfsong" data-idx="${i}">`
    + `<button class="pfsong-play" data-idx="${i}" aria-label="${tr('a11y.preview')}"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>`
    + `<span class="pfsong-title">${escapeHtml(s.title || '(Song)')}</span></div>`).join('');
  // Titel antippen -> Album öffnen (oder bei gesuchten Songs danach suchen)
  el.querySelectorAll('.pfsong-title').forEach((t) => t.addEventListener('click', () => {
    const s = favSongsCache[+t.closest('.pfsong').dataset.idx]; if (!s) return;
    if (s.albumId) openPreview({ source: 'discogs', sourceId: s.albumId, title: s.album || '', artist: s.artist || '', coverUrl: '' });
    else runDbSearchWith({ q: `${s.artist || ''} ${s.album || s.title || ''}`.trim() });
  }));
  // Play -> 30s-Hörprobe (gespeicherte bevorzugen, sonst lazy über iTunes, pro Song gecacht)
  el.querySelectorAll('.pfsong-play').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const s = favSongsCache[+b.dataset.idx]; if (!s) return;
    let url = s.preview;
    if (!url) {
      if (s._preview === undefined) {
        b.classList.add('loading');
        try { s._preview = await fetchSongPreview(s.artist || s.album || '', s.title || ''); } catch { s._preview = ''; }
        b.classList.remove('loading');
      }
      url = s._preview;
    }
    if (url) togglePreview(url, b, { title: s.title, artist: s.artist || s.album });
    else toast(tr('toast.noPreview'));
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
let songPickSlot = null;
let songSearchTimer = null;
function renderSongPick(songs, fromSearch) {
  songPickCache = songs || [];
  const box = $('#song-pick-list');
  if (!songPickCache.length) { box.innerHTML = `<p class="hint">${fromSearch ? tr('msg.nothingFound') : tr('songpicker.none')}</p>`; return; }
  box.innerHTML = songPickCache.map((s, i) => `<button class="song-pick-row" data-i="${i}"><span class="fs-title">${escapeHtml(s.title || '(Song)')}</span><span class="fs-artist">${escapeHtml(s.artist || s.album || '')}</span></button>`).join('');
  box.querySelectorAll('.song-pick-row').forEach((b) => b.addEventListener('click', () => {
    const s = songPickCache[+b.dataset.i];
    const arr = ((getProfile() || {}).fav_songs || []).slice();
    while (arr.length < 4) arr.push(null);
    arr[songPickSlot] = { albumId: s.albumId || '', position: s.position || '', title: s.title || '', artist: s.artist || '', album: s.album || '', preview: s.preview || '' };
    updateProfile({ fav_songs: arr });
    $('#song-dialog').close();
    refreshFavSongs();
  }));
}
async function openSongPicker(slot) {
  songPickSlot = slot;
  const inp = $('#song-search'); inp.value = '';
  const box = $('#song-pick-list');
  box.innerHTML = `<p class="hint">${tr('msg.loading')}</p>`;
  $('#song-dialog').showModal();
  let liked = [];
  // Such-Handler SOFORT setzen (vor dem Laden der Likes), damit Tippen direkt sucht.
  inp.oninput = () => {
    clearTimeout(songSearchTimer);
    const q = inp.value.trim();
    if (!q) { renderSongPick(liked, false); return; }
    songSearchTimer = setTimeout(async () => {
      box.innerHTML = `<p class="hint">${tr('msg.searching')}</p>`;
      let res = [];
      try { res = await fetchItunesSongs(q, 25); } catch { /* ignorieren */ }
      renderSongPick(res, true);
    }, 350);
  };
  try { liked = await fetchMyLikedSongs(50); } catch { /* ignorieren */ }
  renderSongPick(liked, false);
}
$('#btn-song-close').addEventListener('click', () => $('#song-dialog').close());

// Anzeige auf der Profilseite (klickbar -> Albumseite)
function renderFavoritesDisplay() {
  const favs = (getProfile() || {}).favorites || [];
  const coll = getList('collection');
  const el = $('#profile-favorites');
  if (!el) return;
  let html = '';
  for (let i = 0; i < 4; i++) {
    const item = resolveFav(favs[i], coll);
    html += item ? `<button class="fav-slot filled" data-i="${i}">${favSlotInner(item)}</button>` : '<div class="fav-slot empty"></div>';
  }
  el.innerHTML = html;
  el.querySelectorAll('.fav-slot.filled').forEach((b) => b.addEventListener('click', () => openFav(resolveFav(favs[+b.dataset.i], coll))));
}

// Bearbeitbare Slots im Profil-Popup
function renderFavoritesEdit() {
  const favs = (getProfile() || {}).favorites || [];
  const coll = getList('collection');
  const el = $('#ps-favorites');
  if (!el) return;
  let html = '';
  for (let i = 0; i < 4; i++) {
    const item = resolveFav(favs[i], coll);
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

let favPickSlot = null;
let favPickCache = [];
let favSearchTimer = null;
function renderFavPick(albums) {
  favPickCache = albums || [];
  const grid = $('#fav-pick-grid');
  grid.innerHTML = favPickCache.map((a, i) => `<button data-i="${i}">${favSlotInner(a)}</button>`).join('');
  grid.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const a = favPickCache[+b.dataset.i]; if (!a) return;
    const fav = ((getProfile() || {}).favorites || []).slice();
    while (fav.length < 4) fav.push(null);
    fav[favPickSlot] = a.id ? a.id : favAlbumObj(a); // Collection -> ID (bearbeitbar), Suche -> Objekt
    updateProfile({ favorites: fav });
    $('#fav-dialog').close();
    refreshFavorites();
  }));
}
function openFavPicker(slot) {
  favPickSlot = slot;
  const inp = $('#fav-search'); inp.value = '';
  renderFavPick(getList('collection')); // Standard: eigene Sammlung als Schnellauswahl
  $('#fav-pick-status').textContent = '';
  $('#fav-dialog').showModal();
  inp.oninput = () => {
    clearTimeout(favSearchTimer);
    const q = inp.value.trim();
    if (!q) { renderFavPick(getList('collection')); $('#fav-pick-status').textContent = ''; return; }
    favSearchTimer = setTimeout(async () => {
      $('#fav-pick-status').textContent = tr('msg.searching');
      let res = [];
      try { res = dedupeAlbums(await discogsSearch({ q })); } catch { /* ignorieren */ }
      $('#fav-pick-status').textContent = res.length ? '' : tr('msg.nothingFound');
      renderFavPick(res);
    }, 350);
  };
}

// Bild verkleinern/komprimieren und als Blob zurückgeben (für den Storage-Upload).
function downscaleImageBlob(file, maxW, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.naturalWidth);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob((b) => resolve(b), 'image/jpeg', quality);
    };
    img.onerror = () => resolve(null);
    const fr = new FileReader();
    fr.onload = () => { img.src = fr.result; };
    fr.readAsDataURL(file);
  });
}

function openProfileSettings() {
  const p = getProfile() || {};
  $('#profile-settings-dialog').classList.remove('show-auth', 'show-delete', 'show-lang', 'show-theme');
  $('#ps-signed-name').textContent = p.display_name || p.username || '';
  $('#ps-name').value = p.display_name || p.username || '';
  $('#ps-email').value = (getUser() && getUser().email) || '';
  $('#ps-email').readOnly = true;
  $('#ps-cur-email').value = (getUser() && getUser().email) || '';
  $('#ps-new-email').value = '';
  $('#ps-email-msg').textContent = '';
  $$('.set-theme-opt').forEach((b) => b.classList.toggle('active', b.dataset.theme === getTheme()));
  $$('.set-accent-opt').forEach((b) => b.classList.toggle('active', b.dataset.accent === getAccent()));
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
$('#ps-email-save').addEventListener('click', async () => {
  const msg = $('#ps-email-msg'); msg.textContent = tr('msg.pleaseWait');
  const err = await changeEmail($('#ps-new-email').value);
  msg.textContent = err || tr('msg.emailChangeSent');
  if (!err) $('#ps-new-email').value = '';
});
$('#ps-delete-open').addEventListener('click', () => {
  $('#ps-del-ack').checked = false; $('#ps-del-confirm').disabled = true; $('#ps-del-msg').textContent = '';
  $('#profile-settings-dialog').classList.add('show-delete');
});
$('#ps-del-back').addEventListener('click', () => $('#profile-settings-dialog').classList.remove('show-delete'));
$('#ps-del-ack').addEventListener('change', (e) => { $('#ps-del-confirm').disabled = !e.target.checked; });
$('#ps-feedback-open').addEventListener('click', () => { $('#ps-fb-msg').textContent = ''; $('#profile-settings-dialog').classList.add('show-feedback'); });
$('#ps-fb-back').addEventListener('click', () => $('#profile-settings-dialog').classList.remove('show-feedback'));
$('#ps-fb-send').addEventListener('click', async () => {
  if (!requireAuth()) return;
  const t = $('#ps-fb-text').value.trim();
  if (!t) return;
  const msg = $('#ps-fb-msg'); msg.textContent = tr('msg.sending');
  const ok = await sendFeedback(t, appBuild(), getLang());
  msg.textContent = ok ? tr('feedback.thanks') : tr('feedback.failed');
  if (ok) {
    $('#ps-fb-text').value = '';
    setTimeout(() => { $('#profile-settings-dialog').classList.remove('show-feedback'); toast(tr('feedback.thanks')); }, 700);
  }
});
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
$('#ps-avatar-btn').addEventListener('click', () => $('#avatar-file').click());
$('#avatar-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  toast(tr('toast.uploadingImage'));
  const blob = await downscaleImageBlob(file, 400, 0.85);
  const url = blob ? await uploadProfileImage('avatar', blob) : null;
  if (url) { updateProfile({ avatar_url: url }); renderProfile(); toast(tr('toast.saved')); }
  else { toast(tr('toast.uploadFailed')); }
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

// Datei-Download-Helfer (Blob → Download).
function downloadBlob(name, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
// Sammlung als CSV exportieren (Semikolon-getrennt + BOM: Excel-DE/Umlaut-freundlich).
function exportCollectionCsv() {
  const coll = getList('collection');
  if (!coll.length) { toast(tr('toast.emptyCollectionExport')); return; }
  const head = ['Interpret', 'Titel', 'Jahr', 'Format', 'Label', 'Genre', 'Zustand Medium', 'Zustand Hülle', 'Bewertung', 'Kaufpreis (EUR)', 'Standort', 'Kaufdatum', 'Kaufort', 'Tags', 'Barcode', 'Hinzugefügt'];
  const esc = (v) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = coll.map((i) => [
    i.artist, i.title, i.year, i.format, i.label, i.genre, i.mediaCond, i.sleeveCond,
    i.rating || '', i.price || '', i.location, i.purchaseDate, i.purchasePlace,
    (i.tags || []).join('; '), i.barcode, i.addedAt ? new Date(i.addedAt).toISOString().slice(0, 10) : '',
  ].map(esc).join(';'));
  const csv = '﻿' + head.join(';') + '\r\n' + rows.join('\r\n');
  downloadBlob('discend-sammlung-' + new Date().toISOString().slice(0, 10) + '.csv', 'text/csv;charset=utf-8', csv);
}
// Versicherungs-Report: druckfertige HTML-Seite (im neuen Tab → „Drucken/Als PDF speichern").
function openInsuranceReport() {
  const coll = getList('collection').slice().sort((a, b) => (a.artist || '').localeCompare(b.artist || '', 'de'));
  if (!coll.length) { toast(tr('toast.emptyCollectionExport')); return; }
  const est = computeCachedValue();
  const knownSum = coll.reduce((s, i) => s + (Number(i.price) > 0 ? Number(i.price) : 0), 0);
  const rows = coll.map((i, n) => {
    const cond = [i.mediaCond, i.sleeveCond].filter(Boolean).join(' / ');
    const val = Number(i.price) > 0 ? fmtEuro(Number(i.price)) : '';
    return `<tr><td class="r">${n + 1}</td><td>${escapeHtml(i.artist || '')}</td><td>${escapeHtml(i.title || '')}</td><td>${escapeHtml(String(i.year || ''))}</td><td>${escapeHtml(i.format || '')}</td><td>${escapeHtml(cond)}</td><td class="r">${val}</td></tr>`;
  }).join('');
  const name = escapeHtml(profileName() || 'Discend');
  const date = new Date().toLocaleDateString('de-DE');
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Discend – Versicherungs-Report</title>
<style>
body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111;margin:24px;}
h1{font-size:20px;margin:0 0 4px;}.sub{color:#666;font-size:13px;margin:0 0 14px;}
.totals{display:flex;flex-wrap:wrap;gap:24px;margin:0 0 16px;font-size:14px;}.totals b{display:block;font-size:18px;}
table{width:100%;border-collapse:collapse;font-size:12px;}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top;}
th{background:#f4f4f4;}td.r,th.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}
.foot{margin-top:16px;color:#888;font-size:11px;}
.btn{display:inline-block;margin:0 0 16px;padding:8px 14px;border:1px solid #999;border-radius:8px;background:#fff;cursor:pointer;font-size:14px;}
@media print{body{margin:12mm;}.noprint{display:none;}}
</style></head><body>
<button class="btn noprint" onclick="window.print()">Als PDF speichern / drucken</button>
<h1>Schallplatten-Sammlung – Bestandsliste</h1>
<p class="sub">${name} · ${coll.length} Alben · Stand ${date}</p>
<div class="totals"><span>Geschätzter Marktwert<b>${fmtEuro(est)}</b></span><span>Summe erfasster Kaufpreise<b>${fmtEuro(knownSum)}</b></span></div>
<table><thead><tr><th class="r">#</th><th>Interpret</th><th>Titel</th><th>Jahr</th><th>Format</th><th>Zustand</th><th class="r">Wert</th></tr></thead><tbody>${rows}</tbody></table>
<p class="foot">Erstellt mit Discend (discend.app) am ${date}. Der Marktwert ist eine automatische Schätzung (Discogs) und keine offizielle Bewertung.</p>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast(tr('toast.popupBlocked')); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
$('#btn-export-csv').addEventListener('click', exportCollectionCsv);
$('#btn-insurance').addEventListener('click', openInsuranceReport);

// ---------- Toast ----------
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.classList.remove('has-action');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}
// Toast mit „Rückgängig"-Knopf (etwas länger sichtbar). cb() läuft bei Klick.
function toastUndo(msg, cb) {
  const el = $('#toast');
  el.classList.add('has-action');
  el.innerHTML = '<span class="toast-msg"></span><button type="button" class="toast-action"></button>';
  el.querySelector('.toast-msg').textContent = msg;
  const btn = el.querySelector('.toast-action');
  btn.textContent = tr('btn.undo');
  btn.onclick = () => { clearTimeout(toastTimer); el.classList.add('hidden'); cb(); };
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 5000);
}
// Löschen mit Rückgängig: Snapshot inkl. id -> Wiederherstellung mit derselben id.
function deleteWithUndo(list, id, message) {
  const item = getList(list).find((i) => i.id === id);
  if (!item) return;
  const snapshot = { ...item };
  deleteItem(list, id);
  renderList(list); renderCounts();
  if (currentView === 'settings') renderProfile();
  toastUndo(message || tr('toast.deleted'), () => {
    addItem(list, snapshot); // gleiche id -> Eintrag zurück
    renderList(list); renderCounts();
    if (currentView === 'settings') renderProfile();
    toast(tr('toast.restored'));
  });
}

// ---------- Service Worker + Update-Hinweis ----------
function showUpdateBar(reg) {
  const bar = $('#update-bar'); if (!bar) return;
  bar.classList.remove('hidden');
  $('#update-reload').onclick = () => {
    bar.classList.add('hidden');
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    else location.reload();
  };
}
if ('serviceWorker' in navigator) {
  let refreshing = false;
  // Sobald die neue Version die Kontrolle übernimmt: einmal neu laden.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return; refreshing = true; location.reload();
  });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('service-worker.js');
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          // Neue Version installiert UND es lief schon eine alte -> Hinweis zeigen.
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar(reg);
        });
      });
    } catch { /* ignorieren */ }
  });
}

// ---------- Offline-Hinweis ----------
function updateOnlineStatus() {
  const bar = $('#offline-bar'); if (!bar) return;
  if (navigator.onLine) {
    if (!bar.classList.contains('hidden')) { bar.classList.add('hidden'); toast(tr('offline.backOnline')); }
  } else {
    bar.classList.remove('hidden');
  }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
if (!navigator.onLine) updateOnlineStatus();

// ---------- „Zum Home-Bildschirm" (iOS: Anleitung-Overlay, Android: Ein-Klick) ----------
let deferredInstallPrompt = null;
let a2hsShown = false;
function isStandalone() {
  return ('standalone' in navigator && navigator.standalone) || matchMedia('(display-mode: standalone)').matches;
}
function showA2HSOverlay(platform) {
  const dlg = $('#a2hs-overlay'); if (!dlg || a2hsShown) return;
  if (document.querySelector('dialog[open]')) return; // nicht über einen anderen offenen Dialog legen
  $('#a2hs-ios').style.display = platform === 'ios' ? '' : 'none';
  $('#a2hs-install').style.display = platform === 'android' ? '' : 'none';
  // Einmal gezeigt = nicht mehr nerven (robust, unabhängig vom Schließ-Weg).
  try { localStorage.setItem('discend_a2hs_v2', '1'); } catch { /* voll */ }
  try { dlg.showModal(); a2hsShown = true; } catch { /* ignorieren */ }
}
function maybeShowA2HS(trigger) {
  try {
    if (isStandalone() || a2hsShown) return; // schon installiert oder schon gezeigt
    if (localStorage.getItem('discend_a2hs_v2')) return;
    // Android/Chrome: nativer Ein-Klick möglich (beforeinstallprompt vorhanden)
    if (trigger === 'android' && deferredInstallPrompt) { showA2HSOverlay('android'); return; }
    // iOS Safari: kein programmatischer Weg → Anleitung nach kurzem Stöbern zeigen
    const ua = navigator.userAgent || '';
    const iOS = (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && !window.MSStream;
    if (iOS) setTimeout(() => { if (!a2hsShown && !deferredInstallPrompt) showA2HSOverlay('ios'); }, 2500);
  } catch { /* ignorieren */ }
}
// Android: nativen Installations-Dialog vormerken statt Chrome-Mini-Leiste
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstallPrompt = e; maybeShowA2HS('android'); });
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const dlg = $('#a2hs-overlay'); if (dlg && dlg.open) dlg.close();
  try { localStorage.setItem('discend_a2hs_v2', '1'); } catch { /* voll */ }
});
if ($('#a2hs-overlay')) {
  $('#a2hs-x').onclick = () => $('#a2hs-overlay').close();
  $('#a2hs-install').onclick = async () => {
    const p = deferredInstallPrompt;
    deferredInstallPrompt = null;
    if (p && typeof p.prompt === 'function') {
      p.prompt();
      try { await p.userChoice; } catch { /* ignorieren */ }
    }
    const dlg = $('#a2hs-overlay'); if (dlg && dlg.open) dlg.close();
  };
  // Beim Schließen (× / daneben tippen / installiert) nicht erneut nerven.
  $('#a2hs-overlay').addEventListener('close', () => { try { localStorage.setItem('discend_a2hs_v2', '1'); } catch { /* voll */ } });
}
maybeShowA2HS();

// ---------- Pull-to-refresh (Startseite/Listen neu laden) ----------
async function refreshCurrentView() {
  if (currentView === 'home') renderHome();
  else if (currentView === 'collection') { renderList('collection'); renderCounts(); renderValueRange(); }
  else if (currentView === 'search') renderBrowse();
  else if (currentView === 'settings') { renderProfile(); renderPlaylists(); renderList('wishlist'); }
}
function setupPullToRefresh() {
  const main = document.getElementById('main');
  const spin = document.getElementById('ptr-spin');
  if (!main || !spin) return;
  const THRESHOLD = 70;
  let startY = 0, pulling = false, dist = 0, refreshing = false;
  main.addEventListener('touchstart', (e) => {
    if (refreshing || main.scrollTop > 0 || e.touches.length !== 1) { pulling = false; return; }
    startY = e.touches[0].clientY; pulling = true; dist = 0;
    spin.style.transition = 'none';
  }, { passive: true });
  main.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    dist = e.touches[0].clientY - startY;
    if (dist <= 0 || main.scrollTop > 0) { pulling = main.scrollTop <= 0 && dist > 0; spin.style.opacity = '0'; return; }
    const pull = Math.min(dist, 120);
    spin.style.opacity = String(Math.min(1, pull / THRESHOLD));
    spin.style.transform = `translateY(${pull * 0.5}px) rotate(${pull * 3}deg)`;
  }, { passive: true });
  main.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    spin.style.transition = 'opacity .2s ease, transform .2s ease';
    if (dist >= THRESHOLD && !refreshing) {
      refreshing = true;
      spin.classList.add('spinning');
      try { if (getUser()) await syncAll(); } catch { /* ignorieren */ }
      await refreshCurrentView();
      spin.classList.remove('spinning');
      refreshing = false;
    }
    spin.style.opacity = '0';
    spin.style.transform = 'translateY(0)';
  });
}
setupPullToRefresh();

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
    c.innerHTML = emptyState({ icon: ES_LIST, title: tr('empty.playlistsTitle'), text: tr('empty.playlistsText') });
    return;
  }
  const coll = getList('collection');
  // Letterboxd-Stil: ganze Karte klickbar (öffnet die Übersicht), kein Löschen-Knopf an der Zeile.
  c.innerHTML = pls.map((p) => {
    const albums = p.itemIds.map((id) => coll.find((x) => x.id === id)).filter(Boolean);
    const posters = albums.slice(0, 5).map((a) => `<span class="pl-poster${a.coverUrl ? '' : ' placeholder'}">${a.coverUrl ? `<img src="${escapeHtml(a.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove()" />` : ''}</span>`).join('') || '<span class="pl-poster placeholder"></span>';
    const desc = p.description ? `<span class="pl-card-desc">${escapeHtml(p.description)}</span>` : '';
    return `<button class="pl-card" data-plopen="${p.id}">
        <span class="pl-stack">${posters}</span>
        <span class="pl-card-body">
          <span class="pl-card-name">${escapeHtml(p.name)}</span>
          <span class="pl-card-count">${tr('unit.albumsCount', { n: albums.length })}</span>
          ${desc}
        </span>
        <span class="pl-card-chev">›</span>
      </button>`;
  }).join('');
  c.querySelectorAll('.pl-card[data-plopen]').forEach((b) => b.addEventListener('click', () => openPlaylistView(b.dataset.plopen)));
}

// ---------- Listen-Ansicht (sortierbar/ranked) ----------
let plvId = null;
let plvEditMode = false; // Reihenfolge-ändern-Modus (zeigt Hoch/Runter/Entfernen)
function openPlaylistView(id) {
  plvId = id;
  plvEditMode = false;
  $('#btn-plv-settings').style.display = ''; // eigene Liste: Zahnrad zeigen
  $('#plv-settings').hidden = true;
  renderPlaylistView();
  $('#playlist-view-dialog').showModal();
}
function renderPlaylistView() {
  const p = getPlaylists().find((x) => x.id === plvId);
  if (!p) { $('#playlist-view-dialog').close(); return; }
  $('#plv-title').textContent = p.name;
  { const byEl = $('#plv-by'); if (byEl) byEl.hidden = true; } // eigene Liste: kein „von …"
  const descEl = $('#plv-desc');
  descEl.textContent = p.description || '';
  descEl.style.display = p.description ? '' : 'none';
  $('#plv-ranked-toggle').checked = !!p.ranked;
  const reorderBtn = $('#plv-reorder');
  reorderBtn.classList.toggle('active', plvEditMode);
  reorderBtn.textContent = plvEditMode ? tr('pl.reorderDone') : tr('pl.reorder');
  const coll = getList('collection');
  const albums = p.itemIds.map((id) => coll.find((x) => x.id === id)).filter(Boolean);
  const list = $('#plv-list');
  if (!albums.length) { list.innerHTML = `<p class="pl-none">${tr('pl.empty')}</p>`; return; }
  list.innerHTML = albums.map((a, i) => `
    <div class="plv-row${p.ranked ? ' ranked' : ''}${plvEditMode ? ' editing' : ''}">
      ${p.ranked ? `<span class="plv-rank">${i + 1}</span>` : ''}
      <button class="plv-album" data-open="${a.id}">
        <span class="plv-cover${a.coverUrl ? '' : ' placeholder'}">${a.coverUrl ? `<img src="${escapeHtml(a.coverUrl)}" alt="" onerror="this.parentElement.classList.add('placeholder');this.remove()" />` : ''}</span>
        <span class="plv-meta"><span class="chart-title">${escapeHtml(a.title || '')}</span><span class="chart-artist">${escapeHtml(a.artist || '')}</span></span>
      </button>
      ${plvEditMode ? `<span class="plv-ctrls">
        <button class="plv-mv" data-up="${a.id}" ${i === 0 ? 'disabled' : ''} aria-label="${tr('a11y.moveUp')}">▲</button>
        <button class="plv-mv" data-down="${a.id}" ${i === albums.length - 1 ? 'disabled' : ''} aria-label="${tr('a11y.moveDown')}">▼</button>
        <button class="plv-rm" data-rm="${a.id}" aria-label="${tr('a11y.remove')}">×</button>
      </span>` : ''}
    </div>`).join('');
  list.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { $('#playlist-view-dialog').close(); openDetail('collection', b.dataset.open); }));
  list.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => { movePlaylistItem(plvId, b.dataset.up, -1); renderPlaylistView(); }));
  list.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => { movePlaylistItem(plvId, b.dataset.down, 1); renderPlaylistView(); }));
  list.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { togglePlaylistItem(plvId, b.dataset.rm); renderPlaylistView(); renderPlaylists(); }));
}
$('#btn-plv-close').addEventListener('click', () => $('#playlist-view-dialog').close());
// Zahnrad: Einstellungen der Liste ein-/ausklappen
$('#btn-plv-settings').addEventListener('click', () => { const s = $('#plv-settings'); s.hidden = !s.hidden; });
$('#plv-ranked-toggle').addEventListener('change', (e) => { updatePlaylist(plvId, { ranked: e.target.checked }); renderPlaylistView(); renderPlaylists(); });
$('#plv-reorder').addEventListener('click', () => { plvEditMode = !plvEditMode; renderPlaylistView(); });
$('#plv-edit').addEventListener('click', () => { if (plvId) openPlaylistEdit(plvId); });
$('#plv-delete').addEventListener('click', () => {
  if (!plvId) return;
  if (confirm(tr('confirm.deletePlaylist'))) { deletePlaylist(plvId); $('#playlist-view-dialog').close(); renderPlaylists(); }
});

// Liste anlegen ODER bearbeiten (derselbe Dialog, gesteuert über editingPlaylistId).
let editingPlaylistId = null;
function openPlaylistEdit(id) {
  const p = getPlaylists().find((x) => x.id === id); if (!p) return;
  editingPlaylistId = id;
  $('#new-playlist-name').value = p.name;
  $('#new-playlist-desc').value = p.description || '';
  $('#create-pl-title').textContent = tr('dlg.editPlaylist');
  $('#btn-create-playlist').textContent = tr('btn.save');
  $('#create-playlist-dialog').showModal();
}
function resetPlaylistDialog() {
  editingPlaylistId = null;
  $('#new-playlist-name').value = '';
  $('#new-playlist-desc').value = '';
  $('#create-pl-title').textContent = tr('dlg.newPlaylist');
  $('#btn-create-playlist').textContent = tr('btn.create');
}
$('#btn-new-playlist').addEventListener('click', () => { resetPlaylistDialog(); $('#create-playlist-dialog').showModal(); });
$('#btn-create-pl-close').addEventListener('click', () => { $('#create-playlist-dialog').close(); resetPlaylistDialog(); });
$('#btn-create-playlist').addEventListener('click', () => {
  const name = $('#new-playlist-name').value.trim();
  if (!name) return;
  const desc = $('#new-playlist-desc').value.trim();
  if (editingPlaylistId) {
    updatePlaylist(editingPlaylistId, { name, description: desc });
    $('#create-playlist-dialog').close();
    resetPlaylistDialog();
    renderPlaylists();
    renderPlaylistView();
  } else {
    createPlaylist(name, desc);
    $('#create-playlist-dialog').close();
    resetPlaylistDialog();
    renderPlaylists();
    toast(tr('toast.playlistCreated'));
  }
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
      `<button class="home-tab" data-htab="activity">${tr('htab.activity')}</button>` +
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
  animateSwap(body);
  if (tab === 'reviews') renderHomeReviews(body);
  else if (tab === 'lists') renderHomeLists(body);
  else if (tab === 'activity') renderHomeActivity(body);
  else renderHomeAlben(body);
}

// ---------- Zufalls-Platte („Was soll ich heute hören?") ----------
const DICE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg>';
let lastRandomId = null;
// Erst ab ein paar Platten sinnvoll – bei 2 Alben ist „Zufall" albern.
function randomCardHtml() {
  if (getList('collection').length < 3) return '';
  return '<div class="home-section">'
    + `<span class="dp-label">${tr('home.whatToPlay')}</span>`
    + `<button class="btn random-btn" id="home-random">${DICE_SVG}<span>${tr('btn.randomRecord')}</span></button>`
    + '</div>';
}
function pickRandomRecord() {
  const coll = getList('collection');
  if (!coll.length) return;
  // Nicht zweimal hintereinander dieselbe Platte vorschlagen
  const pool = coll.length > 1 ? coll.filter((i) => i.id !== lastRandomId) : coll;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  lastRandomId = pick.id;
  openDetail('collection', pick.id);
}

// „Alben" = die normale Startseite (Begrüßung + Charts + Neuzugänge).
function renderHomeAlben(body) {
  body.innerHTML =
    whatsNewCardHtml() +
    onboardCardHtml() +
    '<div class="home-greet">' +
      `<button class="home-greet-av" id="home-greet-av" aria-label="${tr('a11y.myProfile')}"></button>` +
      '<div class="home-greet-text"><span class="home-greet-hello" id="home-greet-hello"></span></div>' +
      `<button class="home-bell" id="home-bell" aria-label="${tr('a11y.notifications')}">` +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' +
        '<span class="notif-badge hidden" id="notif-badge"></span>' +
      '</button>' +
    '</div>' +
    randomCardHtml() +
    `<div class="home-section" id="home-foryou-section" hidden><span class="dp-label">${tr('home.forYou')}</span><ol id="home-foryou-list" class="chart-list">${skelCharts()}</ol></div>` +
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
  { const rb = $('#home-random'); if (rb) rb.addEventListener('click', pickRandomRecord); }
  $('#home-bell').addEventListener('click', openNotifications);
  refreshBellBadge();
  if ($('#onboard')) {
    $('#onboard-x').addEventListener('click', dismissOnboard);
    $('#onboard-go').addEventListener('click', dismissOnboard);
  }
  if ($('#whatsnew')) {
    $('#wn-x').addEventListener('click', dismissWhatsNew);
    $('#wn-ok').addEventListener('click', dismissWhatsNew);
  }

  loadForYou();
  loadPopularThisWeek();
  renderFriendsRow();
  loadNewReleases();
}

// „Aktivität" = chronologischer Feed der Gefolgten: Neuzugänge, Höreinträge, neue Listen.
let homeActivityCache = [];
function timeAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return tr('time.now');
  const m = Math.floor(s / 60); if (m < 60) return tr('time.min', { n: m });
  const h = Math.floor(m / 60); if (h < 24) return tr('time.hour', { n: h });
  const d = Math.floor(h / 24); if (d < 7) return tr('time.day', { n: d });
  return new Date(ts).toLocaleDateString();
}
function activityRowHtml(e, i) {
  const who = e.by ? (e.by.display_name || e.by.username || '') : '';
  const whoHtml = `<strong>${escapeHtml(who)}</strong>`;
  const avStyle = (e.by && e.by.avatar_url) ? ` style="background-image:url('${escapeHtml(e.by.avatar_url)}')"` : '';
  const avCls = (e.by && e.by.avatar_url) ? '' : ' placeholder';
  const time = e.ts ? timeAgo(e.ts) : '';
  let text = '', thumb = '', extra = '';
  if (e.kind === 'list') {
    const nameHtml = `<strong>${escapeHtml((e.list && e.list.name) || tr('list.fallbackName'))}</strong>`;
    text = tr('act.createdList', { who: whoHtml, name: nameHtml });
    const covers = ((e.list && e.list.items) || []).slice(0, 4).map((it) => `<span class="act-poster${(it && it.coverUrl) ? '' : ' placeholder'}">${(it && it.coverUrl) ? `<img src="${escapeHtml(it.coverUrl)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`).join('');
    thumb = `<span class="act-stack">${covers}</span>`;
  } else {
    const album = `<strong>${escapeHtml(e.title || '')}</strong>` + (e.artist ? ` – ${escapeHtml(e.artist)}` : '');
    text = tr(e.kind === 'play' ? 'act.played' : 'act.added', { who: whoHtml, album });
    thumb = `<span class="act-cover${e.coverUrl ? '' : ' placeholder'}">${e.coverUrl ? `<img src="${escapeHtml(e.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove()">` : ''}</span>`;
    if (e.kind === 'add' && Number(e.rating) > 0) extra += `<span class="act-rating">${ratingDisplayHtml(e.rating)}</span>`;
    const rv = (e.review || '').trim();
    if (e.kind === 'add' && rv) extra += `<p class="act-review">${escapeHtml(rv.slice(0, 140))}${rv.length > 140 ? '…' : ''}</p>`;
  }
  return `<div class="act-row">
      <button class="act-av${avCls}" data-who="${i}"${avStyle} aria-label="${escapeHtml(who)}"></button>
      <button class="act-open act-body" data-i="${i}"><span class="act-text">${text}</span><span class="act-time">${time}</span>${extra}</button>
      <button class="act-open act-thumb" data-i="${i}">${thumb}</button>
    </div>`;
}
async function renderHomeActivity(body) {
  if (!getUser()) {
    body.innerHTML = `<div class="home-empty-card">${tr('home.signInActivity')} <button id="act-cta" class="link-btn">${tr('auth.login')}</button></div>`;
    const b = body.querySelector('#act-cta'); if (b) b.onclick = () => openAuth('login');
    return;
  }
  body.innerHTML = `<div class="act-feed">${skelLists(5)}</div>`;
  const wrap = body.querySelector('.act-feed');
  let events = [];
  try {
    const [feed, lists] = await Promise.all([fetchFriendsFeed(30), fetchFriendsLists(12)]);
    events = (feed || []).slice();
    (lists || []).forEach((l) => events.push({ kind: 'list', list: l, by: l.by, ts: l.createdAt || 0 }));
    events.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    events = events.slice(0, 40);
  } catch { /* ignorieren */ }
  if (!wrap) return;
  if (!events.length) {
    wrap.innerHTML = `<div class="home-empty-card">${tr('act.emptyText')} <button id="act-cta" class="link-btn">${tr('dlg.findFriends')}</button></div>`;
    const b = wrap.querySelector('#act-cta'); if (b) b.onclick = goMemberSearch;
    return;
  }
  homeActivityCache = events;
  wrap.innerHTML = events.map((e, i) => activityRowHtml(e, i)).join('');
  wrap.querySelectorAll('.act-av[data-who]').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); const e = homeActivityCache[+b.dataset.who]; if (e && e.by) openUserProfile(e.by); }));
  wrap.querySelectorAll('.act-open[data-i]').forEach((b) => b.addEventListener('click', () => {
    const e = homeActivityCache[+b.dataset.i]; if (!e) return;
    if (e.kind === 'list') openUserPlaylistView(e.list);
    else openRecord(e, false); // Freundes-Infos zur Platte (Cover → echte Albumseite)
  }));
}

// „Reviews" = Reviews von Gefolgten zuerst, danach allgemein neueste.
async function renderHomeReviews(body) {
  body.innerHTML = `<div class="rev-list">${skelRevs()}</div>`;
  const wrap = body.querySelector('.rev-list');
  let revs = [];
  try { revs = await fetchReviewsFeed(30); } catch { /* ignorieren */ }
  if (!wrap) return;
  if (!revs.length) {
    wrap.innerHTML = emptyState({ icon: ES_PEN, title: tr('empty.reviewsTitle'), text: tr('home.noReviews') });
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
  // Ranglisten-Nummern auch hier (Startseite/Suche), wenn der Ersteller sie anhat.
  const rank = (n) => (l.ranked ? `<span class="ll-rank">${n}</span>` : '');
  const covers = l.items.slice(0, 4).map((it, n) => (it && it.coverUrl)
    ? `<div class="ll-cover">${rank(n + 1)}<img src="${escapeHtml(it.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();" /></div>`
    : `<div class="ll-cover placeholder">${rank(n + 1)}</div>`).join('');
  const who = l.by ? (l.by.display_name || l.by.username || '') : '';
  const rankNote = l.ranked ? ` · ${tr('pl.ranked')}` : '';
  return `<button class="list-card" data-idx="${i}">
      <div class="ll-covers">${covers || '<div class="ll-cover placeholder"></div>'}</div>
      <div class="ll-meta"><span class="ll-name">${escapeHtml(l.name || tr('list.fallbackName'))}</span><span class="ll-by">${escapeHtml(who)} · ${tr('unit.albumsCount', { n: l.items.length })}${rankNote}</span></div>
    </button>`;
}

// „Lists" = Playlists von Gefolgten.
async function renderHomeLists(body) {
  if (!getUser()) {
    body.innerHTML = emptyState({ icon: ES_LIST, title: tr('empty.listsTitle'), text: tr('home.signInLists'), ctaLabel: tr('auth.login'), ctaAttr: 'id="lists-cta"' });
    const b = body.querySelector('#lists-cta'); if (b) b.onclick = () => openAuth('login');
    return;
  }
  body.innerHTML = `<div class="lists-wrap">${skelLists()}</div>`;
  const wrap = body.querySelector('.lists-wrap');
  let lists = [];
  try { lists = await fetchFriendsLists(20); } catch { /* ignorieren */ }
  if (!wrap) return;
  if (!lists.length) {
    wrap.innerHTML = emptyState({ icon: ES_LIST, title: tr('empty.listsTitle'), text: tr('home.noFriendLists'), ctaLabel: tr('dlg.findFriends'), ctaAttr: 'id="lists-cta"' });
    const b = wrap.querySelector('#lists-cta'); if (b) b.onclick = goMemberSearch;
    return;
  }
  homeListsCache = lists;
  wrap.innerHTML = lists.map((l, i) => listCardHtml(l, i)).join('');
  // Antippen öffnet die LISTE (wie auf den Profilen), nicht mehr das Profil des Erstellers.
  wrap.querySelectorAll('.list-card').forEach((c) => c.addEventListener('click', () => {
    const l = homeListsCache[+c.dataset.idx];
    if (l) openUserPlaylistView(l);
  }));
}

// Wochen-Index (wechselt jede Woche) + rotierendes Fenster: gleicher großer Topf,
// aber je Kalenderwoche ein anderer Ausschnitt → die Startseiten-Listen wirken
// nicht mehr statisch, bleiben aber innerhalb der Woche stabil.
// weekIndex / rotateWindow: jetzt in ./util.js

// „Für dich" – Empfehlungen aus den Top-Genres + Top-Künstlern der eigenen Sammlung
// (über Discogs), gefiltert um bereits vorhandene Alben. Nur für angemeldete Nutzer
// mit ein paar Alben. Innerhalb der Sitzung gecacht.
let forYouCache = null;
// shuffle: jetzt in ./util.js
async function loadForYou() {
  const section = document.getElementById('home-foryou-section');
  const ol = document.getElementById('home-foryou-list');
  if (!section || !ol) return;
  const coll = getList('collection');
  if (!getUser() || coll.length < 3) { section.hidden = true; return; }
  section.hidden = false; // Skeleton während des Ladens zeigen
  let res = forYouCache;
  if (!res) {
    const genreCounts = {}, artistCounts = {};
    for (const it of coll) {
      const g = (it.genre || '').trim(); if (g) genreCounts[g] = (genreCounts[g] || 0) + 1;
      const a = (it.artist || '').trim(); if (a) artistCounts[a] = (artistCounts[a] || 0) + 1;
    }
    const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map((e) => e[0]);
    const topArtists = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
    const queries = [];
    topGenres.forEach((g) => queries.push({ genre: g, sort: 'have', sort_order: 'desc', per_page: 40 }));
    topArtists.forEach((a) => queries.push({ artist: a, sort: 'have', sort_order: 'desc', per_page: 20 }));
    if (!queries.length) { section.hidden = true; return; }
    let pool = [];
    try {
      const parts = await Promise.all(queries.map((q) => discogsSearch(q).catch(() => [])));
      pool = dedupeAlbums(parts.flat());
    } catch { pool = []; }
    const have = new Set(coll.map(dedupeKey));
    res = shuffle(pool.filter((r) => r.coverUrl && !have.has(dedupeKey(r)))).slice(0, 15);
    forYouCache = res;
  }
  if (!res.length) { section.hidden = true; return; }
  section.hidden = false;
  ol.innerHTML = res.map((r, i) => {
    const cov = r.coverUrl ? `<img src="${escapeHtml(r.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove();" />` : '';
    return `<li class="chart-item" data-idx="${i}"><div class="chart-cover${r.coverUrl ? '' : ' placeholder'}">${cov}</div><div class="chart-meta"><span class="chart-title">${escapeHtml(r.title || '')}</span><span class="chart-artist">${escapeHtml(r.artist || '')}</span></div></li>`;
  }).join('');
  ol.querySelectorAll('.chart-item').forEach((li) => li.addEventListener('click', () => openPreview(forYouCache[+li.dataset.idx])));
}

// „Neu erschienen" – Releases des aktuellen Jahres (über Discogs), wöchentlich rotierend.
let newReleasesCache = null;
async function loadNewReleases() {
  const ol = document.getElementById('home-new-list');
  if (!ol) return;
  let res = newReleasesCache;
  if (!res) {
    const year = new Date().getFullYear();
    try { res = dedupeAlbums(await discogsSearch({ year: String(year), sort: 'have', sort_order: 'desc', per_page: 100 })); }
    catch { res = []; }
    newReleasesCache = res;
  }
  const withCover = res.filter((r) => r.coverUrl);
  const pool = withCover.length >= 10 ? withCover : res;
  const list = rotateWindow(pool, 12, weekIndex() + 3);
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
    try { res = dedupeAlbums(await discogsSearch({ sort: 'have', sort_order: 'desc', per_page: 100 })); }
    catch { res = []; }
    popularCache = res;
  }
  const withCover = res.filter((r) => r.coverUrl);
  const pool = withCover.length >= 10 ? withCover : res;
  const list = rotateWindow(pool, 10, weekIndex());
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
    b.addEventListener('click', () => openRecord(friendsFeedCache[+b.dataset.idx], false)));
}

// ---------- Benachrichtigungen ----------
let notifCache = [];
function updateBellBadge(c) {
  const b = document.getElementById('notif-badge');
  if (!b) return;
  if (c > 0) { b.textContent = c > 9 ? '9+' : String(c); b.classList.remove('hidden'); }
  else { b.classList.add('hidden'); }
}
async function refreshBellBadge() {
  if (!getUser()) { updateBellBadge(0); return; }
  let c = 0;
  try { c = await fetchUnreadCount(); } catch { /* ignorieren */ }
  updateBellBadge(c);
}
function notifText(n) {
  const who = n.actor ? (n.actor.display_name || n.actor.username || '') : tr('notif.someone');
  if (n.type === 'follow') return tr('notif.followed', { who });
  if (n.type === 'like') return tr('notif.liked', { who });
  if (n.type === 'comment') {
    const t = (n.data && n.data.text) ? ' „' + n.data.text + '"' : '';
    return tr('notif.commented', { who }) + t;
  }
  return who;
}
function notifRowHtml(n, i) {
  const hasAv = !!(n.actor && n.actor.avatar_url);
  const av = hasAv ? `style="background-image:url('${escapeHtml(n.actor.avatar_url)}')"` : '';
  const dot = n.read ? '' : '<span class="notif-dot"></span>';
  return `<button class="notif-row" data-idx="${i}"><span class="friend-av${hasAv ? '' : ' placeholder'}" ${av}></span><span class="notif-text">${escapeHtml(notifText(n))}</span>${dot}</button>`;
}
function openNotifTarget(n) {
  $('#notifications-dialog').close();
  if (!n) return;
  if (n.type === 'follow') { if (n.actor) openUserProfile(n.actor); }
  else if (n.itemId) { openDetail('collection', n.itemId); }
}
async function openNotifications() {
  if (!requireAuth()) return;
  const box = $('#notif-list');
  box.innerHTML = `<p class="hint">${tr('msg.loading')}</p>`;
  $('#notifications-dialog').showModal();
  let notifs = [];
  try { notifs = await fetchNotifications(40); } catch { /* ignorieren */ }
  notifCache = notifs;
  if (!notifs.length) {
    box.innerHTML = emptyState({ icon: ES_BELL, title: tr('notif.emptyTitle'), text: tr('notif.emptyText') });
  } else {
    box.innerHTML = notifs.map((n, i) => notifRowHtml(n, i)).join('');
    box.querySelectorAll('.notif-row').forEach((row) => row.addEventListener('click', () => openNotifTarget(notifCache[+row.dataset.idx])));
  }
  try { await markNotificationsRead(); } catch { /* ignorieren */ }
  updateBellBadge(0);
}
$('#btn-notif-close').addEventListener('click', () => $('#notifications-dialog').close());

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
// Lieblingssongs in einen Container rendern (für eigenes UND fremdes Profil).
function renderSongsInto(el, rawSongs) {
  if (!el) return;
  const songs = (rawSongs || []).filter(Boolean).slice(0, 4);
  if (!songs.length) { el.innerHTML = `<p class="hint pfsong-none">${tr('favsongs.noneOther')}</p>`; return; }
  el.innerHTML = songs.map((s, i) => `<div class="pfsong" data-idx="${i}"><button class="pfsong-play" data-idx="${i}" aria-label="${tr('a11y.preview')}"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button><span class="pfsong-title">${escapeHtml(s.title || '(Song)')}</span></div>`).join('');
  el.querySelectorAll('.pfsong-title').forEach((t) => t.addEventListener('click', () => {
    const s = songs[+t.closest('.pfsong').dataset.idx]; if (!s) return;
    if (s.albumId) openPreview({ source: 'discogs', sourceId: s.albumId, title: s.album || '', artist: s.artist || '', coverUrl: '' });
    else runDbSearchWith({ q: `${s.artist || ''} ${s.album || s.title || ''}`.trim() });
  }));
  el.querySelectorAll('.pfsong-play').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const s = songs[+b.dataset.idx]; if (!s) return;
    let url = s.preview;
    if (!url) {
      if (s._preview === undefined) {
        b.classList.add('loading');
        try { s._preview = await fetchSongPreview(s.artist || s.album || '', s.title || ''); } catch { s._preview = ''; }
        b.classList.remove('loading');
      }
      url = s._preview;
    }
    if (url) togglePreview(url, b, { title: s.title, artist: s.artist || s.album });
    else toast(tr('toast.noPreview'));
  }));
}
let upColl = [], upWish = [], upCommon = [], upName = '';
let upMenuUser = null; // aktuelles Fremdprofil für das 3-Punkte-Menü
async function openUserProfile(user) {
  if (!user) return;
  const u = (await fetchUserProfile(user.id)) || user;
  friendsFollowing = new Set(await getFollowing().catch(() => []));
  upName = u.display_name || u.username || '';
  if (u.username) setUrl(profileUrl(u.username)); // Deep-Link in der Adresszeile
  $('#up-name').textContent = upName;
  $('#up-handle').textContent = '@' + (u.username || '');
  renderSongsInto($('#up-songs'), u.fav_songs);
  const av = $('#up-avatar');
  if (u.avatar_url) { av.style.backgroundImage = `url("${u.avatar_url}")`; av.innerHTML = ''; }
  else { av.style.backgroundImage = ''; av.innerHTML = '<svg class="avatar-ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>'; }
  const PIN = '<svg class="meta-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  const LNK = '<svg class="meta-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  const parts = [];
  if (u.location) parts.push(`${PIN} ${escapeHtml(u.location)}`);
  if (u.website) {
    const href = /^https?:\/\//.test(u.website) ? u.website : 'https://' + u.website;
    parts.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${LNK} ${escapeHtml(u.website.replace(/^https?:\/\//, ''))}</a>`);
  }
  $('#up-meta').innerHTML = parts.join('  ·  ');
  $('#up-bio').textContent = u.bio || '';
  const fbtn = $('#up-follow');
  const isMe = getUser() && getUser().id === u.id;
  const isBlocked = getBlocked().has(u.id);
  // Follow-Button: nur zeigen, wenn man noch NICHT folgt. Unfollow/Teilen/Blockieren/Melden
  // stecken jetzt im 3-Punkte-Menü oben rechts.
  fbtn.onclick = async () => {
    if (!requireAuth()) return;
    friendsFollowing.add(u.id); await follow(u.id);
    fbtn.style.display = 'none';
    if (currentView === 'home') renderFriendsRow();
  };
  setFollowBtn(fbtn, false);
  fbtn.style.display = (isMe || isBlocked || friendsFollowing.has(u.id)) ? 'none' : '';
  upMenuUser = isMe ? null : u;
  { const mb = $('#up-menu-btn'); if (mb) mb.style.display = isMe ? 'none' : ''; }
  // Bei Blockierung: Hinweis zeigen, Inhalte ausblenden und nicht laden
  $('#up-blocked-note').classList.toggle('hidden', !isBlocked);
  $('#up-favorites-section').style.display = isBlocked ? 'none' : '';
  $('#up-stats-section').style.display = isBlocked ? 'none' : '';
  $('#up-rating-section').hidden = true;
  $('#up-ms-section').hidden = true;
  $('#up-grid-page').classList.add('hidden');
  if (isBlocked) {
    fbtn.style.display = 'none';
    $('#up-songs').innerHTML = '';
    $('#up-lists').innerHTML = ''; $('#up-lists-section').hidden = true;
    bringOverlayFront($('#user-page')); $('#user-page').classList.remove('hidden');
    $('#user-scroll').scrollTop = 0;
    document.body.style.overflow = 'hidden';
    return; // Inhalte blockierter Nutzer nicht laden
  }
  $('#up-stats').innerHTML = '';
  $('#up-favorites').innerHTML = '';
  $('#up-lists').innerHTML = '';
  $('#up-lists-section').hidden = true;
  bringOverlayFront($('#user-page')); $('#user-page').classList.remove('hidden');
  $('#user-scroll').scrollTop = 0;
  document.body.style.overflow = 'hidden';
  // Sammlung + Wishlist + Wert laden
  let coll = [], wish = [], vhist = [];
  try { [coll, wish, vhist] = await Promise.all([fetchUserItems(u.id, 'collection'), fetchUserItems(u.id, 'wishlist'), u.hide_value ? Promise.resolve([]) : fetchValueHistory(u.id)]); }
  catch { /* ignorieren */ }
  upColl = coll; upWish = wish;
  // „Ihr habt X gemeinsam": Schnittmenge mit der eigenen Sammlung (nur eingeloggt, nicht bei sich selbst).
  upCommon = (isMe || !getUser()) ? [] : commonAlbums(getList('collection'), coll);
  const latestVal = vhist.length ? vhist[vhist.length - 1].value : 0;
  const rated = coll.filter((i) => Number(i.rating) > 0);
  const avg = rated.length ? (rated.reduce((s, i) => s + Number(i.rating), 0) / rated.length) : 0;
  // Sammlung/Wishlist öffnen als eigene Seite (kein Aufklappen mehr)
  $('#up-stats').innerHTML =
    `<li class="stat-toggle" data-grid="collection"><span>${tr('stat.collection')}</span><span class="stat-num">${coll.length}<span class="stat-chev">›</span></span></li>` +
    `<li class="stat-toggle" data-grid="wishlist"><span>${tr('stat.wishlist')}</span><span class="stat-num">${wish.length}<span class="stat-chev">›</span></span></li>` +
    (upCommon.length ? `<li class="stat-toggle" data-grid="common"><span>${tr('stat.inCommon')}</span><span class="stat-num">${upCommon.length}<span class="stat-chev">›</span></span></li>` : '') +
    `<li><span>${tr('stat.rated')}</span><span class="stat-num">${rated.length}</span></li>` +
    `<li><span>${tr('stat.avgRating')}</span><span class="stat-num">${avg ? avg.toFixed(1) + ' ♪' : '–'}</span></li>` +
    ((!u.hide_value && latestVal > 0) ? `<li><span>${tr('stat.collectionValue')}</span><span class="stat-num">${fmtEuro(latestVal)}</span></li>` : '');
  $('#up-stats').querySelectorAll('.stat-toggle').forEach((li) => li.addEventListener('click', () => openUpGrid(li.dataset.grid)));
  // Rating-Diagramm (wie beim eigenen Profil), nur wenn es Bewertungen gibt
  $('#up-rating-section').hidden = rated.length === 0;
  if (rated.length) renderHisto(coll, '#up-rating-histo');
  // Meilensteine des anderen: nur Erreichtes (kein Fortschritt zu fremden Zielen)
  $('#up-ms-section').hidden = renderMilestones(coll, u.created_at, '#up-milestones', true) === 0;
  // Favoriten-Alben
  const favItems = (u.favorites || []).map((f) => resolveFav(f, coll)).filter(Boolean);
  let favHtml = '';
  for (let i = 0; i < 4; i++) {
    const it = favItems[i];
    favHtml += it ? `<button class="fav-slot filled" data-fav="${i}">${favSlotInner(it)}</button>` : '<div class="fav-slot empty"></div>';
  }
  $('#up-favorites').innerHTML = favHtml;
  $('#up-favorites').querySelectorAll('.fav-slot.filled').forEach((b) => b.addEventListener('click', () => openPreview(favItems[+b.dataset.fav])));
  // Listen des Nutzers
  let lists = [];
  try { lists = await fetchUserPlaylists(u.id); } catch { /* ignorieren */ }
  renderUserLists(lists);
}
// Sammlung/Wishlist eines Nutzers als eigene Übersichtsseite öffnen.
function openUpGrid(kind) {
  const items = kind === 'wishlist' ? upWish : kind === 'common' ? upCommon : upColl;
  const titleKey = kind === 'wishlist' ? 'stat.wishlist' : kind === 'common' ? 'stat.inCommon' : 'stat.collection';
  $('#up-grid-title').textContent = (upName ? upName + ' – ' : '') + tr(titleKey);
  fillCoverGrid($('#up-grid'), items);
  const p = $('#up-grid-page');
  bringOverlayFront(p);
  p.classList.remove('hidden');
  const sc = p.querySelector('.detail-scroll'); if (sc) sc.scrollTop = 0;
}
$('#up-grid-back').addEventListener('click', () => $('#up-grid-page').classList.add('hidden'));
// Listen (Playlists) eines Nutzers anzeigen
// Schreibgeschützte Listen-Übersicht (fremdes Profil): zeigt die Platzierungs-Nummern,
// wenn der Ersteller sie aktiviert hat (ranked). Kein Zahnrad, kein Bearbeiten.
function openUserPlaylistView(list) {
  if (!list) return;
  $('#btn-plv-settings').style.display = 'none'; // read-only: kein Zahnrad
  $('#plv-settings').hidden = true;
  $('#plv-title').textContent = list.name || '';
  // „von …" – aus Startseite/Suche kommt man sonst nicht mehr zum Ersteller.
  const byEl = $('#plv-by');
  if (byEl) {
    const who = list.by ? (list.by.display_name || list.by.username || '') : '';
    byEl.hidden = !who;
    byEl.textContent = who ? tr('pl.byWho', { who }) : '';
    byEl.onclick = () => { $('#playlist-view-dialog').close(); if (list.by) openUserProfile(list.by); };
  }
  const descEl = $('#plv-desc');
  descEl.textContent = list.description || '';
  descEl.style.display = list.description ? '' : 'none';
  const items = list.items || [];
  const el = $('#plv-list');
  if (!items.length) { el.innerHTML = `<p class="pl-none">${tr('pl.empty')}</p>`; }
  else {
    el.innerHTML = items.map((a, i) => `
      <div class="plv-row${list.ranked ? ' ranked' : ''}">
        ${list.ranked ? `<span class="plv-rank">${i + 1}</span>` : ''}
        <button class="plv-album" data-i="${i}">
          <span class="plv-cover${a.coverUrl ? '' : ' placeholder'}">${a.coverUrl ? `<img src="${escapeHtml(a.coverUrl)}" alt="" onerror="this.parentElement.classList.add('placeholder');this.remove()" />` : ''}</span>
          <span class="plv-meta"><span class="chart-title">${escapeHtml(a.title || '')}</span><span class="chart-artist">${escapeHtml(a.artist || '')}</span></span>
        </button>
      </div>`).join('');
    el.querySelectorAll('.plv-album').forEach((b) => b.addEventListener('click', () => { $('#playlist-view-dialog').close(); openPreview(items[+b.dataset.i]); }));
  }
  $('#playlist-view-dialog').showModal();
}
function renderUserLists(lists) {
  const sec = $('#up-lists-section'); const box = $('#up-lists');
  if (!lists.length) { sec.hidden = true; box.innerHTML = ''; return; }
  sec.hidden = false;
  // Gleiche Karten-Optik wie beim eigenen Profil; Rangliste-Hinweis + Nummern in der Übersicht.
  box.innerHTML = lists.map((pl) => {
    const items = pl.items || [];
    const posters = items.slice(0, 5).map((a) => `<span class="pl-poster${a.coverUrl ? '' : ' placeholder'}">${a.coverUrl ? `<img src="${escapeHtml(a.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove()" />` : ''}</span>`).join('') || '<span class="pl-poster placeholder"></span>';
    const desc = pl.description ? `<span class="pl-card-desc">${escapeHtml(pl.description)}</span>` : '';
    const rankNote = pl.ranked ? ` · ${tr('pl.ranked')}` : '';
    return `<button class="pl-card" data-plopen="${pl.id}">
        <span class="pl-stack">${posters}</span>
        <span class="pl-card-body">
          <span class="pl-card-name">${escapeHtml(pl.name)}</span>
          <span class="pl-card-count">${tr('unit.albumsCount', { n: items.length })}${rankNote}</span>
          ${desc}
        </span>
        <span class="pl-card-chev">›</span>
      </button>`;
  }).join('');
  box.querySelectorAll('.pl-card[data-plopen]').forEach((b) => b.addEventListener('click', () => {
    const pl = lists.find((x) => x.id === b.dataset.plopen);
    if (pl) openUserPlaylistView(pl);
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
  resetUrl();
  $('#user-page').classList.add('hidden');
  $('#up-grid-page').classList.add('hidden');
  document.body.style.overflow = '';
}

// ---------- Erscheinungsbild / Theme (dark | light | system) ----------
const THEME_KEY = 'discend_theme';
function getTheme() { return localStorage.getItem(THEME_KEY) || 'dark'; }
function resolveTheme(t) {
  if (t === 'system') return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return t === 'light' ? 'light' : 'dark';
}
function applyTheme() {
  const resolved = resolveTheme(getTheme());
  document.documentElement.setAttribute('data-theme', resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'light' ? '#f4f1ec' : '#14181C');
}
function setTheme(t) {
  try { localStorage.setItem(THEME_KEY, t); } catch { /* voll */ }
  applyTheme();
  $$('.set-theme-opt').forEach((b) => b.classList.toggle('active', b.dataset.theme === t));
}
// Akzentfarbe (Rosa/Petrol/Indigo): setzt data-accent, den Rest macht CSS.
const ACCENT_KEY = 'discend_accent';
const ACCENTS = ['rose', 'petrol', 'indigo'];
function getAccent() { const a = localStorage.getItem(ACCENT_KEY); return ACCENTS.includes(a) ? a : 'rose'; }
function applyAccent() { document.documentElement.setAttribute('data-accent', getAccent()); }
function setAccent(a) {
  if (!ACCENTS.includes(a)) return;
  try { localStorage.setItem(ACCENT_KEY, a); } catch { /* voll */ }
  applyAccent();
  $$('.set-accent-opt').forEach((b) => b.classList.toggle('active', b.dataset.accent === a));
}
applyTheme();
applyAccent();
// Bei „System": auf Hell/Dunkel-Wechsel des Geräts live reagieren.
try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (getTheme() === 'system') applyTheme(); }); } catch { /* alt */ }

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
// Erscheinungsbild-Menü (slidet wie Sprache)
$('#ps-theme-open').addEventListener('click', () => $('#profile-settings-dialog').classList.add('show-theme'));
$('#ps-theme-back').addEventListener('click', () => $('#profile-settings-dialog').classList.remove('show-theme'));
$$('.set-theme-opt').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.theme)));
$$('.set-accent-opt').forEach((b) => b.addEventListener('click', () => setAccent(b.dataset.accent)));
// Bei Sprachwechsel die sichtbare Ansicht neu aufbauen (dynamische Texte)
document.addEventListener('langchange', () => { switchView(currentView); });

manualRating = createRatingInput($('#manual-rating'), 0);
$('#manual-rating-clear').addEventListener('click', () => manualRating && manualRating.setValue(0));
switchView('home');
routeFromUrl(); // geteilten Deep-Link (/u/name oder /album?…) direkt öffnen

// Sammlungs-Ansicht (große/kleine Kacheln, Liste) wiederherstellen + Umschalter verdrahten
document.querySelectorAll('#view-switch-collection .vs-btn').forEach((b) => b.addEventListener('click', () => applyCollectionView(b.dataset.view)));
applyCollectionView(getCollectionView());

// Popup-Dialoge/Menüs schließen, wenn man daneben (auf den abgedunkelten Hintergrund) tippt –
// statt immer „Abbrechen"/„Speichern" drücken zu müssen. (Klick auf den Dialog selbst = Backdrop.)
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
});

$('#btn-friends-close').addEventListener('click', () => $('#friends-dialog').close());
$('#user-back').addEventListener('click', closeUserProfile);
// 3-Punkte-Menü auf fremden Profilen (Unfollow / Teilen / Blockieren / Melden)
$('#up-menu-btn').addEventListener('click', () => {
  const u = upMenuUser; if (!u) return;
  $('#um-title').textContent = u.display_name || u.username || '';
  $('#um-unfollow').style.display = friendsFollowing.has(u.id) ? '' : 'none';
  $('#um-block-label').textContent = tr(getBlocked().has(u.id) ? 'mod.unblock' : 'mod.block');
  $('#up-menu').showModal();
});
$('#um-close').addEventListener('click', () => $('#up-menu').close());
$('#um-unfollow').addEventListener('click', async () => {
  $('#up-menu').close();
  const u = upMenuUser; if (!u || !requireAuth()) return;
  friendsFollowing.delete(u.id); await unfollow(u.id);
  if (getUser() && getUser().id !== u.id && !getBlocked().has(u.id)) { setFollowBtn($('#up-follow'), false); $('#up-follow').style.display = ''; }
  if (currentView === 'home') renderFriendsRow();
});
$('#um-share').addEventListener('click', () => {
  $('#up-menu').close();
  const u = upMenuUser; if (!u) return;
  const url = u.username ? profileUrl(u.username) : location.origin + '/';
  shareLink(`${u.display_name || u.username || tr('title.profile')} ${tr('share.suffix')}`, url);
});
$('#um-block').addEventListener('click', async () => {
  $('#up-menu').close();
  const u = upMenuUser; if (!u || !requireAuth()) return;
  if (getBlocked().has(u.id)) { await unblockUser(u.id); toast(tr('toast.unblocked')); }
  else { await blockUser(u.id); toast(tr('toast.blocked')); }
  if (currentView === 'home') renderHome();
  openUserProfile(u);
});
$('#um-report').addEventListener('click', async () => {
  $('#up-menu').close();
  const u = upMenuUser; if (!u || !requireAuth()) return;
  if (!confirm(tr('mod.reportUserConfirm'))) return;
  await reportTarget('user', u.id, '');
  toast(tr('toast.reported'));
});
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
