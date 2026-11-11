import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { AttachBar } from "../../../components/AttachBar";
import { AmountField, Banner, Button, Card, Chips, Empty, Field, Icon, Loading, Screen, Section, st } from "../../../components/ui";
import { notify, useApp } from "../../../lib/app";
import { Summary, loadSummary, useLoad } from "../../../lib/data";
import { dateLabel, money, parseAmount, todayISO } from "../../../lib/format";
import { methodDef } from "../../../lib/payments";
import { errText } from "../../../lib/supabase";
import { C, R, S, T } from "../../../lib/theme";
import { Trail, TrailBill, loadTrail, recordPayout } from "../../../lib/trail";
import { LocalFile, uploadFile } from "../../../lib/upload";

const METHODS = ["upi", "bank_in", "bank_intl", "cash", "card", "cheque", "other"];
const shift = (iso: string, d: number) => { const x = new Date(iso + "T00:00:00"); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };

/** Record money paid OUT of the pool to a hospital, pharmacy or other provider, and which bills it paid. */
export default function PayoutScreen() {
  const { id, eid } = useLocalSearchParams<{ id: string; eid?: string }>();
  const { t, lang } = useApp();
  const d = useLoad<{ s: Summary; tr: Trail }>(async () => {
    const [s, tr] = await Promise.all([loadSummary(id), loadTrail(id)]);
    return { s, tr };
  }, [id]);
  const [payee, setPayee] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<string>("upi");
  const [reference, setReference] = useState("");
  const [proof, setProof] = useState<LocalFile[]>([]);
  const [notes, setNotes] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!d.data) return;
    const { s, tr } = d.data;
    // default: the payee that is me, else the first one I may record for
    const mine = s.payees.find((p) => p.member_id === s.me && tr.can_record.includes(p.id));
    setPayee((v) => v ?? mine?.id ?? tr.can_record[0] ?? null);
    if (eid && tr.bills.some((b) => b.id === eid)) {
      setPicked(new Set([eid]));
      const b = tr.bills.find((x) => x.id === eid);
      if (b?.vendor) setVendor((v) => v || b.vendor!);
    }
  }, [d.data, eid]);

  const bills = d.data?.tr.bills ?? [];
  const left = (b: TrailBill) => Math.max(0, Number(b.amount) - Number(b.paid));
  const chosen = useMemo(() => bills.filter((b) => picked.has(b.id)).sort((a, b) => a.spent_on.localeCompare(b.spent_on)), [bills, picked]);
  const chosenSum = chosen.reduce((a, b) => a + left(b), 0);
  useEffect(() => { if (!amountTouched) setAmount(chosenSum ? String(Math.round(chosenSum * 100) / 100) : ""); }, [chosenSum, amountTouched]);
  const amt = parseAmount(amount);
  // spread the amount over the chosen bills, oldest first; whatever is left over is an advance / deposit
  const alloc = useMemo(() => {
    let rest = amt; const out: { expense_id: string; amount: number }[] = [];
    for (const b of chosen) { if (rest <= 0) break; const a = Math.min(rest, left(b)); if (a > 0) { out.push({ expense_id: b.id, amount: Math.round(a * 100) / 100 }); rest -= a; } }
    return { items: out, extra: Math.max(0, Math.round(rest * 100) / 100) };
  }, [amt, chosen]);

  if (!d.data) return d.error ? <Empty icon="alert-circle-outline" title={t("something_wrong")} text={d.error} /> : <Loading />;
  const { s, tr } = d.data;
  const cur = s.circle.currency;
  const m$ = (n: number) => money(n, cur, lang);
  const recordable = s.payees.filter((p) => tr.can_record.includes(p.id));
  if (!recordable.length) return (
    <Screen title={t("po_title")} subtitle={s.circle.name}>
      <Empty icon="lock-closed-outline" title={t("po_not_allowed_t")} text={t("po_not_allowed")} />
    </Screen>
  );
  const holder = tr.holders.find((h) => h.payee_id === payee);
  const shown = bills.filter((b) => !q.trim() || `${b.title} ${b.vendor ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (bid: string) => {
    const n = new Set(picked); if (n.has(bid)) n.delete(bid); else n.add(bid); setPicked(n);
    const b = bills.find((x) => x.id === bid); if (b?.vendor && !vendor) setVendor(b.vendor);
  };
  const allShown = shown.length > 0 && shown.every((b) => picked.has(b.id));

  const save = async () => {
    if (!payee || amt <= 0) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { notify(t("po_bad_date")); return; }
    setBusy(true);
    try {
      const proofPath = proof[0] ? await uploadFile(id, "payouts", proof[0]) : null;
      await recordPayout({ payee, amount: amt, paidOn: date, vendor: vendor.trim(), method, reference: reference.trim(), proofPath, notes: notes.trim(), items: alloc.items });
      notify(t("po_saved_t"), proofPath ? t("po_saved") : t("po_saved_no_proof"));
      router.back();
    } catch (e) { notify(t("something_wrong"), errText(e, t)); }
    finally { setBusy(false); }
  };

  return (
    <Screen title={t("po_title")} subtitle={s.circle.name}
      footer={<Button icon="checkmark" label={amt > 0 ? t("po_save", { amount: m$(amt) }) : t("po_save_plain")} loading={busy} disabled={amt <= 0 || !payee} onPress={save} />}>
      <Banner tone="primary" icon="information-circle-outline" text={t("po_intro")} />

      {recordable.length > 1 ? (
        <View style={{ gap: S.sm }}>
          <Text style={[T.small, { color: C.ink2, fontWeight: "600" }]}>{t("po_whose_money")}</Text>
          <Chips value={payee ?? ""} onChange={setPayee} options={recordable.map((p) => ({ value: p.id, label: p.name, icon: "wallet-outline" }))} />
        </View>
      ) : null}
      {holder ? <Text style={[T.small, { color: C.ink2 }]}>{t("po_holder_line", { name: holder.name, amount: m$(holder.balance) })}</Text> : null}

      <Section title={t("po_which_bills")} action={shown.length ? (
        <Button small kind="ghost" label={allShown ? t("po_select_none") : t("po_select_all")}
          onPress={() => { const n = new Set(picked); shown.forEach((b) => (allShown ? n.delete(b.id) : n.add(b.id))); setPicked(n); }} />) : undefined}>
        {bills.length > 6 ? <Field label={t("po_find")} value={q} onChangeText={setQ} placeholder={t("po_find_ph")} /> : null}
        <Card style={{ paddingVertical: 4, gap: 0 }}>
          {shown.length ? shown.map((b, i) => {
            const on = picked.has(b.id);
            return (
              <Pressable key={b.id} onPress={() => toggle(b.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                style={[{ flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: 10 }, i < shown.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
                <Icon name={on ? "checkbox" : "square-outline"} size={22} color={on ? C.primary : C.ink3} />
                <View style={{ flex: 1 }}>
                  <Text style={[T.small, { color: C.ink, fontWeight: "700" }]} numberOfLines={1}>{b.title}</Text>
                  <Text style={[T.tiny, { color: C.ink3 }]} numberOfLines={1}>{[dateLabel(b.spent_on, lang), b.vendor, b.status === "partial" ? t("po_part_paid", { amount: m$(b.paid) }) : null].filter(Boolean).join(" · ")}</Text>
                </View>
                <Text style={[T.small, { color: C.ink, fontWeight: "700" }]}>{m$(left(b))}</Text>
              </Pressable>
            );
          }) : <Text style={[T.small, { color: C.ink3, paddingVertical: S.md }]}>{bills.length ? t("po_no_match") : t("po_no_bills")}</Text>}
        </Card>
        {chosen.length ? <Text style={[T.small, { color: C.ink2 }]}>{t("po_chosen", { n: chosen.length, amount: m$(chosenSum) })}</Text> : null}
      </Section>

      <AmountField label={t("po_amount", { cur })} value={amount} onChangeText={(v) => { setAmountTouched(true); setAmount(v); }} currency={cur} />
      {amt > 0 && chosen.length && amt < chosenSum - 0.5 ? <Banner tone="pending" text={t("po_partial", { amount: m$(chosenSum - amt) })} /> : null}
      {alloc.extra > 0.5 ? <Banner tone="primary" icon="information-circle-outline" text={t("po_extra", { amount: m$(alloc.extra) })} /> : null}

      <Field label={t("po_vendor")} value={vendor} onChangeText={setVendor} placeholder={t("po_vendor_ph")} maxLength={120} />
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
        <Text style={[T.small, { color: C.ink2, fontWeight: "600" }]}>{t("po_how_paid")}</Text>
        <Chips value={method} onChange={setMethod} options={METHODS.map((k) => ({ value: k, label: k === "card" ? t("po_card") : k === "cheque" ? t("po_cheque") : methodDef(k).name, icon: k === "card" ? "card-outline" : k === "cheque" ? "document-outline" : methodDef(k).icon }))} />
      </View>
      <Field label={t("po_reference")} value={reference} onChangeText={setReference} placeholder={t("po_reference_ph")} autoCapitalize="characters" maxLength={120} />
      <View style={{ borderWidth: 1, borderColor: proof.length ? C.line : C.accent, borderRadius: R.md, padding: S.md, gap: S.sm, backgroundColor: proof.length ? C.card : C.accentSoft }}>
        <AttachBar label={t("po_proof")} files={proof} onChange={(f) => setProof(f.slice(-1))} />
        {!proof.length ? <Text style={[T.tiny, { color: C.accent }]}>{t("po_proof_why")}</Text> : null}
      </View>
      <Field label={t("notes_optional")} value={notes} onChangeText={setNotes} multiline maxLength={1000} />
      <Text style={[T.tiny, { color: C.ink3 }]}>{t("po_verify_note")}</Text>
    </Screen>
  );
}
