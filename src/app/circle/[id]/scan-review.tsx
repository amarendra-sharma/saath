import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Banner, Button, Card, Empty, Icon, Loading, Pill, Screen, st } from "../../../components/ui";
import { notify, useApp } from "../../../lib/app";
import { CATEGORY_ICON } from "../../../lib/constants";
import { Summary, loadSummary, useLoad } from "../../../lib/data";
import { money, parseAmount, todayISO } from "../../../lib/format";
import { ScanDoc, isBill, setPendingScan, takePendingScan } from "../../../lib/scan";
import { errText, supabase } from "../../../lib/supabase";
import { C, R, S, T } from "../../../lib/theme";

type Row = ScanDoc & { key: number; on: boolean; amountText: string; titleText: string };

export default function ScanReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useApp();
  const sum = useLoad<Summary>(() => loadSummary(id), [id]);
  const scan = takePendingScan();
  const [rows, setRows] = useState<Row[]>(() =>
    (scan?.documents ?? []).map((d, i) => ({
      ...d, key: i, on: isBill(d),
      amountText: d.currency === (scan?.circleCurrency ?? d.currency) ? String(d.amount || "") : "",
      titleText: d.title || d.vendor || "",
    })));
  const [busy, setBusy] = useState(false);
  const s = sum.data;
  const cur = s?.circle.currency ?? "INR";
  const chosen = useMemo(() => rows.filter((r) => r.on), [rows]);
  const total = chosen.reduce((a, r) => a + parseAmount(r.amountText), 0);

  if (!scan) return <Screen title={t("scan_review_title")}><Empty icon="document-outline" title={t("scan_nothing")} /></Screen>;
  if (!s) return <Loading />;

  const set = (k: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === k ? { ...r, ...patch } : r)));

  const addAll = async () => {
    const bad = chosen.find((r) => parseAmount(r.amountText) <= 0);
    if (bad) { notify(t("scan_fix_row", { title: bad.titleText || "—" })); return; }
    setBusy(true);
    try {
      for (const r of chosen) {
        const pages = r.pages?.length ? (r.pages.length > 1 ? `p. ${r.pages[0]}–${r.pages[r.pages.length - 1]}` : `p. ${r.pages[0]}`) : "";
        const notes = [r.bill_number ? `#${r.bill_number}` : "", pages, r.note ?? ""].filter(Boolean).join(" · ") || null;
        const { data, error } = await supabase.from("saath_expenses").insert({
          circle_id: id, title: (r.titleText || r.vendor || t("cat_" + r.category)).slice(0, 120), amount: parseAmount(r.amountText),
          category: r.category, spent_on: r.date || todayISO(), vendor: r.vendor || null, notes,
          orig_amount: r.currency !== cur ? r.amount : null, orig_currency: r.currency !== cur ? r.currency : null,
        }).select("id").single();
        if (error) throw error;
        const { error: e2 } = await supabase.from("saath_receipts").insert({ expense_id: data.id, circle_id: id, path: scan.path, mime: scan.mime, size_bytes: scan.size });
        if (e2) throw e2;
      }
      setPendingScan(null);
      notify(t("scan_added", { n: chosen.length, total: money(total, cur, lang) }));
      router.replace({ pathname: "/circle/[id]", params: { id } });
    } catch (e) { notify(t("something_wrong"), errText(e)); }
    finally { setBusy(false); }
  };

  return (
    <Screen title={t("scan_review_title")} subtitle={scan.name}
      footer={<Button icon="checkmark-done" loading={busy} disabled={!chosen.length}
        label={t("scan_add_n", { n: chosen.length, total: money(total, cur, lang) })} onPress={addAll} />}>
      <Text style={[T.body, { color: C.ink2 }]}>{t("scan_review_intro", { n: rows.length })}</Text>
      {scan.overall_note ? <Banner tone="primary" icon="sparkles-outline" text={scan.overall_note} /> : null}
      {rows.map((r) => {
        const counted = isBill(r);
        const foreign = r.currency !== cur;
        return (
          <Card key={r.key} style={!r.on ? { opacity: 0.6 } : undefined}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: r.on }} hitSlop={8} onPress={() => set(r.key, { on: !r.on })}
                style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: r.on ? C.primary : C.line, backgroundColor: r.on ? C.primary : C.card, alignItems: "center", justifyContent: "center" }}>
                {r.on ? <Icon name="checkmark" size={18} color={C.white} /> : null}
              </Pressable>
              <Icon name={CATEGORY_ICON[r.category] ?? "pricetag-outline"} size={20} color={C.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[T.small, { color: C.ink3 }]} numberOfLines={1}>
                  {[r.vendor, r.date, r.pages?.length ? `p. ${r.pages.join(", ")}` : ""].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <Pill tone={counted ? (r.confidence === "high" ? "ok" : "pending") : "neutral"}
                text={counted ? t("conf_" + r.confidence) : t("doc_" + r.doc_type)} />
            </View>
            <TextInput value={r.titleText} onChangeText={(v) => set(r.key, { titleText: v })} accessibilityLabel={t("what_was_it")}
              style={[st.input, { minHeight: 44, fontSize: 16 }]} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
              <Text style={[T.h3, { color: C.ink3 }]}>{cur}</Text>
              <TextInput value={r.amountText} onChangeText={(v) => set(r.key, { amountText: v })} keyboardType="decimal-pad" accessibilityLabel={t("amount")}
                placeholder={foreign ? t("scan_convert_ph") : "0"} placeholderTextColor={C.ink3}
                style={[st.input, { flex: 1, minWidth: 0, width: "100%", minHeight: 44, fontSize: 20, fontWeight: "800" }]} />
            </View>
            {foreign ? <Text style={[T.tiny, { color: C.pending, fontWeight: "700" }]}>{t("scan_foreign_row", { amount: money(r.amount, r.currency, lang), cur })}</Text> : null}
            {!counted && r.doc_type !== "report" ? <Text style={[T.tiny, { color: C.ink3 }]}>{t("scan_not_counted")}</Text> : null}
            {r.note ? <View style={{ backgroundColor: C.pendingSoft, borderRadius: R.sm, padding: 8 }}><Text style={[T.tiny, { color: C.pending, fontWeight: "600" }]}>{r.note}</Text></View> : null}
          </Card>
        );
      })}
    </Screen>
  );
}
