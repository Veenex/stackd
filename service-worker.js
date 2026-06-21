// service-worker.js – einfacher App-Shell-Cache, damit die App offline startet.
// Daten (Sammlung/Wishlist) liegen in localStorage und sind ohnehin offline.

const CACHE = 'platten-v128';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
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
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API-Aufrufe (MusicBrainz/Discogs/Cover) immer aus dem Netz holen.
  const isApi = /musicbrainz\.org|discogs\.com|coverartarchive\.org/.test(url.hostname);
  if (isApi || e.request.method !== 'GET') {
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
