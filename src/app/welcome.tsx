import Constants from "expo-constants";
import { router } from "expo-router";
import React, { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Field, Icon } from "../components/ui";
import { notify, useApp } from "../lib/app";
import { LANGS, LangCode } from "../lib/strings";
import { openUrl } from "../lib/share";
import { callFn, errText, supabase } from "../lib/supabase";
import { C, R, S, T } from "../lib/theme";

type Mode = "start" | "signin" | "signup" | "reset" | "reset2";

export default function Welcome() {
  const { t, lang, setLang, refreshProfile } = useApp();
  const ins = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>("start");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async (fn: () => Promise<void>) => {
    setErr(null); setBusy(true);
    try { await fn(); } catch (e: any) { setErr(t("err_" + (e?.code || "")) !== "err_" + (e?.code || "") ? t("err_" + e.code) : errText(e)); }
    finally { setBusy(false); }
  };

  const signIn = () => go(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) { const e: any = new Error(error.message); e.code = /invalid/i.test(error.message) ? "invalid_login" : ""; throw e; }
    await refreshProfile();
    router.replace("/home");
  });

  const signUp = () => go(async () => {
    if (!name.trim()) { const e: any = new Error(""); e.code = "name_required"; throw e; }
    await callFn("saath-signup", { email, password, full_name: name, language: lang });
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw error;
    await refreshProfile();
    router.replace("/home");
  });

  const sendReset = () => go(async () => {
    await callFn("saath-reset", { action: "send", email, language: lang });
    setMode("reset2");
  });
  const doReset = () => go(async () => {
    await callFn("saath-reset", { action: "verify", email, code, new_password: password });
    notify(t("reset_done"));
    setMode("signin"); setCode("");
  });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.primary }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
      <View style={{ paddingTop: ins.top + S.xl, paddingHorizontal: S.xl, paddingBottom: S.xl, gap: S.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
          <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            <Image source={require("../../assets/adaptive-icon.png")} style={{ width: 104, height: 104 }} accessibilityIgnoresInvertColors />
          </View>
          <View>
            <Text style={[T.hero, { color: C.white }]}>{t("app_name")}</Text>
            <Text style={[T.small, { color: "rgba(255,255,255,0.75)" }]}>साथ · together</Text>
          </View>
        </View>
        <Text style={[T.h2, { color: C.white, fontWeight: "600", lineHeight: 28, marginTop: S.md }]}>{t("tagline")}</Text>
        {mode === "start" ? (
          <View style={{ gap: 10, marginTop: S.sm }}>
            {[["receipt-outline", "feat_receipts"], ["pie-chart-outline", "feat_split"], ["notifications-outline", "feat_remind"], ["globe-outline", "feat_pay"]].map(([ic, k]) => (
              <View key={k} style={{ flexDirection: "row", gap: S.md, alignItems: "center" }}>
                <Icon name={ic} size={22} color={C.gold} />
                <Text style={[T.body, { color: C.white, flex: 1 }]}>{t(k)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1, backgroundColor: C.bg, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: S.xl, gap: S.lg, paddingBottom: ins.bottom + S.xl }}>
        <View style={{ gap: S.sm }}>
          <Text style={[T.small, { color: C.ink2, fontWeight: "700" }]}>{t("choose_language")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {LANGS.map((l) => (
              <Pressable key={l.code} onPress={() => setLang(l.code as LangCode)} accessibilityRole="radio" accessibilityState={{ selected: lang === l.code }}
                style={{ paddingHorizontal: 14, height: 40, borderRadius: R.pill, justifyContent: "center", borderWidth: 1.5,
                  borderColor: lang === l.code ? C.primary : C.line, backgroundColor: lang === l.code ? C.primarySoft : C.card }}>
                <Text style={{ fontSize: 16, fontWeight: "700", color: lang === l.code ? C.primaryDark : C.ink2 }}>{l.native}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {mode === "start" && (
          <View style={{ gap: S.md }}>
            <Button label={t("create_account")} icon="person-add-outline" onPress={() => setMode("signup")} />
            <Button label={t("sign_in")} kind="secondary" onPress={() => setMode("signin")} />
          </View>
        )}

        {(mode === "signin" || mode === "signup") && (
          <View style={{ gap: S.md }}>
            <Text style={[T.h1, { color: C.ink }]}>{mode === "signin" ? t("welcome_back") : t("create_account")}</Text>
            {mode === "signup" && <Field label={t("your_name")} value={name} onChangeText={setName} autoComplete="name" textContentType="name" placeholder={t("name_ph")} />}
            <Field label={t("email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" placeholder="you@example.com" />
            <Field label={t("password")} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === "signin" ? "current-password" : "new-password"}
              hint={mode === "signup" ? t("password_hint") : undefined} onSubmitEditing={mode === "signin" ? signIn : signUp} />
            {err ? <Text style={[T.small, { color: C.owe }]}>{err}</Text> : null}
            <Button label={mode === "signin" ? t("sign_in") : t("create_account")} loading={busy} onPress={mode === "signin" ? signIn : signUp} />
            {mode === "signin" ? (
              <Button kind="ghost" label={t("forgot_password")} onPress={() => { setErr(null); setMode("reset"); }} />
            ) : (
              <Text style={[T.tiny, { color: C.ink3, textAlign: "center" }]}>{t("terms_note")}{" "}
                <Text style={{ color: C.primary, fontWeight: "700" }} accessibilityRole="link"
                  onPress={() => openUrl((Constants.expoConfig?.extra as any)?.privacyUrl)}>{t("privacy_policy")}</Text></Text>
            )}
            <Button kind="ghost" label={mode === "signin" ? t("no_account") : t("have_account")} onPress={() => { setErr(null); setMode(mode === "signin" ? "signup" : "signin"); }} />
          </View>
        )}

        {(mode === "reset" || mode === "reset2") && (
          <View style={{ gap: S.md }}>
            <Text style={[T.h1, { color: C.ink }]}>{t("reset_password")}</Text>
            <Field label={t("email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" editable={mode === "reset"} />
            {mode === "reset2" && (
              <>
                <Text style={[T.small, { color: C.ink2 }]}>{t("reset_sent", { email })}</Text>
                <Field label={t("reset_code")} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} placeholder="123456" />
                <Field label={t("new_password")} value={password} onChangeText={setPassword} secureTextEntry hint={t("password_hint")} />
              </>
            )}
            {err ? <Text style={[T.small, { color: C.owe }]}>{err}</Text> : null}
            <Button label={mode === "reset" ? t("send_code") : t("set_password")} loading={busy} onPress={mode === "reset" ? sendReset : doReset} />
            <Button kind="ghost" label={t("back_to_sign_in")} onPress={() => { setErr(null); setMode("signin"); }} />
          </View>
        )}
      </View>
    </ScrollView>
  );
}
