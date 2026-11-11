import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AttachBar } from "../../../components/AttachBar";
import { Banner, Button, Card, Empty, Field, Icon, IconButton, Loading, Pill, Screen, Section, Segmented, Sheet } from "../../../components/ui";
import { confirm, notify, useApp } from "../../../lib/app";
import { Summary, loadSummary, useLoad } from "../../../lib/data";
import { esc, exportPdf } from "../../../lib/exporter";
import { dateLabel, money } from "../../../lib/format";
import { methodDef } from "../../../lib/payments";
import { openUrl } from "../../../lib/share";
import { errText } from "../../../lib/supabase";
import { C, R, S, T } from "../../../lib/theme";
import { Check, Payout, Trail, addPayoutProof, clearQuestion, deletePayout, loadTrail, questionPayout, verifyPayout } from "../../../lib/trail";
import { LocalFile, signedUrl, uploadFile } from "../../../lib/upload";

type Tab = "bills" | "out" | "ledger";
const SEV: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };

export default function TrailScreen() {
  const { id, tab: tab0 } = useLocalSearchParams<{ id: string; tab?: Tab }>();
  const { t, lang } = useApp();
  const d = useLoad<{ s: Summary; tr: Trail }>(async () => {
    const [s, tr] = await Promise.all([loadSummary(id), loadTrail(id)]);
    return { s, tr };
  }, [id]);
  const [tab, setTab] = useState<Tab>(tab0 ?? "bills");
  const [ledgerFor, setLedgerFor] = useState<string | null>(null);
  const [asking, setAsking] = useState<Payout | null>(null);
  const [question, setQuestion] = useState("");
  const [proofFor, setProofFor] = useState<Payout | null>(null);
  const [proofFile, setProofFile] = useState<LocalFile[]>([]);
  const [proofRef, setProofRef] = useState("");
  const [proofNote, setProofNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  if (!d.data) return d.error ? <Empty icon="alert-circle-outline" title={t("something_wrong")} text={d.error} /> : <Loading />;
  const { s, tr } = d.data;
  const cur = s.circle.currency;
  const m$ = (n: number) => money(Number(n), cur, lang);
  const canRecord = tr.can_record.length > 0;
  const people = tr.holders.filter((h) => h.kind === "person");
  const providers = tr.holders.filter((h) => h.kind !== "person");
  const act = async (key: string, fn: () => Promise<void>, ok?: string) => {
    setBusy(key);
    try { await fn(); if (ok) notify(ok); d.reload(); } catch (e) { notify(t("something_wrong"), errText(e, t)); } finally { setBusy(null); }
  };
  const openProof = async (path: string) => { const u = await signedUrl(path); if (u) openUrl(u); };

  // issues: unpaid bills are summarised in one line so a long list doesn't drown the rest
  const unpaidChecks = tr.checks.filter((c) => c.code === "bill_unpaid");
  const other = tr.checks.filter((c) => c.code !== "bill_unpaid").sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  const checkText = (c: Check) => t("tc_" + c.code, {
    payee: c.payee ?? "", vendor: c.vendor || t("tr_a_provider"), amount: m$(c.amount ?? 0), held: m$(c.held ?? 0), unpaid: m$(c.unpaid ?? 0),
    days: c.days ?? "", question: c.question ?? "", title: c.title ?? "",
  });

  // ledger with a running balance, for one holder at a time
  const ledgerHolder = ledgerFor ?? people[0]?.payee_id ?? tr.holders[0]?.payee_id ?? null;
  let run = 0;
  const ledger = tr.ledger.filter((l) => l.payee_id === ledgerHolder).map((l) => {
    run += l.type === "in" ? Number(l.amount) : -Number(l.amount);
    return { ...l, run };
  });
  const holderName = tr.holders.find((h) => h.payee_id === ledgerHolder)?.name ?? "";

  const pdf = async () => {
    const h = tr.holders.find((x) => x.payee_id === ledgerHolder);
    if (!h) return;
    const rows = ledger.map((l) => `<tr><td>${esc(dateLabel(l.d, lang))}</td><td>${esc(l.type === "in" ? t("tr_l_in", { who: l.who ?? "" }) : l.type === "reimb" ? t("tr_l_reimb", { who: l.who ?? "" }) : t("tr_l_out", { who: l.who || t("tr_a_provider") }))}${l.reference ? ` <span class="m">${esc(l.reference)}</span>` : ""}</td>
      <td>${l.proof ? "✓" : "—"}</td><td>${l.type === "out" ? esc(t("tr_st_" + (l.status ?? "recorded"))) : ""}</td>
      <td class="n">${l.type === "in" ? esc(m$(l.amount)) : ""}</td><td class="n">${l.type !== "in" ? esc(m$(l.amount)) : ""}</td><td class="n">${esc(m$(l.run))}</td></tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,Segoe UI,Roboto,"Noto Sans",sans-serif;color:#0E1A2B;padding:28px;font-size:12px}
      h1{font-size:19px;margin:0;color:#1A3A6E}.sub{color:#63708A;margin:2px 0 16px}.k{display:inline-block;margin:0 18px 12px 0}.k b{display:block;font-size:15px}
      table{width:100%;border-collapse:collapse}th,td{padding:6px 7px;border-bottom:1px solid #E2E7EF;text-align:left;vertical-align:top}th{background:#F4F6FA;font-size:11px}
      .n{text-align:right;white-space:nowrap}.m{color:#63708A;font-size:10px}.f{color:#63708A;font-size:10px;margin-top:14px}
    </style></head><body>
      <h1>${esc(t("tr_pdf_title", { name: h.name }))}</h1><div class="sub">${esc(s.circle.name)} · ${esc(dateLabel(new Date().toISOString().slice(0, 10), lang, true))}</div>
      <div class="k">${esc(t("tr_received"))}<b>${esc(m$(h.received))}</b></div><div class="k">${esc(t("tr_paid_out"))}<b>${esc(m$(h.paid_out))}</b></div>
      ${Number(h.reimbursed) ? `<div class="k">${esc(t("tr_paid_back"))}<b>${esc(m$(h.reimbursed))}</b></div>` : ""}
      <div class="k">${esc(t("tr_still_held"))}<b>${esc(m$(h.balance))}</b></div><div class="k">${esc(t("tr_verified"))}<b>${esc(m$(h.verified))}</b></div>
      <table><tr><th>${esc(t("date"))}</th><th>${esc(t("tr_what"))}</th><th>${esc(t("tr_proof"))}</th><th>${esc(t("tr_status"))}</th><th class="n">${esc(t("tr_in"))}</th><th class="n">${esc(t("tr_out"))}</th><th class="n">${esc(t("tr_balance"))}</th></tr>${rows}</table>
      <div class="f">${esc(t("tr_pdf_note"))}</div></body></html>`;
    try { await exportPdf(html, `${s.circle.name}-money-trail.pdf`); } catch (e) { notify(t("something_wrong"), errText(e)); }
  };

  return (
    <Screen title={t("tr_title")} subtitle={s.circle.name} right={<IconButton icon="download-outline" label="PDF" onPress={pdf} />}
      footer={canRecord ? <Button icon="arrow-up-circle-outline" label={t("po_title")} onPress={() => router.push({ pathname: "/circle/[id]/payout", params: { id } })} /> : undefined}>
      {!tr.holders.length && !tr.bills.length ? <Empty icon="git-network-outline" title={t("tr_empty_t")} text={t("tr_empty")} /> : null}

      {people.map((h) => {
        const covered = Number(h.paid_out) > 0 ? Math.round((Number(h.verified) / Number(h.paid_out)) * 100) : 0;
        return (
          <Card key={h.payee_id} tone="primary">
            <Text style={[T.small, { color: "rgba(255,255,255,0.85)", fontWeight: "700" }]}>{t("tr_with_x", { name: h.name })}</Text>
            <Text style={[T.hero, { color: C.white }]}>{m$(h.balance)}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: S.lg }}>
              <Kv k={t("tr_received")} v={m$(h.received)} />
              <Kv k={t("tr_paid_out")} v={m$(h.paid_out)} />
              {Number(h.reimbursed) ? <Kv k={t("tr_paid_back")} v={m$(h.reimbursed)} /> : null}
            </View>
            {Number(h.paid_out) > 0 ? (
              <View style={{ gap: 4 }}>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.25)" }}>
                  <View style={{ height: 6, borderRadius: 3, width: `${covered}%`, backgroundColor: C.gold }} />
                </View>
                <Text style={[T.tiny, { color: "rgba(255,255,255,0.85)" }]}>{t("tr_verified_pct", { pct: covered })}{Number(h.no_proof) ? ` · ${t("tr_no_proof_amt", { amount: m$(h.no_proof) })}` : ""}</Text>
              </View>
            ) : <Text style={[T.tiny, { color: "rgba(255,255,255,0.85)" }]}>{t("tr_nothing_paid_yet")}</Text>}
          </Card>
        );
      })}
      {providers.length ? (
        <Card>
          <Text style={[T.small, { color: C.ink2, fontWeight: "700" }]}>{t("tr_direct_t")}</Text>
          {providers.map((h) => <Text key={h.payee_id} style={[T.small, { color: C.ink }]}>{t("tr_direct_line", { name: h.name, received: m$(h.received), applied: m$(h.paid_out) })}</Text>)}
        </Card>
      ) : null}

      <View style={{ flexDirection: "row", gap: S.md }}>
        <Stat label={t("tr_bills_paid")} value={m$(tr.totals.bills_paid)} sub={t("tr_of_total", { amount: m$(tr.totals.bills) })} tone={C.ok} />
        <Stat label={t("tr_bills_unpaid")} value={m$(tr.totals.bills_unpaid)} sub={t("tr_n_bills", { n: tr.totals.unpaid_count })} tone={tr.totals.unpaid_count ? C.owe : C.ok} />
      </View>

      {unpaidChecks.length || other.length ? (
        <Section title={t("tr_issues")}>
          <Card style={{ gap: S.sm }}>
            {unpaidChecks.length ? (
              <Issue sev={unpaidChecks.some((c) => c.severity === "high") ? "high" : "medium"} onPress={() => setTab("bills")}
                text={t("tc_bills_unpaid_n", { n: unpaidChecks.length, days: tr.alert_days, amount: m$(unpaidChecks.reduce((a, c) => a + Number(c.amount), 0)) })} />
            ) : null}
            {other.map((c, i) => <Issue key={i} sev={c.severity} text={checkText(c)} onPress={c.payout_id ? () => setTab("out") : undefined} />)}
          </Card>
        </Section>
      ) : tr.holders.length ? <Banner tone="ok" icon="checkmark-circle-outline" text={t("tr_all_clear")} /> : null}

      <Segmented value={tab} onChange={setTab} options={[
        { value: "bills", label: t("tr_tab_bills"), badge: tr.bills.length || undefined },
        { value: "out", label: t("tr_tab_out"), badge: tr.payouts.filter((p) => p.status !== "verified").length || undefined },
        { value: "ledger", label: t("tr_tab_ledger") },
      ]} />

      {tab === "bills" ? (
        tr.bills.length ? (
          <Card style={{ paddingVertical: 4, gap: 0 }}>
            {tr.bills.map((b, i) => (
              <View key={b.id} style={[{ flexDirection: "row", alignItems: "center", gap: S.sm, paddingVertical: 10 }, i < tr.bills.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
                <Pressable style={{ flex: 1 }} onPress={() => router.push({ pathname: "/circle/[id]/expense-view", params: { id, eid: b.id } })}>
                  <Text style={[T.small, { color: C.ink, fontWeight: "700" }]} numberOfLines={1}>{b.title}</Text>
                  <Text style={[T.tiny, { color: b.age > tr.alert_days ? C.owe : C.ink3 }]} numberOfLines={1}>
                    {[dateLabel(b.spent_on, lang), t("tr_days_old", { n: b.age }), b.status === "partial" ? t("po_part_paid", { amount: m$(b.paid) }) : null].filter(Boolean).join(" · ")}
                  </Text>
                </Pressable>
                <Text style={[T.small, { color: C.ink, fontWeight: "700" }]}>{m$(Number(b.amount) - Number(b.paid))}</Text>
                {canRecord ? <Button small kind="secondary" label={t("tr_mark_paid")} onPress={() => router.push({ pathname: "/circle/[id]/payout", params: { id, eid: b.id } })} /> : null}
              </View>
            ))}
          </Card>
        ) : <Banner tone="ok" icon="checkmark-circle-outline" text={t("tr_no_unpaid")} />
      ) : null}

      {tab === "out" ? (
        tr.payouts.length ? tr.payouts.map((p) => {
          const canVerify = !p.mine && !p.i_am_receiver && p.status !== "verified" && (p.status !== "questioned" || p.asked_by_me);
          const canQuestion = !p.mine && p.status !== "questioned";
          const canProof = (p.mine || p.i_am_receiver || tr.can_record.includes(p.payee_id)) && p.status !== "verified";
          const canDelete = (p.mine || s.is_admin) && p.status !== "verified";
          return (
            <Card key={p.id}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={[T.h3, { color: C.ink }]} numberOfLines={1}>{p.vendor || t("tr_a_provider")}</Text>
                  <Text style={[T.tiny, { color: C.ink3 }]}>{[dateLabel(p.paid_on, lang, true), t("tr_from_x", { name: p.payee }), p.method ? methodDef(p.method).name : null, p.reference].filter(Boolean).join(" · ")}</Text>
                </View>
                <Text style={[T.h3, { color: C.ink }]}>{m$(p.amount)}</Text>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: S.sm }}>
                <Pill tone={p.status === "verified" ? "ok" : p.status === "questioned" ? "owe" : "pending"} text={t("tr_st_" + p.status)} />
                <Pill tone={p.proof_path ? "primary" : "owe"} text={p.proof_path ? t("tr_has_proof") : t("tr_no_proof")} />
              </View>
              {p.items.length ? p.items.map((it) => (
                <Text key={it.expense_id} style={[T.small, { color: C.ink2 }]} numberOfLines={1}>• {it.title} — {m$(it.amount)}{Number(it.amount) < Number(it.bill_amount) - 0.5 ? ` ${t("tr_of_x", { amount: m$(it.bill_amount) })}` : ""}</Text>
              )) : null}
              {Number(p.amount) - Number(p.allocated) > 0.5 ? <Text style={[T.small, { color: C.ink2 }]}>• {t("tr_advance", { amount: m$(Number(p.amount) - Number(p.allocated)) })}</Text> : null}
              <Text style={[T.tiny, { color: C.ink3 }]}>
                {t("tr_recorded_by", { name: p.recorded_by ?? "" })}
                {p.status === "verified" && p.verified_by ? ` · ${t("tr_verified_by", { name: p.verified_by, date: dateLabel(p.verified_at!, lang) })}` : ""}
              </Text>
              {p.status === "questioned" ? <Banner tone="owe" icon="help-circle-outline" text={t("tr_question_line", { name: p.questioned_by ?? "", q: p.question ?? "" })} /> : null}
              {p.notes ? <Text style={[T.small, { color: C.ink2 }]}>{p.notes}</Text> : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: S.sm }}>
                {p.proof_path ? <Button small kind="secondary" icon="eye-outline" label={t("tr_see_proof")} onPress={() => openProof(p.proof_path!)} /> : null}
                {canVerify ? <Button small icon="checkmark-done" label={t("tr_verify")} loading={busy === "v" + p.id}
                  onPress={async () => { if (await confirm(t("tr_verify_q"), p.proof_path ? t("tr_verify_text") : t("tr_verify_text_noproof"), t("tr_verify"), t("cancel"))) act("v" + p.id, () => verifyPayout(p.id), t("tr_verified_ok")); }} /> : null}
                {canQuestion ? <Button small kind="secondary" icon="help-circle-outline" label={t("tr_question")} onPress={() => { setQuestion(""); setAsking(p); }} /> : null}
                {p.status === "questioned" && p.asked_by_me ? <Button small kind="ghost" label={t("tr_clear_q")} onPress={() => act("c" + p.id, () => clearQuestion(p.id))} /> : null}
                {canProof ? <Button small kind="secondary" icon="attach" label={p.proof_path ? t("tr_replace_proof") : t("tr_add_proof")} onPress={() => { setProofFile([]); setProofRef(""); setProofNote(""); setProofFor(p); }} /> : null}
                {canDelete ? <Button small kind="ghost" icon="trash-outline" label={t("delete")}
                  onPress={async () => { if (await confirm(t("tr_delete_q"), t("tr_delete_text"), t("delete"), t("cancel"), true)) act("d" + p.id, () => deletePayout(p.id)); }} /> : null}
              </View>
            </Card>
          );
        }) : <Card><Text style={[T.small, { color: C.ink3 }]}>{t("tr_no_payouts")}</Text></Card>
      ) : null}

      {tab === "ledger" ? (
        <>
          {tr.holders.length > 1 ? (
            <Segmented value={ledgerHolder ?? ""} onChange={setLedgerFor} options={tr.holders.map((h) => ({ value: h.payee_id, label: h.name }))} />
          ) : null}
          {ledger.length ? (
            <Card style={{ paddingVertical: 4, gap: 0 }}>
              {[...ledger].reverse().map((l, i) => (
                <View key={i} style={[{ flexDirection: "row", gap: S.sm, paddingVertical: 9, alignItems: "center" }, i < ledger.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
                  <Icon name={l.type === "in" ? "arrow-down-circle" : "arrow-up-circle"} size={22} color={l.type === "in" ? C.ok : C.owe} />
                  <View style={{ flex: 1 }}>
                    <Text style={[T.small, { color: C.ink, fontWeight: "600" }]} numberOfLines={1}>
                      {l.type === "in" ? t("tr_l_in", { who: l.who ?? "" }) : l.type === "reimb" ? t("tr_l_reimb", { who: l.who ?? "" }) : t("tr_l_out", { who: l.who || t("tr_a_provider") })}
                    </Text>
                    <Text style={[T.tiny, { color: C.ink3 }]} numberOfLines={1}>
                      {[dateLabel(l.d, lang), l.reference, l.type === "out" ? t("tr_st_" + (l.status ?? "recorded")) : null, l.proof ? null : t("tr_no_proof")].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[T.small, { color: l.type === "in" ? C.ok : C.ink, fontWeight: "700" }]}>{l.type === "in" ? "+" : "−"}{m$(l.amount)}</Text>
                    <Text style={[T.tiny, { color: C.ink3 }]}>{m$(l.run)}</Text>
                  </View>
                </View>
              ))}
            </Card>
          ) : <Card><Text style={[T.small, { color: C.ink3 }]}>{t("tr_no_ledger")}</Text></Card>}
          {ledger.length ? <Button kind="secondary" icon="download-outline" label={t("tr_pdf", { name: holderName })} onPress={pdf} /> : null}
        </>
      ) : null}

      <Text style={[T.tiny, { color: C.ink3 }]}>{t("tr_how")}</Text>

      <Sheet visible={!!asking} onClose={() => setAsking(null)} title={t("tr_question")}>
        <Text style={[T.small, { color: C.ink2 }]}>{t("tr_question_hint")}</Text>
        <Field label={t("tr_question_label")} value={question} onChangeText={setQuestion} multiline maxLength={500} placeholder={t("tr_question_ph")} />
        <Button icon="send-outline" label={t("tr_question_send")} disabled={question.trim().length < 3} loading={busy === "q"}
          onPress={() => { const p = asking!; setAsking(null); act("q", () => questionPayout(p.id, question.trim()), t("tr_question_sent")); }} />
      </Sheet>

      <Sheet visible={!!proofFor} onClose={() => setProofFor(null)} title={t("tr_add_proof")}>
        <AttachBar label={t("po_proof")} files={proofFile} onChange={(f) => setProofFile(f.slice(-1))} />
        <Field label={t("po_reference")} value={proofRef} onChangeText={setProofRef} placeholder={t("po_reference_ph")} autoCapitalize="characters" />
        <Field label={t("tr_reply_label")} value={proofNote} onChangeText={setProofNote} multiline maxLength={500} />
        <Button icon="checkmark" label={t("save_changes")} disabled={!proofFile.length && !proofRef.trim() && !proofNote.trim()} loading={busy === "p"}
          onPress={() => {
            const p = proofFor!; setProofFor(null);
            act("p", async () => {
              const path = proofFile[0] ? await uploadFile(id, "payouts", proofFile[0]) : null;
              await addPayoutProof(p.id, path, proofRef.trim(), proofNote.trim());
            }, t("tr_proof_saved"));
          }} />
      </Sheet>
    </Screen>
  );
}

const Kv = ({ k, v }: { k: string; v: string }) => (
  <View><Text style={[T.tiny, { color: "rgba(255,255,255,0.8)" }]}>{k}</Text><Text style={[T.body, { color: C.white, fontWeight: "700" }]}>{v}</Text></View>
);
function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <Card style={{ flex: 1, gap: 2 }}>
      <Text style={[T.tiny, { color: C.ink3, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 }]} numberOfLines={1}>{label}</Text>
      <Text style={[T.h2, { color: tone }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={[T.tiny, { color: C.ink3 }]} numberOfLines={1}>{sub}</Text>
    </Card>
  );
}
function Issue({ sev, text, onPress }: { sev: string; text: string; onPress?: () => void }) {
  const color = sev === "high" ? C.owe : sev === "medium" ? C.pending : sev === "low" ? C.ink2 : C.primary;
  const icon = sev === "high" ? "alert-circle" : sev === "medium" ? "warning-outline" : sev === "low" ? "time-outline" : "information-circle-outline";
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ flexDirection: "row", gap: S.sm, alignItems: "flex-start" }}>
      <View style={{ paddingTop: 1 }}><Icon name={icon} size={18} color={color} /></View>
      <Text style={[T.small, { color: C.ink, flex: 1 }]}>{text}</Text>
      {onPress ? <Icon name="chevron-forward" size={16} color={C.ink3} /> : null}
    </Pressable>
  );
}
