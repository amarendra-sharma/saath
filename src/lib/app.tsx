import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Session } from "@supabase/supabase-js";
import { getLocales } from "expo-localization";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Alert, Platform } from "react-native";
import { STRINGS, LangCode, LANGS } from "./strings";
import { supabase } from "./supabase";

export type Profile = {
  id: string; full_name: string; email: string | null; phone: string | null; language: string;
  notify_whatsapp: boolean; notify_email: boolean;
};

type Ctx = {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  lang: LangCode;
  setLang: (l: LangCode) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
  refreshProfile: () => Promise<void>;
};

const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

function deviceLang(): LangCode {
  const code = getLocales()?.[0]?.languageCode ?? "en";
  return (LANGS.find((l) => l.code === code)?.code ?? "en") as LangCode;
}

export function translate(lang: LangCode, key: string, params?: Record<string, string | number>) {
  let s = (STRINGS[lang] as Record<string, string>)[key] ?? (STRINGS.en as Record<string, string>)[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lang, setLangState] = useState<LangCode>("en");

  const refreshProfile = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) { setProfile(null); return; }
    const { data, error } = await supabase.rpc("saath_ensure_profile");
    if (!error && data) {
      setProfile(data as Profile);
      if ((data as Profile).language && STRINGS[(data as Profile).language as LangCode]) {
        setLangState((data as Profile).language as LangCode);
        AsyncStorage.setItem("saath-lang", (data as Profile).language).catch(() => {});
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      let stored: string | null = null;
      try { stored = await AsyncStorage.getItem("saath-lang"); } catch {}
      setLangState(((stored && STRINGS[stored as LangCode]) ? stored : deviceLang()) as LangCode);
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      if (data.session) await refreshProfile();
      setReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) setProfile(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshProfile]);

  const setLang = useCallback(async (l: LangCode) => {
    setLangState(l);
    try { await AsyncStorage.setItem("saath-lang", l); } catch {}
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      await supabase.from("saath_profiles").update({ language: l }).eq("id", data.session.user.id);
      await supabase.from("saath_members").update({ language: l }).eq("user_id", data.session.user.id);
    }
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>) => translate(lang, key, params), [lang]);

  const value = useMemo(() => ({ ready, session, profile, lang, setLang, t, refreshProfile }), [ready, session, profile, lang, setLang, t, refreshProfile]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

// ---- cross-platform dialogs (Alert.alert has no buttons on web) ----
export function notify(title: string, message?: string) {
  if (Platform.OS === "web") (globalThis as any).alert?.([title, message].filter(Boolean).join("\n\n"));
  else Alert.alert(title, message);
}

export function confirm(title: string, message: string, okLabel: string, cancelLabel: string, destructive = false): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(!!(globalThis as any).confirm?.(`${title}\n\n${message}`));
  return new Promise((res) =>
    Alert.alert(title, message, [
      { text: cancelLabel, style: "cancel", onPress: () => res(false) },
      { text: okLabel, style: destructive ? "destructive" : "default", onPress: () => res(true) },
    ], { cancelable: true, onDismiss: () => res(false) }));
}
