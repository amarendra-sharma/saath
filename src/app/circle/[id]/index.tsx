import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Avatar, Banner, Button, Card, Empty, Icon, IconButton, Loading, Pill, Row, Section, Segmented, hashTone,
} from "../../../components/ui";
import { confirm, notify, useApp } from "../../../lib/app";
import { CATEGORY_ICON, PURPOSE_ICON } from "../../../lib/constants";
import { Activity, Contribution, Expense, Summary, loadSummary, memberName, useLoad } from "../../../lib/data";
import { dateLabel, money, monthLabel } from "../../../lib/format";
import { copy, openWhatsApp, shareText } from "../../../lib/share";
import { methodDef } from "../../../lib/payments";
import { callFn, errText, supabase } from "../../../lib/supabase";
import { C, R, S, T } from "../../../lib/theme";
import { AI_LIMIT_CODES, billCheckAllowed, loadCircleChecks, openFlags, openRisk, runCheck } from "../../../lib/billcheck";

type Tab = "overview" | "expenses" | "payments" | "people";

export default function CircleScreen() {
  const { id, welcome } = useLocalSearchParams<{ id: string; welcome?: string }>();
  const { t, lang } = useApp();
  const ins = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("overview");
  const [showWelcome, setShowWelcome] = useState(welcome === "1");

  const sum = useLoad<Summary>(() => loadSummary(id), [id]);
  const exp = useLoad<Expense[]>(async () => {
    const { data, error } = await supabase.from("saath_expenses").select("*, saath_receipts(id)").eq("circle_id", id)
      .order("spent_on", { ascending: false }).order("created_at", { ascending: false }).limit(500);
    if (error) throw error; return data as Expense[];
  }, [id]);
  const pay = useLoad<Contribution[]>(async () => {
    const { data, error } = await supabase.from("saath_contributions").select("*").eq("circle_id", id)
      .order("paid_on", { ascending: false }).order("created_at", { ascending: false }).limit(500);
    if (error) throw error; return data as Contribution[];
  }, [id]);
  const act = useLoad<Activity[]>(async () => {
    const { data, error } = await supabase.from("saath_activity").select("*").eq("circle_id", id).order("created_at", { ascending: false }).limit(12);
    if (error) throw error; return data as Activity[];
  }, [id]);

  const reloadAll = () => { sum.reload(); exp.reload(); pay.reload(); act.reload(); };
  const s = sum.data;
  if (!s) return sum.error ? <Empty icon="alert-circle-outline" title={t("something_wrong")} text={sum.error} action={<Button label={t("go_home")} onPress={() => router.replace("/home")} />} /> : <Loading />;

  const c = s.circle, cur = c.currency, admin = s.is_admin;
  const me = s.members.find((m) => m.id === s.me);
  const myBal = Number(me?.balance ?? 0);
  const pendingCount = (pay.data ?? []).filter((p) => p.status === "pending").length;

  const fab: Record<Tab, { label: string; icon: string; go: () => void } | null> = {
    overview: myBal > 0.5 ? { label: t("pay_my_share"), icon: "send-outline", go: () => router.push({ pathname: "/circle/[id]/pay", params: { id } }) }
      : { label: t("add_expense"), icon: "add", go: () => router.push({ pathname: "/circle/[id]/expense", params: { id } }) },
    expenses: { label: t("add_expense"), icon: "camera-outline", go: () => router.push({ pathname: "/circle/[id]/expense", params: { id } }) },
    payments: { label: t("record_payment"), icon: "add", go: () => router.push({ pathname: "/circle/[id]/pay", params: { id } }) },
    people: admin ? { label: t("add_person"), icon: "person-add-outline", go: () => router.push({ pathname: "/circle/[id]/member", params: { id } }) } : null,
  };
  const f = fab[tab];
  const x: Ctx = { t, lang, id, cur, c, admin, me };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingTop: ins.top + 6, paddingHorizontal: S.lg, gap: S.md, paddingBottom: S.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
          <IconButton icon="chevron-back" label={t("back")} bg="transparent" onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))} />
          <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" }}>
            <Icon name={PURPOSE_ICON[c.purpose] ?? "albums-outline"} size={20} color={C.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[T.h2, { color: C.ink }]} numberOfLines={1} accessibilityRole="header">{c.name}</Text>
            <Text style={[T.tiny, { color: C.ink3 }]}>{t("period_" + c.period)} · {cur}{c.status === "archived" ? " · " + t("archived") : ""}</Text>
          </View>
          <IconButton icon="document-text-outline" label={t("statement")} onPress={() => router.push({ pathname: "/circle/[id]/statement", params: { id } })} />
          <IconButton icon="settings-outline" label={t("settings")} onPress={() => router.push({ pathname: "/circle/[id]/settings", params: { id } })} />
        </View>
        <Segmented value={tab} onChange={setTab} options={[
          { value: "overview", label: t("tab_overview") },
          { value: "expenses", label: t("tab_expenses") },
          { value: "payments", label: t("tab_payments"), badge: admin ? pendingCount : 0 },
          { value: "people", label: t("tab_people") },
        ]} />
      </View>

      <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: S.sm, gap: S.lg, paddingBottom: ins.bottom + 120 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reloadAll} tintColor={C.primary} />}>
        {tab === "overview" && <Overview x={x} s={s} acts={act.data ?? []} myBal={myBal} showWelcome={showWelcome} closeWelcome={() => setShowWelcome(false)} goTab={setTab} pendingCount={pendingCount} />}
        {tab === "expenses" && <Expenses x={x} s={s} items={exp.data} />}
        {tab === "payments" && <Payments x={x} s={s} items={pay.data} onChanged={reloadAll} />}
        {tab === "people" && <People x={x} s={s} onChanged={reloadAll} />}
      </ScrollView>

      {f ? (
        <View style={{ position: "absolute", left: S.lg, right: S.lg, bottom: ins.bottom + S.lg }}>
          <Button label={f.label} icon={f.icon} onPress={f.go} kind={tab === "overview" && myBal > 0.5 ? "accent" : "primary"} />
        </View>
      ) : null}
    </View>
  );
}

type Ctx = { t: (k: string, p?: Record<string, string | number>) => string; lang: string; id: string; cur: string; c: Summary["circle"]; admin: boolean; me: Summary["members"][number] | undefined };

// ---------------------------------------------------------------- Overview
function Overview({ x, s, acts, myBal, showWelcome, closeWelcome, goTab, pendingCount }: {
  x: Ctx; s: Summary; acts: Activity[]; myBal: number; showWelcome: boolean; closeWelcome: () => void; goTab: (t: Tab) => void; pendingCount: number;
}) {
  const { t, lang, id, cur, c, admin, me } = x;
  const cats = s.categories.slice(0, 6);
  const maxCat = Math.max(1, ...cats.map((x) => Number(x.total)));
  const sharesOff = Math.abs(Number(s.totals.shares_total) - 100) > 0.01;
  return (
    <>
      {showWelcome ? (
        <Card tone="accent">
          <Text style={[T.h3, { color: C.ink }]}>{t("welcome_circle_title")}</Text>
          <Text style={[T.small, { color: C.ink2 }]}>{t("welcome_circle_text")}</Text>
          <View style={{ flexDirection: "row", gap: S.sm, flexWrap: "wrap", marginTop: 4 }}>
            <Button small label={t("invite_family")} icon="person-add-outline" onPress={() => { closeWelcome(); goTab("people"); }} />
            <Button small kind="secondary" label={t("add_payee")} icon="wallet-outline" onPress={() => { closeWelcome(); router.push({ pathname: "/circle/[id]/payees", params: { id } }); }} />
            <Button small kind="ghost" label={t("later")} onPress={closeWelcome} />
          </View>
        </Card>
      ) : null}

      <Card tone={myBal > 0.5 ? "owe" : myBal < -0.5 ? "ok" : undefined}>
        <Text style={[T.small, { color: C.ink2, fontWeight: "700" }]}>{t("your_balance")}</Text>
        <Text style={[T.hero, { color: myBal > 0.5 ? C.owe : myBal < -0.5 ? C.ok : C.ink }]}>
          {Math.abs(myBal) > 0.5 ? money(Math.abs(myBal), cur, lang) : t("all_settled")}
        </Text>
        <Text style={[T.small, { color: C.ink2 }]}>
          {myBal > 0.5 ? t("you_owe_long", { next: dateLabel(s.period.next_due, lang) }) : myBal < -0.5 ? t("you_are_owed_long") : t("settled_long")}
        </Text>
        {me ? <Text style={[T.tiny, { color: C.ink3 }]}>{t("your_share_pct", { pct: Number(me.share).toFixed(Number(me.share) % 1 ? 1 : 0) })} · {t("charged_paid", { charged: money(me.charged, cur, lang), paid: money(me.credited, cur, lang) })}</Text> : null}
      </Card>

      {admin && sharesOff ? (
        <Pressable onPress={() => router.push({ pathname: "/circle/[id]/shares", params: { id } })}>
          <Banner tone="owe" icon="pie-chart-outline" text={t("shares_off", { pct: Number(s.totals.shares_total).toFixed(1) })} />
        </Pressable>
      ) : null}
      {admin && pendingCount > 0 ? (
        <Pressable onPress={() => goTab("payments")}><Banner tone="pending" icon="time-outline" text={t("pending_banner", { n: pendingCount })} /></Pressable>
      ) : null}
      {s.payees.length === 0 && admin && !showWelcome ? (
        <Pressable onPress={() => router.push({ pathname: "/circle/[id]/payees", params: { id } })}>
          <Banner tone="primary" icon="wallet-outline" text={t("no_payee_banner")} />
        </Pressable>
      ) : null}

      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={[T.h3, { color: C.ink }]}>{t("this_period")}</Text>
          <Pill tone="primary" text={`${dateLabel(s.period.start, lang)} – ${dateLabel(s.period.end, lang)}`} />
        </View>
        <View style={{ flexDirection: "row", gap: S.md, marginTop: 4 }}>
          <Stat label={c.split_mode === "budget" ? t("budget") : t("spent")} value={money(c.split_mode === "budget" ? c.budget_amount ?? 0 : s.period.expenses, cur, lang, { compact: true })} />
          <Stat label={t("collected")} value={money(s.period.collected, cur, lang, { compact: true })} />
          <Stat label={t("still_due")} value={money(s.totals.outstanding, cur, lang, { compact: true })} tone={s.totals.outstanding > 0.5 ? C.owe : C.ok} />
        </View>
        <Text style={[T.tiny, { color: C.ink3 }]}>{t("next_due_on", { date: dateLabel(s.period.next_due, lang, true) })}</Text>
      </Card>

      <Card>
        <Text style={[T.h3, { color: C.ink }]}>{t("since_start")}</Text>
        <View style={{ flexDirection: "row", gap: S.md }}>
          <Stat label={t("total_spent")} value={money(s.totals.expenses, cur, lang, { compact: true })} sub={t("n_bills", { n: s.totals.expenses_count })} />
          <Stat label={t("total_contributed")} value={money(s.totals.contributed, cur, lang, { compact: true })} />
        </View>
        {s.payees.length ? (
          <View style={{ backgroundColor: C.bg, borderRadius: R.sm, padding: S.md, gap: 2 }}>
            <Text style={[T.small, { color: C.ink2, fontWeight: "700" }]}>{t("held_by", { name: s.payees[0].name })}</Text>
            <Text style={[T.h3, { color: Number(s.totals.pot) < 0 ? C.owe : C.ink }]}>{money(s.totals.pot, cur, lang)}</Text>
            <Text style={[T.tiny, { color: C.ink3 }]}>{Number(s.totals.pot) < 0 ? t("pot_negative") : t("pot_positive")}</Text>
          </View>
        ) : null}
      </Card>

      {cats.length ? (
        <Section title={t("where_money_goes")}>
          <Card>
            {cats.map((x) => (
              <View key={x.category} style={{ gap: 6, marginBottom: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Icon name={CATEGORY_ICON[x.category] ?? "pricetag-outline"} size={18} color={C.ink2} />
                  <Text style={[T.small, { color: C.ink, flex: 1, fontWeight: "600" }]}>{t("cat_" + x.category)}</Text>
                  <Text style={[T.small, { color: C.ink, fontWeight: "700" }]}>{money(x.total, cur, lang, { compact: true })}</Text>
                </View>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: C.bg }}>
                  <View style={{ height: 8, borderRadius: 4, width: `${(Number(x.total) / maxCat) * 100}%`, backgroundColor: C.primary }} />
                </View>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title={t("recent_activity")}>
        <Card style={{ paddingVertical: 4 }}>
          {acts.length === 0 ? <Text style={[T.small, { color: C.ink3, paddingVertical: S.md }]}>{t("no_activity")}</Text> : acts.map((a, i) => (
            <Row key={a.id} last={i === acts.length - 1}
              left={<Icon name={a.verb.startsWith("expense") ? "receipt-outline" : a.verb.startsWith("payment") || a.verb.startsWith("reimb") ? "cash-outline" : "people-outline"} size={20} color={C.ink2} />}
              title={activityText(x, a)} subtitle={dateLabel(a.created_at, lang)} />
          ))}
        </Card>
      </Section>
    </>
  );
}

function activityText(x: Ctx, a: Activity) {
  const { t, lang, id, cur, c, admin, me } = x;
  const d = a.data ?? {};
  const amount = d.amount != null ? money(d.amount, cur, lang) : "";
  return t("act_" + a.verb, { title: d.title ?? "", amount, member: d.member ?? "", from: d.from != null ? Number(d.from).toFixed(0) : "", to: d.to != null ? Number(d.to).toFixed(0) : "", note: d.note ?? "" });
}

// ---------------------------------------------------------------- Expenses
function Expenses({ x, s, items }: { x: Ctx; s: Summary; items: Expense[] | null }) {
  const { t, lang, id, cur, c, admin, me } = x;
  const checks = useLoad(() => loadCircleChecks(id), [id]);
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  const flagged = (items ?? []).filter((e) => ["medium", "high"].includes(openRisk(checks.data?.[e.id])));
  const unchecked = (items ?? []).filter((e) => !checks.data?.[e.id]);
  const checkAll = async () => {
    if (!billCheckAllowed(c.plan)) { notify(t("bc_plus_title"), t("bc_plus_text")); return; }
    const todo = unchecked.length ? unchecked : (items ?? []);
    let done = 0;
    for (let i = 0; i < todo.length; i++) {
      setProgress({ i: i + 1, n: todo.length });
      try { await runCheck(todo[i].id, lang); done++; } catch (e: any) { if (AI_LIMIT_CODES.includes(e?.code)) break; }
    }
    setProgress(null); checks.reload();
    notify(t("bc_done_all", { n: done }));
  };
  const groups = useMemo(() => {
    const g = new Map<string, Expense[]>();
    for (const e of items ?? []) { const k = e.spent_on.slice(0, 7); g.set(k, [...(g.get(k) ?? []), e]); }
    return [...g.entries()];
  }, [items]);
  if (!items) return <Loading />;
  if (!items.length) return <Empty icon="receipt-outline" title={t("no_expenses_title")} text={t("no_expenses_text")} />;
  return (
    <>
      <Card tone={flagged.length ? "owe" : undefined}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
          <Icon name={flagged.length ? "shield-half-outline" : "shield-checkmark-outline"} size={24} color={flagged.length ? C.owe : C.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[T.h3, { color: C.ink }]}>{t("bc_summary_title")}</Text>
            <Text style={[T.small, { color: C.ink2 }]}>{flagged.length ? t("bc_summary_n", { n: flagged.length, m: unchecked.length }) : t("bc_summary_clear", { m: unchecked.length })}</Text>
          </View>
        </View>
        <Button small kind="secondary" icon="shield-checkmark-outline" loading={!!progress}
          label={progress ? t("bc_checking_x", { i: progress.i, n: progress.n }) : t("bc_check_all")} onPress={checkAll} />
      </Card>
      {groups.map(([k, list]) => (
        <Section key={k} title={monthLabel(k + "-01", lang)} action={<Text style={[T.small, { color: C.ink2, fontWeight: "700" }]}>{money(list.reduce((a, e) => a + Number(e.amount), 0), cur, lang)}</Text>}>
          <Card style={{ paddingVertical: 4 }}>
            {list.map((e, i) => (
              <Row key={e.id} last={i === list.length - 1}
                onPress={() => router.push({ pathname: "/circle/[id]/expense-view", params: { id, eid: e.id } })}
                left={<View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
                  <Icon name={CATEGORY_ICON[e.category] ?? "pricetag-outline"} size={20} color={C.primary} /></View>}
                title={e.title}
                subtitle={[dateLabel(e.spent_on, lang), e.paid_by_member_id ? t("paid_by_x", { name: memberName(s, e.paid_by_member_id) }) : e.vendor].filter(Boolean).join(" · ")}
                right={<View style={{ alignItems: "flex-end", gap: 2 }}>
                  <Text style={[T.body, { color: C.ink, fontWeight: "700" }]}>{money(e.amount, cur, lang)}</Text>
                  {(() => { const r = openRisk(checks.data?.[e.id]); const n = openFlags(checks.data?.[e.id]).length;
                    return r === "high" || r === "medium" ? <Pill tone={r === "high" ? "owe" : "pending"} text={`⚠ ${n}`} /> : null; })()}
                  {e.saath_receipts?.length ? <Icon name="attach" size={16} color={C.ink3} /> : <Text style={[T.tiny, { color: C.accent }]}>{t("no_receipt")}</Text>}
                </View>} />
            ))}
          </Card>
        </Section>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- Payments
function Payments({ x, s, items, onChanged }: { x: Ctx; s: Summary; items: Contribution[] | null; onChanged: () => void }) {
  const { t, lang, id, cur, c, admin, me } = x;
  if (!items) return <Loading />;
  const list = items;
  const decide = async (p: Contribution, ok: boolean) => {
    const { error } = await supabase.from("saath_contributions").update({ status: ok ? "confirmed" : "rejected" }).eq("id", p.id);
    if (error) notify(t("something_wrong"), errText(error)); else onChanged();
  };
  const remove = async (p: Contribution) => {
    if (!(await confirm(t("delete_payment_q"), t("delete_payment_text"), t("delete"), t("cancel"), true))) return;
    const { error } = await supabase.from("saath_contributions").delete().eq("id", p.id);
    if (error) notify(t("something_wrong"), errText(error)); else onChanged();
  };
  if (!list.length) return <Empty icon="cash-outline" title={t("no_payments_title")} text={t("no_payments_text")} />;
  const pending = list.filter((p) => p.status === "pending");
  const rest = list.filter((p) => p.status !== "pending");
  const rowFor = (p: Contribution, i: number, arr: Contribution[]) => {
    const who = memberName(s, p.member_id);
    const isMine = p.member_id === s.me;
    const kindLabel = p.kind === "expense_paid" ? t("kind_expense_paid") : p.kind === "reimbursement" ? t("kind_reimbursement") : (p.method ? methodName(p.method) : t("kind_payment"));
    return (
      <View key={p.id} style={[{ paddingVertical: S.md, gap: S.sm }, i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
          <Avatar name={who} tone={hashTone(who)} size={38} />
          <View style={{ flex: 1 }}>
            <Text style={[T.body, { color: C.ink, fontWeight: "600" }]} numberOfLines={1}>{who}{isMine ? ` (${t("you")})` : ""}</Text>
            <Text style={[T.small, { color: C.ink3 }]} numberOfLines={1}>{dateLabel(p.paid_on, lang)} · {kindLabel}{p.reference ? ` · ${p.reference}` : ""}</Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            <Text style={[T.body, { color: p.kind === "reimbursement" ? C.owe : C.ink, fontWeight: "700" }]}>{p.kind === "reimbursement" ? "−" : ""}{money(p.amount, cur, lang)}</Text>
            <Pill tone={p.status === "confirmed" ? "ok" : p.status === "pending" ? "pending" : "owe"} text={t("st_" + p.status)} />
          </View>
        </View>
        {p.orig_amount && p.orig_currency ? <Text style={[T.tiny, { color: C.ink3, marginLeft: 50 }]}>{t("sent_as", { amount: money(p.orig_amount, p.orig_currency, lang) })}</Text> : null}
        {p.status === "pending" && admin ? (
          <View style={{ flexDirection: "row", gap: S.sm, marginLeft: 50 }}>
            <Button small label={t("confirm_received")} icon="checkmark" onPress={() => decide(p, true)} />
            <Button small kind="danger" label={t("not_received")} onPress={() => decide(p, false)} />
          </View>
        ) : null}
        {p.kind !== "expense_paid" && ((p.status === "pending" && p.created_by === sessionUid()) || admin) ? (
          <View style={{ marginLeft: 50, alignItems: "flex-start" }}>
            <Button small kind="ghost" icon="trash-outline" label={t("delete")} onPress={() => remove(p)} />
          </View>
        ) : null}
      </View>
    );
  };
  return (
    <>
      {pending.length ? <Section title={t("waiting_confirmation")}><Card style={{ paddingVertical: 0 }}>{pending.map(rowFor)}</Card></Section> : null}
      <Section title={t("all_payments")}><Card style={{ paddingVertical: 0 }}>{rest.length ? rest.map(rowFor) : <Text style={[T.small, { color: C.ink3, paddingVertical: S.md }]}>{t("none_yet")}</Text>}</Card></Section>
      {admin ? <Button kind="secondary" icon="return-down-back-outline" label={t("record_reimbursement")} onPress={() => router.push({ pathname: "/circle/[id]/pay", params: { id, kind: "reimbursement" } })} /> : null}
    </>
  );
}

// ---------------------------------------------------------------- People
function People({ x, s, onChanged }: { x: Ctx; s: Summary; onChanged: () => void }) {
  const { t, lang, id, cur, c, admin, me } = x;
  const [sending, setSending] = useState(false);
  const active = s.members.filter((m) => m.status === "active");
  const left = s.members.filter((m) => m.status !== "active");
  const inviteText = t("invite_msg", { circle: c.name, code: c.invite_code });
  const remindAll = async () => {
    if (!(await confirm(t("send_reminders_q"), t("send_reminders_text"), t("send"), t("cancel")))) return;
    setSending(true);
    try {
      const r: any = await callFn("saath-remind", { circle_id: id }, true);
      if (r.throttled) notify(t("reminders_throttled"));
      else notify(t("reminders_done", { n: r.members, wa: r.results.whatsapp.sent, em: r.results.email.sent }),
        r.results.whatsapp.skipped || r.results.email.skipped ? t("reminders_some_skipped") : undefined);
    } catch (e) { notify(t("something_wrong"), errText(e)); }
    finally { setSending(false); onChanged(); }
  };
  const nudge = (m: (typeof active)[number]) =>
    openWhatsApp(t("nudge_msg", { name: m.name.split(" ")[0], circle: c.name, amount: money(m.balance, cur, m.language || lang) }), m.phone);

  return (
    <>
      <Card tone="primary">
        <Text style={[T.small, { color: "rgba(255,255,255,0.8)", fontWeight: "700" }]}>{t("invite_code")}</Text>
        <Pressable onPress={async () => { await copy(c.invite_code); notify(t("copied")); }} accessibilityLabel={t("copy")}>
          <Text style={{ color: C.white, fontSize: 36, fontWeight: "800", letterSpacing: 6 }}>{c.invite_code}</Text>
        </Pressable>
        <Text style={[T.small, { color: "rgba(255,255,255,0.85)" }]}>{t("invite_hint")}</Text>
        <View style={{ flexDirection: "row", gap: S.sm, marginTop: 4 }}>
          <Button small kind="accent" icon="logo-whatsapp" label="WhatsApp" onPress={() => openWhatsApp(inviteText)} style={{ flex: 1 }} />
          <Button small kind="secondary" icon="share-outline" label={t("share")} onPress={async () => { if ((await shareText(inviteText)) === "copied") notify(t("copied")); }} style={{ flex: 1 }} />
        </View>
      </Card>

      <Section title={t("members_and_shares")} action={admin ? <Button small kind="ghost" icon="pie-chart-outline" label={t("edit_shares")} onPress={() => router.push({ pathname: "/circle/[id]/shares", params: { id } })} /> : undefined}>
        <Card style={{ paddingVertical: 4 }}>
          {active.map((m, i) => {
            const bal = Number(m.balance);
            return (
              <Row key={m.id} last={i === active.length - 1}
                onPress={admin || m.is_me ? () => router.push({ pathname: "/circle/[id]/member", params: { id, mid: m.id } }) : undefined}
                left={<Avatar name={m.name} tone={hashTone(m.name)} />}
                title={`${m.name}${m.is_me ? ` (${t("you")})` : ""}`}
                subtitle={[`${Number(m.share).toFixed(Number(m.share) % 1 ? 1 : 0)}%`, m.role === "admin" ? t("organiser") : null, !m.joined ? t("not_on_app") : null, m.relation].filter(Boolean).join(" · ")}
                right={
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={[T.small, { fontWeight: "700", color: bal > 0.5 ? C.owe : bal < -0.5 ? C.ok : C.ink3 }]}>
                      {bal > 0.5 ? t("owes_x", { amount: money(bal, cur, lang) }) : bal < -0.5 ? t("owed_x", { amount: money(-bal, cur, lang) }) : t("settled")}
                    </Text>
                    {admin && bal > 0.5 && m.phone && !m.is_me ? (
                      <Pressable onPress={() => nudge(m)} accessibilityRole="button" accessibilityLabel={t("nudge_whatsapp")} hitSlop={8}
                        style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Icon name="logo-whatsapp" size={16} color={C.ok} /><Text style={[T.tiny, { color: C.ok, fontWeight: "700" }]}>{t("nudge")}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                } />
            );
          })}
        </Card>
      </Section>

      {admin ? (
        <Card>
          <Text style={[T.h3, { color: C.ink }]}>{t("reminders")}</Text>
          <Text style={[T.small, { color: C.ink2 }]}>{t("reminders_auto", { period: t("period_" + c.period).toLowerCase(), date: dateLabel(s.period.next_due, lang) })}</Text>
          <Button kind="secondary" icon="notifications-outline" label={t("send_reminders_now")} loading={sending} onPress={remindAll} />
        </Card>
      ) : null}

      {left.length ? (
        <Section title={t("former_members")}>
          <Card style={{ paddingVertical: 4 }}>
            {left.map((m, i) => <Row key={m.id} last={i === left.length - 1} left={<Avatar name={m.name} />} title={m.name}
              subtitle={Number(m.balance) ? t("balance_x", { amount: money(m.balance, cur, lang) }) : t("settled")} />)}
          </Card>
        </Section>
      ) : null}
    </>
  );
}


let _uid: string | null = null;
supabase.auth.getSession().then(({ data }) => { _uid = data.session?.user.id ?? null; });
supabase.auth.onAuthStateChange((_e, s) => { _uid = s?.user.id ?? null; });
const sessionUid = () => _uid;

const methodName = (k: string) => methodDef(k).name;

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={[T.tiny, { color: C.ink3, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 }]} numberOfLines={1}>{label}</Text>
      <Text style={[T.h3, { color: tone ?? C.ink }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={[T.tiny, { color: C.ink3 }]}>{sub}</Text> : null}
    </View>
  );
}
