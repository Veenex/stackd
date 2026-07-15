// Cloudflare Pages Function: dynamische Teilen-Vorschau (Open-Graph-Tags) fuer /u/<username>.
// Serverseitig am Edge. Normale Nutzer bekommen dieselbe index.html (App startet normal);
// Vorschau-Bots lesen Name, Bio und Profilbild fuer eine huebsche Teilen-Karte.

// Oeffentliche, client-sichere Supabase-Zugangsdaten (identisch mit dem Frontend).
const SUPABASE_URL = 'https://xjrpojypkbfbsowvjmbj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_0A1YsQoTYkVyXXnSAHR0oQ_yNdq_KXg';

const esc = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function ogTags({ title, desc, image, url }) {
  let t = '\n<meta property="og:type" content="profile">'
    + '\n<meta property="og:site_name" content="Discend">'
    + `\n<meta property="og:title" content="${esc(title)}">`
    + `\n<meta property="og:description" content="${esc(desc)}">`
    + `\n<meta property="og:url" content="${esc(url)}">`
    + `\n<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`
    + `\n<meta name="twitter:title" content="${esc(title)}">`
    + `\n<meta name="twitter:description" content="${esc(desc)}">`;
  if (image && /^https?:\/\//.test(image)) {
    t += `\n<meta property="og:image" content="${esc(image)}">`
      + `\n<meta name="twitter:image" content="${esc(image)}">`;
  }
  return t;
}

class HeadInjector {
  constructor(html) { this.html = html; }
  element(el) { el.append(this.html, { html: true }); }
}

// Profil per Username (case-insensitive) ueber die oeffentliche Supabase-REST-API.
async function fetchProfile(username) {
  if (!username) return null;
  try {
    const u = encodeURIComponent(username);
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?username=ilike.${u}&select=username,display_name,bio,avatar_url&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }, cf: { cacheTtl: 300 } });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) && j[0] ? j[0] : null;
  } catch { return null; }
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const response = await context.env.ASSETS.fetch(new URL('/index.html', url).toString());
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return response;

  const username = decodeURIComponent(context.params.username || '');
  let title = username ? '@' + username : 'Discend';
  let desc = 'Music collection on Discend';
  let image = '';
  const p = await fetchProfile(username);
  if (p) {
    title = p.display_name || p.username || title;
    desc = (p.bio && p.bio.trim()) ? p.bio.trim() : `${title} · music collection on Discend`;
    if (p.avatar_url) image = p.avatar_url; // nur http(s) wird als og:image gesetzt (siehe ogTags)
  }
  // Geteilter Wunschzettel-Link (/u/name?list=wishlist): Vorschau auf die Wunschliste muenzen.
  if (url.searchParams.get('list') === 'wishlist') {
    desc = `${title} · wishlist on Discend`;
    title = `${title} · Wishlist`;
  }

  return new HTMLRewriter()
    .on('head', new HeadInjector(ogTags({ title, desc, image, url: url.toString() })))
    .transform(response);
}
