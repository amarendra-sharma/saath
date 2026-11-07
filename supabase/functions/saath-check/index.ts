// saath-check (v2 pipeline) — "Bill Check": looks for signs a bill is wrong, inflated or tampered with.
// Stages, cheapest first, all ending as warnings for the family to review (never accusations):
//   (a) rules in code — free: arithmetic, above-MRP, expired stock, GSTIN checksum, duplicates, dates, patient name;
//   (b) forensic read — reuses the scan's read of the same file when there is one; otherwise Haiku reads it.
//       Sonnet re-reads only for high-value bills, poor copies, or reads that don't add up (manual checks only);
//   (c) local price check — what Saath users paid locally first; web search only for the top items above a
//       minimum amount, when local data is thin, never on automatic runs, and only on the paid plan when
//       SAATH_BILL_CHECK_PAID=true. Results cached 30 days per item + city, shared across circles.
// Deploy with verify_jwt = true. Body: { expense_id, language?, auto? }
// Secrets: ANTHROPIC_API_KEY. Optional: SAATH_BILL_CHECK_PAID, SAATH_PRICE_MODEL. Settings: table saath_ai_config.
import { createClient } from "npm:@supabase/supabase-js@2";
import { anthropic, UsageCtx } from "../_shared/ai_usage.ts";
import { cachedRead, escalationReasons, HAIKU, prepareFile, readBill, SONNET, storeRead } from "../_shared/bill_read.ts";
import { afterCalls, allowance, guard, GuardResult, loadConfig } from "../_shared/guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const PRICE_MODEL = Deno.env.get("SAATH_PRICE_MODEL") ?? HAIKU;
const PAID_ENV = (Deno.env.get("SAATH_BILL_CHECK_PAID") ?? "false") === "true";
const FN = Deno.env.get("SAATH_FN_NAME") ?? "saath-check";
const LANG_NAME: Record<string, string> = { en: "English", hi: "Hindi", bn: "Bengali", es: "Spanish", fr: "French", pt: "Portuguese" };
const PRICED_CATEGORIES = ["hospital", "doctor", "medicine", "tests", "nursing", "therapy", "equipment"];

type Sev = "high" | "medium" | "low" | "info";
type Flag = { code: string; severity: Sev; params?: Record<string, unknown>; detail?: string; source?: "rule" | "visual" | "price" };
const W: Record<Sev, number> = { high: 40, medium: 15, low: 5, info: 0 };

function toolInput(out: any, name: string) {
  const tu = (out.content ?? []).find((c: any) => c.type === "tool_use" && c.name === name);
  if (tu) return tu.input;
  const text = (out.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}
async function sha256(b: Uint8Array | string) {
  const d = typeof b === "string" ? new TextEncoder().encode(b) : b;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", d as unknown as ArrayBuffer))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function mimeOf(blob: Blob, path: string) {
  const p = path.toLowerCase();
  if (blob.type && blob.type !== "application/octet-stream") return blob.type;
  return p.endsWith(".pdf") ? "application/pdf" : p.endsWith(".png") ? "image/png" : p.endsWith(".webp") ? "image/webp" : "image/jpeg";
}
// equivalent units share one cache entry (tab/tablet, inj/vial/ampoule, …)
const UNIT: Record<string, string> = { tab: "tablet", tabs: "tablet", tablets: "tablet", cap: "capsule", caps: "capsule", capsules: "capsule",
  inj: "vial", injection: "vial", amp: "vial", ampoule: "vial", vials: "vial", strips: "strip", str: "strip", btl: "bottle", bottles: "bottle",
  nos: "unit", no: "unit", pcs: "unit", piece: "unit", pieces: "unit", item: "unit", days: "day", tests: "test", visits: "visit" };
const unitKey = (u: unknown) => { const k = String(u ?? "unit").toLowerCase().replace(/[^a-z]/g, ""); return UNIT[k] ?? (k || "unit"); };

// ───────────────────────────── 2. rules ─────────────────────────────
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : null);
const near = (a: number, b: number, tol = 0.01, abs = 1) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * tol);
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9ऀ-ॿঀ-৿]+/g, " ").trim();
const billNoFromNotes = (notes: string | null) => (notes ?? "").match(/#\s*([A-Za-z0-9\/\-]+)/)?.[1] ?? null;
const pagesFromNotes = (notes: string | null) => {
  const m = (notes ?? "").match(/p\.\s*(\d+)(?:\s*[–-]\s*(\d+))?/);
  if (!m) return [] as number[];
  const a = +m[1], b = m[2] ? +m[2] : a;
  return Array.from({ length: Math.min(b - a + 1, 20) }, (_, i) => a + i);
};

// GSTIN: 2-digit state + PAN (10) + entity + 'Z' + check character (mod-36 checksum)
const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function gstinValid(g: string): boolean {
  const s = g.toUpperCase().replace(/\s/g, "");
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = GST_CHARS.indexOf(s[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36] === s[14];
}
const GST_STATE: Record<string, string> = {
  "01": "jammu and kashmir", "02": "himachal pradesh", "03": "punjab", "04": "chandigarh", "05": "uttarakhand", "06": "haryana",
  "07": "delhi", "08": "rajasthan", "09": "uttar pradesh", "10": "bihar", "11": "sikkim", "12": "arunachal pradesh", "13": "nagaland",
  "14": "manipur", "15": "mizoram", "16": "tripura", "17": "meghalaya", "18": "assam", "19": "west bengal", "20": "jharkhand",
  "21": "odisha", "22": "chhattisgarh", "23": "madhya pradesh", "24": "gujarat", "26": "dadra and nagar haveli and daman and diu",
  "27": "maharashtra", "29": "karnataka", "30": "goa", "31": "lakshadweep", "32": "kerala", "33": "tamil nadu", "34": "puducherry",
  "35": "andaman and nicobar islands", "36": "telangana", "37": "andhra pradesh", "38": "ladakh",
};
const CITY_STATE: Record<string, string> = { patna: "bihar", delhi: "delhi", "new delhi": "delhi", mumbai: "maharashtra", pune: "maharashtra", kolkata: "west bengal", chennai: "tamil nadu", bengaluru: "karnataka", bangalore: "karnataka", hyderabad: "telangana", lucknow: "uttar pradesh", ranchi: "jharkhand", gaya: "bihar", muzaffarpur: "bihar", bhagalpur: "bihar", varanasi: "uttar pradesh", noida: "uttar pradesh", gurugram: "haryana", gurgaon: "haryana", jaipur: "rajasthan", ahmedabad: "gujarat", bhopal: "madhya pradesh", kochi: "kerala" };

function expiryEnd(e: string): string | null {
  const m = String(e).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return null;
  if (m[3]) return `${m[1]}-${m[2]}-${m[3]}`;
  const last = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}`;
}

function docRules(doc: any, exp: any, country: string): Flag[] {
  const f: Flag[] = [];
  const items: any[] = Array.isArray(doc.items) ? doc.items : [];
  const total = num(doc.grand_total);

  if (total != null && total > 0 && !near(Number(exp.amount), total, 0.002, 1))
    f.push({ code: "amount_mismatch", severity: "medium", params: { recorded: Number(exp.amount), bill: total } });

  const itemsSum = items.reduce((a, it) => a + (num(it.amount) ?? 0), 0);
  if (items.length >= 2 && itemsSum > 0) {
    const sub = num(doc.subtotal);
    const disc = num(doc.discount) ?? 0, tax = num(doc.tax) ?? 0;
    // line items may be printed before or after discount / tax: accept any consistent reading
    const ok = [sub, total, total != null ? total + disc : null, total != null ? total - tax : null, total != null ? total + disc - tax : null]
      .some((v) => v != null && near(itemsSum, v, 0.01, 2));
    const stated = sub ?? total;
    if (!ok && stated != null) f.push({ code: "items_dont_add_up", severity: "high", params: { items: Math.round(itemsSum * 100) / 100, stated } });
  }
  if (sub_ok(doc) === false) f.push({ code: "totals_dont_add_up", severity: "high", params: { subtotal: doc.subtotal, discount: doc.discount ?? 0, tax: doc.tax ?? 0, total } });

  const lineBad = items.filter((it) => { const q = num(it.qty), r = num(it.rate), a = num(it.amount); return q && r && a && !near(q * r, a, 0.02, 1.5); });
  if (lineBad.length) f.push({ code: "line_math", severity: "medium", params: { items: lineBad.slice(0, 5).map((it) => `${it.name}: ${it.qty} × ${it.rate} ≠ ${it.amount}`) } });

  const words = num(doc.amount_in_words_value);
  if (words != null && words > 0 && total != null && !near(words, total, 0.001, 1))
    f.push({ code: "words_vs_figures", severity: "high", params: { words: doc.amount_in_words || words, figures: total } });

  const overMrp = items.filter((it) => { const r = num(it.rate), m = num(it.mrp); return r && m && r > m * 1.005 + 0.01; });
  if (overMrp.length) f.push({ code: country === "IN" ? "above_mrp" : "above_printed_price", severity: "high", params: { items: overMrp.slice(0, 5).map((it) => `${it.name}: ${it.rate} > MRP ${it.mrp}`) } });

  const billDate = doc.date || exp.spent_on;
  const expired = items.filter((it) => { const e = it.expiry && expiryEnd(it.expiry); return e && billDate && e < billDate; });
  if (expired.length) f.push({ code: "expired_item", severity: "high", params: { items: expired.slice(0, 5).map((it) => `${it.name} (exp ${it.expiry})`) } });

  const g = String(doc.gstin ?? "").trim();
  if (g) {
    if (!gstinValid(g)) f.push({ code: "gstin_invalid", severity: "high", params: { gstin: g } });
    else {
      const st = GST_STATE[g.slice(0, 2)];
      const vs = norm(doc.vendor_state) || CITY_STATE[norm(doc.vendor_city)] || "";
      if (st && vs && !vs.includes(st) && !st.includes(vs)) f.push({ code: "gstin_state", severity: "medium", params: { gstin: g, gst_state: st, address_state: doc.vendor_state || doc.vendor_city } });
    }
  } else if ((num(doc.tax) ?? 0) > 0 || items.some((it) => (num(it.gst_percent) ?? 0) > 0)) {
    f.push({ code: "gst_without_gstin", severity: "medium" });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (doc.date && doc.date > today) f.push({ code: "future_date", severity: "high", params: { date: doc.date } });
  if (doc.date && exp.spent_on && Math.abs((Date.parse(doc.date) - Date.parse(exp.spent_on)) / 864e5) > 3)
    f.push({ code: "date_mismatch", severity: "low", params: { bill: doc.date, recorded: exp.spent_on } });

  const amt = total ?? Number(exp.amount);
  const noId = !g && !(doc.registration_numbers ?? []).length;
  if (doc.handwritten && noId && amt >= 2000) f.push({ code: "handwritten_no_id", severity: "medium", params: { amount: amt } });
  else if (doc.handwritten && !items.length && amt >= 2000 && amt % 500 === 0) f.push({ code: "handwritten_round", severity: "low", params: { amount: amt } });
  if (["hospital", "clinic", "nursing"].includes(doc.vendor_kind) && amt >= 20000 && items.length <= 1)
    f.push({ code: "not_itemised", severity: "low", params: { amount: amt } });
  if (doc.doc_type === "bill" && doc.has_stamp === false && doc.has_signature === false && amt >= 5000) f.push({ code: "no_stamp_signature", severity: "low" });
  if (doc.readability === "poor") f.push({ code: "poor_copy", severity: "low" });

  for (const v of doc.visual_flags ?? []) {
    f.push({ code: "visual_" + v.kind, severity: (["high", "medium", "low"].includes(v.severity) ? v.severity : "medium") as Sev, detail: [v.where, v.detail].filter(Boolean).join(": "), source: "visual" });
  }
  return f;
}
function sub_ok(doc: any): boolean | null {
  const sub = num(doc.subtotal), total = num(doc.grand_total);
  if (sub == null || total == null) return null;
  const disc = num(doc.discount) ?? 0, tax = num(doc.tax) ?? 0;
  // some bills print tax already inside the subtotal; accept either reading
  return near(sub - disc + tax, total, 0.01, 2) || near(sub - disc, total, 0.01, 2) || near(sub + tax, total, 0.01, 2);
}

function circleRules(exp: any, doc: any | null, others: any[], otherChecks: any[]): Flag[] {
  const f: Flag[] = [];
  const myNo = (doc?.bill_number || billNoFromNotes(exp.notes) || "").toString().trim().toLowerCase();
  const myVendor = norm(doc?.vendor || exp.vendor);
  const docs = new Map(otherChecks.map((c: any) => [c.expense_id, c.doc]));
  for (const o of others) {
    const od = docs.get(o.id);
    const oNo = (od?.bill_number || billNoFromNotes(o.notes) || "").toString().trim().toLowerCase();
    const oVendor = norm(od?.vendor || o.vendor);
    const sameVendor = myVendor && oVendor && (myVendor.includes(oVendor) || oVendor.includes(myVendor));
    if (myNo && oNo && myNo === oNo && (sameVendor || !myVendor || !oVendor)) {
      f.push({ code: "duplicate_bill_number", severity: "high", params: { bill_number: myNo, other: o.title, other_id: o.id, other_date: o.spent_on } });
      continue;
    }
    const days = Math.abs((Date.parse(o.spent_on) - Date.parse(exp.spent_on)) / 864e5);
    if (Number(o.amount) === Number(exp.amount) && days <= 3 && (sameVendor || norm(o.title) === norm(exp.title)) && !(myNo && oNo && myNo !== oNo))
      f.push({ code: "possible_duplicate", severity: "medium", params: { other: o.title, other_id: o.id, other_date: o.spent_on, amount: Number(o.amount) } });
    // bill numbers from one vendor should rise with time
    const a = parseInt(myNo.replace(/\D/g, "").slice(0, 12)), b = parseInt(oNo.replace(/\D/g, "").slice(0, 12));
    if (sameVendor && a && b && myNo.replace(/\d/g, "") === oNo.replace(/\d/g, "") && days >= 2 &&
        ((a > b && exp.spent_on < o.spent_on) || (a < b && exp.spent_on > o.spent_on)))
      f.push({ code: "bill_number_order", severity: "medium", params: { this_no: myNo, this_date: exp.spent_on, other_no: oNo, other_date: o.spent_on } });
  }
  // patient name: compare with the name most bills in this circle carry
  const names = otherChecks.map((c: any) => norm(c.doc?.patient_name)).filter((n: string) => n.length > 2);
  const mine = norm(doc?.patient_name);
  if (mine && names.length >= 2) {
    const counts = new Map<string, number>(); for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
    const [top, c] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
    const firstTop = top.split(" ")[0], firstMine = mine.split(" ")[0];
    if (c >= 2 && firstTop !== firstMine && !top.includes(mine) && !mine.includes(top))
      f.push({ code: "patient_name", severity: "medium", params: { name: doc.patient_name, usual: top } });
  }
  // dedupe duplicate flags pointing at several others
  const seen = new Set<string>();
  return f.filter((x) => { const k = x.code + (x.params?.other_id ?? ""); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
}
// ───────────────────────────── 3. market prices ─────────────────────────────
const PRICE_TOOL = {
  name: "record_prices",
  description: "Record the local market price check for each item.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", description: "Echo the key you were given." },
            typical_low: { type: "number", description: "Typical low price per unit in the area." },
            typical_high: { type: "number", description: "Typical high price per unit in the area (normal private-sector upper end)." },
            ceiling_price: { type: "number", description: "Government ceiling/MRP cap per unit if one applies (e.g. NPPA), else omit." },
            reference: { type: "string", description: "What the range is based on, e.g. 'NPPA ceiling + 1mg/PharmEasy MRP', 'CGHS rate + Patna lab price lists'." },
            verdict: { type: "string", enum: ["fair", "high", "very_high", "above_ceiling", "low", "unknown"] },
            explanation: { type: "string", description: "One or two sentences for the family." },
            sources: { type: "array", items: { type: "string" }, description: "URLs you used." },
          },
          required: ["key", "verdict", "explanation"],
        },
      },
    },
    required: ["items"],
  },
};

type PriceAsk = { key: string; name: string; unit: string; unit_price: number; qty: number; vendor_kind: string; mrp?: number | null };

async function priceCheck(ctx: UsageCtx, asks: PriceAsk[], city: string | null, country: string, currency: string, lang: string, date: string) {
  if (!asks.length) return { items: [] as any[], searches: 0 };
  const list = asks.map((a, i) => `${i + 1}. key="${a.key}" — "${a.name}" — billed ${currency} ${a.unit_price} per ${a.unit || "unit"} (qty ${a.qty})${a.mrp ? `, printed MRP ${a.mrp}` : ""} — from a ${a.vendor_kind}`).join("\n");
  const prompt = `A family in ${city ? city + ", " : ""}${country} was billed for the items below around ${date}. For each, find what it normally costs in that area${city ? " (or the nearest comparable city)" : ""}.
Use web search, at most twice — combine all items into one query if you can. Good sources: NPPA ceiling prices, 1mg, PharmEasy, Apollo, Netmeds (medicines); CGHS / PM-JAY rates and local lab or hospital price lists (tests, scans, procedures); hospital tariffs of a similar tier (room, ICU, nursing, doctor visits).
Rules: compare per unit (convert strip vs tablet). Private hospitals legitimately charge more than government rates: "high" only if >25% above the normal private upper end, "very_high" if about double, "above_ceiling" if above an applicable government ceiling. An item with unit "bill" covers a whole bill: if you cannot price every part, use "unknown". "unknown" if no reliable reference. Never invent numbers. Write explanation in ${LANG_NAME[lang] ?? "English"}.
Then call record_prices once with every item.

${list}`;
  const tools: any[] = [
    { type: "web_search_20250305", name: "web_search", max_uses: 2, user_location: { type: "approximate", ...(city ? { city } : {}), country } },
    PRICE_TOOL,
  ];
  const messages: any[] = [{ role: "user", content: prompt }];
  let searches = 0;
  for (let round = 0; round < 2; round++) {
    const { r, out } = await anthropic({ ...ctx, fn: `${ctx.fn}#${round + 1}` }, KEY, { model: PRICE_MODEL, max_tokens: 3000, tools, tool_choice: { type: "auto" }, messages });
    if (!r.ok) throw new Error(out?.error?.message ?? `anthropic_${r.status}`);
    searches += out.usage?.server_tool_use?.web_search_requests ?? 0;
    const got = toolInput(out, "record_prices");
    if (got?.items) return { items: got.items, searches };
    if (out.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: out.content }); continue; }
    break;
  }
  return { items: [] as any[], searches };
}

// ───────────────────────────── main ─────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!KEY) return json({ error: "scan_not_configured" }, 503);
    const body = await req.json().catch(() => ({}));
    const lang = String(body.language ?? "en").slice(0, 2);
    const auto = body.auto === true;              // automatic run after adding a bill: rules + Haiku read only
    const cfg = await loadConfig(admin);

    // who is asking: a signed-in member, or the owner with the scheduler's vault key
    let userId: string | null = null;
    const ownerKey = req.headers.get("x-saath-cron");
    if (ownerKey) {
      const { data: ok } = await admin.rpc("saath_check_cron", { p_secret: ownerKey });
      if (ok !== true) return json({ error: "unauthorized" }, 401);
      // owner evaluation: forensic read + rules on a stored/inline file, optional forced model; nothing stored
      if (body.test_b64 || body.test_path) {
        let bytes: Uint8Array, mime: string;
        if (body.test_path) {
          const { data: blob, error } = await admin.storage.from("saath-receipts").download(String(body.test_path));
          if (error || !blob) return json({ error: "file_not_found" }, 404);
          bytes = new Uint8Array(await blob.arrayBuffer()); mime = mimeOf(blob, String(body.test_path));
        } else { bytes = Uint8Array.from(atob(String(body.test_b64)), (c) => c.charCodeAt(0)); mime = String(body.test_mime || "image/png"); }
        const t0 = Date.now();
        const tcfg = { ...cfg, ...(body.test_cfg ?? {}) };
        const prep = await prepareFile(bytes, mime, tcfg, Array.isArray(body.test_pages) ? body.test_pages.map(Number) : []);
        const res = await readBill({ admin, fn: `${FN}:audit:eval` }, KEY, prep, { purpose: "audit", currency: "INR", lang, amountHint: Number(body.test_amount ?? 0) }, tcfg, body.test_model || undefined);
        const d = (res.documents ?? []).find((x: any) => x.doc_type === "bill") ?? (res.documents ?? [])[0];
        const fake = { amount: Number(body.test_amount ?? d?.amount ?? 0), spent_on: body.test_date ?? new Date().toISOString().slice(0, 10), title: "test", notes: null };
        return json({ ok: true, ms: Date.now() - t0, model: res.model, escalated: res.escalated, reasons: res.reasons, sent_bytes: prep.bytesSent, resized: prep.resized,
          documents: res.documents, flags: d ? docRules(d, fake, "IN") : [] });
      }
    } else {
      const auth = req.headers.get("Authorization") ?? "";
      const { data: u } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
      if (!u?.user) return json({ error: "unauthorized" }, 401);
      userId = u.user.id;
    }

    const { data: exp } = await admin.from("saath_expenses").select("*, saath_receipts(path, mime)").eq("id", body.expense_id).single();
    if (!exp) return json({ error: "not_found" }, 404);
    if (userId) {
      const { data: m } = await admin.from("saath_members").select("id").eq("circle_id", exp.circle_id).eq("user_id", userId).eq("status", "active").maybeSingle();
      if (!m) return json({ error: "forbidden" }, 403);
    }
    const { data: circle } = await admin.from("saath_circles").select("currency, city, country, plan").eq("id", exp.circle_id).single();
    const currency = circle?.currency ?? "INR";
    const country = (circle?.country ?? "IN").toUpperCase();

    // spend guard: if the AI allowance is used up, still run the free rules and say so
    const g: GuardResult = ownerKey ? { ok: true, allowance: await allowance(admin, exp.circle_id) } : await guard(admin, cfg, { circleId: exp.circle_id, userId, kind: "check" });
    if (!g.ok && !["ai_limit_reached", "ai_paused", "ai_off"].includes(g.error ?? "")) return json({ error: g.error, message: g.message, ai: { allowance: g.allowance } }, g.status ?? 429);
    // paid switch: env secret or admin console (Features → Bill Check only on Plus)
    const PAID = PAID_ENV || cfg.bill_check_paid === true;
    if (PAID && !ownerKey && circle?.plan !== "plus") return json({ error: "upgrade_required", message: "Bill Check is part of Saath Plus." }, 402);
    const aiAllowed = g.ok;
    const webAllowed = aiAllowed && !auto && cfg.price_web_enabled !== false && (!PAID || circle?.plan === "plus");

    // ── (b) forensic read: cached (scan or earlier check) → else Haiku → Sonnet only if needed and not auto
    const flags: Flag[] = [];
    let doc: any = null, readModel: string | null = null, readReasons: string[] = [], readSource = "none";
    const receipts: any[] = exp.saath_receipts ?? [];
    const pages = pagesFromNotes(exp.notes);
    const billNo = billNoFromNotes(exp.notes);
    for (const rc of receipts.slice(0, 2)) {
      if (String(rc.mime ?? "").includes("heic")) continue;
      const hit = await cachedRead(admin, rc.path, pages);
      let read: any = hit?.result ?? null; readSource = read ? "cache" : "none";
      let fileHash: string | null = read?.file_hash ?? null;
      let bytesForEsc: Uint8Array | null = null, mimeForEsc = "";
      const prepFile = async () => {
        const { data: blob, error } = await admin.storage.from("saath-receipts").download(rc.path);
        if (error || !blob) throw new Error("file_not_found");
        bytesForEsc = new Uint8Array(await blob.arrayBuffer()); mimeForEsc = mimeOf(blob, rc.path);
        fileHash = await sha256(bytesForEsc);
        return await prepareFile(bytesForEsc, mimeForEsc, cfg, pages);
      };
      const hint = pages.length ? `The bill of interest is on page(s) ${pages.join(", ")}${billNo ? `, number ${billNo}` : ""}, amount about ${exp.amount}.`
        : `The bill of interest is "${exp.title}"${billNo ? `, number ${billNo}` : ""}, amount about ${exp.amount}.`;
      const ropts = { purpose: "audit" as const, currency, lang, hint, amountHint: Number(exp.amount), noEscalate: auto };
      if (!read && aiAllowed) {
        try {
          const prep = await prepFile();
          read = await readBill({ admin, fn: `${FN}:read`, userId, circleId: exp.circle_id }, KEY, prep, ropts, cfg);
          await storeRead(admin, rc.path, pages, exp.circle_id, read, fileHash!);
          readSource = "read";
        } catch (e) { flags.push({ code: "read_failed", severity: "info", detail: String((e as Error).message).slice(0, 120) }); }
      } else if (read && aiAllowed && !auto && read.version >= 2 && (read.model !== SONNET || read.verify === "amounts")) {
        // cached Haiku read: audits of high-value / poor / inconsistent bills get a full Sonnet read (once; then cached).
        // If the scan already had Sonnet verify the amounts, only high-value / poor copies / non-reconciling bills re-read.
        const allowed = read.verify === "amounts" ? ["high_value", "poor_readability", "does_not_reconcile"]
          : ["high_value", "poor_readability", "does_not_reconcile", "low_confidence", "handwritten", "indic_script"];
        const why = escalationReasons(read, ropts, cfg).filter((r) => allowed.includes(r));
        if (why.length) {
          try {
            const prep = await prepFile();
            const strong = await readBill({ admin, fn: `${FN}:read`, userId, circleId: exp.circle_id }, KEY, prep, ropts, cfg, SONNET);
            read = { ...strong, escalated: true, reasons: why };
            await storeRead(admin, rc.path, pages, exp.circle_id, read, fileHash!);
            readSource = "escalated";
          } catch (_) { /* keep the Haiku read */ }
        }
      }
      if (!read) continue;
      readModel = read.model ?? hit?.model ?? null; readReasons = read.reasons ?? [];
      const cands: any[] = (read.documents ?? []).filter((d: any) => d.doc_type === "bill" || (d.items ?? []).length);
      const score = (d: any) => (billNo && String(d.bill_number ?? "").toLowerCase().includes(billNo.toLowerCase()) ? 3 : 0)
        + (num(d.grand_total ?? d.amount) != null && near(Number(d.grand_total ?? d.amount), Number(exp.amount), 0.002, 1) ? 2 : 0)
        + (pages.length && (d.pages ?? []).some((p: number) => pages.includes(p)) ? 1 : 0);
      const best = cands.sort((a, b) => score(b) - score(a))[0] ?? (read.documents ?? [])[0];
      if (best && !doc) {
        const bd = { ...best, grand_total: best.grand_total ?? best.amount };
        doc = { ...bd, file_hash: fileHash, path: rc.path };
        flags.push(...docRules(bd, exp, country));
      }
    }
    if (!receipts.length) flags.push({ code: "no_file", severity: "info" });
    if (!aiAllowed) flags.push({ code: "ai_limit", severity: "info", detail: g.ok ? undefined : g.message });

    // ── (a) rules across the circle (free)
    const [{ data: others }, { data: otherChecks }] = await Promise.all([
      admin.from("saath_expenses").select("id, title, amount, spent_on, vendor, notes").eq("circle_id", exp.circle_id).neq("id", exp.id),
      admin.from("saath_bill_checks").select("expense_id, doc").eq("circle_id", exp.circle_id).neq("expense_id", exp.id),
    ]);
    flags.push(...circleRules(exp, doc, others ?? [], otherChecks ?? []));
    if (doc?.file_hash) {
      const dupFile = (otherChecks ?? []).find((c: any) => c.doc?.file_hash === doc.file_hash && c.doc?.path !== doc.path);
      if (dupFile) flags.push({ code: "same_file_twice", severity: "high", params: { other_id: dupFile.expense_id } });
    }

    // ── (c) prices: local medians first (free), web search only where allowed and needed
    const city = (circle?.city || doc?.vendor_city || null) as string | null;
    const vendorKind = doc?.vendor_kind ?? (exp.category === "medicine" ? "pharmacy" : exp.category === "tests" ? "lab" : exp.category === "hospital" ? "hospital" : "other");
    const lines: PriceAsk[] = (doc?.items ?? [])
      .map((it: any) => {
        const qty = num(it.qty) || 1, amt = num(it.amount) ?? 0;
        const unit_price = num(it.rate) ?? (amt ? amt / qty : 0);
        return { key: norm(it.generic_key || it.name).slice(0, 80) + "|" + unitKey(it.unit), name: it.name, unit: it.unit || "unit", unit_price: Math.round(unit_price * 100) / 100, qty, vendor_kind: vendorKind, mrp: num(it.mrp), amount: amt };
      })
      .filter((a: any) => a.unit_price > 0);
    if (!lines.length && PRICED_CATEGORIES.includes(exp.category) && exp.category !== "medicine" && Number(exp.amount) > 0) {
      const name = doc?.vendor ? `${exp.title} (${doc.vendor})` : exp.title;
      lines.push({ key: norm(exp.title).slice(0, 80) + "|bill", name, unit: "bill", unit_price: Number(exp.amount), qty: 1, vendor_kind: vendorKind, mrp: null, amount: Number(exp.amount) } as any);
    }
    const keys = lines.map((l) => l.key);
    const { data: stats } = keys.length ? await admin.rpc("saath_price_stats", { p_keys: keys, p_city: city, p_country: country }) : { data: [] };
    const statFor = (k: string) => (stats ?? []).find((s: any) => s.item_key === k && s.scope === "city" && s.n >= 5) ?? (stats ?? []).find((s: any) => s.item_key === k && s.scope === "country" && s.n >= 8);
    const benchmarks: any[] = [];
    for (const l of lines) {
      const s = statFor(l.key);
      if (s && l.unit_price > Number(s.median) * 1.6 && l.unit_price - Number(s.median) >= 20) {
        flags.push({ code: "above_local_median", severity: l.unit_price > Number(s.median) * 2.5 ? "high" : "medium", source: "price",
          params: { item: l.name, billed: l.unit_price, median: Math.round(Number(s.median) * 100) / 100, n: Number(s.n), scope: s.scope } });
      }
    }
    const top = [...lines].sort((a: any, b: any) => (b.amount ?? 0) - (a.amount ?? 0))
      .filter((l: any) => (l.amount ?? 0) >= Number(cfg.price_min_amount)).slice(0, Number(cfg.price_top_items));
    const refKey = (l: PriceAsk) => `${l.key}|${norm(city ?? "")}|${country}`;
    const fresh = new Date(Date.now() - 30 * 864e5).toISOString();
    const { data: refs } = top.length ? await admin.from("saath_price_refs").select("key, result").in("key", top.map(refKey)).gte("created_at", fresh) : { data: [] };
    const known = new Map((refs ?? []).map((r: any) => [r.key, r.result]));
    const ask = webAllowed ? top.filter((l) => !known.has(refKey(l)) && !statFor(l.key)) : [];
    let searches = 0;
    if (ask.length) {
      try {
        const res = await priceCheck({ admin, fn: `${FN}:price`, userId, circleId: exp.circle_id }, ask, city, country, currency, lang, exp.spent_on);
        searches = res.searches;
        for (const r of res.items) {
          const l = ask.find((a) => a.key === r.key) ?? ask[res.items.indexOf(r)];
          if (!l) continue;
          known.set(refKey(l), r);
          if (r.verdict !== "unknown") await admin.from("saath_price_refs").upsert({ key: refKey(l), result: r, created_at: new Date().toISOString() });
        }
      } catch (e) { console.error("price check", e); }
    }
    for (const l of top) {
      const r: any = known.get(refKey(l));
      if (!r) continue;
      const hi = num(r.typical_high), ceil = num(r.ceiling_price);
      let verdict = r.verdict;
      if (hi && l.unit_price > 0 && r.verdict !== "unknown") verdict = ceil && l.unit_price > ceil * 1.02 ? "above_ceiling" : l.unit_price > hi * 2 ? "very_high" : l.unit_price > hi * 1.25 ? "high" : "fair";
      benchmarks.push({ name: l.name, unit: l.unit, billed: l.unit_price, qty: l.qty, low: num(r.typical_low), high: hi, ceiling: ceil, verdict, reference: r.reference, explanation: r.explanation, sources: (r.sources ?? []).slice(0, 3) });
      if (verdict === "above_ceiling") flags.push({ code: "above_ceiling_price", severity: "high", source: "price", params: { item: l.name, billed: l.unit_price, ceiling: ceil }, detail: r.explanation });
      else if (verdict === "very_high") flags.push({ code: "price_very_high", severity: "high", source: "price", params: { item: l.name, billed: l.unit_price, low: num(r.typical_low), high: hi }, detail: r.explanation });
      else if (verdict === "high") flags.push({ code: "price_high", severity: "medium", source: "price", params: { item: l.name, billed: l.unit_price, low: num(r.typical_low), high: hi }, detail: r.explanation });
    }

    // ── score + save
    const score = Math.min(100, flags.reduce((a, f) => a + W[f.severity], 0));
    const risk = score >= 40 ? "high" : score >= 15 ? "medium" : score > 0 ? "low" : "none";
    const items = (doc?.items ?? []).slice(0, 80);
    const docSlim = doc ? { vendor: doc.vendor, vendor_kind: doc.vendor_kind, vendor_city: doc.vendor_city, gstin: doc.gstin, bill_number: doc.bill_number, date: doc.date,
      patient_name: doc.patient_name, grand_total: doc.grand_total, handwritten: doc.handwritten, file_hash: doc.file_hash, path: doc.path, readability: doc.readability } : null;
    const row = { expense_id: exp.id, circle_id: exp.circle_id, status: "done", risk, score, flags, items, benchmarks, doc: docSlim, had_file: !!receipts.length, model: readModel, searches, checked_by: userId, checked_at: new Date().toISOString() };
    const { data: prev } = await admin.from("saath_bill_checks").select("dismissed").eq("expense_id", exp.id).maybeSingle();
    await admin.from("saath_bill_checks").upsert({ ...row, dismissed: prev?.dismissed ?? [] });

    if (doc && lines.length) {
      const h = await sha256(`${doc.file_hash ?? doc.path}#${doc.bill_number ?? ""}`);
      const obs = lines.filter((l: any) => l.unit !== "bill").map((l: any) => ({
        item_key: l.key, item_name: String(l.name).slice(0, 120), unit: l.unit, unit_price: l.unit_price, mrp: l.mrp ?? null,
        currency, city: city ?? null, country, vendor_kind: vendorKind, observed_on: doc.date || exp.spent_on, source_path_hash: h,
      }));
      if (obs.length) await admin.from("saath_price_obs").upsert(obs, { onConflict: "source_path_hash,item_key,unit_price", ignoreDuplicates: true });
    }
    afterCalls(admin, cfg);
    const a = await allowance(admin, exp.circle_id);
    return json({ ok: true, ...row, dismissed: prev?.dismissed ?? [],
      ai: { read_model: readModel, read_source: readSource, read_reasons: readReasons, web_search: ask.length > 0, searches, auto, allowance: a,
        limit_reached: !aiAllowed, message: g.ok ? undefined : g.message } });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    const code = ["file_not_found", "file_too_large", "too_many_pages"].includes(msg) ? msg : "check_failed";
    return json({ error: code, detail: msg.slice(0, 300) }, code === "check_failed" ? 500 : 400);
  }
});
