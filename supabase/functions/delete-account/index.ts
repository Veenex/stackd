// Supabase Edge Function: delete-account
// Löscht das eigene Konto (Auth-User) + per FK-Cascade alle zugehörigen Daten.
// Verifiziert den mitgesendeten User-JWT (Authorization: Bearer <access_token>)
// und löscht dann mit dem Service-Role-Key. CORS offen für die PWA.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "no token" }, 401);
    const admin = createClient(url, service);
    const { data, error: uerr } = await admin.auth.getUser(token);
    if (uerr || !data?.user) return json({ error: "unauthorized" }, 401);
    const { error } = await admin.auth.admin.deleteUser(data.user.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
