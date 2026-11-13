import Constants from "expo-constants";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, Chips, Field, Screen, Section, Toggle } from "../components/ui";
import { confirm, notify, useApp } from "../lib/app";
import { LANGS, LangCode } from "../lib/strings";
import { openUrl } from "../lib/share";
import { guideUrl } from "../lib/visits";
import { callFn, errText, supabase } from "../lib/supabase";
import { C, S, T } from "../lib/theme";

export default function Profile() {
  const { t, lang, setLang, profile, refreshProfile, session, isAdmin } = useApp();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [wa, setWa] = useState(profile?.notify_whatsapp ?? true);
  const [em, setEm] = useState(profile?.notify_email ?? true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (profile) { setName(profile.full_name); setPhone(profile.phone ?? ""); setWa(profile.notify_whatsapp); setEm(profile.notify_email); } }, [profile]);

  const save = async () => {
    const p = phone.replace(/[^\d+]/g, "");
    const norm = p ? (p.startsWith("+") ? p : "+" + p) : null;
    if (norm && !/^\+\d{8,15}$/.test(norm)) { notify(t("bad_phone")); return; }
    setBusy(true);
    try {
      const uid = session!.user.id;
      const { error } = await supabase.from("saath_profiles").update({ full_name: name.trim(), phone: norm, notify_whatsapp: wa, notify_email: em }).eq("id", uid);
      if (error) throw error;
      // keep my details in every circle in step
      await supabase.from("saath_members").update({ display_name: name.trim() || undefined, phone: norm, notify_whatsapp: wa, notify_email: em }).eq("user_id", uid);
      await refreshProfile();
      notify(t("saved"));
    } catch (e) { notify(t("something_wrong"), errText(e)); } finally { setBusy(false); }
  };

  const signOut = async () => { await supabase.auth.signOut(); router.replace("/welcome"); };
  const del = async () => {
    if (!(await confirm(t("delete_account_q"), t("delete_account_text"), t("delete_account"), t("cancel"), true))) return;
    try { await callFn("saath-account", { action: "delete" }, true); await supabase.auth.signOut(); router.replace("/welcome"); }
    catch (e) { notify(t("something_wrong"), errText(e)); }
  };

  return (
    <Screen title={t("profile")} footer={<Button label={t("save_changes")} icon="checkmark" loading={busy} onPress={save} />}>
      <Field label={t("your_name")} value={name} onChangeText={setName} />
      <Field label={t("email")} value={profile?.email ?? session?.user.email ?? ""} editable={false} />
      <Field label={t("whatsapp_number")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91 98765 43210" hint={t("phone_hint")} />
      <Section title={t("language")}>
        <Chips value={lang} onChange={(l) => setLang(l as LangCode)} options={LANGS.map((l) => ({ value: l.code, label: l.native }))} />
      </Section>
      <Section title={t("reminders")}>
        <Card>
          <Toggle label={t("remind_whatsapp")} value={wa} onChange={setWa} />
          <Toggle label={t("remind_email")} value={em} onChange={setEm} />
        </Card>
      </Section>
      <Section title={t("how_it_works")}>
        <Card>
          {["hiw_1", "hiw_2", "hiw_3", "hiw_4", "hiw_5"].map((k, i) => (
            <View key={k} style={{ flexDirection: "row", gap: S.md }}>
              <Text style={[T.h3, { color: C.primary, width: 20 }]}>{i + 1}</Text>
              <Text style={[T.small, { color: C.ink2, flex: 1 }]}>{t(k)}</Text>
            </View>
          ))}
        </Card>
      </Section>
      <View style={{ gap: S.sm }}>
        {isAdmin ? <Button kind="secondary" icon="shield-half-outline" label={t("admin_console")} onPress={() => router.push("/admin")} /> : null}
        <Button kind="secondary" icon="book-outline" label={t("how_to_use")} onPress={() => openUrl(guideUrl())} />
        <Button kind="ghost" icon="shield-checkmark-outline" label={t("privacy_policy")} onPress={() => openUrl((Constants.expoConfig?.extra as any)?.privacyUrl)} />
        <Button kind="secondary" icon="log-out-outline" label={t("sign_out")} onPress={signOut} />
        <Button kind="danger" icon="trash-outline" label={t("delete_account")} onPress={del} />
      </View>
      <Text style={[T.tiny, { color: C.ink3, textAlign: "center" }]}>Bengu {Constants.expoConfig?.version} · MacroNations LLC</Text>
    </Screen>
  );
}
