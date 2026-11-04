import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Banner, Button, Card, Chips, Field, Loading, Screen, Toggle } from "../../../components/ui";
import { confirm, notify, useApp } from "../../../lib/app";
import { Summary, loadSummary, useLoad } from "../../../lib/data";
import { money, parseAmount } from "../../../lib/format";
import { openWhatsApp } from "../../../lib/share";
import { LANGS } from "../../../lib/strings";
import { errText, supabase } from "../../../lib/supabase";
import { C, S, T } from "../../../lib/theme";

const normPhone = (p: string) => { const d = p.replace(/[^\d+]/g, ""); return d ? (d.startsWith("+") ? d : "+" + d) : ""; };

export default function MemberEdit() {
  const { id, mid } = useLocalSearchParams<{ id: string; mid?: string }>();
  const { t, lang } = useApp();
  const sum = useLoad<Summary>(() => loadSummary(id), [id]);
  const s = sum.data;
  const m = s?.members.find((x) => x.id === mid);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [mlang, setMlang] = useState(lang as string);
  const [wa, setWa] = useState(true);
  const [em, setEm] = useState(true);
  const [role, setRole] = useState<"admin" | "member">("member");
  const [share, setShare] = useState("0");
  const [adj, setAdj] = useState("");
  const [adjNote, setAdjNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!m) return;
    setName(m.name); setRelation(m.relation ?? ""); setPhone(m.phone ?? ""); setEmail(m.email ?? "");
    setMlang(m.language || "en"); setWa(m.notify_whatsapp); setEm(m.notify_email); setRole(m.role); setShare(String(Number(m.share)));
  }, [m?.id]); // eslint-disable-line

  if (!s || (mid && !m)) return <Loading />;
  const admin = s.is_admin;
  const self = !!m?.is_me;
  const canEdit = admin || self;
  const othersShare = s.members.filter((x) => x.status === "active" && x.id !== mid).reduce((a, x) => a + Number(x.share), 0);

  const save = async () => {
    if (!name.trim()) { notify(t("name_required")); return; }
    const p = normPhone(phone);
    if (p && !/^\+\d{8,15}$/.test(p)) { notify(t("bad_phone")); return; }
    setBusy(true);
    try {
      const row: any = { display_name: name.trim(), relation: relation.trim() || null, phone: p || null, email: email.trim().toLowerCase() || null,
        language: mlang, notify_whatsapp: wa, notify_email: em };
      if (admin) { row.role = role; }
      if (mid) {
        const { error } = await supabase.from("saath_members").update(row).eq("id", mid);
        if (error) throw error;
        if (admin && parseAmount(share) !== Number(m!.share)) {
          const { error: e2 } = await supabase.rpc("saath_set_shares", { p_circle: id, p_shares: { [mid]: parseAmount(share) } });
          if (e2) throw e2;
        }
        if (self) await supabase.from("saath_profiles").update({ phone: p || null, notify_whatsapp: wa, notify_email: em }).eq("id", (await supabase.auth.getUser()).data.user!.id);
      } else {
        const { data, error } = await supabase.from("saath_members").insert({ circle_id: id, ...row, role: "member" }).select("id").single();
        if (error) throw error;
        if (parseAmount(share) > 0) {
          const { error: e2 } = await supabase.rpc("saath_set_shares", { p_circle: id, p_shares: { [data.id]: parseAmount(share) } });
          if (e2) throw e2;
        }
      }
      router.back();
    } catch (e) { notify(t("something_wrong"), errText(e)); }
    finally { setBusy(false); }
  };

  const addAdjustment = async () => {
    const v = parseAmount(adj.replace(/^-/, "")) * (adj.trim().startsWith("-") ? -1 : 1);
    if (!v) return;
    const { error } = await supabase.rpc("saath_add_adjustment", { p_circle: id, p_member: mid, p_amount: v, p_note: adjNote.trim() || null });
    if (error) notify(t("something_wrong"), errText(error)); else { setAdj(""); setAdjNote(""); notify(t("saved")); sum.reload(); }
  };

  const leaveOrRemove = async () => {
    if (self) {
      if (!(await confirm(t("leave_circle_q"), t("leave_circle_text"), t("leave"), t("cancel"), true))) return;
      const { error } = await supabase.rpc("saath_leave", { p_circle: id });
      if (error) notify(t("something_wrong"), errText(error)); else router.replace("/home");
      return;
    }
    if (!(await confirm(t("remove_member_q", { name: m!.name }), t("remove_member_text"), t("remove"), t("cancel"), true))) return;
    // never-joined people with no payments can be deleted; everyone else is marked as having left (ledger stays intact)
    let { error } = await supabase.from("saath_members").delete().eq("id", mid);
    const { data: still } = await supabase.from("saath_members").select("id").eq("id", mid).maybeSingle();
    if (still) ({ error } = await supabase.from("saath_members").update({ status: "left", share_percent: 0 }).eq("id", mid));
    if (error) notify(t("something_wrong"), errText(error)); else router.back();
  };

  const inviteText = t("invite_msg", { circle: s.circle.name, code: s.circle.invite_code });

  return (
    <Screen title={mid ? m!.name : t("add_person")} subtitle={s.circle.name}
      footer={canEdit ? <Button label={mid ? t("save_changes") : t("add_person")} icon="checkmark" loading={busy} onPress={save} /> : undefined}>
      {!mid ? <Text style={[T.body, { color: C.ink2 }]}>{t("add_person_intro")}</Text> : null}
      {m && !m.joined ? <Banner tone="primary" icon="phone-portrait-outline" text={t("not_on_app_hint")} /> : null}
      <Field label={t("name")} value={name} onChangeText={setName} editable={canEdit} />
      <Field label={t("relation_optional")} value={relation} onChangeText={setRelation} placeholder={t("relation_ph")} editable={canEdit} />
      <Field label={t("whatsapp_number")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91 98765 43210" hint={t("phone_hint")} editable={canEdit} />
      <Field label={t("email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" editable={canEdit} />
      <View style={{ gap: S.sm }}>
        <Text style={[T.small, { color: C.ink2, fontWeight: "600" }]}>{t("reminder_language")}</Text>
        <Chips value={mlang} onChange={setMlang} options={LANGS.map((l) => ({ value: l.code, label: l.native }))} />
      </View>
      <Card>
        <Toggle label={t("remind_whatsapp")} value={wa} onChange={setWa} />
        <Toggle label={t("remind_email")} value={em} onChange={setEm} />
      </Card>

      {admin ? (
        <Card>
          <Field label={t("share_percent")} value={share} onChangeText={setShare} keyboardType="decimal-pad"
            hint={t("share_room", { pct: Math.max(0, 100 - othersShare).toFixed(1) })} />
          {mid && !self ? <Toggle label={t("make_organiser")} hint={t("make_organiser_hint")} value={role === "admin"} onChange={(v) => setRole(v ? "admin" : "member")} /> : null}
        </Card>
      ) : null}

      {mid && m && !m.joined && admin ? (
        <Button kind="secondary" icon="logo-whatsapp" label={t("send_invite_whatsapp")} onPress={() => openWhatsApp(inviteText, m.phone)} />
      ) : null}

      {mid && admin ? (
        <Card>
          <Text style={[T.h3, { color: C.ink }]}>{t("adjust_balance")}</Text>
          <Text style={[T.small, { color: C.ink2 }]}>{t("adjust_balance_hint", { bal: money(m!.balance, s.circle.currency, lang) })}</Text>
          <Field label={t("adjust_amount")} value={adj} onChangeText={setAdj} keyboardType="numbers-and-punctuation" placeholder="+500 / -500" />
          <Field label={t("reason")} value={adjNote} onChangeText={setAdjNote} />
          <Button small kind="secondary" label={t("add_adjustment")} onPress={addAdjustment} disabled={!parseAmount(adj)} />
        </Card>
      ) : null}

      {mid && (self || admin) ? <Button kind="danger" icon={self ? "exit-outline" : "person-remove-outline"} label={self ? t("leave_circle") : t("remove_from_circle")} onPress={leaveOrRemove} /> : null}
    </Screen>
  );
}
