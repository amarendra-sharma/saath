// One read of a bill file that serves both "scan" (pre-fill) and "Bill Check" (forensic audit).
// Haiku reads first; Sonnet re-reads only when the result is not safe to trust (see escalationReasons).
// The read is cached in saath_doc_audits by "<path>#<pages>" so the same file is never read twice.
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { anthropic, UsageCtx } from "./ai_usage.ts";

export const HAIKU = Deno.env.get("SAATH_FAST_MODEL") ?? "claude-haiku-5-5";
export const SONNET = Deno.env.get("SAATH_STRONG_MODEL") ?? "claude-sonnet-5-5";
export const READ_VERSION = 2;

export const CATEGORIES = ["hospital", "doctor", "medicine", "tests", "nursing", "therapy", "equipment", "travel",
  "food", "rent", "utilities", "insurance", "fees", "event", "other"];
const LANG_NAME: Record<string, string> = { en: "English", hi: "Hindi", bn: "Bengali", es: "Spanish", fr: "French", pt: "Portuguese" };
const MONEY_DOCS = ["bill", "payment_receipt", "settlement_summary", "deposit_receipt"];

// ── tool: compact descriptions (every field is shown in the app or used by Bill Check rules)
const TOOL = {
  name: "record_bills",
  description: "Record every document in the file.",
  input_schema: {
    type: "object",
    properties: {
      documents: {
        type: "array",
        items: {
          type: "object",
          properties: {
            doc_type: { type: "string", enum: ["bill", "payment_receipt", "settlement_summary", "deposit_receipt", "report", "prescription", "other"] },
            title: { type: "string", description: "Short description in the requested language." },
            vendor: { type: "string" },
            vendor_kind: { type: "string", enum: ["pharmacy", "hospital", "clinic", "lab", "imaging", "nursing", "transport", "shop", "other"] },
            vendor_city: { type: "string" }, vendor_state: { type: "string" },
            gstin: { type: "string", description: "Exactly as printed; empty if none." },
            registration_numbers: { type: "array", items: { type: "string" } },
            bill_number: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD" },
            amount: { type: "number", description: "Final payable/paid total. 0 if unreadable." },
            currency: { type: "string", description: "ISO 4217" },
            category: { type: "string", enum: CATEGORIES },
            patient_name: { type: "string" },
            pages: { type: "array", items: { type: "integer" } },
            handwritten: { type: "boolean", description: "Amounts or items written by hand." },
            script: { type: "string", enum: ["latin", "devanagari", "bengali", "other_indic", "other"], description: "Main script of the amounts/items." },
            confidence: { type: "string", enum: ["high", "medium", "low"], description: "In the amount." },
            note: { type: "string", description: "What the user should check; in the requested language." },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  generic_key: { type: "string", description: "lower-case generic name + strength + form, or service name" },
                  qty: { type: "number" }, unit: { type: "string" }, rate: { type: "number" }, mrp: { type: "number" },
                  amount: { type: "number" }, batch: { type: "string" }, expiry: { type: "string", description: "YYYY-MM" },
                  gst_percent: { type: "number" },
                },
                required: ["name", "amount"],
              },
            },
            subtotal: { type: "number" }, discount: { type: "number" }, tax: { type: "number" },
            amount_in_words: { type: "string" }, amount_in_words_value: { type: "number" },
            has_stamp: { type: "boolean" }, has_signature: { type: "boolean" },
            visual_flags: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: ["overwritten_digits", "different_ink_or_hand", "whitener_or_erasure", "pasted_or_edited_region", "font_mismatch", "added_line_after_total", "date_altered", "blank_letterhead_filled_by_hand", "photocopy_of_copy", "cropped_or_missing_part", "other"] },
                  severity: { type: "string", enum: ["high", "medium", "low"] },
                  where: { type: "string" }, detail: { type: "string" },
                },
                required: ["kind", "severity", "detail"],
              },
            },
            readability: { type: "string", enum: ["good", "fair", "poor"] },
          },
          required: ["doc_type", "title", "amount", "currency", "category", "pages", "confidence", "handwritten", "script", "readability"],
        },
      },
      overall_note: { type: "string", description: "How documents relate (which totals include which); in the requested language." },
    },
    required: ["documents"],
  },
};

// Static instructions: identical for every request, so they are prompt-cached together with the tool.
const SYSTEM = `You read financial documents a family uploaded to a shared-expenses app (medical care, elder care and similar).
Files may be photos, scans or PDFs; printed or handwritten; in any language or script; possibly rotated, faded or stamped.
Call record_bills exactly once with EVERY distinct document. Never answer in plain text.

Amounts (most important):
- amount = the final payable/paid total ("Grand total", "Net amount", "कुल", "মোট", "Total"), after discount, including tax. Not MRP, not subtotal.
- Read handwritten digits carefully. If two readings are plausible, choose the most likely, set confidence below "high" and say so in note.
- confidence "high" only when the total is clearly legible and consistent with the items/words on the document.
- Never invent amounts. If unreadable: amount 0, confidence "low".
Documents:
- A multi-page PDF may hold many bills: list each with its page numbers.
- doc_type: bill = charges money (invoice, cash memo, money receipt for a service). payment_receipt / deposit_receipt = proof money was paid (card/UPI slip, cheque, advance or security deposit). settlement_summary = a statement totalling other bills. report = lab/medical report with no charge (amount 0). prescription = doctor's note.
- Keep payment slips and settlement statements separate from bills so nothing is counted twice; explain links in overall_note.
- category: medicines, injections, IV fluids → medicine; oxygen cylinders/refills, concentrators, BiPAP/CPAP, beds, wheelchairs and their rental → equipment; lab tests and scans → tests; hospital stay/ICU/procedures → hospital; caretakers/attendants/nurses → nursing; doctor fees → doctor.
- script: the script of the handwritten or printed amounts and items (latin for English/numerals-only).
Details for checking the bill:
- items: every line with qty, unit rate, MRP if printed, line amount, batch, expiry. generic_key must match the same product/service on another bill (e.g. "pantoprazole 40mg tablet", "hrct thorax").
- gstin: copy exactly as printed, character by character. amount_in_words: copy verbatim and give its value.
- visual_flags: inspect like a forensic document examiner; report only visible signs (digits written over digits, a total or quantity in different ink or handwriting, whitener/erasure, a region with different background/font/alignment, a line added below the total, an altered date, a blank letterhead filled by hand, missing parts). Blur, folds, stamps and scanner noise are not flags. Empty list if nothing looks altered.
Dates: YYYY-MM-DD; Indian bills print DD/MM/YYYY. Keep vendor and person names as printed.`;

// Short second opinion used when a SCAN escalates: Sonnet re-reads only what the app pre-fills (amounts, dates,
// document split). ~3x less output than a full read; line items and forensic fields stay from the Haiku read.
const VERIFY_TOOL = {
  name: "record_totals",
  description: "Record every document in the file with its final amount.",
  input_schema: {
    type: "object",
    properties: {
      documents: {
        type: "array",
        items: {
          type: "object",
          properties: {
            doc_type: TOOL.input_schema.properties.documents.items.properties.doc_type,
            title: { type: "string", description: "Short description in the requested language." },
            vendor: { type: "string" }, bill_number: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD" },
            amount: { type: "number", description: "Final payable/paid total. 0 if unreadable." },
            currency: { type: "string", description: "ISO 4217" },
            category: { type: "string", enum: CATEGORIES },
            patient_name: { type: "string" },
            pages: { type: "array", items: { type: "integer" } },
            handwritten: { type: "boolean" },
            confidence: { type: "string", enum: ["high", "medium", "low"], description: "In the amount." },
            note: { type: "string", description: "What the user should check; in the requested language." },
          },
          required: ["doc_type", "title", "amount", "currency", "category", "pages", "confidence", "handwritten"],
        },
      },
      overall_note: { type: "string" },
    },
    required: ["documents"],
  },
};
const VERIFY_SYSTEM = SYSTEM.split("Details for checking the bill:")[0].replace("Call record_bills", "Call record_totals") +
  "Dates: YYYY-MM-DD; Indian bills print DD/MM/YYYY. Keep vendor and person names as printed.";

let resizeQueue: Promise<unknown> = Promise.resolve();
let imageLib: Promise<any> | null = null;   // loaded once, only if server resize is on
const loadImageLib = () => (imageLib ??= import("https://deno.land/x/imagescript@1.3.0/mod.ts").then((m) => m.Image));

export type FilePrep = { block: unknown; mime: string; pages: number; bytesSent: number; resized: boolean; note?: string };

/** Size checks, PDF page selection and photo downscaling. Throws Error("file_too_large" | "too_many_pages" | "unsupported_format"). */
export async function prepareFile(bytes: Uint8Array, mime: string, cfg: Record<string, any>, pages: number[] = []): Promise<FilePrep> {
  if (bytes.length > Number(cfg.max_file_mb) * 1024 * 1024) throw new Error("file_too_large");
  if (mime.includes("heic") || mime.includes("heif")) throw new Error("unsupported_format");
  if (mime === "application/pdf") {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const n = src.getPageCount();
    let sel = pages.filter((p) => p >= 1 && p <= n);
    if (sel.length && sel.length < n) {
      const out = await PDFDocument.create();
      for (const pg of await out.copyPages(src, sel.map((p) => p - 1))) out.addPage(pg);
      bytes = new Uint8Array(await out.save());
    } else sel = [];
    const count = sel.length || n;
    if (count > Number(cfg.max_pdf_pages)) throw new Error("too_many_pages");
    return { block: { type: "document", source: { type: "base64", media_type: "application/pdf", data: encodeBase64(bytes) } }, mime, pages: count, bytesSent: bytes.length, resized: false };
  }
  let resized = false, note: string | undefined;
  const edge = Number(cfg.image_long_edge);
  // The app resizes photos before upload. Decoding a 12 MP photo here is near the edge worker's CPU/memory
  // limit (546 under concurrent load), so server-side resize is off unless config server_resize = true.
  if (cfg.server_resize === true && edge > 0 && bytes.length > 350_000) {
    // one decode at a time per worker: a 12 MP photo needs ~50 MB while decoded
    const run = resizeQueue.then(async () => {
      const Image = await loadImageLib();
      let img: any = await Image.decode(bytes);
      if (Math.max(img.width, img.height) <= edge) return null;
      img.resize(img.width >= img.height ? edge : Image.RESIZE_AUTO, img.height > img.width ? edge : Image.RESIZE_AUTO);
      const outBytes: Uint8Array = await img.encodeJPEG(80);
      img = null;
      return outBytes;
    });
    resizeQueue = run.then(() => undefined, () => undefined);
    try {
      const small = await run;
      if (small) { bytes = small; mime = "image/jpeg"; resized = true; }
    } catch (e) { note = "resize_failed: " + String((e as Error)?.message ?? e).slice(0, 80); }
  }
  return { block: { type: "image", source: { type: "base64", media_type: mime, data: encodeBase64(bytes) } }, mime, pages: 1, bytesSent: bytes.length, resized, note };
}

export type ReadOpts = { purpose: "scan" | "audit"; currency: string; lang: string; hint?: string; amountHint?: number; noEscalate?: boolean };
export type ReadResult = {
  version: number; documents: any[]; overall_note?: string;
  model: string; verify?: string; escalated: boolean; reasons: string[]; haiku?: { documents: any[] } | null; stop_reason?: string;
};

// Optional reasoning-effort override per call type (config keys effort_haiku / effort_verify / effort_sonnet;
// null or missing = the model's default). Thinking is billed as output tokens.
function effortFor(cfg: Record<string, any> | undefined, model: string, slim: boolean): string | null {
  const k = model === HAIKU ? "effort_haiku" : slim ? "effort_verify" : "effort_sonnet";
  const v = cfg?.[k];
  return typeof v === "string" && ["low", "medium", "high"].includes(v) ? v : null;
}

async function call(ctx: UsageCtx, key: string, model: string, prep: FilePrep, o: ReadOpts, slim = false, cfg?: Record<string, any>) {
  const effort = effortFor(cfg, model, slim);
  const user = `Requested language for title, note and overall_note: ${LANG_NAME[o.lang] ?? "English"}. If the document shows no currency, use ${o.currency}.` +
    (o.hint ? `\n${o.hint}` : "");
  let max = slim ? Math.min(8000, 1500 + 500 * Math.max(0, prep.pages - 1)) : Math.min(16000, 4000 + 1500 * Math.max(0, prep.pages - 1));
  for (let attempt = 0; attempt < 2; attempt++) {
    const { r, out } = await anthropic(ctx, key, {
      model, max_tokens: max, ...(effort ? { output_config: { effort } } : {}),
      tools: [slim ? VERIFY_TOOL : TOOL], tool_choice: { type: "auto" },
      system: [{ type: "text", text: slim ? VERIFY_SYSTEM : SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [prep.block, { type: "text", text: user }] }],
    });
    if (!r.ok) throw new Error(out?.error?.message ?? `anthropic_${r.status}`);
    if (out.stop_reason === "max_tokens" && attempt === 0 && max < 16000) { max = slim ? 8000 : 16000; continue; }
    return out;
  }
  throw new Error("unreachable");
}

export function tidyRead(out: any, currency: string) {
  const tu = (out?.content ?? []).find((c: any) => c.type === "tool_use" && (c.name === "record_bills" || c.name === "record_totals"));
  let res: any = tu?.input;
  if (!res) {
    const text = (out?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    const m = text.match(/\{[\s\S]*\}/);
    try { res = m ? JSON.parse(m[0]) : null; } catch { res = null; }
  }
  if (!res || !Array.isArray(res.documents)) res = { documents: [] };
  for (const d of res.documents) {
    d.amount = Math.max(0, Math.round(Number(d.amount || 0) * 100) / 100);
    d.grand_total = d.amount;                         // Bill Check rules read grand_total
    d.currency = /^[A-Z]{3}$/.test(String(d.currency || "").toUpperCase()) ? String(d.currency).toUpperCase() : currency;
    if (!CATEGORIES.includes(d.category)) d.category = "other";
    if (d.date && !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) d.date = "";
    if (!Array.isArray(d.items)) d.items = [];
    if (!Array.isArray(d.visual_flags)) d.visual_flags = [];
  }
  return res;
}

const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
const near = (a: number, b: number, tol = 0.01, abs = 2) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * tol);

/** Does the bill add up? false = a clear inconsistency (may be a misread, or a real problem — either way, re-read). */
export function reconciles(d: any): boolean {
  const total = n(d.amount);
  if (!total) return true;
  const w = n(d.amount_in_words_value);
  if (w && !near(w, total, 0.001, 1)) return false;
  const items: any[] = d.items ?? [];
  const sum = items.reduce((a, it) => a + (n(it.amount) ?? 0), 0);
  if (items.length >= 2 && sum > 0) {
    const sub = n(d.subtotal), disc = n(d.discount) ?? 0, tax = n(d.tax) ?? 0;
    const ok = [sub, total, total + disc, total - tax, total + disc - tax].some((v) => v != null && near(sum, v));
    if (!ok) return false;
  }
  return true;
}

export function escalationReasons(res: any, o: ReadOpts, cfg: Record<string, any>): string[] {
  const why = new Set<string>();
  const docs: any[] = res.documents ?? [];
  if (!docs.length) why.add("no_documents");
  for (const d of docs) {
    const money = MONEY_DOCS.includes(d.doc_type);
    if (money && d.confidence !== "high") why.add("low_confidence");
    if (money && d.handwritten && (cfg.haiku_handwritten !== "high_conf" || d.confidence !== "high")) why.add("handwritten");
    if (money && d.script && d.script !== "latin" && (cfg.haiku_indic !== "high_conf" || d.confidence !== "high")) why.add("indic_script");
    if (money && !reconciles(d)) why.add("does_not_reconcile");
    if (o.purpose === "audit" && money && Math.max(d.amount ?? 0, o.amountHint ?? 0) >= Number(cfg.escalate_amount)) why.add("high_value");
    if (o.purpose === "audit" && d.readability === "poor") why.add("poor_readability");
  }
  return [...why];
}

/** Haiku first; Sonnet when escalationReasons says so (unless noEscalate). */
export async function readBill(ctx: UsageCtx, key: string, prep: FilePrep, o: ReadOpts, cfg: Record<string, any>, forceModel?: string): Promise<ReadResult> {
  if (forceModel === "verify") {   // eval only: the short Sonnet amount check on its own
    const out = await call(ctx, key, SONNET, prep, o, true, cfg);
    return { version: READ_VERSION, ...tidyRead(out, o.currency), model: SONNET, verify: "amounts", escalated: false, reasons: [], stop_reason: out.stop_reason };
  }
  if (forceModel) {
    const out = await call(ctx, key, forceModel, prep, o, false, cfg);
    const res = tidyRead(out, o.currency);
    return { version: READ_VERSION, ...res, model: forceModel, escalated: false, reasons: [], stop_reason: out.stop_reason };
  }
  const out1 = await call({ ...ctx, fn: ctx.fn + ":haiku" }, key, HAIKU, prep, o, false, cfg);
  const r1 = tidyRead(out1, o.currency);
  if (out1.stop_reason === "max_tokens") r1.documents = r1.documents ?? [];
  const reasons = escalationReasons(r1, o, cfg);
  if (out1.stop_reason === "max_tokens") reasons.push("truncated");
  if (!reasons.length || o.noEscalate) return { version: READ_VERSION, ...r1, model: HAIKU, escalated: false, reasons, stop_reason: out1.stop_reason };
  if (o.purpose === "scan") {
    const out2 = await call({ ...ctx, fn: ctx.fn + ":verify" }, key, SONNET, prep, o, true, cfg);
    const r2 = tidyRead(out2, o.currency);
    return { version: READ_VERSION, ...mergeVerified(r1, r2), model: SONNET, verify: "amounts", escalated: true, reasons, haiku: { documents: r1.documents }, stop_reason: out2.stop_reason };
  }
  const out2 = await call({ ...ctx, fn: ctx.fn + ":sonnet" }, key, SONNET, prep, o, false, cfg);
  const r2 = tidyRead(out2, o.currency);
  return { version: READ_VERSION, ...r2, model: SONNET, escalated: true, reasons, haiku: { documents: r1.documents }, stop_reason: out2.stop_reason };
}

/** Sonnet's documents and amounts win. A Haiku doc's line items / GSTIN / forensic fields are kept only when it is
 *  clearly the same document with the same amount; otherwise they are dropped, so Bill Check never runs its rules
 *  on items that don't belong to the amount shown. */
export function mergeVerified(haiku: any, sonnet: any) {
  const used = new Set<number>();
  const docs = (sonnet.documents ?? []).map((s: any) => {
    let j = (haiku.documents ?? []).findIndex((h: any, i: number) => !used.has(i) && h.doc_type === s.doc_type &&
      near(Number(h.amount), Number(s.amount), 0.002, 1) && (!s.pages?.length || !h.pages?.length || h.pages.some((p: number) => s.pages.includes(p))));
    if (j < 0) return { ...s, amount_verified: true, haiku_match: false };
    used.add(j);
    const h = haiku.documents[j];
    return { ...h, ...s, items: h.items, visual_flags: h.visual_flags, amount_verified: true, haiku_match: true };
  });
  return { documents: docs, overall_note: sonnet.overall_note || haiku.overall_note };
}

/** Find a cached read: exact page range first, then the whole-file read. */
export async function cachedRead(admin: any, path: string, pages: number[]) {
  const keys = [`${path}#${pages.join(",")}`];
  if (pages.length) keys.push(`${path}#`);
  const { data } = await admin.from("saath_doc_audits").select("path, model, result").in("path", keys);
  const exact = (data ?? []).find((r: any) => r.path === keys[0]);
  return exact ?? (data ?? [])[0] ?? null;
}

export async function storeRead(admin: any, path: string, pages: number[], circleId: string, res: ReadResult, fileHash: string) {
  await admin.from("saath_doc_audits").upsert({ path: `${path}#${pages.join(",")}`, circle_id: circleId, model: res.model, result: { ...res, file_hash: fileHash } });
}
