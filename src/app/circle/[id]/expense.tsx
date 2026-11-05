import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { AttachBar } from "../../../components/AttachBar";
import { AmountField, Avatar, Banner, Button, Card, Chips, Field, Loading, Screen, Toggle, hashTone, st } from "../../../components/ui";
import { confirm, notify, useApp } from "../../../lib/app";
import { CATEGORIES_BY_PURPOSE, CATEGORY_ICON } from "../../../lib/constants";
import { Expense, Summary, loadSummary, useLoad } from "../../../lib/data";
import { CURRENCIES, money, parseAmount, todayISO } from "../../../lib/format";
import { errText, supabase } from "../../../lib/supabase";
import { C, S, T } from "../../../lib/theme";
import { LocalFile, pickPdf, pickPhotos, takePhoto, uploadFile } from "../../../lib/upload";
import { ScanResult, isBill, scanFile, setPendingScan } from "../../../lib/scan";
import { ActivityIndicator } from "react-native";
import { billCheckAllowed, runCheck } from "../../../lib/billcheck";

const shift = (iso: string, days: number) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

export default function ExpenseForm() {
  const { id, eid } = useLocalSearchParams<{ id: string; eid?: string }>();
  const { t, lang } = useApp();
  const sum = useLoad<Summary>(() => loadSummary(id), [id]);
  const [loaded, setLoaded] = useState(!eid);
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("other");
  const [date, setDate] = useState(todayISO());
  const [paidBy, setPaidBy] = useState<string>("fund");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [foreign, setForeign] = useState(false);
  const [origAmount, setOrigAmount] = useState("");
  const [origCur, setOrigCur] = useState("USD");
  const [custom, setCustom] = useState(false);
  const [split, setSplit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState<{ path: string; mime: string; size: number | null } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<{ tone: "ok" | "pending" | "owe"; text: string } | null>(null);

  useEffect(() => {
    if (!eid) return;
    (async () => {
      const { data } = await supabase.from("saath_expenses").select("*").eq("id", eid).single();
      const e = data as Expense | null;
      if (e) {
        setAmount(String(e.amount)); setTitle(e.title); setCategory(e.category); setDate(e.spent_on);
        setPaidBy(e.paid_by_member_id ?? "fund"); setVendor(e.vendor ?? ""); setNotes(e.notes ?? "");
        if (e.orig_amount && e.orig_currency) { setForeign(true); setOrigAmount(String(e.orig_amount)); setOrigCur(e.orig_currency); }
        if (e.split && Object.keys(e.split).length) { setCustom(true); setSplit(Object.fromEntries(Object.entries(e.split).map(([k, v]) => [k, String(v)]))); }
      }
      setLoaded(true);
    })();
  }, [eid]);

  const s = sum.data;
  const active = useMemo(() => (s?.members ?? []).filter((m) => m.status === "active"), [s]);
  useEffect(() => {
    if (s && !Object.keys(split).length) setSplit(Object.fromEntries(active.map((m) => [m.id, String(Number(m.share))])));
  }, [s]); // eslint-disable-line
  if (!s || !loaded) return <Loading />;

  const cur = s.circle.currency;
  const amt = parseAmount(amount);
  const splitTotal = Object.values(split).reduce((a, v) => a + parseAmount(v), 0);
  const splitOk = !custom || Math.abs(splitTotal - 100) < 0.01;
  const cats = CATEGORIES_BY_PURPOSE[s.circle.purpose] ?? CATEGORIES_BY_PURPOSE.other;
  const meId = s.me;

  const runScan = async (pick: () => Promise<LocalFile | LocalFile[] | null>) => {
    const got = await pick();
    const f = Array.isArray(got) ? got[0] : got;
    if (!f) return;
    setScanning(true); setScanMsg(null);
    try {
      const r: ScanResult = { ...(await scanFile(id, f, lang)), circleCurrency: cur };
      setScanned({ path: r.path, mime: r.mime, size: r.size });
      const bills = r.documents.filter(isBill);
      if (bills.length > 1) {
        setPendingScan(r);
        router.replace({ pathname: "/circle/[id]/scan-review", params: { id } });
        return;
      }
      const d = bills[0];
      if (!d) {
        const kind = r.documents[0]?.doc_type ?? "other";
        setScanMsg({ tone: "pending", text: t("scan_no_bill", { kind: t("doc_" + kind) }) });
        return;
      }
      setTitle(d.title || d.vendor || "");
      if (d.vendor) setVendor(d.vendor);
      if (d.date) setDate(d.date);
      setCategory(cats.includes(d.category) ? d.category : "other");
      const note = [d.bill_number ? `#${d.bill_number}` : "", d.note ?? ""].filter(Boolean).join(" · ");
      if (note) setNotes(note);
      if (d.currency !== cur) {
        setForeign(true); setOrigCur(d.currency); setOrigAmount(String(d.amount)); setAmount("");
        setScanMsg({ tone: "pending", text: t("scan_foreign", { amount: money(d.amount, d.currency, lang), cur }) });
      } else {
        setAmount(String(d.amount));
        setScanMsg({ tone: d.confidence === "high" ? "ok" : "pending",
          text: (d.confidence === "high" ? t("scan_filled") : t("scan_check")) + (d.note ? ` ${d.note}` : "") });
      }
    } catch (e: any) {
      setScanMsg({ tone: "owe", text: t("err_" + (e?.code || "scan_failed")) === "err_" + (e?.code || "scan_failed") ? t("err_scan_failed") : t("err_" + e.code) });
    } finally { setScanning(false); }
  };

  const save = async () => {
    if (amt <= 0 || !title.trim()) { notify(t("fill_amount_title")); return; }
    if (!splitOk) { notify(t("split_must_100")); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { notify(t("bad_date")); return; }
    setBusy(true);
    try {
      const row = {
        circle_id: id, title: title.trim(), amount: amt, category, spent_on: date,
        paid_by_member_id: paidBy === "fund" ? null : paidBy, vendor: vendor.trim() || null, notes: notes.trim() || null,
        orig_amount: foreign ? parseAmount(origAmount) || null : null, orig_currency: foreign ? origCur : null,
        split: custom ? Object.fromEntries(Object.entries(split).map(([k, v]) => [k, parseAmount(v)]).filter(([, v]) => (v as number) > 0)) : null,
      };
      let expenseId = eid as string | undefined;
      if (eid) {
        const { error } = await supabase.from("saath_expenses").update(row).eq("id", eid);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("saath_expenses").insert(row).select("id").single();
        if (error) throw error;
        expenseId = data.id;
      }
      if (scanned) {
        const { error } = await supabase.from("saath_receipts").insert({ expense_id: expenseId, circle_id: id, path: scanned.path, mime: scanned.mime, size_bytes: scanned.size });
        if (error) throw error;
      }
      for (const f of files) {
        const path = await uploadFile(id, expenseId!, f);
        const { error } = await supabase.from("saath_receipts").insert({ expense_id: expenseId, circle_id: id, path, mime: f.mime, size_bytes: f.size ?? null });
        if (error) throw error;
      }
      // Bill Check runs in the background; its result appears on the bill
      if (s.circle.bill_check_auto && billCheckAllowed(s.circle.plan) && (scanned || files.length) && expenseId) runCheck(expenseId, lang).catch(() => {});
      router.back();
    } catch (e) { notify(t("something_wrong"), errText(e)); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!(await confirm(t("delete_expense_q"), t("delete_expense_text"), t("delete"), t("cancel"), true))) return;
    const { error } = await supabase.from("saath_expenses").delete().eq("id", eid);
    if (error) notify(t("something_wrong"), errText(error)); else router.dismissTo({ pathname: "/circle/[id]", params: { id } });
  };

  return (
    <Screen title={eid ? t("edit_expense") : t("add_expense")} subtitle={s.circle.name}
      footer={<Button label={eid ? t("save_changes") : t("save_expense")} icon="checkmark" loading={busy} disabled={amt <= 0 || !title.trim() || !splitOk} onPress={save} />}>
      {!eid ? (
        <Card tone="accent">
          <Text style={[T.h3, { color: C.ink }]}>{t("scan_title")}</Text>
          <Text style={[T.small, { color: C.ink2 }]}>{t("scan_hint")}</Text>
          {scanning ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: S.sm }}>
              <ActivityIndicator color={C.primary} />
              <Text style={[T.small, { color: C.ink2, flex: 1 }]}>{t("scan_reading")}</Text>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: S.sm }}>
              <Button small icon="camera-outline" label={t("take_photo")} style={{ flex: 1 }} onPress={() => runScan(takePhoto)} />
              <Button small icon="images-outline" label={t("from_gallery")} style={{ flex: 1 }} onPress={() => runScan(async () => (await pickPhotos()).slice(0, 1))} />
              <Button small icon="document-outline" label="PDF" style={{ flex: 0.7 }} onPress={() => runScan(async () => (await pickPdf()).slice(0, 1))} />
            </View>
          )}
          {scanned && !scanning ? <Text style={[T.tiny, { color: C.ok, fontWeight: "700" }]}>✓ {t("scan_attached")}</Text> : null}
        </Card>
      ) : null}
      {scanMsg ? <Banner tone={scanMsg.tone} icon="sparkles-outline" text={scanMsg.text} /> : null}

      <AmountField label={t("amount")} value={amount} onChangeText={setAmount} currency={cur} autoFocus={false} />
      <Field label={t("what_was_it")} value={title} onChangeText={setTitle} placeholder={t("expense_title_ph")} maxLength={120} />

      <AttachBar label={t("receipts")} files={files} onChange={setFiles} />
      {!files.length && !eid && !scanned ? <Text style={[T.tiny, { color: C.ink3, marginTop: -8 }]}>{t("receipt_hint")}</Text> : null}

      <View style={{ gap: S.sm }}>
        <Text style={[T.small, { color: C.ink2, fontWeight: "600" }]}>{t("category")}</Text>
        <Chips value={category} onChange={setCategory} options={cats.map((k) => ({ value: k, label: t("cat_" + k), icon: CATEGORY_ICON[k] }))} />
      </View>

      <View style={{ gap: S.sm }}>
        <Text style={[T.small, { color: C.ink2, fontWeight: "600" }]}>{t("date")}</Text>
        <View style={{ flexDirection: "row", gap: S.sm, alignItems: "center", flexWrap: "wrap" }}>
          {[["t", t("today"), todayISO()], ["y", t("yesterday"), shift(todayISO(), -1)]].map(([k, label, v]) => (
            <Button key={k} small kind={date === v ? "primary" : "secondary"} label={label} onPress={() => setDate(v)} />
          ))}
          <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" accessibilityLabel={t("date")}
            style={[st.input, { width: 140, minHeight: 40, height: 40, fontSize: 15 }]} />
        </View>
      </View>

      <View style={{ gap: S.sm }}>
        <Text style={[T.small, { color: C.ink2, fontWeight: "600" }]}>{t("who_paid")}</Text>
        <Chips value={paidBy} onChange={setPaidBy} options={[
          { value: "fund", label: s.payees[0] ? t("paid_by_payee", { name: s.payees[0].name }) : t("paid_from_fund"), icon: "wallet-outline" },
          ...[...active].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0)).map((m) => ({ value: m.id, label: m.id === meId ? t("i_paid") : m.name, icon: "person-outline" })),
        ]} />
        <Text style={[T.tiny, { color: C.ink3 }]}>{paidBy === "fund" ? t("paid_fund_hint") : t("paid_member_hint")}</Text>
      </View>

      <Field label={t("vendor_optional")} value={vendor} onChangeText={setVendor} placeholder={t("vendor_ph")} />
      <Field label={t("notes_optional")} value={notes} onChangeText={setNotes} multiline />

      <Card>
        <Toggle label={t("paid_other_currency")} value={foreign} onChange={setForeign} hint={t("paid_other_currency_hint", { cur })} />
        {foreign ? (
          <View style={{ gap: S.sm }}>
            <Chips wrap={false} value={origCur} onChange={setOrigCur} options={CURRENCIES.filter((c) => c !== cur).map((c) => ({ value: c, label: c }))} />
            <Field label={t("amount_in_x", { cur: origCur })} value={origAmount} onChangeText={setOrigAmount} keyboardType="decimal-pad" />
            {parseAmount(origAmount) > 0 && amt > 0 ? <Text style={[T.tiny, { color: C.ink3 }]}>{t("rate_used", { rate: (amt / parseAmount(origAmount)).toFixed(4), from: origCur, to: cur })}</Text> : null}
          </View>
        ) : null}
      </Card>

      {s.circle.split_mode === "expenses" ? (
        <Card>
          <Toggle label={t("split_differently")} value={custom} onChange={setCustom} hint={t("split_differently_hint")} />
          {custom ? (
            <View style={{ gap: S.sm }}>
              {active.map((m) => (
                <View key={m.id} style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
                  <Avatar name={m.name} tone={hashTone(m.name)} size={34} />
                  <Text style={[T.body, { color: C.ink, flex: 1 }]} numberOfLines={1}>{m.name}</Text>
                  <TextInput value={split[m.id] ?? "0"} onChangeText={(v) => setSplit({ ...split, [m.id]: v })} keyboardType="decimal-pad"
                    accessibilityLabel={m.name} style={[st.input, { width: 80, minHeight: 42, height: 42, textAlign: "right" }]} />
                  <Text style={[T.body, { color: C.ink3 }]}>%</Text>
                  <Text style={[T.small, { color: C.ink2, width: 84, textAlign: "right" }]}>{money(amt * parseAmount(split[m.id] ?? "0") / 100, cur, lang)}</Text>
                </View>
              ))}
              <Banner tone={splitOk ? "ok" : "owe"} text={t("split_total", { pct: splitTotal.toFixed(1) })} />
            </View>
          ) : null}
        </Card>
      ) : <Banner tone="primary" text={t("budget_mode_expense_note")} />}

      {eid ? <Button kind="danger" icon="trash-outline" label={t("delete_expense")} onPress={remove} /> : null}
    </Screen>
  );
}
