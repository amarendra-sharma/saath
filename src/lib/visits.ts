import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "./supabase";

/** Web only: where visitors come from (the about/guide pages set this up — see public/saath-track.js).
 *  Counts an app visit once per browser session, and credits a NEW Bengu user to the link that brought them. */
const ls = (k: string, v?: string) => {
  try { if (v === undefined) return window.localStorage.getItem(k); window.localStorage.setItem(k, v); } catch { /* private mode */ }
  return null;
};
const ss = (k: string, v?: string) => {
  try { if (v === undefined) return window.sessionStorage.getItem(k); window.sessionStorage.setItem(k, v); } catch { /* private mode */ }
  return null;
};
type Src = { source: string; medium?: string; mn_sid?: string; at: number };

function source(): Src | null {
  if (Platform.OS !== "web") return null;
  // a link straight into the app may carry the source too
  try {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("utm_source");
    if (s) { const v: Src = { source: s, medium: q.get("utm_medium") ?? "", mn_sid: q.get("mn_sid") ?? "", at: Date.now() }; ls("saath_src", JSON.stringify(v)); return v; }
  } catch { /* ignore */ }
  try { const v = JSON.parse(ls("saath_src") ?? "null"); return v && Date.now() - v.at < 30 * 864e5 ? v : null; } catch { return null; }
}
function visitor() {
  let v = ls("saath_vid");
  if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); ls("saath_vid", v); }
  return v;
}

export function trackAppVisit() {
  if (Platform.OS !== "web" || ss("saath_app_visit")) return;
  ss("saath_app_visit", "1");
  const s = source();
  supabase.rpc("saath_track_visit", { p_source: s?.source ?? "direct", p_medium: s?.medium ?? "", p_page: "/app", p_mn_sid: s?.mn_sid ?? "", p_visitor: visitor() }).then(() => {}, () => {});
}

/** After sign-in: the server ignores this unless the Bengu profile is new (under 3 days), so it is safe to call each time. */
export function attributeSignup(userId: string) {
  if (Platform.OS !== "web" || ls("saath_attr_" + userId)) return;
  const s = source();
  if (!s) return;
  supabase.rpc("saath_attribute_me", { p_source: s.source, p_medium: s.medium ?? "", p_mn_sid: s.mn_sid ?? "", p_visitor: visitor() })
    .then(({ error }) => { if (!error) ls("saath_attr_" + userId, "1"); }, () => {});
}

export const guideUrl = (section?: string) => {
  const base = String((Constants.expoConfig?.extra as any)?.guideUrl ?? "https://bengu.macronations.com/guide.html");
  return section ? `${base}#${section}` : base;
};
