import { callFn, supabase } from "./supabase";

export type Severity = "high" | "medium" | "low" | "info";
export type CheckFlag = {
  code: string; severity: Severity; params?: Record<string, any>; detail?: string; source?: "rule" | "visual" | "price";
};
export type Benchmark = {
  name: string; unit: string; billed: number; qty: number; low: number | null; high: number | null; ceiling: number | null;
  verdict: "fair" | "high" | "very_high" | "above_ceiling" | "low" | "unknown"; reference?: string; explanation?: string; sources?: string[];
};
export type CheckItem = { name: string; qty?: number; unit?: string; rate?: number; mrp?: number; amount: number; batch?: string; expiry?: string };
export type BillCheck = {
  expense_id: string; circle_id: string; status: string; risk: "none" | "low" | "medium" | "high"; score: number;
  flags: CheckFlag[]; items: CheckItem[]; benchmarks: Benchmark[]; dismissed: string[]; had_file: boolean;
  doc: { vendor?: string; gstin?: string; bill_number?: string; patient_name?: string; handwritten?: boolean } | null;
  checked_at: string;
  ai?: { read_model?: string | null; web_search?: boolean; auto?: boolean; limit_reached?: boolean; message?: string;
    allowance?: { cap_usd: number; spent_usd: number; remaining_usd: number } };
};

/** Server codes that mean "AI is unavailable for now" (limits), not "something broke". */
export const AI_LIMIT_CODES = ["ai_limit_reached", "ai_paused", "too_many_requests", "scan_limit", "upgrade_required", "scan_off", "ai_off"];

/** Paid-tier switch: set in the admin console (Settings → Features → "Bill Check only on Plus"); loaded at sign-in. */
let BILL_CHECK_PAID = false;
export const setBillCheckPaid = (v: boolean) => { BILL_CHECK_PAID = v; };
export const billCheckAllowed = (plan: string | undefined) => !BILL_CHECK_PAID || plan === "plus";

export const SEV_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
export const flagKey = (f: CheckFlag) => f.code + (f.params?.item ? ":" + f.params.item : "") + (f.params?.other_id ? ":" + f.params.other_id : "");

/** auto = the check that runs by itself after a bill is added: rules + the cheap read only, never web search. */
export async function runCheck(expenseId: string, lang: string, auto = false): Promise<BillCheck> {
  return callFn<BillCheck>("saath-check", { expense_id: expenseId, language: lang, auto }, true);
}
export async function loadCheck(expenseId: string): Promise<BillCheck | null> {
  const { data } = await supabase.from("saath_bill_checks").select("*").eq("expense_id", expenseId).maybeSingle();
  return (data as BillCheck) ?? null;
}
export async function loadCircleChecks(circleId: string): Promise<Record<string, Pick<BillCheck, "risk" | "score" | "flags" | "dismissed">>> {
  const { data } = await supabase.from("saath_bill_checks").select("expense_id, risk, score, flags, dismissed").eq("circle_id", circleId);
  return Object.fromEntries((data ?? []).map((r: any) => [r.expense_id, r]));
}
export async function dismissFlag(expenseId: string, key: string, undo = false) {
  const { error } = await supabase.rpc("saath_dismiss_flag", { p_expense: expenseId, p_code: key, p_undo: undo });
  if (error) throw error;
}

/** Warnings still open (not marked as checked), most serious first. */
export function openFlags(c: Pick<BillCheck, "flags" | "dismissed"> | null | undefined) {
  if (!c) return [] as CheckFlag[];
  const d = new Set(c.dismissed ?? []);
  return (c.flags ?? []).filter((f) => f.severity !== "info" && !d.has(flagKey(f))).sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}
/** Risk after the family's own "it's fine" marks. */
export function openRisk(c: Pick<BillCheck, "flags" | "dismissed"> | null | undefined): "none" | "low" | "medium" | "high" {
  const f = openFlags(c);
  const s = f.reduce((a, x) => a + (x.severity === "high" ? 40 : x.severity === "medium" ? 15 : 5), 0);
  return s >= 40 ? "high" : s >= 15 ? "medium" : s > 0 ? "low" : "none";
}

/** Turn a flag into text: rule flags are translated by code, model-written ones carry their own detail. */
export function flagText(t: (k: string, p?: Record<string, any>) => string, f: CheckFlag, fmt: (n: number) => string) {
  const p: Record<string, any> = {};
  for (const [k, v] of Object.entries(f.params ?? {})) p[k] = Array.isArray(v) ? v.join("; ") : typeof v === "number" && !["n"].includes(k) ? fmt(v) : String(v ?? "");
  const key = f.code.startsWith("visual_") ? "bc_visual" : "bc_" + f.code;
  let title = t(key + "_t", p);
  if (title === key + "_t") title = t("bc_other_t");
  let body = t(key, p);
  if (body === key) body = "";
  if (f.detail) body = body ? `${body} ${f.detail}` : f.detail;
  const doKey = (f.code.startsWith("visual_") ? "bc_visual" : "bc_" + f.code) + "_do";
  const todo = t(doKey, p);
  return { title, body, todo: todo === doKey ? "" : todo };
}
