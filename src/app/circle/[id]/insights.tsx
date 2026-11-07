import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { Avatar, Button, Card, Empty, Icon, IconButton, Loading, Pill, Row, Screen, Section, Segmented, hashTone } from "../../../components/ui";
import { notify, useApp } from "../../../lib/app";
import { CATEGORY_ICON } from "../../../lib/constants";
import { Summary, loadSummary, useLoad } from "../../../lib/data";
import { csvCell, exportCsv } from "../../../lib/exporter";
import { dateLabel, money, monthLabel, todayISO } from "../../../lib/format";
import { errText, supabase } from "../../../lib/supabase";
import { C, R, S, T } from "../../../lib/theme";

type Insights = {
  months: { month: string; spent: number; paid_in: number }[];
  categories: { category: string; total: number; count: number }[];
  categories_90d: { category: string; total: number }[];
  vendors: { name: string; total: number; count: number }[];
  largest: { id: string; title: string; amount: number; spent_on: string; category: string }[];
  members: { id: string; name: string; share: number; charged: number; credited: number; balance: number; on_time: number; pending: number }[];
  stats: { total: number; count: number; this_month: number; last_month: number; avg_3m: number; first_date: string | null; outstanding: number; checks_flagged: number; receipts_pct: number };
};

export default function InsightsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useApp();
  const [catRange, setCatRange] = useState<"all" | "90d">("all");
  const d = useLoad<{ s: Summary; i: Insights }>(async () => {
    const [s, r] = await Promise.all([loadSummary(id), supabase.rpc("saath_circle_insights", { p_circle: id })]);
    if (r.error) throw r.error;
    return { s, i: r.data as Insights };
  }, [id]);
  if (!d.data) return d.error ? <Empty icon="alert-circle-outline" title={t("something_wrong")} text={d.error} /> : <Loading />;
  const { s, i } = d.data;
  const cur = s.circle.currency;
  const m$ = (n: number, compact = true) => money(Number(n), cur, lang, { compact });
  const st = i.stats;
  if (!Number(st.count)) return (
    <Screen title={t("ins_title")} subtitle={s.circle.name}>
      <Empty icon="bar-chart-outline" title={t("ins_empty_t")} text={t("ins_empty")} />
    </Screen>
  );

  // drop empty months before the circle's first activity, but always show at least 6
  const firstUsed = i.months.findIndex((m) => Number(m.spent) || Number(m.paid_in));
  const months = i.months.slice(Math.max(0, Math.min(firstUsed < 0 ? 0 : firstUsed, i.months.length - 6)));
  const maxMonth = Math.max(1, ...months.map((m) => Math.max(Number(m.spent), Number(m.paid_in))));
  const cats = catRange === "all" ? i.categories : i.categories_90d;
  const catTotal = cats.reduce((a, c) => a + Number(c.total), 0) || 1;
  const paidTotal = i.members.reduce((a, m) => a + Math.max(0, Number(m.credited)), 0);

  const csv = async () => {
    try {
      const lines = [
        [t("ins_month"), t("spent"), t("ins_paid_in")].map(csvCell).join(","),
        ...i.months.map((m) => [m.month, m.spent, m.paid_in].map(csvCell).join(",")),
        "",
        [t("category"), t("total_spent"), t("ins_bills")].map(csvCell).join(","),
        ...i.categories.map((c) => [t("cat_" + c.category), c.total, c.count].map(csvCell).join(",")),
        "",
        [t("ins_member"), t("ins_share"), t("ins_charged"), t("ins_paid"), t("ins_balance")].map(csvCell).join(","),
        ...i.members.map((m) => [m.name, m.share, m.charged, m.credited, m.balance].map(csvCell).join(",")),
      ];
      await exportCsv(lines.join("\n"), `saath-insights-${todayISO()}.csv`);
    } catch (e) { notify(t("something_wrong"), errText(e)); }
  };

  return (
    <Screen title={t("ins_title")} subtitle={s.circle.name} right={<IconButton icon="download-outline" label={t("export_csv")} onPress={csv} />}>
      <View style={{ flexDirection: "row", gap: S.md }}>
        <Tile label={t("ins_this_month")} value={m$(st.this_month)} sub={t("ins_last_month", { amount: m$(st.last_month) })} />
        <Tile label={t("ins_avg_3m")} value={m$(st.avg_3m)} sub={t("ins_per_month")} />
      </View>
      <View style={{ flexDirection: "row", gap: S.md }}>
        <Tile label={t("total_spent")} value={m$(st.total)} sub={st.first_date ? t("ins_since", { date: dateLabel(st.first_date, lang, true) }) : undefined} />
        <Tile label={t("still_due")} value={m$(st.outstanding)} valueTone={Number(st.outstanding) > 0.5 ? C.owe : C.ok} />
      </View>

      <Section title={t("ins_12m")}>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "flex-end", height: 140, gap: 4 }}
            accessible accessibilityLabel={months.map((m) => `${monthLabel(m.month + "-01", lang)}: ${m$(m.spent, false)}`).join(", ")}>
            {months.map((m) => (
              <View key={m.month} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height: 120 }}>
                  <View style={{ width: 7, height: Math.max(2, (Number(m.spent) / maxMonth) * 120), borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: Number(m.spent) ? C.primary : C.line }} />
                  <View style={{ width: 7, height: Math.max(2, (Number(m.paid_in) / maxMonth) * 120), borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: Number(m.paid_in) ? C.gold : C.line }} />
                </View>
                <Text style={[T.tiny, { color: C.ink3, fontSize: 10, marginTop: 4 }]} numberOfLines={1}>{monthLabel(m.month + "-01", lang).slice(0, 3)}</Text>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: S.lg }}>
            <Legend color={C.primary} text={t("spent")} />
            <Legend color={C.gold} text={t("ins_paid_in")} />
          </View>
        </Card>
      </Section>

      <Section title={t("where_money_goes")}>
        <Segmented value={catRange} onChange={setCatRange} options={[{ value: "all", label: t("ins_all_time") }, { value: "90d", label: t("ins_90d") }]} />
        <Card>
          {cats.length ? cats.map((c) => {
            const pct = (Number(c.total) / catTotal) * 100;
            return (
              <View key={c.category} style={{ gap: 6, marginBottom: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Icon name={CATEGORY_ICON[c.category] ?? "pricetag-outline"} size={18} color={C.ink2} />
                  <Text style={[T.small, { color: C.ink, flex: 1, fontWeight: "600" }]}>{t("cat_" + c.category)}</Text>
                  <Text style={[T.tiny, { color: C.ink3 }]}>{pct.toFixed(0)}%</Text>
                  <Text style={[T.small, { color: C.ink, fontWeight: "700", minWidth: 70, textAlign: "right" }]}>{m$(c.total)}</Text>
                </View>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: C.bg }}>
                  <View style={{ height: 8, borderRadius: 4, width: `${pct}%`, backgroundColor: C.primary }} />
                </View>
              </View>
            );
          }) : <Text style={[T.small, { color: C.ink3 }]}>{t("none_yet")}</Text>}
        </Card>
      </Section>

      <Section title={t("ins_fairness")}>
        <Card>
          <Text style={[T.small, { color: C.ink2 }]}>{t("ins_fairness_hint")}</Text>
          {i.members.map((m) => {
            const actual = paidTotal > 0 ? (Math.max(0, Number(m.credited)) / paidTotal) * 100 : 0;
            const share = Number(m.share);
            const diff = actual - share;
            return (
              <View key={m.id} style={{ gap: 6, paddingVertical: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
                  <Avatar name={m.name} tone={hashTone(m.name)} size={30} />
                  <Text style={[T.small, { color: C.ink, fontWeight: "700", flex: 1 }]} numberOfLines={1}>{m.name}</Text>
                  <Pill tone={Math.abs(diff) < 3 ? "ok" : diff < 0 ? "pending" : "primary"}
                    text={Math.abs(diff) < 3 ? t("ins_on_track") : diff < 0 ? t("ins_behind", { pct: Math.abs(diff).toFixed(0) }) : t("ins_ahead", { pct: diff.toFixed(0) })} />
                </View>
                <View style={{ height: 10, borderRadius: 5, backgroundColor: C.bg, overflow: "hidden" }}>
                  <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, actual)}%`, backgroundColor: C.primary, borderRadius: 5 }} />
                  <View style={{ position: "absolute", top: -2, bottom: -2, left: `${Math.min(99.5, share)}%`, width: 2, backgroundColor: C.accent }} />
                </View>
                <Text style={[T.tiny, { color: C.ink3 }]}>
                  {t("ins_member_line", { share: share.toFixed(share % 1 ? 1 : 0), paid: actual.toFixed(0), amount: m$(m.credited, false) })}
                  {Number(m.pending) ? ` · ${t("ins_pending_n", { n: m.pending })}` : ""}
                </Text>
              </View>
            );
          })}
          <View style={{ flexDirection: "row", gap: S.lg }}>
            <Legend color={C.primary} text={t("ins_paid_pct")} />
            <Legend color={C.accent} text={t("ins_agreed_share")} />
          </View>
        </Card>
      </Section>

      {i.vendors.length ? (
        <Section title={t("ins_vendors")}>
          <Card style={{ paddingVertical: 4 }}>
            {i.vendors.map((v, k) => (
              <Row key={v.name + k} last={k === i.vendors.length - 1} title={v.name} subtitle={t("n_bills", { n: v.count })}
                right={<Text style={[T.body, { color: C.ink, fontWeight: "700" }]}>{m$(v.total)}</Text>} />
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title={t("ins_largest")}>
        <Card style={{ paddingVertical: 4 }}>
          {i.largest.map((e, k) => (
            <Row key={e.id} last={k === i.largest.length - 1} onPress={() => router.push({ pathname: "/circle/[id]/expense-view", params: { id, eid: e.id } })}
              left={<View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
                <Icon name={CATEGORY_ICON[e.category] ?? "pricetag-outline"} size={18} color={C.primary} /></View>}
              title={e.title} subtitle={dateLabel(e.spent_on, lang, true)}
              right={<Text style={[T.body, { color: C.ink, fontWeight: "700" }]}>{m$(e.amount, false)}</Text>} />
          ))}
        </Card>
      </Section>

      <Section title={t("ins_health")}>
        <Card>
          <Health icon="attach" ok={Number(st.receipts_pct) >= 80} text={t("ins_receipts_pct", { pct: st.receipts_pct })} />
          <Health icon="shield-checkmark-outline" ok={!Number(st.checks_flagged)} text={Number(st.checks_flagged) ? t("ins_flagged", { n: st.checks_flagged }) : t("ins_no_flags")} />
          <Health icon="time-outline" ok={!i.members.some((m) => Number(m.pending))} text={i.members.some((m) => Number(m.pending)) ? t("ins_pending_conf") : t("ins_all_confirmed")} />
        </Card>
      </Section>
      <Button kind="secondary" icon="download-outline" label={t("export_csv")} onPress={csv} />
    </Screen>
  );
}

function Tile({ label, value, sub, valueTone, subTone }: { label: string; value: string; sub?: string; valueTone?: string; subTone?: string }) {
  return (
    <Card style={{ flex: 1, gap: 2 }}>
      <Text style={[T.tiny, { color: C.ink3, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 }]} numberOfLines={1}>{label}</Text>
      <Text style={[T.h2, { color: valueTone ?? C.ink }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={[T.tiny, { color: subTone ?? C.ink3 }]} numberOfLines={1}>{sub}</Text> : null}
    </Card>
  );
}
const Legend = ({ color, text }: { color: string; text: string }) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
    <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
    <Text style={[T.tiny, { color: C.ink2 }]}>{text}</Text>
  </View>
);
const Health = ({ icon, ok, text }: { icon: string; ok: boolean; text: string }) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm, paddingVertical: 4 }}>
    <View style={{ width: 30, height: 30, borderRadius: R.sm, backgroundColor: ok ? C.okSoft : C.pendingSoft, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={16} color={ok ? C.ok : C.pending} />
    </View>
    <Text style={[T.small, { color: C.ink, flex: 1 }]}>{text}</Text>
  </View>
);
