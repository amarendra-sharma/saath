import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Banner, Button, Card, Icon, Loading, Pill, Screen, Section } from "../../../components/ui";
import { notify, useApp } from "../../../lib/app";
import { Summary, loadSummary, useLoad } from "../../../lib/data";
import { dateLabel } from "../../../lib/format";
import { AiAccess, Price, UpgradeRequest, aiStatus, myUpgradeRequest, payCountry, priceFor, priceText, requestUpgrade, yearlySaving } from "../../../lib/plus";
import { errText } from "../../../lib/supabase";
import { C, R, S, T } from "../../../lib/theme";

type Period = UpgradeRequest["period"];
const FREE = ["plus_f_unlimited", "plus_f_split", "plus_f_receipts", "plus_f_reminders", "plus_f_rules", "plus_f_insights", "plus_f_agreement", "plus_f_export"];
const PLUS = ["plus_p_scan", "plus_p_multi", "plus_p_forensic", "plus_p_price", "plus_p_lang", "plus_p_priority"];

export default function PlusScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang, isAdmin } = useApp();
  const [period, setPeriod] = useState<Period>("year");
  const [busy, setBusy] = useState(false);
  const d = useLoad<{ s: Summary; a: AiAccess | null; p: Price | null; r: UpgradeRequest | null }>(async () => {
    const s = await loadSummary(id);
    const [a, p, r] = await Promise.all([aiStatus(id), priceFor(payCountry(s.circle.country)).catch(() => null), myUpgradeRequest(id)]);
    return { s, a, p, r };
  }, [id]);
  if (!d.data) return <Loading />;
  const { s, a, p, r } = d.data;
  const pending = r?.status === "open";
  const fmt = (n: number) => (p ? priceText(Number(n), p.currency, lang) : "");
  const opts: { v: Period; label: string; price: string; sub: string; badge?: string }[] = p ? [
    { v: "month", label: t("plus_monthly"), price: fmt(p.monthly), sub: t("plus_per_month") },
    { v: "year", label: t("plus_yearly"), price: fmt(p.yearly), sub: t("plus_per_year_eq", { m: fmt(Math.round((Number(p.yearly) / 12) * 100) / 100) }), badge: yearlySaving(p) ? t("plus_save", { pct: yearlySaving(p) }) : undefined },
    { v: "pass90", label: t("plus_pass"), price: fmt(p.pass90), sub: t("plus_pass_sub") },
  ] : [];
  const chosen = opts.find((o) => o.v === period);

  const status = (() => {
    if (!a) return null;
    if (a.reason === "admin_off") return { tone: "owe" as const, icon: "ban-outline", text: t("plus_st_off") };
    if (a.reason === "admin_on") return { tone: "ok" as const, icon: "sparkles-outline", text: t("plus_st_on") };
    if (a.plus) return { tone: "ok" as const, icon: "sparkles-outline", text: a.plus_until ? t("plus_st_plus_until", { date: dateLabel(a.plus_until, lang, true) }) : t("plus_st_plus") };
    if (a.reason === "free_mode") return { tone: "primary" as const, icon: "gift-outline", text: t("plus_st_free_mode") };
    if (a.reason === "trial") return { tone: "pending" as const, icon: "hourglass-outline", text: t("plus_st_trial", { n: a.trial_left, total: a.trial_total }) };
    return { tone: "owe" as const, icon: "lock-closed-outline", text: t("plus_st_locked", { total: a.trial_total }) };
  })();

  const ask = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      await requestUpgrade(id, period, `${chosen.label} · ${chosen.price}`);
      notify(t("plus_requested_t"), t("plus_requested"));
      d.reload();
    } catch (e) { notify(t("something_wrong"), errText(e)); }
    finally { setBusy(false); }
  };
  const showBuy = !a?.plus && a?.reason !== "admin_off";

  return (
    <Screen title={t("plus_title")} subtitle={s.circle.name}
      footer={showBuy && p ? <Button kind="accent" icon={pending ? "time-outline" : "sparkles-outline"} loading={busy}
        label={pending ? t("plus_update_request") : t("plus_request", { price: chosen?.price ?? "" })} onPress={ask} /> : undefined}>
      <Card tone="primary">
        <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
          <Icon name="sparkles" size={22} color={C.gold} />
          <Text style={[T.h2, { color: C.white }]}>{t("plus_hero_t")}</Text>
        </View>
        <Text style={[T.small, { color: "rgba(255,255,255,0.88)" }]}>{t("plus_hero")}</Text>
      </Card>

      {status ? <Banner tone={status.tone} icon={status.icon} text={status.text} /> : null}
      {pending ? <Banner tone="pending" icon="time-outline" text={t("plus_pending", { what: r?.price_text ?? "", date: dateLabel(r!.created_at, lang) })} /> : null}

      {showBuy && p ? (
        <Section title={t("plus_choose")}>
          <View style={{ gap: S.sm }}>
            {opts.map((o) => {
              const on = o.v === period;
              return (
                <Pressable key={o.v} onPress={() => setPeriod(o.v)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                  style={{ flexDirection: "row", alignItems: "center", gap: S.md, padding: S.md, borderRadius: R.md, backgroundColor: on ? C.primarySoft : C.card, borderWidth: on ? 2 : 1, borderColor: on ? C.primary : C.line }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? C.primary : C.ink3, alignItems: "center", justifyContent: "center" }}>
                    {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary }} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
                      <Text style={[T.body, { color: C.ink, fontWeight: "700" }]}>{o.label}</Text>
                      {o.badge ? <Pill tone="ok" text={o.badge} /> : null}
                    </View>
                    <Text style={[T.tiny, { color: C.ink3 }]}>{o.sub}</Text>
                  </View>
                  <Text style={[T.h3, { color: C.ink }]}>{o.price}</Text>
                </Pressable>
              );
            })}
            <Text style={[T.tiny, { color: C.ink3 }]}>{t("plus_price_note", { country: p.country === "*" ? t("plus_your_region") : p.country })}</Text>
          </View>
        </Section>
      ) : null}

      <Section title={t("plus_compare")}>
        <Card>
          <Text style={[T.h3, { color: C.ink }]}>{t("plus_free_t")}</Text>
          {FREE.map((k) => <Feature key={k} icon="checkmark-circle" color={C.ok} text={t(k)} />)}
          <View style={{ height: 1, backgroundColor: C.line, marginVertical: S.sm }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
            <Icon name="sparkles" size={18} color={C.accent} />
            <Text style={[T.h3, { color: C.ink }]}>{t("plus_plus_t")}</Text>
          </View>
          {PLUS.map((k) => <Feature key={k} icon="sparkles-outline" color={C.accent} text={t(k)} />)}
        </Card>
      </Section>

      <Card>
        <Text style={[T.h3, { color: C.ink }]}>{t("plus_why_t")}</Text>
        <Text style={[T.small, { color: C.ink2 }]}>{t("plus_why")}</Text>
      </Card>
      <Text style={[T.tiny, { color: C.ink3 }]}>{t("plus_payment_note")}</Text>
      {isAdmin ? <Button kind="ghost" icon="shield-outline" label={t("admin_console")} onPress={() => router.push("/admin")} /> : null}
    </Screen>
  );
}

function Feature({ icon, color, text }: { icon: string; color: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: S.sm, alignItems: "flex-start" }}>
      <View style={{ paddingTop: 1 }}><Icon name={icon} size={18} color={color} /></View>
      <Text style={[T.small, { color: C.ink, flex: 1 }]}>{text}</Text>
    </View>
  );
}
