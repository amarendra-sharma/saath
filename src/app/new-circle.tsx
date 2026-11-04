import { router } from "expo-router";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { AmountField, Banner, Button, Card, Chips, Field, Screen, Toggle } from "../components/ui";
import { notify, useApp } from "../lib/app";
import { CURRENCIES, parseAmount } from "../lib/format";
import { errText, supabase } from "../lib/supabase";
import { C, S, T } from "../lib/theme";
import { PURPOSE_ICON } from "../lib/constants";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

export default function NewCircle() {
  const { t, profile } = useApp();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("medical");
  const [currency, setCurrency] = useState(profile?.language === "hi" || profile?.language === "bn" ? "INR" : "INR");
  const [mode, setMode] = useState<"expenses" | "budget">("expenses");
  const [budget, setBudget] = useState("");
  const [period, setPeriod] = useState<"weekly" | "biweekly" | "monthly" | "quarterly">("monthly");
  const [dueDay, setDueDay] = useState(1);
  const [confirmPayments, setConfirmPayments] = useState(true);
  const [busy, setBusy] = useState(false);

  const weekly = period === "weekly" || period === "biweekly";
  const canNext = step === 0 ? name.trim().length > 0 : step === 1 ? (mode === "expenses" || parseAmount(budget) > 0) : true;

  const create = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("saath_create_circle", {
        p_name: name.trim(), p_purpose: purpose, p_currency: currency, p_split_mode: mode,
        p_budget: mode === "budget" ? parseAmount(budget) : null, p_period: period,
        p_due_day: weekly ? Math.min(dueDay, 7) : dueDay, p_description: null, p_require_confirmation: confirmPayments,
      });
      if (error) throw error;
      router.replace({ pathname: "/circle/[id]", params: { id: data as string, welcome: "1" } });
    } catch (e) { notify(t("something_wrong"), errText(e)); }
    finally { setBusy(false); }
  };

  return (
    <Screen title={t("new_circle")} subtitle={t("step_of", { n: step + 1, total: 3 })}
      footer={
        <View style={{ flexDirection: "row", gap: S.md }}>
          {step > 0 ? <Button kind="secondary" label={t("back")} onPress={() => setStep(step - 1)} style={{ flex: 1 }} /> : null}
          <Button style={{ flex: 2 }} label={step < 2 ? t("next") : t("create_circle")} disabled={!canNext} loading={busy}
            onPress={() => (step < 2 ? setStep(step + 1) : create())} />
        </View>
      }>
      {step === 0 && (
        <>
          <Field label={t("circle_name")} value={name} onChangeText={setName} placeholder={t("circle_name_ph")} autoFocus maxLength={80} />
          <View style={{ gap: S.sm }}>
            <Text style={[T.small, { color: C.ink2, fontWeight: "600" }]}>{t("what_for")}</Text>
            <Chips value={purpose} onChange={setPurpose}
              options={Object.keys(PURPOSE_ICON).map((k) => ({ value: k, label: t("purpose_" + k), icon: PURPOSE_ICON[k] }))} />
          </View>
          <View style={{ gap: S.sm }}>
            <Text style={[T.small, { color: C.ink2, fontWeight: "600" }]}>{t("currency")}</Text>
            <Chips wrap={false} value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
            <Text style={[T.tiny, { color: C.ink3 }]}>{t("currency_hint")}</Text>
          </View>
        </>
      )}

      {step === 1 && (
        <>
          <Text style={[T.body, { color: C.ink2 }]}>{t("how_split_q")}</Text>
          {(["expenses", "budget"] as const).map((m) => (
            <Card key={m} onPress={() => setMode(m)} style={mode === m ? { borderWidth: 2, borderColor: C.primary } : { borderWidth: 2, borderColor: "transparent" }}>
              <Text style={[T.h3, { color: C.ink }]}>{t("mode_" + m)}</Text>
              <Text style={[T.small, { color: C.ink2 }]}>{t("mode_" + m + "_desc")}</Text>
            </Card>
          ))}
          {mode === "budget" && <AmountField label={t("budget_per_period", { period: t("per_" + period) })} value={budget} onChangeText={setBudget} currency={currency} />}
          <Banner tone="primary" icon="pie-chart-outline" text={t("shares_later_hint")} />
        </>
      )}

      {step === 2 && (
        <>
          <View style={{ gap: S.sm }}>
            <Text style={[T.small, { color: C.ink2, fontWeight: "600" }]}>{t("how_often")}</Text>
            <Chips value={period} onChange={(p) => { setPeriod(p); setDueDay(1); }}
              options={(["weekly", "biweekly", "monthly", "quarterly"] as const).map((p) => ({ value: p, label: t("period_" + p) }))} />
          </View>
          <View style={{ gap: S.sm }}>
            <Text style={[T.small, { color: C.ink2, fontWeight: "600" }]}>{weekly ? t("due_weekday") : t("due_day_of_month")}</Text>
            {weekly ? (
              <Chips value={String(dueDay)} onChange={(v) => setDueDay(Number(v))} options={WEEKDAYS.map((d) => ({ value: String(d), label: t("wd_" + d) }))} />
            ) : (
              <Chips wrap={false} value={String(dueDay)} onChange={(v) => setDueDay(Number(v))}
                options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />
            )}
            <Text style={[T.tiny, { color: C.ink3 }]}>{t("due_hint")}</Text>
          </View>
          <Card>
            <Toggle label={t("confirm_payments")} hint={t("confirm_payments_hint")} value={confirmPayments} onChange={setConfirmPayments} />
          </Card>
        </>
      )}
    </Screen>
  );
}
