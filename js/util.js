// util.js – reine, zustandslose Hilfsfunktionen OHNE Abhängigkeiten: Sortier-Buchstaben (A–Z),
// Dubletten-Erkennung, Wert-Verlaufs-Diagramm (SVG), Wochen-Rotation, Mischen.
// Bewusst import-frei, damit es ein sauberes Basis-Modul bleibt (wie ui.js).

// Künstlername in Wörter zerlegen, führende Artikel (The/Die/Der/…) ignorieren.
function azWords(artist) {
  const a = String(artist || '').trim().replace(/^(the|die|der|das|los|las|les)\s+/i, '');
  return a.split(/\s+/).filter(Boolean);
}
// Sprung-Buchstabe einer Kachel je Sortiermodus (für die A–Z-Leiste).
export function sortLetter(item, mode) {
  let s = '';
  if (mode === 'title') s = item.title || '';
  else if (mode === 'lastname') { const p = azWords(item.artist); s = p.length ? p[p.length - 1] : ''; }
  else { const p = azWords(item.artist); s = p[0] || ''; } // artist / firstname
  const c = s.trim().charAt(0).toUpperCase();
  return (c >= 'A' && c <= 'Z') ? c : '#';
}
export function letterRank(c) { return (c >= 'A' && c <= 'Z') ? (c.charCodeAt(0) - 64) : 0; }

// Doppelte Alben aus einer Ergebnisliste filtern (nach masterId bzw. Künstler|Titel).
export function dedupeAlbums(list) {
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
// Eindeutiger Schlüssel eines Sammlungs-Items (Dubletten-Erkennung).
export function dedupeKey(it) {
  if (it.masterId) return 'm' + it.masterId;
  if (it.sourceId) return 's' + it.sourceId;
  return (String(it.artist) + '|' + String(it.title)).toLowerCase().trim();
}

// Mini-Liniendiagramm (SVG) für den Sammlungswert-Verlauf.
export function valueHistorySvg(hist) {
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

// Wochen-Index (für rotierende Startlisten) + Fenster-Ausschnitt.
export function weekIndex() { return Math.floor(Date.now() / (7 * 24 * 3600 * 1000)); }
export function rotateWindow(arr, size, seed) {
  if (arr.length <= size) return arr.slice(0, size);
  const span = arr.length - size;               // mögliche Startpositionen 0..span
  const off = 1 + (Math.abs(seed * 13) % span); // 1..span: nie exakt die Top-Liste, gute Streuung pro Woche
  return arr.slice(off, off + size);
}
// Array mischen (Fisher–Yates).
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
