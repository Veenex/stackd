// Cloudflare Pages Function: dynamische Teilen-Vorschau (Open-Graph-Tags) fuer /album.
// Laeuft nur serverseitig am Edge. Normale Nutzer bekommen dieselbe index.html und
// die App startet normal; Vorschau-Bots (WhatsApp, iMessage, Twitter/X, Facebook,
// Slack ...) lesen die eingefuegten OG-/Twitter-Tags fuer eine huebsche Karte.

const esc = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function ogTags({ title, desc, image, url }) {
  let t = '\n<meta property="og:type" content="website">'
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

// Fuegt die Tags ans Ende von <head> ein (HTMLRewriter ist am Edge global verfuegbar).
class HeadInjector {
  constructor(html) { this.html = html; }
  element(el) { el.append(this.html, { html: true }); }
}

// Album-Cover serverseitig ueber iTunes holen (kein CORS-Problem, da nicht im Browser).
async function albumCover(artist, title) {
  if (!title) return '';
  try {
    const term = encodeURIComponent(`${artist} ${title}`.trim());
    const r = await fetch(`https://itunes.apple.com/search?term=${term}&entity=album&limit=1`,
      { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!r.ok) return '';
    const j = await r.json();
    const it = j.results && j.results[0];
    if (it && it.artworkUrl100) return it.artworkUrl100.replace('100x100', '600x600');
  } catch { /* ignorieren */ }
  return '';
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  // Basis-HTML (index.html) direkt als statisches Asset holen.
  const response = await context.env.ASSETS.fetch(new URL('/index.html', url).toString());
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return response;

  const a = url.searchParams.get('a') || '';
  const t = url.searchParams.get('t') || '';
  const y = url.searchParams.get('y') || '';
  const title = [a, t].filter(Boolean).join(' – ') || 'Discend';
  const desc = t
    ? `${t}${a ? ' – ' + a : ''}${y ? ' (' + y + ')' : ''} · on Discend`
    : 'Discover music on Discend';
  const image = await albumCover(a, t);

  return new HTMLRewriter()
    .on('head', new HeadInjector(ogTags({ title, desc, image, url: url.toString() })))
    .transform(response);
}
