// Supabase Edge Function: discogs
// Proxy für die Discogs-API. Der Token liegt als Secret DISCOGS_TOKEN auf dem
// Server – niemals im Browser. Erlaubt nur Lese-Aktionen (search/release/versions),
// damit es kein offener Proxy ist. CORS offen, damit die PWA (auch Gäste) zugreifen kann.

const DISCOGS = "https://api.discogs.com";
const TOKEN = Deno.env.get("DISCOGS_TOKEN") ?? "";
const UA = "Stackd/1.0 +https://veenex.github.io/stackd";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const p = new URL(req.url).searchParams;
    const action = p.get("action") || "search";
    let target: URL;

    if (action === "release") {
      target = new URL(`${DISCOGS}/releases/${encodeURIComponent(p.get("id") || "")}`);
    } else if (action === "price") {
      // Marktwert-Vorschläge pro Zustand (Poor … Mint)
      target = new URL(`${DISCOGS}/marketplace/price_suggestions/${encodeURIComponent(p.get("id") || "")}`);
    } else if (action === "versions") {
      target = new URL(`${DISCOGS}/masters/${encodeURIComponent(p.get("id") || "")}/versions`);
      for (const k of ["per_page", "page"]) {
        const v = p.get(k);
        if (v) target.searchParams.set(k, v);
      }
    } else if (action === "collection") {
      const user = encodeURIComponent(p.get("username") || "");
      target = new URL(`${DISCOGS}/users/${user}/collection/folders/0/releases`);
      for (const k of ["per_page", "page", "sort", "sort_order"]) {
        const v = p.get(k);
        if (v) target.searchParams.set(k, v);
      }
    } else {
      // search
      target = new URL(`${DISCOGS}/database/search`);
      target.searchParams.set("type", "release");
      const pass = ["q", "artist", "title", "release_title", "barcode", "genre",
        "style", "year", "country", "format", "sort", "sort_order", "per_page", "page", "master_id"];
      for (const k of pass) {
        const v = p.get(k);
        if (v != null && v !== "") target.searchParams.set(k, v);
      }
    }

    if (TOKEN) target.searchParams.set("token", TOKEN);

    const res = await fetch(target.toString(), {
      headers: { "User-Agent": UA, "Accept": "application/json" },
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
