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
  ai_override: "auto" | "on" | "off"; plus_until: string | null; plus_source: string | null; ai_trial_used: number;
  plus_active: boolean; wants_plus: boolean;
};
export type AdminRequest = { id: string; circle_id: string; circle: string; country: string | null; period: "month" | "year" | "pass90"; price_text: string | null; created_at: string; by: string | null; email: string | null };
export type PriceRow = { country: string; tier: string; currency: string; monthly: number; yearly: number; pass90: number; ai_allowance_usd: number; updated_at?: string };
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

export const adminSetAi = (id: string, override: "auto" | "on" | "off") => rpc<void>("saath_admin_set_ai", { p_circle: id, p_override: override });
/** months <= 0 revokes Plus. Sets the circle's AI allowance from its price tier and closes open requests. */
export const adminGrantPlus = (id: string, months: number, note?: string) => rpc<void>("saath_admin_grant_plus", { p_circle: id, p_months: months, p_note: note ?? null });
export const adminRequests = () => rpc<AdminRequest[]>("saath_admin_requests");
export const adminDeclineRequest = (id: string) => rpc<void>("saath_admin_decline_request", { p_id: id });
export async function adminPricing(): Promise<PriceRow[]> {
  const { data, error } = await supabase.from("saath_pricing").select("*").order("tier").order("country");
  if (error) throw error;
  return data as PriceRow[];
}
export const adminSetPrice = (r: PriceRow) => rpc<void>("saath_admin_set_price", {
  p_country: r.country, p_tier: r.tier, p_currency: r.currency, p_monthly: r.monthly, p_yearly: r.yearly, p_pass90: r.pass90, p_allowance: r.ai_allowance_usd,
});
export type Traffic = {
  by_source: { source: string; visits_30d: number; visitors_30d: number; visits_all: number; signups_30d: number; signups_all: number }[];
  pages_30d: { page: string; visits: number }[];
  daily: { day: string; visits: number; from_macronations: number }[];
  signups_total: number; signups_30d: number;
};
export const adminTraffic = () => rpc<Traffic>("saath_admin_traffic");
export const PERIOD_MONTHS = { month: 1, year: 12, pass90: 3 } as const;

export const usd = (n: number | null | undefined, d = 2) => `$${Number(n ?? 0).toFixed(d)}`;
