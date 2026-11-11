import { supabase } from "./supabase";

/** Money trail (migration 015): where pooled money went after a receiver got it. */
export type Holder = {
  payee_id: string; name: string; kind: string; member_id: string | null;
  received: number; paid_out: number; reimbursed: number; balance: number; verified: number; no_proof: number;
  last_payout: string | null; last_received: string | null;
};
export type TrailBill = { id: string; title: string; amount: number; paid: number; status: "unpaid" | "partial"; questioned: boolean; spent_on: string; vendor: string | null; category: string; age: number };
export type Payout = {
  id: string; payee_id: string; payee: string; vendor: string | null; amount: number; allocated: number; paid_on: string;
  method: string | null; reference: string | null; proof_path: string | null; notes: string | null;
  status: "recorded" | "verified" | "questioned"; question: string | null; created_at: string; mine: boolean;
  recorded_by: string | null; verified_by: string | null; verified_at: string | null; questioned_by: string | null; questioned_at: string | null;
  asked_by_me: boolean; i_am_receiver: boolean;
  items: { expense_id: string; title: string; amount: number; bill_amount: number; spent_on: string }[];
};
export type LedgerRow = { payee_id: string; type: "in" | "out" | "reimb"; d: string; at: string; amount: number; who: string | null; method: string | null; reference: string | null; proof: boolean; status?: string; id?: string };
export type Check = { code: string; severity: "high" | "medium" | "low" | "info"; [k: string]: any };
export type Trail = {
  alert_days: number; can_record: string[]; holders: Holder[]; bills: TrailBill[]; payouts: Payout[]; ledger: LedgerRow[]; checks: Check[];
  totals: { bills: number; bills_paid: number; bills_unpaid: number; unpaid_count: number; held: number };
};
export type BillStatus = { expense_id: string; status: "member_paid" | "verified" | "paid" | "partial" | "unpaid"; paid: number; questioned: boolean; payouts: number };

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}
export const loadTrail = (circle: string) => rpc<Trail>("saath_money_trail", { p_circle: circle });
export async function loadBillStatus(circle: string): Promise<Record<string, BillStatus>> {
  const rows = await rpc<BillStatus[]>("saath_bill_status", { p_circle: circle }).catch(() => [] as BillStatus[]);
  return Object.fromEntries((rows ?? []).map((r) => [r.expense_id, r]));
}
export const recordPayout = (p: { payee: string; amount: number; paidOn: string; vendor: string; method: string | null; reference: string; proofPath: string | null; notes: string; items: { expense_id: string; amount: number }[] }) =>
  rpc<string>("saath_payout_record", { p_payee: p.payee, p_amount: p.amount, p_paid_on: p.paidOn, p_vendor: p.vendor, p_method: p.method,
    p_reference: p.reference, p_proof_path: p.proofPath, p_notes: p.notes, p_items: p.items });
export const addPayoutProof = (id: string, proofPath: string | null, reference: string, note: string) =>
  rpc<void>("saath_payout_add_proof", { p_payout: id, p_proof_path: proofPath, p_reference: reference, p_note: note });
export const verifyPayout = (id: string) => rpc<void>("saath_payout_verify", { p_payout: id });
export const questionPayout = (id: string, q: string) => rpc<void>("saath_payout_question", { p_payout: id, p_question: q });
export const clearQuestion = (id: string) => rpc<void>("saath_payout_clear_question", { p_payout: id });
export const deletePayout = (id: string) => rpc<void>("saath_payout_delete", { p_payout: id });

/** Tone of a bill's payment state, for pills. */
export const BILL_TONE: Record<string, "ok" | "primary" | "pending" | "owe" | "neutral"> = {
  verified: "ok", member_paid: "ok", paid: "primary", partial: "pending", unpaid: "owe",
};
