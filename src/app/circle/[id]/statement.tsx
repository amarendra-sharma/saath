import { useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, Chips, Loading, Screen, Section } from "../../../components/ui";
import { notify, useApp } from "../../../lib/app";
import { Summary, loadSummary, useLoad } from "../../../lib/data";
import { csvCell, esc, exportCsv, exportPdf } from "../../../lib/exporter";
import { dateLabel, money, todayISO } from "../../../lib/format";
import { methodDef } from "../../../lib/payments";
import { errText, supabase } from "../../../lib/supabase";
import { C, S, T } from "../../../lib/theme";

type Stmt = {
  circle: { name: string; currency: string }; from: string; to: string;
  expenses: { date: string; title: string; category: string; vendor: string | null; amount: number; paid_by: string | null; receipts: number }[];
  contributions: { date: string; member: string; kind: string; amount: number; method: string | null; reference: string | null; status: string }[];
  members: { name: string; share: number; opening: number; charged: number; paid: number }[];
};

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function Statement() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useApp();
  const sum = useLoad<Summary>(() => loadSummary(id), [id]);
  const [range, setRange] = useState<"period" | "this_month" | "last_month" | "3m" | "year" | "all">("period");
  const [busy, setBusy] = useState(false);

  const bounds = (s: Summary): [string, string] => {
    const now = new Date();
    switch (range) {
      case "period": return [s.period.start, s.period.end];
      case "this_month": return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), todayISO()];
      case "last_month": return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
      case "3m": return [iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), todayISO()];
      case "year": return [iso(new Date(now.getFullYear(), 0, 1)), todayISO()];
      default: return [s.circle.start_date < "2000-01-01" ? "2000-01-01" : "2000-01-01", todayISO()];
    }
  };
  const st = useLoad<Stmt | null>(async () => {
    const s = await loadSummary(id);
    const [from, to] = bounds(s);
    const { data, error } = await supabase.rpc("saath_statement", { p_circle: id, p_from: from, p_to: to, p_member: null });
    if (error) throw error;
    return data as Stmt;
  }, [id, range]);

  const s = sum.data, d = st.data;
  if (!s) return <Loading />;
  const cur = s.circle.currency;
  const m$ = (n: number) => money(n, cur, lang);
  const expTotal = (d?.expenses ?? []).reduce((a, e) => a + Number(e.amount), 0);
  const payTotal = (d?.contributions ?? []).filter((c) => c.status === "confirmed").reduce((a, c) => a + (c.kind === "reimbursement" ? -1 : 1) * Number(c.amount), 0);

  const pdf = async () => {
    if (!d) return;
    setBusy(true);
    try {
      const rows = (cols: string[]) => `<tr>${cols.map((c) => `<td>${c}</td>`).join("")}</tr>`;
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        body{font-family:-apple-system,"Noto Sans","Noto Sans Devanagari","Noto Sans Bengali",Arial,sans-serif;color:#1C2624;padding:28px;font-size:12px}
        h1{color:#0E6B5C;margin:0 0 4px;font-size:22px} h2{font-size:15px;margin:22px 0 8px;color:#0A5246}
        table{width:100%;border-collapse:collapse} th,td{padding:6px 8px;border-bottom:1px solid #E4DFD3;text-align:left} th{background:#F6F3EC;font-size:11px;text-transform:uppercase}
        td.n,th.n{text-align:right} .muted{color:#7C8784} .tot td{font-weight:700;border-top:2px solid #1C2624}
      </style></head><body>
      <h1>${esc(d.circle.name)}</h1>
      <div class="muted">${esc(t("statement"))} · ${esc(dateLabel(d.from, lang, true))} – ${esc(dateLabel(d.to, lang, true))} · ${esc(cur)}</div>
      <h2>${esc(t("by_member"))}</h2>
      <table><tr><th>${esc(t("name"))}</th><th class="n">${esc(t("share"))}</th><th class="n">${esc(t("opening"))}</th><th class="n">${esc(t("charged"))}</th><th class="n">${esc(t("paid"))}</th><th class="n">${esc(t("closing"))}</th></tr>
      ${d.members.map((m) => `<tr><td>${esc(m.name)}</td><td class="n">${Number(m.share).toFixed(1)}%</td><td class="n">${esc(m$(m.opening))}</td><td class="n">${esc(m$(m.charged))}</td><td class="n">${esc(m$(m.paid))}</td><td class="n"><b>${esc(m$(m.opening + m.charged - m.paid))}</b></td></tr>`).join("")}
      </table>
      <h2>${esc(t("tab_expenses"))} (${d.expenses.length})</h2>
      <table><tr><th>${esc(t("date"))}</th><th>${esc(t("item"))}</th><th>${esc(t("category"))}</th><th>${esc(t("who_paid"))}</th><th class="n">${esc(t("amount"))}</th></tr>
      ${d.expenses.map((e) => rows([esc(dateLabel(e.date, lang)), esc(e.title) + (e.vendor ? ` <span class="muted">· ${esc(e.vendor)}</span>` : "") + (e.receipts ? " 📎" : ""), esc(t("cat_" + e.category)), esc(e.paid_by ?? t("fund_short")), `<span style="float:right">${esc(m$(e.amount))}</span>`])).join("")}
      <tr class="tot"><td colspan="4">${esc(t("total"))}</td><td class="n">${esc(m$(expTotal))}</td></tr></table>
      <h2>${esc(t("tab_payments"))} (${d.contributions.length})</h2>
      <table><tr><th>${esc(t("date"))}</th><th>${esc(t("name"))}</th><th>${esc(t("how_sent"))}</th><th>${esc(t("status"))}</th><th class="n">${esc(t("amount"))}</th></tr>
      ${d.contributions.map((c) => rows([esc(dateLabel(c.date, lang)), esc(c.member), esc(c.kind === "expense_paid" ? t("kind_expense_paid") : c.kind === "reimbursement" ? t("kind_reimbursement") : (c.method ? methodDef(c.method).name : "")) + (c.reference ? ` <span class="muted">${esc(c.reference)}</span>` : ""), esc(t("st_" + c.status)), `<span style="float:right">${c.kind === "reimbursement" ? "−" : ""}${esc(m$(c.amount))}</span>`])).join("")}
      <tr class="tot"><td colspan="4">${esc(t("total_confirmed"))}</td><td class="n">${esc(m$(payTotal))}</td></tr></table>
      <p class="muted" style="margin-top:24px">${esc(t("generated_by", { date: dateLabel(new Date(), lang, true) }))}</p>
      </body></html>`;
      await exportPdf(html, `${d.circle.name}-${d.from}-${d.to}.pdf`);
    } catch (e) { notify(t("something_wrong"), errText(e)); } finally { setBusy(false); }
  };

  const csv = async () => {
    if (!d) return;
    const lines = [["type", "date", "name", "category_or_method", "amount", "currency", "status", "reference"].join(",")];
    for (const e of d.expenses) lines.push(["expense", e.date, e.title, e.category, e.amount, cur, e.paid_by ?? "fund", e.vendor ?? ""].map(csvCell).join(","));
    for (const c of d.contributions) lines.push([c.kind, c.date, c.member, c.method ?? "", c.kind === "reimbursement" ? -c.amount : c.amount, cur, c.status, c.reference ?? ""].map(csvCell).join(","));
    try { await exportCsv(lines.join("\n"), `${d.circle.name}-${d.from}-${d.to}.csv`); } catch (e) { notify(t("something_wrong"), errText(e)); }
  };

  return (
    <Screen title={t("statement")} subtitle={s.circle.name}
      footer={<View style={{ flexDirection: "row", gap: S.md }}>
        <Button style={{ flex: 1 }} kind="secondary" icon="grid-outline" label="CSV" onPress={csv} disabled={!d} />
        <Button style={{ flex: 2 }} icon="document-outline" label={t("export_pdf")} loading={busy} onPress={pdf} disabled={!d} />
      </View>}>
      <Chips value={range} onChange={setRange} options={[
        { value: "period", label: t("r_period") }, { value: "this_month", label: t("r_this_month") }, { value: "last_month", label: t("r_last_month") },
        { value: "3m", label: t("r_3m") }, { value: "year", label: t("r_year") }, { value: "all", label: t("r_all") },
      ]} />
      {!d ? <Loading /> : (
        <>
          <Card>
            <Text style={[T.small, { color: C.ink3 }]}>{dateLabel(d.from, lang, true)} – {dateLabel(d.to, lang, true)}</Text>
            <View style={{ flexDirection: "row", gap: S.lg }}>
              <View style={{ flex: 1 }}><Text style={[T.tiny, { color: C.ink3, fontWeight: "700" }]}>{t("spent").toUpperCase()}</Text><Text style={[T.h2, { color: C.ink }]}>{m$(expTotal)}</Text></View>
              <View style={{ flex: 1 }}><Text style={[T.tiny, { color: C.ink3, fontWeight: "700" }]}>{t("collected").toUpperCase()}</Text><Text style={[T.h2, { color: C.ink }]}>{m$(payTotal)}</Text></View>
            </View>
          </Card>
          <Section title={t("by_member")}>
            <Card>
              <View style={{ flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.line }}>
                <Text style={[T.tiny, { flex: 2, color: C.ink3, fontWeight: "700" }]}>{t("name")}</Text>
                <Text style={[T.tiny, { flex: 1.3, color: C.ink3, fontWeight: "700", textAlign: "right" }]}>{t("charged")}</Text>
                <Text style={[T.tiny, { flex: 1.3, color: C.ink3, fontWeight: "700", textAlign: "right" }]}>{t("paid")}</Text>
                <Text style={[T.tiny, { flex: 1.4, color: C.ink3, fontWeight: "700", textAlign: "right" }]}>{t("closing")}</Text>
              </View>
              {d.members.map((m) => {
                const close = m.opening + m.charged - m.paid;
                return (
                  <View key={m.name} style={{ flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.bg }}>
                    <Text style={[T.small, { flex: 2, color: C.ink, fontWeight: "600" }]} numberOfLines={1}>{m.name}</Text>
                    <Text style={[T.small, { flex: 1.3, color: C.ink2, textAlign: "right" }]}>{money(m.charged, cur, lang, { compact: true })}</Text>
                    <Text style={[T.small, { flex: 1.3, color: C.ink2, textAlign: "right" }]}>{money(m.paid, cur, lang, { compact: true })}</Text>
                    <Text style={[T.small, { flex: 1.4, textAlign: "right", fontWeight: "700", color: close > 0.5 ? C.owe : close < -0.5 ? C.ok : C.ink3 }]}>{money(close, cur, lang, { compact: true })}</Text>
                  </View>
                );
              })}
              <Text style={[T.tiny, { color: C.ink3 }]}>{t("closing_hint")}</Text>
            </Card>
          </Section>
          <Section title={`${t("tab_expenses")} · ${d.expenses.length}`}>
            <Card>
              {d.expenses.length === 0 ? <Text style={[T.small, { color: C.ink3 }]}>{t("none_in_range")}</Text> : d.expenses.map((e, i) => (
                <View key={i} style={{ flexDirection: "row", gap: S.sm, paddingVertical: 4 }}>
                  <Text style={[T.small, { color: C.ink3, width: 54 }]}>{dateLabel(e.date, lang)}</Text>
                  <Text style={[T.small, { color: C.ink, flex: 1 }]} numberOfLines={1}>{e.title}</Text>
                  <Text style={[T.small, { color: C.ink, fontWeight: "700" }]}>{m$(e.amount)}</Text>
                </View>
              ))}
            </Card>
          </Section>
          <Section title={`${t("tab_payments")} · ${d.contributions.length}`}>
            <Card>
              {d.contributions.length === 0 ? <Text style={[T.small, { color: C.ink3 }]}>{t("none_in_range")}</Text> : d.contributions.map((c, i) => (
                <View key={i} style={{ flexDirection: "row", gap: S.sm, paddingVertical: 4 }}>
                  <Text style={[T.small, { color: C.ink3, width: 54 }]}>{dateLabel(c.date, lang)}</Text>
                  <Text style={[T.small, { color: C.ink, flex: 1 }]} numberOfLines={1}>{c.member}{c.status !== "confirmed" ? ` · ${t("st_" + c.status)}` : ""}</Text>
                  <Text style={[T.small, { color: c.kind === "reimbursement" ? C.owe : C.ink, fontWeight: "700" }]}>{c.kind === "reimbursement" ? "−" : ""}{m$(c.amount)}</Text>
                </View>
              ))}
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
