// saath-account — "Delete my account" (required by the App Store and Google Play).
// Deploy with verify_jwt = true.  Body: { action: "delete" }
// Keeps the family's shared ledger intact: the person's member rows are
// anonymised ("Former member"), not removed, so totals stay correct for others.
// The login itself is removed only if it was created by Saath — this project's
// auth is shared with MacroNations courses, and a course login must survive.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const { data: u, error } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (error || !u?.user) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.action !== "delete") return json({ error: "bad_action" }, 400);
    const uid = u.user.id;

    // circles where they are the only organiser get handed to the longest-standing member
    const { data: mine } = await admin.from("saath_members").select("id, circle_id, role").eq("user_id", uid);
    for (const m of mine ?? []) {
      if (m.role === "admin") {
        const { data: others } = await admin.from("saath_members").select("id, role, user_id")
          .eq("circle_id", m.circle_id).eq("status", "active").neq("id", m.id).order("created_at");
        if (!others?.some((o) => o.user_id)) {
          // nobody else on the app can reach this circle — remove it entirely
          await admin.from("saath_circles").delete().eq("id", m.circle_id);
          continue;
        }
        if (!others.some((o) => o.role === "admin")) {
          const heir = others.find((o) => o.user_id) ?? others[0];
          await admin.from("saath_members").update({ role: "admin" }).eq("id", heir.id);
        }
      }
      await admin.from("saath_members").update({
        user_id: null, display_name: "Former member", email: null, phone: null, relation: null,
        status: "left", role: "member", notify_email: false, notify_whatsapp: false,
      }).eq("id", m.id);
    }
    await admin.from("saath_profiles").delete().eq("id", uid);
    const createdBySaath = u.user.user_metadata?.app === "saath";
    if (createdBySaath) {
      // soft delete: the login is disabled and its e-mail scrubbed, while rows the
      // person authored (expenses, receipts) keep a valid created_by reference
      const { error: de } = await admin.auth.admin.deleteUser(uid, true);
      if (de) return json({ ok: true, login_removed: false, detail: de.message });
    }
    return json({ ok: true, login_removed: createdBySaath });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
