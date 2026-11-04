// saath-scan — reads a bill, receipt or a bundle of bills (photo, scan or PDF,
// printed or handwritten, any language) with Claude and returns structured bills
// the app pre-fills for the user to check.
// Deploy with verify_jwt = true.
// Body: { circle_id, path, language? }   (path = file already uploaded to saath-receipts)
// Secrets: ANTHROPIC_API_KEY (required), SAATH_SCAN_MODEL (optional, default claude-sonnet-5-5)
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const CATEGORIES = ["hospital", "doctor", "medicine", "tests", "nursing", "therapy", "equipment", "travel",
  "food", "rent", "utilities", "insurance", "fees", "event", "other"];
const LANG_NAME: Record<string, string> = { en: "English", hi: "Hindi", bn: "Bengali", es: "Spanish", fr: "French", pt: "Portuguese" };
const MAX_BYTES = 30 * 1024 * 1024;
const DAILY_LIMIT = 80;

const TOOL = {
  name: "record_bills",
  description: "Record every distinct bill, invoice, cash memo or receipt found in the document.",
  input_schema: {
    type: "object",
    properties: {
      documents: {
        type: "array",
        description: "One entry per distinct document found, in page order.",
        items: {
          type: "object",
          properties: {
            doc_type: {
              type: "string",
              enum: ["bill", "payment_receipt", "settlement_summary", "deposit_receipt", "report", "prescription", "other"],
              description: "bill = something that charges money (invoice, cash memo, retail invoice, money receipt for a service). payment_receipt / deposit_receipt = proof money was paid against a bill (card slip, UPI slip, advance/security deposit). settlement_summary = a statement that totals other bills. report = lab/medical report with no charge. prescription = doctor's note.",
            },
            title: { type: "string", description: "Short description, e.g. 'ICU charges 24–28 Oct', 'Pharmacy cash memo', 'HRCT Thorax scan'." },
            vendor: { type: "string", description: "Business that issued it, e.g. hospital, pharmacy, lab." },
            bill_number: { type: "string" },
            date: { type: "string", description: "Bill date as YYYY-MM-DD. Indian/European bills use day/month order. Empty if not shown." },
            amount: { type: "number", description: "The final amount payable/paid for this document: grand total / net payable after discounts and taxes. Not MRP, not subtotal. 0 if none." },
            currency: { type: "string", description: "ISO 4217 code, e.g. INR, USD." },
            category: { type: "string", enum: CATEGORIES },
            patient_name: { type: "string", description: "Patient/customer name if shown." },
            pages: { type: "array", items: { type: "integer" }, description: "1-based page numbers this document occupies." },
            handwritten: { type: "boolean" },
            confidence: { type: "string", enum: ["high", "medium", "low"], description: "Confidence in the amount." },
            note: { type: "string", description: "Anything the user should check, e.g. unclear digits, a sales return, a name that differs." },
          },
          required: ["doc_type", "title", "amount", "currency", "category", "pages", "confidence"],
        },
      },
      overall_note: { type: "string", description: "e.g. how bills relate (which totals include which), possible double counting." },
    },
    required: ["documents"],
  },
};

function prompt(circleCurrency: string, lang: string) {
  return `You are reading financial documents a family uploaded to a shared-expenses app for someone's medical care, elder care or similar.
The files may be photos, scans or PDFs; printed or handwritten; in any language or script (Hindi, Bengali, Tamil, English, etc.), possibly rotated, faded or stamped.

Find EVERY distinct document and call the record_bills tool exactly once with all of them. Always call the tool; do not answer in plain text.
- A multi-page PDF may contain many separate bills (e.g. 20 pharmacy cash memos) — list each separately with its page numbers.
- For each, the amount is the final payable/paid total ("Grand total", "Net to be paid", "Net amount", "कुल", "মোট", "Total"), after discount, including tax. Read handwritten digits carefully; if two readings are plausible, choose the most likely and say so in note.
- Classify proof-of-payment slips (card/UPI receipts, advance or security-deposit receipts) and settlement statements separately from bills, so totals are not counted twice. Explain relationships in overall_note (e.g. "Final bill 50,910 was paid partly by the 25,000 deposit").
- Lab/medical reports without a charge are doc_type "report" with amount 0.
- Dates: write YYYY-MM-DD. Indian bills use DD/MM/YYYY.
- Currency: use what the document shows; if it shows none, assume ${circleCurrency}.
- Write title and note in ${LANG_NAME[lang] ?? "English"}; keep vendor and names as printed.
Do not invent amounts. If no amount is readable, use 0 and confidence "low".`;
}

async function askClaude(key: string, model: string, fileBlock: unknown, currency: string, lang: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: 8000,
      tools: [TOOL], tool_choice: { type: "auto" },
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: prompt(currency, lang) }] }],
    }),
  });
  return { r, out: await r.json() };
}

// keep values the app can trust
function tidy(out: any, currency: string) {
  const toolUse = (out.content ?? []).find((c: any) => c.type === "tool_use" && c.name === "record_bills");
  let result: any = toolUse?.input;
  if (!result) {
    // fallback: model answered in text — pull the first JSON object out of it
    const text = (out.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    const m = text.match(/\{[\s\S]*\}/);
    try { result = m ? JSON.parse(m[0]) : null; } catch { result = null; }
  }
  if (!result || !Array.isArray(result.documents)) result = { documents: [] };
  for (const d of result.documents ?? []) {
    d.amount = Math.max(0, Math.round(Number(d.amount || 0) * 100) / 100);
    d.currency = /^[A-Z]{3}$/.test(String(d.currency || "").toUpperCase()) ? String(d.currency).toUpperCase() : currency;
    if (!CATEGORIES.includes(d.category)) d.category = "other";
    if (d.date && !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) d.date = "";
  }
  return result;
}

const blockFor = (mime: string, data: string) => mime === "application/pdf"
  ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
  : { type: "image", source: { type: "base64", media_type: mime, data } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "scan_not_configured" }, 503);
    const body = await req.json().catch(() => ({}));
    const model = Deno.env.get("SAATH_SCAN_MODEL") ?? "claude-sonnet-5-5";

    // owner self-test: inline file, nothing stored. Locked to the vault key used by the scheduler.
    const testKey = req.headers.get("x-saath-cron");
    if (testKey && body.test_b64) {
      const { data: ok } = await admin.rpc("saath_check_cron", { p_secret: testKey });
      if (ok !== true) return json({ error: "unauthorized" }, 401);
      const t0 = Date.now();
      const { r, out } = await askClaude(key, model, blockFor(String(body.test_mime || "image/jpeg"), String(body.test_b64)), "INR", "en");
      if (!r.ok) return json({ error: "scan_failed", detail: out?.error?.message ?? r.status }, 502);
      return json({ ok: true, model, ms: Date.now() - t0, usage: out.usage, ...tidy(out, "INR") });
    }

    const auth = req.headers.get("Authorization") ?? "";
    const { data: u } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { circle_id, path, language } = body;
    if (!circle_id || !path || !String(path).startsWith(`${circle_id}/`)) return json({ error: "bad_request" }, 400);

    const user = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: member } = await user.rpc("saath_is_member", { p_circle: circle_id });
    if (!member) return json({ error: "forbidden" }, 403);

    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count } = await admin.from("saath_scans").select("id", { count: "exact", head: true }).eq("user_id", u.user.id).gte("created_at", since);
    if ((count ?? 0) >= DAILY_LIMIT) return json({ error: "scan_limit" }, 429);

    const { data: blob, error: dlErr } = await admin.storage.from("saath-receipts").download(path);
    if (dlErr || !blob) return json({ error: "file_not_found" }, 404);
    if (blob.size > MAX_BYTES) return json({ error: "file_too_large" }, 413);
    let mime = blob.type || "";
    const lower = String(path).toLowerCase();
    if (!mime || mime === "application/octet-stream") mime = lower.endsWith(".pdf") ? "application/pdf" : lower.endsWith(".png") ? "image/png" : lower.endsWith(".webp") ? "image/webp" : "image/jpeg";
    if (mime.includes("heic") || mime.includes("heif")) return json({ error: "unsupported_format" }, 415);
    const fileBlock = blockFor(mime, encodeBase64(new Uint8Array(await blob.arrayBuffer())));

    const { data: circle } = await admin.from("saath_circles").select("currency").eq("id", circle_id).single();
    const lang = String(language ?? "en").slice(0, 2);

    const { r, out } = await askClaude(key, model, fileBlock, circle?.currency ?? "INR", lang);
    if (!r.ok) {
      await admin.from("saath_scans").insert({ user_id: u.user.id, circle_id, path, model, status: "failed", detail: JSON.stringify(out).slice(0, 500) });
      return json({ error: "scan_failed", detail: out?.error?.message ?? r.status }, 502);
    }
    const result = tidy(out, circle?.currency ?? "INR");
    await admin.from("saath_scans").insert({
      user_id: u.user.id, circle_id, path, model, status: "ok",
      input_tokens: out.usage?.input_tokens ?? null, output_tokens: out.usage?.output_tokens ?? null,
      result,
    });
    return json({ ok: true, ...result });
  } catch (err) {
    return json({ error: "scan_failed", detail: String(err) }, 500);
  }
});
