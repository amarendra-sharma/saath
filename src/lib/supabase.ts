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

/** Call one of Saath's edge functions; returns parsed JSON or throws with the server's error code. */
export async function callFn<T = any>(name: string, body: unknown, authed = false): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: SUPABASE_KEY };
  if (authed) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = new Error(j.message || j.error || `http_${r.status}`);
    (e as any).code = j.error;
    (e as any).serverMessage = j.message;   // e.g. AI allowance used up: the server explains in plain words
    throw e;
  }
  return j as T;
}

/** Postgres raises come back as messages; strip the noise. */
export function errText(e: any): string {
  const m = String(e?.message ?? e ?? "");
  return m.replace(/^.*?ERROR:\s*/i, "").slice(0, 200);
}
