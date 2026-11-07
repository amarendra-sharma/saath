import { supabase } from "./supabase";

/** App-admin API. Every call goes to a SECURITY DEFINER function that refuses non-admins (migration 013). */
export type AdminOverview = {
  users: number; circles: number; circles_all: number; expenses: number; scans_30d: number; checks_30d: number;
  ai_today: number; ai_month: number; ai_all: number; ai_failed_7d: number; last_ai_error: string | null;
  daily: { day: string; usd: number; calls: number }[];
  by_function: { fn: string; usd: number; calls: number }[];
  alerts: { created_at: string; kind: string; usd: number | null; detail: string; emailed: boolean; circle: string | null }[];
};
export type AdminCircle = {
  id: string; name: string; purpose: string; currency: string; city: string | null; country: string; plan: string; status: string;
  bill_check_auto: boolean; cap_usd: number; spent_usd: number; created_at: string; members: number; expenses: number;
  expense_total: number; owner: string | null;
};
export type AdminUser = {
  id: string; full_name: string; email: string | null; phone: string | null; created_at: string | null; last_sign_in_at: string | null;
  is_admin: boolean; circles: number; ai_30d: number;
};
export type ConfigRow = { key: string; value: any; note: string | null; updated_at: string };

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const isAdmin = () => rpc<boolean>("saath_is_admin").catch(() => false);
export const appFlags = () => rpc<Record<string, any>>("saath_app_flags").catch(() => ({} as Record<string, any>));
export const adminOverview = () => rpc<AdminOverview>("saath_admin_overview");
export const adminCircles = () => rpc<AdminCircle[]>("saath_admin_circles");
export const adminUsers = () => rpc<AdminUser[]>("saath_admin_users");
export const adminConfig = () => rpc<ConfigRow[]>("saath_admin_config");
export const adminSetConfig = (key: string, value: any) => rpc<void>("saath_admin_set_config", { p_key: key, p_value: value });
export const adminSetAdmin = (user: string, on: boolean) => rpc<void>("saath_admin_set_admin", { p_user: user, p_on: on });
export const adminUpdateCircle = (id: string, p: { plan?: string; cap_usd?: number; bill_check_auto?: boolean; status?: string }) =>
  rpc<void>("saath_admin_update_circle", {
    p_circle: id, p_plan: p.plan ?? null, p_cap_usd: p.cap_usd ?? null, p_bill_check_auto: p.bill_check_auto ?? null, p_status: p.status ?? null,
  });

export const usd = (n: number | null | undefined, d = 2) => `$${Number(n ?? 0).toFixed(d)}`;
