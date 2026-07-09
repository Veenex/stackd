// ui.js – reine Darstellungs-Helfer OHNE Abhängigkeiten: DOM-Kürzel, HTML-Escaping,
// Skeleton-Platzhalter, Leerzustand-Illustrationen, Icons, kleine Animationen, Formatierung.
// Bewusst import-frei, damit es ein sauberes Basis-Modul bleibt, das andere Module nutzen können.

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Skeleton-Loader (Platzhalter beim Laden) ----------
const rep = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join('');
export const skelCharts = (n = 6) => rep(n, () => '<div class="skel-chart"><span class="skel skel-cover"></span><span class="skel skel-line sk-80"></span><span class="skel skel-line sk-60"></span></div>');
export const skelRevs = (n = 4) => rep(n, () => '<div class="skel-rev"><span class="skel skel-cover"></span><div class="skel-body"><span class="skel skel-line sk-80"></span><span class="skel skel-line sk-40"></span><span class="skel skel-line"></span></div></div>');
export const skelLists = (n = 4) => rep(n, () => '<div class="skel-listrow"><span class="skel skel-cover"></span><div class="skel-body"><span class="skel skel-line sk-60"></span><span class="skel skel-line sk-40"></span></div></div>');
export const skelGrid = (n = 12) => `<div class="browse-grid">${rep(n, () => '<span class="skel skel-grid-cell"></span>')}</div>`;
export const skelSearchResults = (n = 6) => `<ul class="search-results">${rep(n, () => '<li class="skel-sr"><span class="skel skel-cover"></span><div class="skel-body"><span class="skel skel-line sk-80"></span><span class="skel skel-line sk-40"></span></div></li>')}</ul>`;

// ---------- Einheitlicher Empty State + Illustrationen ----------
export const ES_DISC = '<span class="es-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.4"/></svg></span>';
// Freundliche Illustrationen für leere Zustände (größer, mit Rose-Akzent .acc).
const esIllus = (inner) => `<span class="es-ico es-illus"><svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg></span>`;
export const ES_CRATE = esIllus('<rect x="12" y="27" width="40" height="27" rx="2.5"/><path d="M23 27v27M32 27v27M41 27v27"/><circle class="acc" cx="41" cy="17" r="9"/><circle class="acc" cx="41" cy="17" r="2.2"/>');
export const ES_HEART = esIllus('<circle cx="27" cy="35" r="15"/><circle cx="27" cy="35" r="3"/><path class="acc" d="M47 13.5c-1.7-2.3-5.4-1.6-5.4 1.5 0 2.4 3.1 4 5.4 6.2 2.3-2.2 5.4-3.8 5.4-6.2 0-3.1-3.7-3.8-5.4-1.5z"/>');
export const ES_LIST = esIllus('<path d="M24 22h26M24 32h26M24 42h18"/><circle class="acc" cx="16" cy="22" r="2.6"/><circle class="acc" cx="16" cy="32" r="2.6"/><circle class="acc" cx="16" cy="42" r="2.6"/>');
export const ES_PEN = esIllus('<path d="M14 18h36a4 4 0 0 1 4 4v15a4 4 0 0 1-4 4H30l-8 7v-7h-8a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4z"/><path class="acc" d="M32 23l2.2 4.6 5 .7-3.6 3.6.85 5-4.45-2.4-4.45 2.4.85-5-3.6-3.6 5-.7z"/>');
export const ES_BELL = esIllus('<path d="M32 13a10 10 0 0 1 10 10v7l3 5H19l3-5v-7a10 10 0 0 1 10-10z"/><path d="M32 11v2"/><path class="acc" d="M27.5 45a4.5 4.5 0 0 0 9 0"/>');
export function emptyState({ icon = ES_DISC, title = '', text = '', ctaLabel = '', ctaAttr = '' } = {}) {
  return `<div class="empty-state">${icon}`
    + (title ? `<p class="es-title">${escapeHtml(title)}</p>` : '')
    + (text ? `<p class="es-text">${escapeHtml(text)}</p>` : '')
    + (ctaLabel ? `<button class="btn primary es-cta" ${ctaAttr}>${escapeHtml(ctaLabel)}</button>` : '')
    + '</div>';
}

// ---------- Kleine Animationen ----------
// „Pop"-Animation auf dem Herz-Icon, wenn ein Like aktiviert wird.
export function popHeart(scopeEl) {
  const ic = scopeEl && scopeEl.querySelector('svg');
  if (!ic) return;
  ic.classList.remove('heart-pop'); void ic.offsetWidth; // Reflow → Animation neu starten
  ic.classList.add('heart-pop');
  ic.addEventListener('animationend', () => ic.classList.remove('heart-pop'), { once: true });
}
// Kurzer Ein-Übergang beim Inhalts-Wechsel (z. B. Home-Tabs); Animation neu starten.
export function animateSwap(el) {
  if (!el) return;
  el.classList.remove('swap-in'); void el.offsetWidth; // Reflow erzwingen
  el.classList.add('swap-in');
}

// ---------- Bewertung mit Musiknoten (0,5–5) ----------
export const NOTE_PATH = 'M19.952 1.651a.75.75 0 0 1 .298.599V16.303a3 3 0 0 1-2.176 2.884l-1.32.377a2.553 2.553 0 1 1-1.403-4.909l2.311-.66a1.5 1.5 0 0 0 1.088-1.442V6.994l-9 2.572v9.737a3 3 0 0 1-2.176 2.884l-1.32.377a2.553 2.553 0 1 1-1.402-4.909l2.31-.66a1.5 1.5 0 0 0 1.088-1.442V5.25a.75.75 0 0 1 .544-.721l10.5-3a.75.75 0 0 1 .658.122Z';
export const noteSvg = () => `<svg viewBox="0 0 24 24" fill="currentColor"><path d="${NOTE_PATH}"/></svg>`;

const HEART_PATH = 'M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 0 1-.383-.218 25.18 25.18 0 0 1-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0 1 12 5.052 5.5 5.5 0 0 1 16.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 0 1-4.244 3.17 15.247 15.247 0 0 1-.383.219l-.022.012-.007.004-.003.001a.752.752 0 0 1-.704 0l-.003-.001Z';
export const heartSvg = () => `<svg class="heart-ico" viewBox="0 0 24 24" fill="currentColor"><path d="${HEART_PATH}"/></svg>`;

// Statische Anzeige (Liste): gefüllte Noten je nach Bewertung
export function ratingDisplayHtml(rating) {
  const r = Number(rating) || 0;
  if (r <= 0) return '';
  let slots = '';
  for (let i = 1; i <= 5; i++) {
    const frac = Math.max(0, Math.min(1, r - (i - 1)));
    slots += `<span class="note-slot"><span class="note-empty">${noteSvg()}</span><span class="note-fill" style="width:${frac * 100}%">${noteSvg()}</span></span>`;
  }
  return `<div class="rating-display" title="${r} von 5">${slots}</div>`;
}

// ---------- Formatierung ----------
export function fmtEuro(n) {
  return (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}
