// supabase.js – verbindet Stackd mit dem Supabase-Backend.
// URL + Publishable Key sind ausdrücklich für den Client gedacht (öffentlich);
// der Datenschutz läuft über Row-Level-Security in der Datenbank.
// Der Client wird LAZY geladen (dynamischer Import), damit ein Ausfall des
// CDN nicht die ganze App lahmlegt – ohne Login funktioniert Stöbern weiter.

export const SUPABASE_URL = 'https://xjrpojypkbfbsowvjmbj.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_0A1YsQoTYkVyXXnSAHR0oQ_yNdq_KXg';

let _client = null;
let _loading = null;

export async function getSupabase() {
  if (_client) return _client;
  if (!_loading) {
    _loading = import('https://esm.sh/@supabase/supabase-js@2').then(({ createClient }) => {
      _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      return _client;
    });
  }
  return _loading;
}
