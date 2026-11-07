// saath-scan (v2 pipeline) — reads a bill photo/PDF and returns bills for the app to pre-fill.
// Haiku reads first; Sonnet re-reads only when an amount is not safe to trust. The read is cached so
// Bill Check reuses it instead of reading the file again. Spend is capped per circle and per day.
// Deploy with verify_jwt = true. Body: { circle_id, path, language?, pages? }
// Secrets: ANTHROPIC_API_KEY. Optional: SAATH_FAST_MODEL, SAATH_STRONG_MODEL. Settings: table saath_ai_config.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cachedRead, prepareFile, readBill, storeRead } from "../_shared/bill_read.ts";
import { afterCalls, guard, loadConfig } from "../_shared/guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const FN = Deno.env.get("SAATH_FN_NAME") ?? "saath-scan";

const ERR_MSG: Record<string, string> = {
  file_too_large: "This file is too large to read. Please upload a smaller photo or split the PDF.",
  too_many_pages: "This PDF has too many pages to read at once. Please split it or choose the pages with the bill.",
  unsupported_format: "This photo format (HEIC) can't be read. Please choose the photo again so it's sent as JPEG.",
};

async function sha256(b: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", b as unknown as ArrayBuffer))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function mimeOf(blob: Blob, path: string) {
  const p = path.toLowerCase();
  if (blob.type && blob.type !== "application/octet-stream") return blob.type;
  return p.endsWith(".pdf") ? "application/pdf" : p.endsWith(".png") ? "image/png" : p.endsWith(".webp") ? "image/webp" : "image/jpeg";
}
// what the app's scan screens expect
const forApp = (d: any) => ({
  doc_type: d.doc_type, title: d.title, vendor: d.vendor, bill_number: d.bill_number, date: d.date, amount: d.amount,
  currency: d.currency, category: d.category, patient_name: d.patient_name, pages: d.pages ?? [], handwritten: !!d.handwritten,
  confidence: d.confidence, note: d.note,
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "scan_not_configured" }, 503);
    const body = await req.json().catch(() => ({}));
    const cfg = await loadConfig(admin);
    const pages: number[] = Array.isArray(body.pages) ? body.pages.map(Number).filter((x: number) => x > 0).slice(0, 60) : [];

    // owner evaluation: stored file or inline file; optional forced model; nothing stored but the usage log
    const testKey = req.headers.get("x-saath-cron");
    if (testKey && (body.test_path || body.test_b64)) {
      const { data: ok } = await admin.rpc("saath_check_cron", { p_secret: testKey });
      if (ok !== true) return json({ error: "unauthorized" }, 401);
      let bytes: Uint8Array, mime: string;
      if (body.test_path) {
        const { data: blob, error } = await admin.storage.from("saath-receipts").download(String(body.test_path));
        if (error || !blob) return json({ error: "file_not_found" }, 404);
        bytes = new Uint8Array(await blob.arrayBuffer()); mime = mimeOf(blob, String(body.test_path));
      } else { bytes = Uint8Array.from(atob(String(body.test_b64)), (c) => c.charCodeAt(0)); mime = String(body.test_mime || "image/jpeg"); }
      const t0 = Date.now();
      const tcfg = { ...cfg, ...(body.test_cfg ?? {}) };
      const prep = await prepareFile(bytes, mime, tcfg, pages);
      const tPrep = Date.now() - t0;
      const ropts = { purpose: "scan" as const, currency: "INR", lang: String(body.language ?? "en").slice(0, 2) };
      // test_models: run several forced models on the same prepared file (one download / one resize)
      const models: (string | undefined)[] = Array.isArray(body.test_models) ? body.test_models : [body.test_model || undefined];
      const runs = [];
      for (const m of models) {
        const t1 = Date.now();
        // "model@effort" sets that call type's effort for this run only, e.g. "verify@low", "claude-haiku-5-5@medium"
        const [mm, eff] = String(m ?? "").split("@");
        const rcfg = eff ? { ...tcfg, [mm === "verify" ? "effort_verify" : mm.includes("haiku") ? "effort_haiku" : "effort_sonnet"]: eff } : tcfg;
        const res = await readBill({ admin, fn: `${FN}:eval${eff ? "@" + eff : ""}` }, key, prep, ropts, rcfg, mm || undefined);
        runs.push({ requested: m ?? "pipeline", ms: Date.now() - t1, model: res.model, verify: res.verify ?? null, escalated: res.escalated, reasons: res.reasons,
          haiku: res.haiku ?? null, documents: res.documents, overall_note: res.overall_note });
      }
      const first = runs[0];
      return json({ ok: true, ...first, ms: Date.now() - t0, prep_ms: tPrep, sent_bytes: prep.bytesSent, resized: prep.resized, prep_note: prep.note, runs });
    }

    const auth = req.headers.get("Authorization") ?? "";
    const { data: u } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { circle_id, path, language } = body;
    if (!circle_id || !path || !String(path).startsWith(`${circle_id}/`)) return json({ error: "bad_request" }, 400);
    const user = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: member } = await user.rpc("saath_is_member", { p_circle: circle_id });
    if (!member) return json({ error: "forbidden" }, 403);

    const g = await guard(admin, cfg, { circleId: circle_id, userId: u.user.id, kind: "scan" });
    if (!g.ok) return json({ error: g.error, message: g.message, ai: { allowance: g.allowance, access: g.ai ?? null } }, g.status ?? 429);

    const { data: circle } = await admin.from("saath_circles").select("currency").eq("id", circle_id).single();
    const currency = circle?.currency ?? "INR";
    const lang = String(language ?? "en").slice(0, 2);

    // same file + pages already read (e.g. scanned twice) → reuse, no API call
    const hit = await cachedRead(admin, path, pages);
    let res: any = hit?.result?.version >= 2 && (hit.path === `${path}#${pages.join(",")}`) ? hit.result : null;
    if (!res) {
      const { data: blob, error: dlErr } = await admin.storage.from("saath-receipts").download(path);
      if (dlErr || !blob) return json({ error: "file_not_found" }, 404);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let prep;
      try { prep = await prepareFile(bytes, mimeOf(blob, path), cfg, pages); }
      catch (e) {
        const code = String((e as Error).message);
        return json({ error: code, message: ERR_MSG[code] ?? code }, code === "unsupported_format" ? 415 : 413);
      }
      try {
        res = await readBill({ admin, fn: FN, userId: u.user.id, circleId: circle_id }, key, prep, { purpose: "scan", currency, lang }, cfg);
      } catch (e) {
        await admin.from("saath_scans").insert({ user_id: u.user.id, circle_id, path, model: "error", status: "failed", detail: String(e).slice(0, 500) });
        return json({ error: "scan_failed", detail: String(e).slice(0, 300) }, 502);
      }
      await storeRead(admin, path, pages, circle_id, res, await sha256(bytes));
      if (g.ai?.reason === "trial") await admin.rpc("saath_ai_trial_use", { p_circle: circle_id });   // one free-trial read used
      afterCalls(admin, cfg);
    }
    const documents = (res.documents ?? []).map(forApp);
    await admin.from("saath_scans").insert({
      user_id: u.user.id, circle_id, path, model: res.model, status: "ok",
      detail: res.escalated ? `escalated: ${res.reasons.join(", ")}` : (hit ? "cached" : null),
      result: { documents, overall_note: res.overall_note },
    });
    const a = (await admin.rpc("saath_ai_allowance", { p_circle: circle_id })).data;
    return json({ ok: true, documents, overall_note: res.overall_note,
      ai: { model: res.model, escalated: res.escalated, reasons: res.reasons, allowance: a,
        access: g.ai ? { ...g.ai, trial_left: g.ai.reason === "trial" && !hit ? Math.max(0, g.ai.trial_left - 1) : g.ai.trial_left } : null } });
  } catch (err) {
    return json({ error: "scan_failed", detail: String(err).slice(0, 300) }, 500);
  }
});
