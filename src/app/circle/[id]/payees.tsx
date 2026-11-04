import { useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { Banner, Button, Card, Chips, Empty, Field, Icon, IconButton, Loading, Screen, Sheet, Toggle } from "../../../components/ui";
import { confirm, notify, useApp } from "../../../lib/app";
import { Payee, PayMethod, Summary, loadSummary, useLoad } from "../../../lib/data";
import { METHODS, MethodKey, methodDef } from "../../../lib/payments";
import { errText, supabase } from "../../../lib/supabase";
import { C, R, S, T } from "../../../lib/theme";

const KINDS = ["person", "hospital", "care_provider", "organization", "other"];

export default function Payees() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const sum = useLoad<Summary>(() => loadSummary(id), [id]);
  const [editPayee, setEditPayee] = useState<Partial<Payee> | null>(null);
  const [editMethod, setEditMethod] = useState<(Partial<PayMethod> & { payee_id: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const s = sum.data;
  if (!s) return <Loading />;
  const admin = s.is_admin;

  const savePayee = async () => {
    if (!editPayee?.name?.trim()) return;
    setBusy(true);
    const row = { circle_id: id, name: editPayee.name.trim(), kind: editPayee.kind ?? "person", notes: editPayee.notes?.trim() || null,
      member_id: editPayee.member_id ?? null, is_default: editPayee.is_default ?? s.payees.length === 0 };
    const { data: saved, error } = editPayee.id
      ? await supabase.from("saath_payees").update(row).eq("id", editPayee.id).select("id").single()
      : await supabase.from("saath_payees").insert(row).select("id").single();
    if (!error && row.is_default && saved) await supabase.from("saath_payees").update({ is_default: false }).eq("circle_id", id).neq("id", saved.id);
    setBusy(false);
    if (error) notify(t("something_wrong"), errText(error)); else { setEditPayee(null); sum.reload(); }
  };
  const delPayee = async (p: Payee) => {
    if (!(await confirm(t("remove_payee_q", { name: p.name }), "", t("remove"), t("cancel"), true))) return;
    const { error } = await supabase.from("saath_payees").delete().eq("id", p.id);
    if (error) notify(t("something_wrong"), errText(error)); else sum.reload();
  };
  const saveMethod = async () => {
    if (!editMethod?.method) return;
    setBusy(true);
    const row = { payee_id: editMethod.payee_id, circle_id: id, method: editMethod.method, label: editMethod.label?.trim() || null,
      handle: editMethod.handle?.trim() || null, details: editMethod.details ?? {} };
    const { error } = editMethod.id ? await supabase.from("saath_pay_methods").update(row).eq("id", editMethod.id) : await supabase.from("saath_pay_methods").insert(row);
    setBusy(false);
    if (error) notify(t("something_wrong"), errText(error)); else { setEditMethod(null); sum.reload(); }
  };
  const delMethod = async (m: PayMethod) => {
    const { error } = await supabase.from("saath_pay_methods").delete().eq("id", m.id);
    if (error) notify(t("something_wrong"), errText(error)); else sum.reload();
  };

  const def = editMethod?.method ? methodDef(editMethod.method) : null;

  return (
    <Screen title={t("who_receives")} subtitle={s.circle.name}
      footer={admin ? <Button icon="add" label={t("add_payee")} onPress={() => setEditPayee({ kind: "person" })} /> : undefined}>
      <Text style={[T.body, { color: C.ink2 }]}>{t("payees_intro")}</Text>
      {s.payees.length === 0 ? <Empty icon="wallet-outline" title={t("no_payees_title")} text={t("no_payees_text")} /> : null}
      {s.payees.map((p) => (
        <Card key={p.id}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
            <Icon name={p.kind === "person" ? "person-outline" : "business-outline"} size={24} color={C.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[T.h3, { color: C.ink }]}>{p.name}</Text>
              <Text style={[T.tiny, { color: C.ink3 }]}>{t("payee_" + p.kind)}{p.is_default ? ` · ${t("main_payee")}` : ""}</Text>
            </View>
            {admin ? <IconButton icon="create-outline" label={t("edit")} bg={C.bg} onPress={() => setEditPayee(p)} /> : null}
            {admin ? <IconButton icon="trash-outline" label={t("remove")} bg={C.bg} color={C.owe} onPress={() => delPayee(p)} /> : null}
          </View>
          {p.notes ? <Text style={[T.small, { color: C.ink2 }]}>{p.notes}</Text> : null}
          {p.methods.map((m) => {
            const d = methodDef(m.method);
            return (
              <View key={m.id} style={{ flexDirection: "row", alignItems: "center", gap: S.md, backgroundColor: C.bg, borderRadius: R.sm, padding: S.md }}>
                <Icon name={d.icon} size={20} color={C.ink2} />
                <View style={{ flex: 1 }}>
                  <Text style={[T.body, { color: C.ink, fontWeight: "600" }]}>{m.label || d.name}</Text>
                  <Text style={[T.small, { color: C.ink3 }]} numberOfLines={1}>{m.handle}</Text>
                </View>
                {admin ? <IconButton icon="create-outline" label={t("edit")} onPress={() => setEditMethod({ ...m })} /> : null}
                {admin ? <IconButton icon="close" label={t("remove")} color={C.owe} onPress={() => delMethod(m)} /> : null}
              </View>
            );
          })}
          {admin ? <Button small kind="secondary" icon="add" label={t("add_pay_method")} onPress={() => setEditMethod({ payee_id: p.id, method: "upi", details: {} })} /> : null}
        </Card>
      ))}
      <Banner tone="primary" icon="shield-checkmark-outline" text={t("payees_privacy")} />

      <Sheet visible={!!editPayee} onClose={() => setEditPayee(null)} title={editPayee?.id ? t("edit_payee") : t("add_payee")}>
        <Field label={t("payee_name")} value={editPayee?.name ?? ""} onChangeText={(v) => setEditPayee({ ...editPayee!, name: v })} placeholder={t("payee_name_ph")} />
        <Chips value={editPayee?.kind ?? "person"} onChange={(v) => setEditPayee({ ...editPayee!, kind: v })} options={KINDS.map((k) => ({ value: k, label: t("payee_" + k) }))} />
        <Chips value={editPayee?.member_id ?? ""} onChange={(v) => setEditPayee({ ...editPayee!, member_id: v || null, name: editPayee?.name || s.members.find((m) => m.id === v)?.name })}
          options={[{ value: "", label: t("not_a_member") }, ...s.members.filter((m) => m.status === "active").map((m) => ({ value: m.id, label: m.name }))]} />
        <Field label={t("notes_optional")} value={editPayee?.notes ?? ""} onChangeText={(v) => setEditPayee({ ...editPayee!, notes: v })} placeholder={t("payee_notes_ph")} multiline />
        <Toggle label={t("main_payee")} hint={t("main_payee_hint")} value={editPayee?.is_default ?? s.payees.length === 0} onChange={(v) => setEditPayee({ ...editPayee!, is_default: v })} />
        <Button label={t("save")} loading={busy} disabled={!editPayee?.name?.trim()} onPress={savePayee} />
      </Sheet>

      <Sheet visible={!!editMethod} onClose={() => setEditMethod(null)} title={editMethod?.id ? t("edit_pay_method") : t("add_pay_method")}>
        <Chips value={(editMethod?.method ?? "upi") as MethodKey} onChange={(v) => setEditMethod({ ...editMethod!, method: v })}
          options={METHODS.map((m) => ({ value: m.key, label: m.name, icon: m.icon }))} />
        {def ? <Text style={[T.tiny, { color: C.ok, fontWeight: "700" }]}>{t(def.costKey)} · {t(def.region)}</Text> : null}
        {def ? <Field label={t(def.handleLabelKey)} value={editMethod?.handle ?? ""} placeholder={def.handlePlaceholder} autoCapitalize="none"
          onChangeText={(v) => setEditMethod({ ...editMethod!, handle: v })} /> : null}
        {def?.fields?.map((f) => (
          <Field key={f.key} label={t(f.labelKey)} value={editMethod?.details?.[f.key] ?? ""} placeholder={f.placeholder} autoCapitalize={f.key === "account_name" || f.key === "bank" ? "words" : "characters"}
            onChangeText={(v) => setEditMethod({ ...editMethod!, details: { ...(editMethod?.details ?? {}), [f.key]: v } })} />
        ))}
        <Field label={t("label_optional")} value={editMethod?.label ?? ""} onChangeText={(v) => setEditMethod({ ...editMethod!, label: v })} placeholder={t("label_ph")} />
        <Button label={t("save")} loading={busy} onPress={saveMethod} />
      </Sheet>
    </Screen>
  );
}
