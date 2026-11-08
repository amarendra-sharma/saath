import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Text, View } from "react-native";
import { AttachBar } from "../../../components/AttachBar";
import { QrCode } from "../../../components/QrCode";
import { AmountField, Banner, Button, Card, Chips, Field, Icon, Loading, Screen, Section, Toggle } from "../../../components/ui";
import { notify, useApp } from "../../../lib/app";
import { PayMethod, Summary, loadSummary, useLoad } from "../../../lib/data";
import { CURRENCIES, money, parseAmount, todayISO } from "../../../lib/format";
import { ABROAD, methodDef, methodText } from "../../../lib/payments";
import { payCountry } from "../../../lib/plus";
import { copy, openUrl } from "../../../lib/share";
import { errText, supabase } from "../../../lib/supabase";
import { C, R, S, T } from "../../../lib/theme";
import { LocalFile, uploadFile } from "../../../lib/upload";

export default function Pay() {
  const { id, kind: kindParam } = useLocalSearchParams<{ id: string; kind?: string }>();
  const reimb = kindParam === "reimbursement";
  const { t, lang } = useApp();
  const sum = useLoad<Summary>(() => loadSummary(id), [id]);
  const s = sum.data;
  const [memberId, setMemberId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("upi");
  const [payeeId, setPayeeId] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [date] = useState(todayISO());
  const [foreign, setForeign] = useState(false);
  const [origAmount, setOrigAmount] = useState("");
  const [origCur, setOrigCur] = useState("USD");
  const [proof, setProof] = useState<LocalFile[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"send" | "record">(reimb ? "record" : "send");
  // which method's QR is open; on the web (a computer, usually) the first QR opens by itself
  const [qrOpen, setQrOpen] = useState<string | null>(null);
  const web = Platform.OS === "web";

  const me = s?.members.find((m) => m.id === s.me);
  const target = s?.members.find((m) => m.id === (memberId ?? s?.me));
  const due = Math.max(0, Number(target?.balance ?? 0));
  const payee = s?.payees.find((p) => p.id === payeeId) ?? s?.payees[0];

  useEffect(() => {
    if (!s) return;
    if (reimb) {
      const owed = s.members.filter((m) => Number(m.balance) < -0.5).sort((a, b) => Number(a.balance) - Number(b.balance))[0];
      if (owed) { setMemberId(owed.id); setAmount(String(Math.abs(Number(owed.balance)))); }
      setMethod("bank_in");
    } else {
      setMemberId(s.me);
      const b = Number(me?.balance ?? 0);
      if (b > 0.5) setAmount(String(Math.round(b * 100) / 100));
      const p = s.payees[0];
      if (p) { setPayeeId(p.id); if (p.methods[0]) setMethod(p.methods[0].method); }
    }
  }, [s]); // eslint-disable-line

  const methodOptions = useMemo(() => {
    const keys = [...new Set([...(payee?.methods ?? []).map((m) => m.method), "upi", "wise", "bank_intl", "cash", "other"])];
    return keys.map((k) => ({ value: k, label: methodDef(k).name, icon: methodDef(k).icon }));
  }, [payee]);

  if (!s) return <Loading />;
  const cur = s.circle.currency;
  const amt = parseAmount(amount);
  const note = `${s.circle.name} · Saath`;
  const goPayees = () => router.push({ pathname: "/circle/[id]/payees", params: { id } });
  const country = (s.circle.country || "").toUpperCase();
  const here = payCountry(null);
  const abroad = !!country && here !== "*" && here !== country;
  const firstQr = (payee?.methods ?? []).find((m) => methodDef(m.method).qr?.({ handle: m.handle ?? "", amount: 1, currency: cur, name: payee?.name ?? "", note, details: m.details ?? {}, city: s.circle.city ?? "" }));

  const submit = async () => {
    if (amt <= 0) { notify(t("fill_amount")); return; }
    setBusy(true);
    try {
      let proof_path: string | null = null;
      if (proof[0]) proof_path = await uploadFile(id, "proofs", proof[0]);
      const { error } = await supabase.from("saath_contributions").insert({
        circle_id: id, member_id: memberId ?? s.me, kind: reimb ? "reimbursement" : "payment", amount: amt,
        orig_amount: foreign ? parseAmount(origAmount) || null : null, orig_currency: foreign ? origCur : null,
        method, reference: reference.trim() || null, paid_on: date, payee_id: reimb ? null : payee?.id ?? null,
        proof_path, notes: notes.trim() || null,
      });
      if (error) throw error;
      const pendingNote = !s.is_admin && s.circle.require_confirmation;
      notify(reimb ? t("reimbursement_saved") : t("payment_saved"), pendingNote ? t("payment_pending_note") : undefined);
      router.back();
    } catch (e) { notify(t("something_wrong"), errText(e)); }
    finally { setBusy(false); }
  };

  const MethodCard = ({ m }: { m: PayMethod }) => {
    const def = methodDef(m.method);
    const args = { handle: m.handle ?? "", amount: amt || due, currency: cur, name: payee?.name ?? "", note, details: m.details ?? {}, city: s.circle.city ?? "" };
    // upi:// only opens on a phone that has a UPI app; on the web, show the QR to scan instead
    const link = web && m.method === "upi" ? null : def.link?.(args);
    const qr = def.qr?.(args) ?? null;
    const showQr = !!qr && (qrOpen === m.id || (qrOpen === null && web && firstQr?.id === m.id));
    return (
      <View style={{ borderWidth: 1.5, borderColor: C.line, borderRadius: R.md, padding: S.md, gap: S.sm, backgroundColor: C.card }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" }}>
            <Icon name={def.icon} size={20} color={C.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[T.h3, { color: C.ink }]}>{m.label || def.name}</Text>
            <Text style={[T.tiny, { color: C.ok, fontWeight: "700" }]}>{t(def.costKey)} · {t(def.region)}</Text>
          </View>
        </View>
        {m.handle ? <Text selectable style={[T.body, { color: C.ink, fontWeight: "600" }]}>{m.handle}</Text> : null}
        {(def.fields ?? []).filter((f) => m.details?.[f.key]).map((f) => (
          <Text key={f.key} selectable style={[T.small, { color: C.ink2 }]}>{t(f.labelKey)}: <Text style={{ fontWeight: "700", color: C.ink }}>{m.details[f.key]}</Text></Text>
        ))}
        {def.howKey && !link ? <Text style={[T.small, { color: C.ink2 }]}>{t(def.howKey, { amount: money(amt || due, cur, lang) })}</Text> : null}
        {showQr && qr ? (
          <View style={{ gap: S.sm, alignItems: "center", paddingVertical: S.sm }}>
            <QrCode value={qr} size={220} label={t("qr_label", { name: def.name })} />
            <Text style={[T.small, { color: C.ink2, textAlign: "center" }]}>{t(def.qrHintKey ?? "qr_hint_upi", { amount: money(amt || due, cur, lang) })}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", gap: S.sm, flexWrap: "wrap" }}>
          {link ? <Button small icon="open-outline" label={t("open_x", { name: def.name })} style={{ flexGrow: 1 }}
            onPress={async () => { setMethod(m.method); if (!(await openUrl(link))) notify(t("couldnt_open", { name: def.name })); }} /> : null}
          {qr ? <Button small kind={link ? "secondary" : "primary"} icon="qr-code-outline" label={showQr ? t("hide_qr") : t("show_qr")} style={{ flexGrow: 1 }}
            onPress={() => { setMethod(m.method); setQrOpen(showQr ? "" : m.id); }} /> : null}
          {m.method === "pix" && qr ? <Button small kind="secondary" icon="copy-outline" label={t("copy_pix")} style={{ flexGrow: 1 }}
            onPress={async () => { setMethod("pix"); await copy(qr); notify(t("copied")); }} /> : null}
          <Button small kind="secondary" icon="copy-outline" label={t("copy_details")} style={{ flexGrow: 1 }}
            onPress={async () => { setMethod(m.method); await copy(methodText(m, t)); notify(t("copied")); }} />
        </View>
      </View>
    );
  };

  return (
    <Screen title={reimb ? t("record_reimbursement") : step === "send" ? t("pay_my_share") : t("record_payment")} subtitle={s.circle.name}
      footer={step === "send"
        ? <Button label={t("ive_sent_it")} icon="checkmark-done" onPress={() => setStep("record")} />
        : <Button label={reimb ? t("save_reimbursement") : t("save_payment")} icon="checkmark" loading={busy} disabled={amt <= 0} onPress={submit} />}>

      {step === "send" ? (
        <>
          <Card tone={due > 0.5 ? "owe" : "ok"}>
            <Text style={[T.small, { color: C.ink2, fontWeight: "700" }]}>{t("your_share_due")}</Text>
            <Text style={[T.hero, { color: due > 0.5 ? C.owe : C.ok }]}>{due > 0.5 ? money(due, cur, lang) : t("all_settled")}</Text>
            {due <= 0.5 ? <Text style={[T.small, { color: C.ink2 }]}>{t("pay_ahead_ok")}</Text> : null}
          </Card>
          {s.payees.length === 0 ? (
            <Card tone="accent">
              <Text style={[T.small, { color: C.ink2 }]}>{s.is_admin ? t("no_payee_admin") : t("no_payee_member")}</Text>
              {s.is_admin ? <Button icon="wallet-outline" label={t("add_pay_details")} onPress={goPayees} /> : null}
            </Card>
          ) : (
            <>
              {s.payees.length > 1 ? (
                <Chips value={payee?.id ?? ""} onChange={(v) => setPayeeId(v)} options={s.payees.map((p) => ({ value: p.id, label: p.name }))} />
              ) : null}
              <Section title={t("send_to_x", { name: payee?.name ?? "" })}>
                {payee?.notes ? <Text style={[T.small, { color: C.ink2 }]}>{payee.notes}</Text> : null}
                {(payee?.methods ?? []).map((m) => <MethodCard key={m.id} m={m} />)}
                {!payee?.methods.length ? (
                  <Card tone="accent">
                    <Text style={[T.small, { color: C.ink2 }]}>{s.is_admin ? t("payee_no_methods_admin", { name: payee?.name ?? "" }) : t("payee_no_methods_member", { name: payee?.name ?? "" })}</Text>
                    {s.is_admin ? <Button icon="add" label={t("add_pay_details")} onPress={goPayees} /> : null}
                  </Card>
                ) : null}
              </Section>
              {abroad && payee?.methods.length ? (
                <Card>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
                    <Icon name="globe-outline" size={20} color={C.primary} />
                    <Text style={[T.h3, { color: C.ink, flex: 1 }]}>{t("abroad_t")}</Text>
                  </View>
                  <Text style={[T.small, { color: C.ink2 }]}>{t("abroad_text", { cur })}</Text>
                  <View style={{ flexDirection: "row", gap: S.sm, flexWrap: "wrap" }}>
                    {ABROAD.map((a) => <Button key={a.name} small kind="secondary" icon="open-outline" label={a.name} style={{ flexGrow: 1 }}
                      onPress={async () => { if (!(await openUrl(a.url))) notify(t("couldnt_open", { name: a.name })); }} />)}
                  </View>
                </Card>
              ) : null}
              <Banner tone="primary" icon="bulb-outline" text={t("cheapest_tip")} />
            </>
          )}
          {s.is_admin ? <Button kind="ghost" label={t("record_for_someone")} onPress={() => setStep("record")} /> : null}
        </>
      ) : (
        <>
          {s.is_admin ? (
            <View style={{ gap: S.sm }}>
              <Text style={[T.small, { color: C.ink2, fontWeight: "600" }]}>{reimb ? t("paid_back_to") : t("who_paid_money")}</Text>
              <Chips value={memberId ?? ""} onChange={(v) => { setMemberId(v); const m = s.members.find((x) => x.id === v); if (m) setAmount(String(Math.abs(Math.round(Number(m.balance) * 100) / 100) || "")); }}
                options={s.members.filter((m) => m.status === "active").map((m) => ({ value: m.id, label: m.id === s.me ? t("me") : m.name }))} />
            </View>
          ) : null}
          <AmountField label={t("amount_in_x", { cur })} value={amount} onChangeText={setAmount} currency={cur} />
          <View style={{ gap: S.sm }}>
            <Text style={[T.small, { color: C.ink2, fontWeight: "600" }]}>{t("how_sent")}</Text>
            <Chips value={method} onChange={setMethod} options={methodOptions} />
          </View>
          <Field label={t("reference_optional")} value={reference} onChangeText={setReference} placeholder={t("reference_ph")} autoCapitalize="characters" />
          <Card>
            <Toggle label={t("sent_other_currency")} value={foreign} onChange={setForeign} hint={t("sent_other_currency_hint", { cur })} />
            {foreign ? (
              <View style={{ gap: S.sm }}>
                <Chips wrap={false} value={origCur} onChange={setOrigCur} options={CURRENCIES.filter((c) => c !== cur).map((c) => ({ value: c, label: c }))} />
                <Field label={t("amount_in_x", { cur: origCur })} value={origAmount} onChangeText={setOrigAmount} keyboardType="decimal-pad" />
              </View>
            ) : null}
          </Card>
          <AttachBar label={t("proof_optional")} files={proof} onChange={(f) => setProof(f.slice(-1))} />
          <Field label={t("notes_optional")} value={notes} onChangeText={setNotes} multiline />
          {!s.is_admin && s.circle.require_confirmation ? <Banner text={t("organiser_will_confirm")} /> : null}
        </>
      )}
    </Screen>
  );
}
