import { useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Avatar, Banner, Button, Card, Field, Icon, IconButton, Loading, Pill, Row, Screen, Section, Toggle, hashTone } from "../../../components/ui";
import { confirm, notify, useApp } from "../../../lib/app";
import { Summary, loadSummary, useLoad } from "../../../lib/data";
import { esc, exportPdf } from "../../../lib/exporter";
import { dateLabel, money, parseAmount } from "../../../lib/format";
import { errText, supabase } from "../../../lib/supabase";
import { C, R, S, T } from "../../../lib/theme";

type Terms = { approval_over: number | null; late_days: number; exit_notice_days: number; mediator: string; extra: string };
type Agreement = {
  id: string; version: number; title: string; body: string; terms: Terms; body_hash: string; created_at: string;
  members: { member_id: string; name: string; is_me: boolean | null; joined: boolean; signed_name: string | null; signed_at: string | null }[];
};
type Tr = (k: string, p?: Record<string, string | number>) => string;

const DEFAULT_TERMS: Terms = { approval_over: null, late_days: 7, exit_notice_days: 30, mediator: "", extra: "" };

/** The agreement text, built from the circle's own settings so it always matches how Saath actually splits money. */
export function buildBody(s: Summary, terms: Terms, t: Tr, lang: string) {
  const c = s.circle, cur = c.currency;
  const active = s.members.filter((m) => m.status === "active");
  const m$ = (n: number) => money(n, cur, lang);
  const out: string[] = [];
  let n = 0;
  const sec = (title: string, ...lines: string[]) => { n++; out.push(`${n}. ${title}`, ...lines, ""); };
  out.push(t("agr_intro", { circle: c.name, date: dateLabel(c.start_date, lang, true) }), "");
  sec(t("agr_s_purpose"), c.description?.trim() || t("agr_purpose_default", { purpose: t("purpose_" + c.purpose).toLowerCase() }));
  sec(t("agr_s_shares"), ...active.map((m) => `• ${m.name}${m.relation ? ` (${m.relation})` : ""}: ${Number(m.share).toFixed(Number(m.share) % 1 ? 1 : 0)}%`),
    t("agr_shares_note"));
  sec(t("agr_s_contrib"), c.split_mode === "budget"
    ? t("agr_contrib_budget", { amount: m$(c.budget_amount ?? 0), period: t("period_" + c.period).toLowerCase(), day: c.due_day })
    : t("agr_contrib_expenses", { period: t("period_" + c.period).toLowerCase(), day: c.due_day }));
  sec(t("agr_s_records"), t("agr_records"), c.require_confirmation ? t("agr_records_confirm") : t("agr_records_auto"));
  if (terms.approval_over && terms.approval_over > 0) sec(t("agr_s_approval"), t("agr_approval", { amount: m$(terms.approval_over) }));
  sec(t("agr_s_late"), t("agr_late", { n: terms.late_days }));
  sec(t("agr_s_exit"), t("agr_exit", { n: terms.exit_notice_days }));
  sec(t("agr_s_disputes"), terms.mediator.trim() ? t("agr_disputes_mediator", { name: terms.mediator.trim() }) : t("agr_disputes"));
  sec(t("agr_s_changes"), t("agr_changes"));
  if (terms.extra.trim()) sec(t("agr_s_extra"), terms.extra.trim());
  out.push(t("agr_footer"));
  return out.join("\n").trim();
}

export default function AgreementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang, profile } = useApp();
  const d = useLoad<{ s: Summary; a: Agreement | null }>(async () => {
    const [s, r] = await Promise.all([loadSummary(id), supabase.rpc("saath_agreement_current", { p_circle: id })]);
    if (r.error) throw r.error;
    return { s, a: (r.data as Agreement) ?? null };
  }, [id]);
  const [editing, setEditing] = useState(false);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [approval, setApproval] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);

  const draft = useMemo(() => (d.data && terms ? buildBody(d.data.s, { ...terms, approval_over: parseAmount(approval) || null }, t, lang) : ""), [d.data, terms, approval, t, lang]);
  if (!d.data) return <Loading />;
  const { s, a } = d.data;
  const organiser = s.is_admin;
  const cur = s.circle.currency;
  const me = a?.members.find((m) => m.is_me);
  const signedCount = a?.members.filter((m) => m.signed_at).length ?? 0;

  const startEdit = () => {
    const tm = { ...DEFAULT_TERMS, ...(a?.terms ?? {}) };
    setTerms(tm); setApproval(tm.approval_over ? String(tm.approval_over) : "");
    setTitle(a?.title ?? t("agr_default_title", { circle: s.circle.name }));
    setEditing(true);
  };
  const publish = async () => {
    if (!terms) return;
    if (a && !(await confirm(t("agr_republish_q"), t("agr_republish"), t("agr_publish"), t("cancel")))) return;
    setBusy(true);
    try {
      const tm = { ...terms, approval_over: parseAmount(approval) || null };
      const { error } = await supabase.rpc("saath_agreement_publish", { p_circle: id, p_title: title.trim() || t("agr_default_title", { circle: s.circle.name }), p_body: draft, p_terms: tm });
      if (error) throw error;
      setEditing(false); d.reload();
      notify(t("agr_published"));
    } catch (e) { notify(t("something_wrong"), errText(e)); }
    finally { setBusy(false); }
  };
  const sign = async () => {
    if (!a) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("saath_agreement_sign", { p_agreement: a.id, p_name: name.trim() });
      if (error) throw error;
      d.reload(); notify(t("agr_signed_ok"));
    } catch (e) { notify(t("something_wrong"), errText(e)); }
    finally { setBusy(false); }
  };
  const pdf = async () => {
    if (!a) return;
    const rows = a.members.map((m) => `<tr><td>${esc(m.name)}</td><td>${m.signed_at ? esc(m.signed_name) : "—"}</td><td>${m.signed_at ? esc(new Date(m.signed_at).toISOString().replace("T", " ").slice(0, 19) + " UTC") : esc(t("agr_not_signed"))}</td></tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,Segoe UI,Roboto,"Noto Sans",sans-serif;color:#0E1A2B;padding:32px;font-size:13px;line-height:1.55}
      h1{font-size:20px;margin:0 0 4px;color:#1A3A6E} .meta{color:#63708A;font-size:11px;margin-bottom:18px}
      pre{white-space:pre-wrap;font-family:inherit;margin:0 0 18px} table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #E2E7EF} th{background:#F4F6FA}
      .hash{font-family:monospace;font-size:10px;color:#44526A;word-break:break-all;margin-top:14px} .note{font-size:10px;color:#63708A;margin-top:12px}
    </style></head><body>
      <h1>${esc(a.title)}</h1>
      <div class="meta">${esc(s.circle.name)} · ${esc(t("agr_version", { v: a.version }))} · ${esc(t("agr_published_on", { date: dateLabel(a.created_at, lang, true) }))}</div>
      <pre>${esc(a.body)}</pre>
      <h3>${esc(t("agr_signatures"))}</h3>
      <table><tr><th>${esc(t("ins_member"))}</th><th>${esc(t("agr_typed_name"))}</th><th>${esc(t("agr_signed_at"))}</th></tr>${rows}</table>
      <div class="hash">SHA-256: ${esc(a.body_hash)}</div>
      <div class="note">${esc(t("agr_legal"))}</div>
    </body></html>`;
    try { await exportPdf(html, `${s.circle.name}-agreement-v${a.version}.pdf`); } catch (e) { notify(t("something_wrong"), errText(e)); }
  };

  // ── organiser editing / first draft
  if (editing && terms) {
    const set = (p: Partial<Terms>) => setTerms({ ...terms, ...p });
    return (
      <Screen title={a ? t("agr_edit") : t("agr_new")} subtitle={s.circle.name}
        footer={<Button icon="megaphone-outline" label={a ? t("agr_publish_v", { v: a.version + 1 }) : t("agr_publish")} loading={busy} onPress={publish} />}>
        <Banner tone="primary" icon="information-circle-outline" text={t("agr_builder_hint")} />
        <Field label={t("agr_title")} value={title} onChangeText={setTitle} maxLength={120} />
        <Field label={t("agr_approval_label", { cur })} hint={t("agr_approval_hint")} value={approval} onChangeText={setApproval} keyboardType="decimal-pad" placeholder="0" />
        <View style={{ flexDirection: "row", gap: S.md }}>
          <View style={{ flex: 1 }}><Field label={t("agr_late_label")} value={String(terms.late_days)} keyboardType="number-pad"
            onChangeText={(v) => set({ late_days: Math.min(90, Math.max(1, parseInt(v.replace(/\D/g, "") || "0") || 1)) })} /></View>
          <View style={{ flex: 1 }}><Field label={t("agr_exit_label")} value={String(terms.exit_notice_days)} keyboardType="number-pad"
            onChangeText={(v) => set({ exit_notice_days: Math.min(365, Math.max(0, parseInt(v.replace(/\D/g, "") || "0") || 0)) })} /></View>
        </View>
        <Field label={t("agr_mediator_label")} hint={t("agr_mediator_hint")} value={terms.mediator} onChangeText={(v) => set({ mediator: v })} maxLength={80} />
        <Field label={t("agr_extra_label")} hint={t("agr_extra_hint")} value={terms.extra} onChangeText={(v) => set({ extra: v })} multiline maxLength={3000} />
        <Section title={t("agr_preview")}>
          <Card><Text style={[T.small, { color: C.ink, lineHeight: 21 }]} selectable>{draft}</Text></Card>
        </Section>
        <Text style={[T.tiny, { color: C.ink3 }]}>{t("agr_legal")}</Text>
        <Button kind="ghost" label={t("cancel")} onPress={() => setEditing(false)} />
      </Screen>
    );
  }

  // ── no agreement yet
  if (!a) {
    return (
      <Screen title={t("agr_title_screen")} subtitle={s.circle.name}>
        <Card tone="accent">
          <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
            <Icon name="document-lock-outline" size={22} color={C.accent} />
            <Text style={[T.h3, { color: C.ink }]}>{t("agr_none_t")}</Text>
          </View>
          <Text style={[T.small, { color: C.ink2 }]}>{t("agr_none")}</Text>
          {organiser ? <Button icon="create-outline" label={t("agr_start")} onPress={startEdit} /> : <Text style={[T.small, { color: C.ink3 }]}>{t("agr_ask_organiser")}</Text>}
        </Card>
        <Text style={[T.tiny, { color: C.ink3 }]}>{t("agr_legal")}</Text>
      </Screen>
    );
  }

  // ── current agreement
  const needSign = me && !me.signed_at;
  return (
    <Screen title={t("agr_title_screen")} subtitle={s.circle.name} right={<IconButton icon="download-outline" label="PDF" onPress={pdf} />}
      footer={needSign ? <Button icon="create-outline" label={t("agr_sign")} loading={busy} disabled={!agree || name.trim().length < 2} onPress={sign} /> : undefined}>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
          <Text style={[T.h3, { color: C.ink, flex: 1 }]}>{a.title}</Text>
          <Pill tone="primary" text={t("agr_version", { v: a.version })} />
        </View>
        <Text style={[T.tiny, { color: C.ink3 }]}>{t("agr_published_on", { date: dateLabel(a.created_at, lang, true) })} · {t("agr_signed_n", { n: signedCount, total: a.members.length })}</Text>
        <View style={{ height: 1, backgroundColor: C.line, marginVertical: S.sm }} />
        <Text style={[T.small, { color: C.ink, lineHeight: 21 }]} selectable>{a.body}</Text>
      </Card>

      {needSign ? (
        <Card tone="accent">
          <Text style={[T.h3, { color: C.ink }]}>{t("agr_sign_t")}</Text>
          <Field label={t("agr_typed_name")} value={name} onChangeText={setName} placeholder={me?.name || profile?.full_name || ""} maxLength={80} autoCapitalize="words" />
          <Toggle label={t("agr_i_agree")} value={agree} onChange={setAgree} />
        </Card>
      ) : me?.signed_at ? <Banner tone="ok" icon="checkmark-circle-outline" text={t("agr_you_signed", { date: dateLabel(me.signed_at, lang, true) })} /> : null}

      <Section title={t("agr_signatures")}>
        <Card style={{ paddingVertical: 4 }}>
          {a.members.map((m, i) => (
            <Row key={m.member_id} last={i === a.members.length - 1} left={<Avatar name={m.name} tone={hashTone(m.name)} size={34} />}
              title={m.name + (m.is_me ? ` (${t("you")})` : "")}
              subtitle={m.signed_at ? `“${m.signed_name}” · ${dateLabel(m.signed_at, lang, true)}` : !m.joined ? t("agr_not_on_app") : t("agr_not_signed")}
              right={<Icon name={m.signed_at ? "checkmark-circle" : "ellipse-outline"} size={22} color={m.signed_at ? C.ok : C.ink3} />} />
          ))}
        </Card>
      </Section>

      <View style={{ backgroundColor: C.card, borderRadius: R.md, padding: S.md, borderWidth: 1, borderColor: C.line, gap: 4 }}>
        <Text style={[T.tiny, { color: C.ink2, fontWeight: "700" }]}>{t("agr_fingerprint")}</Text>
        <Text style={[T.tiny, { color: C.ink3, fontFamily: "monospace" }]} selectable>{a.body_hash}</Text>
      </View>
      <Text style={[T.tiny, { color: C.ink3 }]}>{t("agr_legal")}</Text>
      <View style={{ flexDirection: "row", gap: S.sm }}>
        <Button kind="secondary" icon="download-outline" label={t("agr_pdf")} onPress={pdf} style={{ flex: 1 }} />
        {organiser ? <Button kind="secondary" icon="create-outline" label={t("agr_edit")} onPress={startEdit} style={{ flex: 1 }} /> : null}
      </View>
    </Screen>
  );
}
