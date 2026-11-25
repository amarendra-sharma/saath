import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";
import { AppState, Platform } from "react-native";

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl: string; supabaseKey: string };
export const SUPABASE_URL = extra.supabaseUrl;
export const SUPABASE_KEY = extra.supabaseKey;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: AsyncStorage,
    storageKey: "saath-auth",
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// keep the session fresh only while the app is in the foreground (native)
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

export const RECEIPTS_BUCKET = "saath-receipts";

/** Call one of Bengu's edge functions; returns parsed JSON or throws with the server's error code. */
export async function callFn<T = any>(name: string, body: unknown, authed = false): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: SUPABASE_KEY };
  if (authed) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = new Error(j.error || j.message || `http_${r.status}`);
    (e as any).code = j.error;
    (e as any).serverMessage = j.message;   // e.g. AI allowance used up: the server explains in plain words
    throw e;
  }
  return j as T;
}

/** Postgres raises come back as messages; strip the noise. */
/** Error text for people. With t, a database code such as "bill_has_payment" becomes the sentence err_bill_has_payment. */
// Older database messages written as English sentences → the translated sentence to show instead.
const ERR_ALIAS: Record<string, string> = {
  "a circle needs at least one organiser": "err_need_organiser", "not a member": "err_not_member", "not allowed": "err_not_allowed",
  "not signed in": "err_not_signed_in", "only an organiser can change shares": "only_organiser",
  "only an organiser can record reimbursements": "only_organiser", "only the circle organiser can publish the agreement": "only_organiser",
  "edit the expense instead": "err_edit_expense_instead", "invalid code": "code_not_found", "bad_code": "code_not_found",
  "that person has already joined": "err_already_joined", "you can only record your own payments": "err_own_payments_only",
  "bad member": "err_generic", "forbidden": "err_not_allowed", "unauthorized": "err_not_signed_in", "admin_only": "err_not_allowed",
  "upgrade_required": "bc_plus_text", "scan_failed": "err_scan_failed", "check_failed": "bc_failed",
  "failed to fetch": "err_network", "network request failed": "err_network", "load failed": "err_network",
};
let globalT: ((k: string) => string) | null = null;
let globalLang = "en";
/** The app sets this whenever the language changes, so every error message is shown in the person's language. */
export function setErrTranslator(t: (k: string) => string, lang: string) { globalT = t; globalLang = lang; }

export function errText(e: any, t?: (k: string) => string): string {
  const tr = t ?? globalT;
  const raw = String(e?.code || e?.message || e || "").replace(/^.*?ERROR:\s*/i, "").trim();
  const msg = String(e?.message ?? "").replace(/^.*?ERROR:\s*/i, "").trim();
  if (!tr) return (e?.serverMessage || msg || raw).slice(0, 200);
  for (const m of [raw, msg]) {
    const key = ERR_ALIAS[m.toLowerCase()] ?? (/^[a-z_]+$/.test(m) ? "err_" + m : "");
    if (key) { const s = tr(key); if (s !== key) return s; }
  }
  // A plain-words server message is fine in English; in other languages, say it generally rather than show English.
  if (globalLang === "en" && (e?.serverMessage || (msg && !/^[a-z_0-9]+$/.test(msg)))) return String(e?.serverMessage || msg).slice(0, 200);
  return tr("err_generic");
}
