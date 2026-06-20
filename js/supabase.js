// supabase.js – verbindet Discend mit dem Supabase-Backend.
// URL + Publishable Key sind ausdrücklich für den Client gedacht (öffentlich);
// der Datenschutz läuft über Row-Level-Security in der Datenbank.
// Die Supabase-Bibliothek liegt LOKAL gebündelt (js/vendor/supabase.umd.js) und
// wird LAZY per <script> nachgeladen – kein CDN, kein Cold-Import-Hänger, offlinefähig.
// Ohne Login funktioniert Stöbern weiter.

export const SUPABASE_URL = 'https://xjrpojypkbfbsowvjmbj.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_0A1YsQoTYkVyXXnSAHR0oQ_yNdq_KXg';

let _client = null;
let _loading = null;

// Lädt die lokale UMD-Bibliothek (globale `supabase`) einmalig nach.
function loadSupabaseLib() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase.createClient);
  return new Promise((resolve, reject) => {
    const done = () => (window.supabase && window.supabase.createClient)
      ? resolve(window.supabase.createClient)
      : reject(new Error('Supabase-Bibliothek nicht verfügbar'));
    const existing = document.getElementById('supabase-lib');
    if (existing) {
      existing.addEventListener('load', done, { once: true });
      existing.addEventListener('error', () => reject(new Error('Supabase konnte nicht geladen werden')), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.id = 'supabase-lib';
    s.src = 'js/vendor/supabase.umd.js';
    s.onload = done;
    s.onerror = () => reject(new Error('Supabase konnte nicht geladen werden'));
    document.head.appendChild(s);
  });
}

export async function getSupabase() {
  if (_client) return _client;
  if (!_loading) {
    _loading = loadSupabaseLib().then((createClient) => {
      _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      return _client;
    }).catch((e) => { _loading = null; throw e; }); // bei Fehler erneuter Versuch möglich
  }
  return _loading;
}
