import { getLocales } from "expo-localization";
import { supabase } from "./supabase";

/** Bengu Plus: who has AI, regional prices, and asking for an upgrade (migration 014).
 *  Until a payment provider is connected, a request lands in the admin console and the admin grants Plus by hand. */
export type AiAccess = {
  enabled: boolean;
  reason: "admin_off" | "admin_on" | "plus" | "free_mode" | "trial" | "plus_required" | string;
  paid_mode: boolean; plus: boolean; plus_until: string | null; trial_total: number; trial_left: number;
  override: "auto" | "on" | "off"; country: string | null;
};
export type Price = { country: string; tier: "A" | "B" | "C" | "D"; currency: string; monthly: number; yearly: number; pass90: number; ai_allowance_usd: number };
export type UpgradeRequest = { id: string; circle_id: string; period: "month" | "year" | "pass90"; price_text: string | null; status: "open" | "granted" | "declined"; created_at: string };

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const aiStatus = (circle: string) => rpc<AiAccess | null>("saath_circle_ai_status", { p_circle: circle }).catch(() => null);
export const myUpgradeRequest = (circle: string) => rpc<UpgradeRequest | null>("saath_my_upgrade_request", { p_circle: circle }).catch(() => null);
export const requestUpgrade = (circle: string, period: UpgradeRequest["period"], priceText: string) =>
  rpc<void>("saath_request_upgrade", { p_circle: circle, p_period: period, p_price_text: priceText });

/** Device region first (where the person pays from), then the circle's country. */
export function payCountry(circleCountry?: string | null) {
  try { const r = getLocales()[0]?.regionCode; if (r) return r.toUpperCase(); } catch { /* web without locale */ }
  return (circleCountry || "*").toUpperCase();
}
export const priceFor = (country: string) => rpc<Price>("saath_price_for", { p_country: country });

export function priceText(n: number, currency: string, lang = "en") {
  try {
    const whole = Math.abs(n - Math.round(n)) < 0.001;
    return new Intl.NumberFormat(lang === "en" ? undefined : lang, { style: "currency", currency, maximumFractionDigits: whole ? 0 : 2, minimumFractionDigits: whole ? 0 : 2 }).format(n);
  } catch { return `${currency} ${n}`; }
}
/** Yearly saving against 12 monthly payments, in whole percent. */
export const yearlySaving = (p: Price) => Math.max(0, Math.round((1 - Number(p.yearly) / (Number(p.monthly) * 12)) * 100));

/** AI is on for this circle but limited (trial) — show "n free reads left". */
export const onTrial = (a: AiAccess | null) => !!a && a.reason === "trial";
/** AI is locked: show the Plus card instead of the scan buttons. */
export const aiLocked = (a: AiAccess | null) => !!a && !a.enabled;
