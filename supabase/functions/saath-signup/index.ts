// saath-signup — creates a Bengu account without the shared project's
// confirmation e-mail (that template is branded for MacroNations courses).
// Deploy with verify_jwt = false.  Body: { email, password, full_name, language }
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    const { email, password, full_name, language } = await req.json();
    const e = String(email ?? "").trim().toLowerCase();
    const name = String(full_name ?? "").trim().slice(0, 80);
    const lang = String(language ?? "en").slice(0, 5);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return json({ error: "invalid_email" }, 400);
    if (String(password ?? "").length < 8) return json({ error: "weak_password" }, 400);
    if (!name) return json({ error: "name_required" }, 400);

    const { data, error } = await admin.auth.admin.createUser({
      email: e,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, language: lang, app: "saath" },
    });
    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        return json({ error: "already_registered" }, 409);
      }
      return json({ error: "signup_failed", detail: error.message }, 400);
    }
    await admin.from("saath_profiles").upsert({ id: data.user!.id, full_name: name, email: e, language: lang });
    return json({ ok: true });
  } catch (err) {
    return json({ error: "bad_request", detail: String(err) }, 400);
  }
});
