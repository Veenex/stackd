// service-worker.js – einfacher App-Shell-Cache, damit die App offline startet.
// Daten (Sammlung/Wishlist) liegen in localStorage und sind ohnehin offline.

const CACHE = 'platten-v200';
const IMG_CACHE = 'platten-img-v1'; // Cover/Bilder separat, cache-first
const IMG_MAX = 400;                // max. gecachte Bilder (älteste fliegen raus)
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/ui.js',
  './js/util.js',
  './js/store.js',
  './js/api.js',
  './js/scanner.js',
  './js/supabase.js',
  './js/auth.js',
  './js/i18n.js',
  './js/vendor/supabase.umd.js',
  './js/vendor/html5-qrcode.min.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // Kein automatisches skipWaiting mehr: Die neue Version wartet, bis der Nutzer
  // im „Update verfügbar"-Hinweis auf „Neu laden" tippt (postMessage SKIP_WAITING).
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

// Vom Update-Hinweis ausgelöst: wartende Version sofort aktivieren.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Echte Push-Nachricht empfangen und anzeigen.
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: (e.data && e.data.text()) || '' }; }
  const title = data.title || 'Discend';
  const options = {
    body: data.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: data.url || './' },
    tag: 'discend',
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Antippen: offenes App-Fenster in den Vordergrund holen oder neu öffnen.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { c.focus(); return; } }
    if (clients.openWindow) await clients.openWindow(target);
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== IMG_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Cover/Bild erkennen (per <img> oder bekannte Bild-Hosts/-Endungen).
function isImageRequest(req, url) {
  if (req.destination === 'image') return true;
  return /\.(png|jpe?g|webp|gif|avif|svg)(\?|$)/i.test(url.pathname)
    || /mzstatic\.com|discogs\.com|coverartarchive\.org|s2\/favicons/.test(url.hostname + url.pathname);
}

// Cache-first für Bilder: einmal geladen, danach aus dem Cache (schnell, spart Daten).
async function cacheFirstImage(req) {
  const cache = await caches.open(IMG_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req, res.clone()).then(() => trimImageCache()).catch(() => {});
    }
    return res;
  } catch {
    return hit || Response.error();
  }
}

// Bild-Cache begrenzen (FIFO: älteste Einträge zuerst entfernen).
async function trimImageCache() {
  try {
    const cache = await caches.open(IMG_CACHE);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - IMG_MAX; i++) await cache.delete(keys[i]);
  } catch { /* ignorieren */ }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return; // nur GET behandeln

  // Cover/Bilder: cache-first mit Größenlimit
  if (isImageRequest(e.request, url)) {
    e.respondWith(cacheFirstImage(e.request));
    return;
  }

  // API-/Datenaufrufe (MusicBrainz/Discogs/Cover-Archiv) immer aus dem Netz holen.
  const isApi = /musicbrainz\.org|discogs\.com|coverartarchive\.org/.test(url.hostname);
  if (isApi) {
    return; // Standard-Netzwerkverhalten
  }
  // App-Shell: network-first – immer die neueste Version laden, wenn online;
  // nur offline aus dem Cache. So gibt es kein "alter Code"-Problem mehr.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((cached) => cached || caches.match('./index.html'))
      )
  );
});
