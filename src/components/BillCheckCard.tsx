import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { notify, useApp } from "../lib/app";
import { BillCheck, CheckFlag, billCheckAllowed, dismissFlag, flagKey, flagText, openFlags, openRisk, runCheck } from "../lib/billcheck";
import { dateLabel, money } from "../lib/format";
import { openUrl } from "../lib/share";
import { errText } from "../lib/supabase";
import { C, R, S, T } from "../lib/theme";
import { Button, Card, Icon, Pill } from "./ui";

const SEV = {
  high: { fg: C.owe, bg: C.oweSoft, icon: "alert-circle" },
  medium: { fg: C.pending, bg: C.pendingSoft, icon: "warning" },
  low: { fg: C.ink2, bg: C.bg, icon: "information-circle" },
  info: { fg: C.ink3, bg: C.bg, icon: "information-circle-outline" },
} as const;
const RISK_TONE = { high: "owe", medium: "pending", low: "neutral", none: "ok" } as const;

/** Bill Check panel on a bill: run / re-run, open warnings, price comparison, line items. */
export function BillCheckCard({ expenseId, check, currency, plan, onChange }: {
  expenseId: string; check: BillCheck | null; currency: string; plan?: string; onChange: (c: BillCheck | null) => void;
}) {
  const { t, lang } = useApp();
  const [busy, setBusy] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const fmt = (n: number) => money(n, currency, lang);

  const run = async () => {
    if (!billCheckAllowed(plan)) { notify(t("bc_plus_title"), t("bc_plus_text")); return; }
    setBusy(true);
    try {
      const r = await runCheck(expenseId, lang);
      onChange(r);
      // allowance used up: the free checks still ran; say why the AI part didn't
      if (r.ai?.limit_reached) notify(t("bc_limit_title"), r.ai.message || t("err_ai_limit_reached"));
    }
    catch (e: any) {
      const code = e?.code;
      notify(t("bc_failed"), code === "upgrade_required" ? t("bc_plus_text")
        : code && t("err_" + code) !== "err_" + code ? t("err_" + code) : e?.serverMessage || errText(e));
    }
    finally { setBusy(false); }
  };
  const toggle = async (f: CheckFlag, undo: boolean) => {
    if (!check) return;
    const key = flagKey(f);
    try {
      await dismissFlag(expenseId, key, undo);
      const d = undo ? check.dismissed.filter((x) => x !== key) : [...check.dismissed, key];
      onChange({ ...check, dismissed: d });
    } catch (e) { notify(t("something_wrong"), errText(e)); }
  };

  if (!check) {
    return (
      <Card>
        <View style={{ flexDirection: "row", gap: S.md, alignItems: "center" }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" }}>
            <Icon name="shield-checkmark-outline" size={24} color={C.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[T.h3, { color: C.ink }]}>{t("bc_title")}</Text>
            <Text style={[T.small, { color: C.ink3 }]}>{t("bc_intro")}</Text>
          </View>
        </View>
        <Button icon="shield-checkmark-outline" label={busy ? t("bc_running") : t("bc_run")} loading={busy} onPress={run} />
        {busy ? <Text style={[T.tiny, { color: C.ink3, textAlign: "center" }]}>{t("bc_running_hint")}</Text> : null}
      </Card>
    );
  }

  const open = openFlags(check);
  const dismissedFlags = check.flags.filter((f) => f.severity !== "info" && check.dismissed.includes(flagKey(f)));
  const risk = openRisk(check);
  const noFile = check.flags.some((f) => f.code === "no_file");

  return (
    <Card>
      <View style={{ flexDirection: "row", gap: S.md, alignItems: "center" }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: risk === "none" ? C.okSoft : SEV[risk === "low" ? "low" : risk].bg, alignItems: "center", justifyContent: "center" }}>
          <Icon name={risk === "none" ? "shield-checkmark" : "shield-half-outline"} size={24} color={risk === "none" ? C.ok : SEV[risk === "low" ? "low" : risk].fg} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[T.h3, { color: C.ink }]}>{t("bc_title")}</Text>
          <Text style={[T.tiny, { color: C.ink3 }]}>{t("bc_checked_on", { date: dateLabel(check.checked_at, lang, true) })}</Text>
        </View>
        <Pill tone={RISK_TONE[risk]} text={t("bc_risk_" + risk)} />
      </View>

      <Text style={[T.small, { color: C.ink2 }]}>
        {risk === "none" ? t("bc_all_clear") : t("bc_n_warnings", { n: open.length })}
      </Text>
      {noFile ? <View style={{ backgroundColor: C.bg, borderRadius: R.sm, padding: 10 }}><Text style={[T.tiny, { color: C.ink2 }]}>{t("bc_no_file")}</Text></View> : null}

      {open.map((f, i) => <FlagRow key={flagKey(f) + i} f={f} fmt={fmt} onDismiss={() => toggle(f, false)} />)}

      {check.benchmarks?.length ? (
        <View style={{ gap: 6, marginTop: 4 }}>
          <Text style={[T.small, { color: C.ink, fontWeight: "700" }]}>{t("bc_prices")}</Text>
          {check.benchmarks.map((b, i) => {
            const tone = b.verdict === "fair" || b.verdict === "low" ? C.ok : b.verdict === "unknown" ? C.ink3 : b.verdict === "high" ? C.pending : C.owe;
            return (
              <View key={i} style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.sm, padding: 10, gap: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={[T.small, { color: C.ink, fontWeight: "700", flex: 1 }]} numberOfLines={2}>{b.name}</Text>
                  <Text style={[T.tiny, { color: tone, fontWeight: "800" }]}>{t("bc_v_" + b.verdict)}</Text>
                </View>
                <Text style={[T.tiny, { color: C.ink2 }]}>
                  {t("bc_billed_vs", { billed: fmt(b.billed), unit: b.unit === "bill" ? "" : ` / ${b.unit}` })}
                  {b.low != null && b.high != null ? "  ·  " + t("bc_typical", { low: fmt(b.low), high: fmt(b.high) }) : ""}
                  {b.ceiling ? "  ·  " + t("bc_ceiling", { price: fmt(b.ceiling) }) : ""}
                </Text>
                {b.explanation ? <Text style={[T.tiny, { color: C.ink3 }]}>{b.explanation}</Text> : null}
                {(b.sources ?? []).length ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {(b.sources ?? []).map((u, j) => (
                      <Pressable key={j} onPress={() => openUrl(u)} accessibilityRole="link" hitSlop={6}>
                        <Text style={[T.tiny, { color: C.primary, textDecorationLine: "underline" }]}>{hostOf(u)}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {check.items?.length ? (
        <View style={{ gap: 4 }}>
          <Pressable onPress={() => setShowItems(!showItems)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }} accessibilityRole="button">
            <Icon name={showItems ? "chevron-down" : "chevron-forward"} size={16} color={C.primary} />
            <Text style={[T.small, { color: C.primary, fontWeight: "700" }]}>{t("bc_items_n", { n: check.items.length })}</Text>
          </Pressable>
          {showItems ? check.items.map((it, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.line }}>
              <View style={{ flex: 1 }}>
                <Text style={[T.tiny, { color: C.ink, fontWeight: "600" }]}>{it.name}</Text>
                <Text style={[T.tiny, { color: C.ink3 }]}>
                  {[it.qty ? `${it.qty} × ${it.rate != null ? fmt(it.rate) : "—"}` : "", it.mrp ? `MRP ${fmt(it.mrp)}` : "", it.batch ? `B ${it.batch}` : "", it.expiry ? `Exp ${it.expiry}` : ""].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <Text style={[T.tiny, { color: C.ink, fontWeight: "700" }]}>{fmt(it.amount)}</Text>
            </View>
          )) : null}
        </View>
      ) : null}

      {dismissedFlags.length ? (
        <View style={{ gap: 4 }}>
          <Pressable onPress={() => setShowDone(!showDone)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }} accessibilityRole="button">
            <Icon name={showDone ? "chevron-down" : "chevron-forward"} size={16} color={C.ink3} />
            <Text style={[T.small, { color: C.ink3, fontWeight: "700" }]}>{t("bc_marked_ok_n", { n: dismissedFlags.length })}</Text>
          </Pressable>
          {showDone ? dismissedFlags.map((f, i) => {
            const x = flagText(t, f, fmt);
            return (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, opacity: 0.7 }}>
                <Icon name="checkmark-circle" size={16} color={C.ok} />
                <Text style={[T.tiny, { color: C.ink2, flex: 1 }]}>{x.title}</Text>
                <Button small kind="ghost" label={t("bc_undo")} onPress={() => toggle(f, true)} />
              </View>
            );
          }) : null}
        </View>
      ) : null}

      <Text style={[T.tiny, { color: C.ink3 }]}>{t("bc_disclaimer")}</Text>
      <Button small kind="secondary" icon="refresh" label={busy ? t("bc_running") : t("bc_rerun")} loading={busy} onPress={run} />
      {busy ? <ActivityIndicator color={C.primary} /> : null}
    </Card>
  );
}

function FlagRow({ f, fmt, onDismiss }: { f: CheckFlag; fmt: (n: number) => string; onDismiss: () => void }) {
  const { t } = useApp();
  const s = SEV[f.severity];
  const x = flagText(t, f, fmt);
  return (
    <View style={{ backgroundColor: s.bg, borderRadius: R.sm, padding: 10, gap: 4 }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <Icon name={s.icon} size={18} color={s.fg} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[T.small, { color: s.fg, fontWeight: "800" }]}>{x.title}</Text>
          {x.body ? <Text style={[T.tiny, { color: C.ink }]}>{x.body}</Text> : null}
          {x.todo ? <Text style={[T.tiny, { color: C.ink2, fontStyle: "italic" }]}>{t("bc_what_to_do")} {x.todo}</Text> : null}
        </View>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Button small kind="ghost" icon="checkmark" label={t("bc_mark_ok")} onPress={onDismiss} />
      </View>
    </View>
  );
}

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u.slice(0, 30); } };
