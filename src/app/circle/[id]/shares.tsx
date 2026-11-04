import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Avatar, Banner, Button, Card, Icon, Loading, Screen, hashTone, st } from "../../../components/ui";
import { notify, useApp } from "../../../lib/app";
import { Summary, loadSummary, useLoad } from "../../../lib/data";
import { money, parseAmount } from "../../../lib/format";
import { errText, supabase } from "../../../lib/supabase";
import { C, S, T } from "../../../lib/theme";

const round = (n: number) => Math.round(n * 100) / 100;

export default function Shares() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useApp();
  const sum = useLoad<Summary>(() => loadSummary(id), [id]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const s = sum.data;
  const active = (s?.members ?? []).filter((m) => m.status === "active");

  useEffect(() => { if (s) setVals(Object.fromEntries(active.map((m) => [m.id, String(Number(m.share))]))); }, [s]); // eslint-disable-line
  if (!s) return <Loading />;
  if (!s.is_admin) return <Screen title={t("shares")}><Banner text={t("only_organiser")} /></Screen>;

  const total = round(active.reduce((a, m) => a + parseAmount(vals[m.id] ?? "0"), 0));
  const ok = Math.abs(total - 100) < 0.01;
  const example = s.circle.split_mode === "budget" ? Number(s.circle.budget_amount ?? 0) : 10000;
  const bump = (mid: string, d: number) => setVals({ ...vals, [mid]: String(Math.max(0, Math.min(100, round(parseAmount(vals[mid] ?? "0") + d)))) });

  const equal = () => {
    const n = active.length; const base = Math.floor((100 / n) * 100) / 100;
    const out: Record<string, string> = {};
    active.forEach((m, i) => { out[m.id] = String(i === 0 ? round(100 - base * (n - 1)) : base); });
    setVals(out);
  };
  const fillRemainder = (mid: string) => {
    const others = active.filter((m) => m.id !== mid).reduce((a, m) => a + parseAmount(vals[m.id] ?? "0"), 0);
    setVals({ ...vals, [mid]: String(Math.max(0, round(100 - others))) });
  };

  const save = async () => {
    setBusy(true);
    const payload = Object.fromEntries(active.map((m) => [m.id, parseAmount(vals[m.id] ?? "0")]));
    const { error } = await supabase.rpc("saath_set_shares", { p_circle: id, p_shares: payload });
    setBusy(false);
    if (error) notify(t("something_wrong"), errText(error)); else router.back();
  };

  return (
    <Screen title={t("edit_shares")} subtitle={s.circle.name}
      footer={<Button label={t("save_shares")} icon="checkmark" loading={busy} disabled={total > 100.0001} onPress={save} />}>
      <Text style={[T.body, { color: C.ink2 }]}>{t("shares_intro")}</Text>
      <View style={{ flexDirection: "row", gap: S.sm }}>
        <Button small kind="secondary" icon="git-compare-outline" label={t("split_equally")} onPress={equal} style={{ flex: 1 }} />
      </View>
      <Card style={{ paddingVertical: 8 }}>
        {active.map((m, i) => {
          const v = parseAmount(vals[m.id] ?? "0");
          return (
            <View key={m.id} style={[{ paddingVertical: S.md, gap: S.sm }, i < active.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
                <Avatar name={m.name} tone={hashTone(m.name)} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={[T.body, { color: C.ink, fontWeight: "600" }]} numberOfLines={1}>{m.name}</Text>
                  <Text style={[T.tiny, { color: C.ink3 }]}>{t("pays_x_of_y", { x: money(example * v / 100, s.circle.currency, lang), y: money(example, s.circle.currency, lang) })}</Text>
                </View>
                <Pressable accessibilityLabel="−5" onPress={() => bump(m.id, -5)} hitSlop={6} style={{ padding: 6 }}><Icon name="remove-circle-outline" size={28} color={C.ink2} /></Pressable>
                <TextInput value={vals[m.id] ?? ""} onChangeText={(x) => setVals({ ...vals, [m.id]: x })} keyboardType="decimal-pad" accessibilityLabel={`${m.name} %`}
                  style={[st.input, { width: 72, minHeight: 44, height: 44, textAlign: "center", fontWeight: "800" }]} />
                <Pressable accessibilityLabel="+5" onPress={() => bump(m.id, 5)} hitSlop={6} style={{ padding: 6 }}><Icon name="add-circle-outline" size={28} color={C.primary} /></Pressable>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
                <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: C.bg }}>
                  <View style={{ width: `${Math.min(100, v)}%`, height: 8, borderRadius: 4, backgroundColor: C.primary }} />
                </View>
                {!ok && total < 100 ? <Pressable onPress={() => fillRemainder(m.id)}><Text style={[T.tiny, { color: C.primary, fontWeight: "700" }]}>{t("give_rest")}</Text></Pressable> : null}
              </View>
            </View>
          );
        })}
      </Card>
      <Banner tone={ok ? "ok" : "owe"} icon={ok ? "checkmark-circle-outline" : "alert-circle-outline"}
        text={ok ? t("shares_total_ok") : total > 100 ? t("shares_over", { pct: total }) : t("shares_under", { pct: total, rest: round(100 - total) })} />
      <Text style={[T.tiny, { color: C.ink3 }]}>{t("shares_future_note")}</Text>
    </Screen>
  );
}
