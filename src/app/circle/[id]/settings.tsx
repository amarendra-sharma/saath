import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { AmountField, Banner, Button, Card, Chips, Field, Loading, Row, Screen, Section, Toggle } from "../../../components/ui";
import { confirm, notify, useApp } from "../../../lib/app";
import { CURRENCIES, dateLabel, money, parseAmount } from "../../../lib/format";
import { PURPOSE_ICON } from "../../../lib/constants";
import { Summary, loadSummary, useLoad } from "../../../lib/data";
import { errText, supabase } from "../../../lib/supabase";
import { C, S, T } from "../../../lib/theme";

type Notif = { id: number; channel: string; status: string; detail: string | null; amount: number | null; created_at: string; member_id: string | null; trigger: string };

export default function CircleSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useApp();
  const sum = useLoad<Summary>(() => loadSummary(id), [id]);
  const notifs = useLoad<Notif[]>(async () => {
    const { data } = await supabase.from("saath_notifications").select("*").eq("circle_id", id).order("created_at", { ascending: false }).limit(15);
    return (data ?? []) as Notif[];
  }, [id]);
  const s = sum.data;
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (s && !f) setF({ ...s.circle, budget: s.circle.budget_amount != null ? String(s.circle.budget_amount) : "" }); }, [s]); // eslint-disable-line
  if (!s || !f) return <Loading />;
  const admin = s.is_admin;
  const weekly = f.period === "weekly" || f.period === "biweekly";
  const set = (k: string, v: any) => setF({ ...f, [k]: v });

  if (!admin) {
    return (
      <Screen title={t("settings")} subtitle={s.circle.name}>
        <Banner text={t("only_organiser_settings")} />
        <Button kind="secondary" icon="wallet-outline" label={t("who_receives")} onPress={() => router.push({ pathname: "/circle/[id]/payees", params: { id } })} />
        {s.me ? <Button kind="secondary" icon="person-outline" label={t("my_details_here")} onPress={() => router.push({ pathname: "/circle/[id]/member", params: { id, mid: s.me! } })} /> : null}
      </Screen>
    );
  }

  const save = async () => {
    if (!f.name.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("saath_circles").update({
      name: f.name.trim(), description: f.description?.trim() || null, purpose: f.purpose, currency: f.currency,
      split_mode: f.split_mode, budget_amount: f.split_mode === "budget" ? parseAmount(f.budget) : null, period: f.period,
      due_day: weekly ? Math.min(f.due_day, 7) : f.due_day, require_confirmation: f.require_confirmation,
      remind_whatsapp: f.remind_whatsapp, remind_email: f.remind_email,
      city: f.city?.trim() || null, bill_check_auto: !!f.bill_check_auto,
    }).eq("id", id);
    setBusy(false);
    if (error) notify(t("something_wrong"), errText(error)); else { notify(t("saved")); sum.reload(); }
  };
  const regen = async () => {
    if (!(await confirm(t("new_code_q"), t("new_code_text"), t("ok"), t("cancel")))) return;
    const { error } = await supabase.rpc("saath_regen_code", { p_circle: id });
    if (error) notify(t("something_wrong"), errText(error)); else sum.reload();
  };
  const archive = async () => {
    const arch = s.circle.status === "active";
    if (!(await confirm(arch ? t("archive_q") : t("unarchive_q"), arch ? t("archive_text") : "", t("ok"), t("cancel")))) return;
    const { error } = await supabase.from("saath_circles").update({ status: arch ? "archived" : "active" }).eq("id", id);
    if (error) notify(t("something_wrong"), errText(error)); else router.replace("/home");
  };

  return (
    <Screen title={t("settings")} subtitle={s.circle.name}
      footer={<Button label={t("save_changes")} icon="checkmark" loading={busy} onPress={save} />}>
      <Field label={t("circle_name")} value={f.name} onChangeText={(v) => set("name", v)} />
      <Field label={t("description_optional")} value={f.description ?? ""} onChangeText={(v) => set("description", v)} multiline placeholder={t("description_ph")} />
      <Chips value={f.purpose} onChange={(v) => set("purpose", v)} options={Object.keys(PURPOSE_ICON).map((k) => ({ value: k, label: t("purpose_" + k), icon: PURPOSE_ICON[k] }))} />

      <Section title={t("money")}>
        <Chips wrap={false} value={f.currency} onChange={(v) => set("currency", v)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        {f.currency !== s.circle.currency ? <Banner tone="owe" text={t("currency_change_warn")} /> : null}
        <Chips value={f.split_mode} onChange={(v) => set("split_mode", v)} options={[{ value: "expenses", label: t("mode_expenses") }, { value: "budget", label: t("mode_budget") }]} />
        <Text style={[T.tiny, { color: C.ink3 }]}>{t("mode_" + f.split_mode + "_desc")}</Text>
        {f.split_mode === "budget" ? <AmountField label={t("budget_per_period", { period: t("per_" + f.period) })} value={f.budget} onChangeText={(v) => set("budget", v)} currency={f.currency} /> : null}
        {f.split_mode !== s.circle.split_mode ? <Banner text={t("mode_change_note")} /> : null}
      </Section>

      <Section title={t("schedule")}>
        <Chips value={f.period} onChange={(v) => setF({ ...f, period: v, due_day: 1 })} options={["weekly", "biweekly", "monthly", "quarterly"].map((p) => ({ value: p, label: t("period_" + p) }))} />
        {weekly ? (
          <Chips value={String(f.due_day)} onChange={(v) => set("due_day", Number(v))} options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: t("wd_" + d) }))} />
        ) : (
          <Chips wrap={false} value={String(f.due_day)} onChange={(v) => set("due_day", Number(v))} options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />
        )}
        <Card>
          <Toggle label={t("remind_whatsapp")} value={f.remind_whatsapp} onChange={(v) => set("remind_whatsapp", v)} />
          <Toggle label={t("remind_email")} value={f.remind_email} onChange={(v) => set("remind_email", v)} />
          <Toggle label={t("confirm_payments")} hint={t("confirm_payments_hint")} value={f.require_confirmation} onChange={(v) => set("require_confirmation", v)} />
        </Card>
      </Section>

      <Section title={t("bc_title")}>
        <Field label={t("bc_city")} value={f.city ?? ""} onChangeText={(v) => set("city", v)} placeholder={t("bc_city_ph")} />
        <Card>
          <Toggle label={t("bc_auto")} hint={t("bc_auto_hint")} value={!!f.bill_check_auto} onChange={(v) => set("bill_check_auto", v)} />
        </Card>
      </Section>

      <Section title={t("more")}>
        <Card style={{ paddingVertical: 4 }}>
          <Row title={t("who_receives")} subtitle={s.payees.map((p) => p.name).join(", ") || t("none_yet")} onPress={() => router.push({ pathname: "/circle/[id]/payees", params: { id } })} />
          <Row title={t("edit_shares")} subtitle={t("shares_total_x", { pct: Number(s.totals.shares_total).toFixed(1) })} onPress={() => router.push({ pathname: "/circle/[id]/shares", params: { id } })} />
          <Row title={t("statement")} onPress={() => router.push({ pathname: "/circle/[id]/statement", params: { id } })} />
          <Row title={t("new_invite_code")} subtitle={s.circle.invite_code} onPress={regen} last />
        </Card>
      </Section>

      <Section title={t("reminder_log")}>
        <Card style={{ paddingVertical: 4 }}>
          {(notifs.data ?? []).length === 0 ? <Text style={[T.small, { color: C.ink3, paddingVertical: S.md }]}>{t("no_reminders_yet")}</Text> :
            (notifs.data ?? []).map((n, i, arr) => (
              <Row key={n.id} last={i === arr.length - 1}
                title={`${s.members.find((m) => m.id === n.member_id)?.name ?? "—"} · ${n.channel === "whatsapp" ? "WhatsApp" : t("email")}`}
                subtitle={`${dateLabel(n.created_at, lang)} · ${t("ns_" + n.status)}${n.amount ? " · " + money(n.amount, s.circle.currency, lang) : ""}${n.status !== "sent" && n.detail ? " · " + n.detail.slice(0, 60) : ""}`} />
            ))}
        </Card>
      </Section>

      <View style={{ gap: S.sm }}>
        <Button kind="danger" icon="archive-outline" label={s.circle.status === "active" ? t("archive_circle") : t("unarchive_circle")} onPress={archive} />
      </View>
    </Screen>
  );
}
