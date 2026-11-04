import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { supabase } from "./supabase";

export type Member = {
  id: string; name: string; relation: string | null; role: "admin" | "member"; share: number; status: "active" | "left";
  joined: boolean; is_me: boolean | null; phone: string | null; email: string | null; language: string;
  notify_whatsapp: boolean; notify_email: boolean; charged: number; credited: number; balance: number;
};
export type PayMethod = { id: string; payee_id: string; method: string; label: string | null; handle: string | null; details: Record<string, string>; sort: number };
export type Payee = { id: string; name: string; kind: string; notes: string | null; is_default: boolean; member_id: string | null; methods: PayMethod[] };
export type Circle = {
  id: string; name: string; purpose: string; description: string | null; currency: string; split_mode: "expenses" | "budget";
  budget_amount: number | null; period: "weekly" | "biweekly" | "monthly" | "quarterly"; due_day: number; start_date: string;
  require_confirmation: boolean; remind_whatsapp: boolean; remind_email: boolean; invite_code: string; status: string;
};
export type Summary = {
  circle: Circle; me: string | null; is_admin: boolean;
  period: { start: string; end: string; next_due: string; expenses: number; collected: number };
  totals: { expenses: number; expenses_count: number; contributed: number; pending: number; pot: number; outstanding: number; shares_total: number };
  members: Member[]; payees: Payee[]; categories: { category: string; total: number }[];
};
export type Expense = {
  id: string; circle_id: string; title: string; amount: number; category: string; spent_on: string; vendor: string | null;
  notes: string | null; paid_by_member_id: string | null; orig_amount: number | null; orig_currency: string | null;
  split: Record<string, number> | null; created_by: string; created_at: string; saath_receipts?: { id: string }[];
};
export type Contribution = {
  id: string; circle_id: string; member_id: string; kind: "payment" | "expense_paid" | "reimbursement"; amount: number;
  orig_amount: number | null; orig_currency: string | null; method: string | null; reference: string | null; paid_on: string;
  payee_id: string | null; expense_id: string | null; proof_path: string | null; notes: string | null;
  status: "pending" | "confirmed" | "rejected"; created_by: string; created_at: string;
};
export type Activity = { id: number; verb: string; data: any; created_at: string; actor: string | null };

/** Load-on-focus helper: re-fetches whenever the screen comes back into view. */
export function useLoad<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try { const d = await fn(); if (alive.current) { setData(d); setError(null); } }
    catch (e: any) { if (alive.current) setError(String(e?.message ?? e)); }
    finally { if (alive.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useFocusEffect(useCallback(() => { alive.current = true; reload(); return () => { alive.current = false; }; }, [reload]));
  return { data, error, loading, reload, setData };
}

export async function loadSummary(id: string): Promise<Summary> {
  const { data, error } = await supabase.rpc("saath_circle_summary", { p_circle: id });
  if (error) throw error;
  return data as Summary;
}

export const memberName = (s: Summary | null, id: string | null | undefined) =>
  (id && s?.members.find((m) => m.id === id)?.name) || "";
