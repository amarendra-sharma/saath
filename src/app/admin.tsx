// App admin console (owner only). English-only on purpose: it is a tool for the people who run Bengu.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Avatar, Banner, Button, Card, Chips, Empty, Field, Icon, Loading, Pill, Row, Screen, Section, Segmented, Sheet, Toggle, hashTone } from "../components/ui";
import {
  AdminCircle, AdminOverview, AdminRequest, AdminUser, ConfigRow, PERIOD_MONTHS, PriceRow, adminCircles, adminConfig, adminDeclineRequest,
  adminGrantPlus, adminOverview, adminTraffic, Traffic, adminPricing, adminRequests, adminSetAdmin, adminSetAi, adminSetConfig, adminSetPrice,
  adminUpdateCircle, adminUsers, usd,
} from "../lib/admin";
import { confirm, notify, useApp } from "../lib/app";
import { dateLabel, money } from "../lib/format";
import { errText } from "../lib/supabase";
import { C, R, S, T } from "../lib/theme";

type Tab = "overview" | "circles" | "plans" | "people" | "settings";

export default function Admin() {
  const { isAdmin, session } = useApp();
  const [tab, setTab] = useState<Tab>("overview");
  if (!session) return <Loading />;
  if (!isAdmin) {
    return (
      <Screen title="Admin">
        <Card><Empty icon="lock-closed-outline" title="Admins only" text="This account can't open the admin console." /></Card>
      </Screen>
    );
  }
  return (
    <Screen title="Admin console" subtitle="Bengu · run the app" scroll={false} padded={false}>
      <View style={{ paddingHorizontal: S.lg, paddingBottom: S.sm }}>
        <Segmented value={tab} onChange={setTab} options={[
          { value: "overview", label: "Home" }, { value: "circles", label: "Circles" }, { value: "plans", label: "Plans" },
          { value: "people", label: "People" }, { value: "settings", label: "Settings" },
        ]} />
      </View>
      {tab === "overview" ? <OverviewTab goTab={setTab} /> : tab === "circles" ? <CirclesTab /> : tab === "plans" ? <PlansTab goTab={setTab} />
        : tab === "people" ? <PeopleTab /> : <SettingsTab />}
    </Screen>
  );
}

/** load + pull-to-refresh helper */
function useAdmin<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setErr(null); } catch (e) { setErr(errText(e)); } finally { setLoading(false); }
  }, [fn]);
  useEffect(() => { load(); }, [load]);
  return { data, err, loading, reload: load };
}

function Body({ children, loading, onRefresh }: { children: React.ReactNode; loading: boolean; onRefresh: () => void }) {
  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 60, gap: S.lg }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={C.primary} />}>
      {children}
    </ScrollView>
  );
}

// ───────────────────────── Overview
function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: string }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: "46%", backgroundColor: C.card, borderRadius: R.md, padding: S.md, gap: 4, borderWidth: 1, borderColor: C.line }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={icon} size={16} color={C.ink3} />
        <Text style={[T.tiny, { color: C.ink3, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 }]}>{label}</Text>
      </View>
      <Text style={[T.h2, { color: C.ink }]}>{value}</Text>
      {sub ? <Text style={[T.tiny, { color: C.ink3 }]}>{sub}</Text> : null}
    </View>
  );
}

function OverviewTab({ goTab }: { goTab: (t: Tab) => void }) {
  const fn = useCallback(async () => {
    const [o, cfg, req, circles, traffic] = await Promise.all([adminOverview(), adminConfig(), adminRequests().catch(() => [] as AdminRequest[]),
      adminCircles().catch(() => [] as AdminCircle[]), adminTraffic().catch(() => null as Traffic | null)]);
    return { o, req, circles, traffic, cfg: Object.fromEntries(cfg.map((r) => [r.key, r.value])) as Record<string, any> };
  }, []);
  const { data, err, loading, reload } = useAdmin(fn);
  if (!data) return err ? <View style={{ padding: S.lg }}><Banner tone="owe" text={err} /></View> : <Loading />;
  const { o, cfg, req, circles, traffic } = data;
  const mn = traffic?.by_source.find((x) => x.source === "macronations");
  const plusCount = circles.filter((c) => c.plus_active).length;
  const cap = Number(cfg.daily_cap_usd ?? 5);
  const max = Math.max(0.01, ...o.daily.map((d) => Number(d.usd)));
  const credit = /credit balance is too low/i.test(o.last_ai_error ?? "");
  return (
    <Body loading={loading} onRefresh={reload}>
      {credit ? <Banner tone="owe" icon="card-outline" text="Anthropic credit has run out, so bill reading is failing. Add credit at console.anthropic.com → Billing." /> : null}
      {req.length ? (
        <Pressable onPress={() => goTab("plans")}>
          <Banner tone="primary" icon="sparkles-outline" text={`${req.length} circle${req.length > 1 ? "s" : ""} asked for Bengu Plus. Open Plans to grant or decline.`} />
        </Pressable>
      ) : null}
      {cfg.scan_enabled === false ? <Banner tone="pending" icon="pause-circle-outline" text="Bill reading is switched off (Settings → Features)." /> : null}

      <Section title="AI spend">
        <Card style={{ gap: S.md }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
            <View>
              <Text style={[T.tiny, { color: C.ink3, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 }]}>Today (UTC)</Text>
              <Text style={[T.hero, { color: C.ink }]}>{usd(o.ai_today)}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[T.small, { color: C.ink2 }]}>This month <Text style={{ fontWeight: "800", color: C.ink }}>{usd(o.ai_month)}</Text></Text>
              <Text style={[T.small, { color: C.ink2 }]}>All time <Text style={{ fontWeight: "800", color: C.ink }}>{usd(o.ai_all)}</Text></Text>
            </View>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: C.bg, overflow: "hidden" }}>
            <View style={{ width: `${Math.min(100, (Number(o.ai_today) / cap) * 100)}%`, height: 8, backgroundColor: Number(o.ai_today) >= cap ? C.owe : C.primary }} />
          </View>
          <Text style={[T.tiny, { color: C.ink3 }]}>Daily cap {usd(cap)} · AI pauses for everyone when reached</Text>
          {o.daily.length ? (
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, height: 72 }}>
                {o.daily.slice(-30).map((d) => (
                  <View key={d.day} style={{ flex: 1, height: Math.max(3, (Number(d.usd) / max) * 72), backgroundColor: C.primary, borderRadius: 3, opacity: 0.85 }}
                    accessibilityLabel={`${d.day}: ${usd(d.usd, 3)}`} />
                ))}
              </View>
              <Text style={[T.tiny, { color: C.ink3 }]}>Last 30 days · {o.daily[0].day} – {o.daily[o.daily.length - 1].day}</Text>
            </View>
          ) : null}
        </Card>
      </Section>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: S.md }}>
        <Stat icon="people-outline" label="People" value={String(o.users)} />
        <Stat icon="albums-outline" label="Circles" value={String(o.circles)} sub={o.circles_all !== o.circles ? `${o.circles_all} incl. archived` : undefined} />
        <Stat icon="receipt-outline" label="Bills" value={String(o.expenses)} />
        <Stat icon="scan-outline" label="Scans · 30d" value={String(o.scans_30d)} sub={`${o.checks_30d} bill checks`} />
        <Stat icon="sparkles-outline" label="Plus circles" value={String(plusCount)} sub={cfg.ai_paid_enabled ? "Charging for AI: on" : "Charging for AI: off (AI free for all)"} />
        <Stat icon="hourglass-outline" label="Plus requests" value={String(req.length)} sub="waiting for you" />
      </View>

      {traffic ? (
        <Section title="Where visitors come from · 30 days">
          <View style={{ flexDirection: "row", gap: S.md }}>
            <Stat icon="school-outline" label="From MacroNations" value={String(mn?.visits_30d ?? 0)} sub={`${mn?.visitors_30d ?? 0} people · ${mn?.signups_30d ?? 0} sign-ups`} />
            <Stat icon="person-add-outline" label="New Bengu users" value={String(traffic.signups_30d)} sub={`${traffic.signups_total} in total`} />
          </View>
          <Card style={{ paddingVertical: 4 }}>
            {traffic.by_source.length ? traffic.by_source.map((x, i) => (
              <Row key={x.source} title={x.source} subtitle={`${x.visitors_30d} people · ${x.signups_30d} sign-ups (30 d) · ${x.signups_all} sign-ups all time`} last={i === traffic.by_source.length - 1}
                right={<Text style={[T.body, { color: C.ink, fontWeight: "700" }]}>{x.visits_30d}</Text>} />
            )) : <Text style={[T.small, { color: C.ink3, padding: S.md }]}>No visits recorded yet. Visits are counted on the Bengu web pages (about, guide and the web app).</Text>}
          </Card>
          <Text style={[T.tiny, { color: C.ink3 }]}>Counted by Bengu itself: no IP addresses, no cookies, no outside analytics. Clicks on the Bengu button are also counted on macronations.com (its Analytics tab).</Text>
        </Section>
      ) : null}

      <Section title="Spend by feature · 30 days">
        <Card style={{ gap: 0, paddingVertical: S.sm }}>
          {o.by_function.length ? o.by_function.map((f, i) => (
            <Row key={f.fn} title={f.fn} subtitle={`${f.calls} calls`} last={i === o.by_function.length - 1}
              right={<Text style={[T.body, { color: C.ink, fontWeight: "700" }]}>{usd(f.usd)}</Text>} />
          )) : <Text style={[T.small, { color: C.ink3, padding: S.md }]}>No AI calls yet.</Text>}
        </Card>
      </Section>

      <Section title="Alerts">
        {o.ai_failed_7d ? <Banner tone="owe" text={`${o.ai_failed_7d} AI call(s) failed in the last 7 days. Latest: ${o.last_ai_error ?? "—"}`} /> : null}
        <Card style={{ gap: 0, paddingVertical: S.sm }}>
          {o.alerts.length ? o.alerts.map((a, i) => (
            <Row key={a.created_at + a.kind} last={i === o.alerts.length - 1}
              left={<Icon name={a.kind.includes("cap") ? "warning-outline" : "trending-up-outline"} size={20} color={a.kind.includes("cap") ? C.owe : C.pending} />}
              title={a.detail} subtitle={`${new Date(a.created_at).toLocaleString()}${a.circle ? " · " + a.circle : ""}${a.emailed ? " · emailed" : ""}`} />
          )) : <Text style={[T.small, { color: C.ink3, padding: S.md }]}>No alerts. You'll see one here (and by email, once Resend is set up) when spend passes {usd(cfg.alert_daily_usd ?? 1)} in a day or a cap is hit.</Text>}
        </Card>
      </Section>
    </Body>
  );
}

// ───────────────────────── Circles
function CirclesTab() {
  const { lang } = useApp();
  const { data, err, loading, reload } = useAdmin(adminCircles);
  const [edit, setEdit] = useState<AdminCircle | null>(null);
  if (!data) return err ? <View style={{ padding: S.lg }}><Banner tone="owe" text={err} /></View> : <Loading />;
  return (
    <Body loading={loading} onRefresh={reload}>
      {!data.length ? <Card><Empty icon="albums-outline" title="No circles yet" /></Card> : null}
      {data.map((c) => {
        const pct = c.cap_usd > 0 ? Math.min(100, (Number(c.spent_usd) / Number(c.cap_usd)) * 100) : 100;
        return (
          <Card key={c.id} onPress={() => setEdit(c)} style={{ gap: S.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
              <Text style={[T.h3, { color: C.ink, flex: 1 }]} numberOfLines={1}>{c.name}</Text>
              {c.status !== "active" ? <Pill text="Archived" /> : null}
              {c.wants_plus ? <Pill text="Wants Plus" tone="pending" /> : null}
              {c.ai_override !== "auto" ? <Pill text={`AI ${c.ai_override}`} tone={c.ai_override === "off" ? "owe" : "ok"} /> : null}
              <Pill text={c.plus_active ? "Plus" : "Free"} tone={c.plus_active ? "primary" : "neutral"} />
            </View>
            <Text style={[T.small, { color: C.ink3 }]}>
              {c.owner ?? "—"} · {c.members} members · {c.expenses} bills · {money(Number(c.expense_total), c.currency, lang)}{c.city ? ` · ${c.city}` : ""}
            </Text>
            <View style={{ gap: 4 }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: C.bg, overflow: "hidden" }}>
                <View style={{ width: `${pct}%`, height: 6, backgroundColor: pct >= 100 ? C.owe : pct > 75 ? C.pending : C.primary }} />
              </View>
              <Text style={[T.tiny, { color: C.ink3 }]}>AI this month {usd(c.spent_usd)} of {usd(c.cap_usd)} · auto Bill Check {c.bill_check_auto ? "on" : "off"}
                {c.plus_active && c.plus_until ? ` · Plus until ${dateLabel(c.plus_until, lang, true)}` : ""}{!c.plus_active ? ` · trial reads used ${c.ai_trial_used}` : ""}</Text>
            </View>
          </Card>
        );
      })}
      <CircleSheet circle={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </Body>
  );
}

function CircleSheet({ circle, onClose, onSaved }: { circle: AdminCircle | null; onClose: () => void; onSaved: () => void }) {
  const { lang } = useApp();
  const [ai, setAi] = useState<"auto" | "on" | "off">("auto");
  const [plan, setPlan] = useState("free");
  const [cap, setCap] = useState("2");
  const [auto, setAuto] = useState(true);
  const [status, setStatus] = useState("active");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (circle) { setAi(circle.ai_override ?? "auto"); setPlan(circle.plan); setCap(String(circle.cap_usd)); setAuto(circle.bill_check_auto); setStatus(circle.status); }
  }, [circle]);
  const save = async () => {
    if (!circle) return;
    const n = Number(cap);
    if (!isFinite(n) || n < 0 || n > 100) { notify("Monthly AI allowance must be between $0 and $100."); return; }
    setBusy(true);
    try {
      await adminUpdateCircle(circle.id, { plan, cap_usd: n, bill_check_auto: auto, status });
      if (ai !== circle.ai_override) await adminSetAi(circle.id, ai);
      onSaved();
    }
    catch (e) { notify("Couldn't save", errText(e)); } finally { setBusy(false); }
  };
  const grant = async (months: number) => {
    if (!circle) return;
    const q = months > 0 ? `Give "${circle.name}" Bengu Plus for ${months} month${months > 1 ? "s" : ""}?` : `Remove Bengu Plus from "${circle.name}"?`;
    if (!(await confirm(months > 0 ? "Grant Plus" : "Revoke Plus", q + (months > 0 ? " Time is added to any Plus it already has, and its AI allowance is raised to its region's Plus allowance." : ""), months > 0 ? "Grant" : "Revoke", "Cancel", months <= 0))) return;
    setBusy(true);
    try { await adminGrantPlus(circle.id, months, "admin console"); onSaved(); }
    catch (e) { notify("Couldn't change Plus", errText(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet visible={!!circle} onClose={onClose} title={circle?.name ?? ""}>
      <Section title="AI features for this circle">
        <Chips value={ai} onChange={setAi} options={[{ value: "auto", label: "Auto (by plan)" }, { value: "on", label: "Always on" }, { value: "off", label: "Off" }]} />
        <Text style={[T.tiny, { color: C.ink3 }]}>Off wins over everything, including Plus. Always on gives AI for free (e.g. your own family). Auto follows the plan and the free trial.</Text>
      </Section>
      <Section title="Bengu Plus">
        <Text style={[T.small, { color: C.ink2 }]}>
          {circle?.plus_active ? `Active${circle.plus_until ? ` until ${dateLabel(circle.plus_until, lang, true)}` : ""}${circle.plus_source ? ` · ${circle.plus_source}` : ""}` : `Not active · ${circle?.ai_trial_used ?? 0} trial reads used`}
          {circle?.wants_plus ? " · asked for Plus" : ""}
        </Text>
        <View style={{ flexDirection: "row", gap: S.sm, flexWrap: "wrap" }}>
          <Button small icon="add" label="1 month" onPress={() => grant(1)} />
          <Button small icon="add" label="3 months" kind="secondary" onPress={() => grant(3)} />
          <Button small icon="add" label="12 months" kind="secondary" onPress={() => grant(12)} />
          {circle?.plus_active ? <Button small kind="danger" label="Revoke" onPress={() => grant(0)} /> : null}
        </View>
      </Section>
      <Section title="Plan (manual)">
        <Chips value={plan} onChange={setPlan} options={[{ value: "free", label: "Free" }, { value: "plus", label: "Plus" }]} />
        <Text style={[T.tiny, { color: C.ink3 }]}>Prefer the buttons above: they set an end date and the allowance. Plus set here has no end date.</Text>
      </Section>
      <Field label="Monthly AI allowance (USD)" value={cap} onChangeText={setCap} keyboardType="decimal-pad"
        hint={circle ? `Used ${usd(circle.spent_usd)} this month. When it runs out, bills are entered by hand and free checks still run.` : undefined} />
      <Toggle label="Automatic Bill Check" hint="Check each new bill right after it's added (cheap read only, no web search)" value={auto} onChange={setAuto} />
      <Section title="Status">
        <Chips value={status} onChange={setStatus} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} />
      </Section>
      <Button label="Save" icon="checkmark" loading={busy} onPress={save} />
    </Sheet>
  );
}

// ───────────────────────── Plans: Plus requests + regional prices
function PlansTab({ goTab }: { goTab: (t: Tab) => void }) {
  const fn = useCallback(async () => {
    const [req, prices, cfg] = await Promise.all([adminRequests(), adminPricing(), adminConfig()]);
    return { req, prices, cfg: Object.fromEntries(cfg.map((r) => [r.key, r.value])) as Record<string, any> };
  }, []);
  const { data, err, loading, reload } = useAdmin(fn);
  const [edit, setEdit] = useState<PriceRow | null>(null);
  const [q, setQ] = useState("");
  if (!data) return err ? <View style={{ padding: S.lg }}><Banner tone="owe" text={err} /></View> : <Loading />;
  const { req, prices, cfg } = data;
  const grant = async (r: AdminRequest) => {
    const m = PERIOD_MONTHS[r.period] ?? 1;
    if (!(await confirm("Grant Plus", `Give "${r.circle}" Bengu Plus for ${m} month${m > 1 ? "s" : ""}? Do this after they have paid you.`, "Grant", "Cancel"))) return;
    try { await adminGrantPlus(r.circle_id, m, `request ${r.period} ${r.price_text ?? ""}`.trim()); reload(); } catch (e) { notify("Couldn't grant", errText(e)); }
  };
  const decline = async (r: AdminRequest) => {
    if (!(await confirm("Decline request?", `"${r.circle}" stays on the free plan.`, "Decline", "Cancel", true))) return;
    try { await adminDeclineRequest(r.id); reload(); } catch (e) { notify("Couldn't decline", errText(e)); }
  };
  const list = prices.filter((p) => !q || p.country.toLowerCase().includes(q.toLowerCase()) || p.currency.toLowerCase().includes(q.toLowerCase()));
  const tiers = ["A", "B", "C", "D"];
  return (
    <Body loading={loading} onRefresh={reload}>
      <Pressable onPress={() => goTab("settings")}>
        <Banner tone={cfg.ai_paid_enabled ? "ok" : "pending"} icon={cfg.ai_paid_enabled ? "card-outline" : "gift-outline"}
          text={cfg.ai_paid_enabled ? `Charging for AI is on. Free circles get ${cfg.free_ai_trial_scans ?? 10} trial reads.`
            : "Charging for AI is off, so every circle has AI for free. Switch it on in Settings → Features when you're ready."} />
      </Pressable>

      <Section title={`Plus requests (${req.length})`}>
        <Card style={{ gap: 0, paddingVertical: S.sm }}>
          {req.length ? req.map((r, i) => (
            <View key={r.id} style={[{ paddingVertical: S.md, gap: S.sm }, i < req.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
              <Text style={[T.body, { color: C.ink, fontWeight: "700" }]}>{r.circle}</Text>
              <Text style={[T.small, { color: C.ink3 }]}>{[r.price_text, r.by, r.email, r.country, new Date(r.created_at).toLocaleDateString()].filter(Boolean).join(" · ")}</Text>
              <View style={{ flexDirection: "row", gap: S.sm }}>
                <Button small icon="checkmark" label={`Grant ${PERIOD_MONTHS[r.period] ?? 1} mo`} onPress={() => grant(r)} />
                <Button small kind="ghost" label="Decline" onPress={() => decline(r)} />
              </View>
            </View>
          )) : <Text style={[T.small, { color: C.ink3, padding: S.md }]}>No open requests. When someone taps "Request Bengu Plus" in a circle, it shows here. Until a payment provider is connected, collect payment yourself and then grant.</Text>}
        </Card>
      </Section>

      <Section title="Regional prices (per circle)">
        <Text style={[T.tiny, { color: C.ink3 }]}>Tier A rich markets · B middle income · C India and similar · D lowest income. "*" is the price everywhere else. Allowance = fair-use AI spend per month for a Plus circle.</Text>
        <Field label="Find a country or currency" value={q} onChangeText={setQ} placeholder="IN, US, EUR…" autoCapitalize="characters" />
        {tiers.map((tier) => {
          const rows = list.filter((p) => p.tier === tier);
          if (!rows.length) return null;
          return (
            <Card key={tier} style={{ gap: 0, paddingVertical: S.sm }}>
              <Text style={[T.small, { color: C.ink2, fontWeight: "800", paddingBottom: 4 }]}>Tier {tier} · {rows.length}</Text>
              {rows.map((p, i) => (
                <Row key={p.country} last={i === rows.length - 1} onPress={() => setEdit({ ...p })}
                  title={`${p.country === "*" ? "* everywhere else" : p.country} · ${p.currency}`}
                  subtitle={`${p.monthly} / month · ${p.yearly} / year · ${p.pass90} / 90 days`}
                  right={<Text style={[T.tiny, { color: C.ink3 }]}>{usd(p.ai_allowance_usd)} AI</Text>} />
              ))}
            </Card>
          );
        })}
        <Button kind="secondary" icon="add" label="Add a country" onPress={() => setEdit({ country: "", tier: "B", currency: "USD", monthly: 2.49, yearly: 17.99, pass90: 5.99, ai_allowance_usd: 3 })} />
      </Section>
      <PriceSheet row={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </Body>
  );
}

function PriceSheet({ row, onClose, onSaved }: { row: PriceRow | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (row) setF(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v ?? "")]))); }, [row]);
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const save = async () => {
    const r: PriceRow = { country: (f.country || "").trim().toUpperCase(), tier: (f.tier || "B").toUpperCase(), currency: (f.currency || "").trim().toUpperCase(),
      monthly: Number(f.monthly), yearly: Number(f.yearly), pass90: Number(f.pass90), ai_allowance_usd: Number(f.ai_allowance_usd) };
    if (!/^([A-Z]{2}|\*)$/.test(r.country) || !/^[A-Z]{3}$/.test(r.currency)) { notify("Use a 2-letter country code (or *) and a 3-letter currency code."); return; }
    if ([r.monthly, r.yearly, r.pass90, r.ai_allowance_usd].some((n) => !isFinite(n) || n < 0)) { notify("Prices must be numbers of 0 or more."); return; }
    setBusy(true);
    try { await adminSetPrice(r); onSaved(); } catch (e) { notify("Couldn't save", errText(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet visible={!!row} onClose={onClose} title={row?.country ? `Price · ${row.country}` : "New country price"}>
      <View style={{ flexDirection: "row", gap: S.md }}>
        <View style={{ flex: 1 }}><Field label="Country" value={f.country ?? ""} onChangeText={(v) => set("country", v)} autoCapitalize="characters" maxLength={2} editable={!row?.country} /></View>
        <View style={{ flex: 1 }}><Field label="Currency" value={f.currency ?? ""} onChangeText={(v) => set("currency", v)} autoCapitalize="characters" maxLength={3} /></View>
      </View>
      <Section title="Tier">
        <Chips value={(f.tier as any) ?? "B"} onChange={(v) => set("tier", v)} options={["A", "B", "C", "D"].map((x) => ({ value: x, label: x }))} />
      </Section>
      <View style={{ flexDirection: "row", gap: S.md }}>
        <View style={{ flex: 1 }}><Field label="Monthly" value={f.monthly ?? ""} onChangeText={(v) => set("monthly", v)} keyboardType="decimal-pad" /></View>
        <View style={{ flex: 1 }}><Field label="Yearly" value={f.yearly ?? ""} onChangeText={(v) => set("yearly", v)} keyboardType="decimal-pad" /></View>
      </View>
      <View style={{ flexDirection: "row", gap: S.md }}>
        <View style={{ flex: 1 }}><Field label="90-day pass" value={f.pass90 ?? ""} onChangeText={(v) => set("pass90", v)} keyboardType="decimal-pad" /></View>
        <View style={{ flex: 1 }}><Field label="AI allowance (USD/mo)" value={f.ai_allowance_usd ?? ""} onChangeText={(v) => set("ai_allowance_usd", v)} keyboardType="decimal-pad" /></View>
      </View>
      <Text style={[T.tiny, { color: C.ink3 }]}>New prices show to people right away. Circles already on Plus keep what they have.</Text>
      <Button label="Save price" icon="checkmark" loading={busy} onPress={save} />
    </Sheet>
  );
}

// ───────────────────────── People
function PeopleTab() {
  const { session } = useApp();
  const { data, err, loading, reload } = useAdmin(adminUsers);
  const [q, setQ] = useState("");
  const list = useMemo(() => (data ?? []).filter((u) => !q || `${u.full_name} ${u.email ?? ""}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  if (!data) return err ? <View style={{ padding: S.lg }}><Banner tone="owe" text={err} /></View> : <Loading />;
  const toggle = async (u: AdminUser) => {
    const on = !u.is_admin;
    if (!(await confirm(on ? "Make admin?" : "Remove admin?", on ? `${u.full_name} will be able to see every circle and change all app settings.` : `${u.full_name} will lose access to the admin console.`, on ? "Make admin" : "Remove", "Cancel", !on))) return;
    try { await adminSetAdmin(u.id, on); reload(); } catch (e) { notify("Couldn't change", errText(e)); }
  };
  return (
    <Body loading={loading} onRefresh={reload}>
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Name or email" autoCapitalize="none" />
      <Card style={{ gap: 0, paddingVertical: S.sm }}>
        {list.map((u, i) => (
          <Row key={u.id} last={i === list.length - 1} left={<Avatar name={u.full_name || u.email || "?"} tone={hashTone(u.id)} />}
            title={u.full_name || u.email || "—"}
            subtitle={[u.email, `${u.circles} circle${u.circles === 1 ? "" : "s"}`, u.last_sign_in_at ? `last in ${new Date(u.last_sign_in_at).toLocaleDateString()}` : "never signed in", Number(u.ai_30d) > 0 ? `AI ${usd(u.ai_30d)} / 30d` : null].filter(Boolean).join(" · ")}
            right={u.is_admin ? <Pill text="Admin" tone="primary" /> : undefined}
            onPress={u.id === session?.user.id ? undefined : () => toggle(u)} />
        ))}
      </Card>
      <Text style={[T.tiny, { color: C.ink3, textAlign: "center" }]}>Tap a person to make them an admin or remove admin access.</Text>
    </Body>
  );
}

// ───────────────────────── Settings
type Meta = { label: string; hint?: string; kind: "bool" | "number" | "text" | "choice"; choices?: string[]; group: "features" | "limits" | "alerts" | "advanced" };
const META: Record<string, Meta> = {
  scan_enabled:          { group: "features", kind: "bool", label: "AI bill reading", hint: "Off: people type bills in by hand" },
  bill_check_ai_enabled: { group: "features", kind: "bool", label: "AI in Bill Check", hint: "Off: only the free rule checks run" },
  price_web_enabled:     { group: "features", kind: "bool", label: "Web price search", hint: "Compares top items with online prices (costs more)" },
  ai_paid_enabled:       { group: "features", kind: "bool", label: "Charge for AI (Bengu Plus)", hint: "Off: AI is free for every circle. On: circles without Plus get the free trial, then manual entry" },
  free_ai_trial_scans:   { group: "limits", kind: "number", label: "Free AI reads per circle (trial)", hint: "Used only when charging for AI is on" },
  daily_cap_usd:         { group: "limits", kind: "number", label: "Daily AI cap, whole app (USD)" },
  scan_per_user_day:     { group: "limits", kind: "number", label: "Scans per person per day" },
  checks_per_circle_day: { group: "limits", kind: "number", label: "Bill checks per circle per day" },
  ai_calls_per_user_hour:{ group: "limits", kind: "number", label: "AI calls per person per hour" },
  max_file_mb:           { group: "limits", kind: "number", label: "Largest file (MB)" },
  max_pdf_pages:         { group: "limits", kind: "number", label: "Most PDF pages" },
  alert_daily_usd:       { group: "alerts", kind: "number", label: "Alert when a day's spend passes (USD)" },
  alert_email:           { group: "alerts", kind: "text", label: "Alert email" },
  escalate_amount:       { group: "advanced", kind: "number", label: "Careful re-read for bills from (amount)", hint: "Bill Check uses the stronger model at or above this" },
  haiku_handwritten:     { group: "advanced", kind: "choice", choices: ["escalate", "high_conf"], label: "Handwritten bills", hint: "escalate = always double-check amounts with the stronger model" },
  haiku_indic:           { group: "advanced", kind: "choice", choices: ["escalate", "high_conf"], label: "Bills in Indian scripts" },
  effort_verify:         { group: "advanced", kind: "choice", choices: ["low", "medium", "high"], label: "Double-check effort" },
  price_min_amount:      { group: "advanced", kind: "number", label: "Price-check items from (amount)" },
  price_top_items:       { group: "advanced", kind: "number", label: "Items price-checked per bill" },
  image_long_edge:       { group: "advanced", kind: "number", label: "Photo size sent to AI (px)" },
  server_resize:         { group: "advanced", kind: "bool", label: "Resize photos on the server", hint: "Leave off; the app resizes photos" },
};
const GROUPS: { id: Meta["group"]; title: string }[] = [
  { id: "features", title: "Features" }, { id: "limits", title: "Limits" }, { id: "alerts", title: "Alerts" }, { id: "advanced", title: "Advanced (AI)" },
];

function SettingsTab() {
  const { data, err, loading, reload } = useAdmin(adminConfig);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setDraft(Object.fromEntries(data.map((r) => [r.key, typeof r.value === "number" ? String(r.value) : r.value]))); }, [data]);
  if (!data) return err ? <View style={{ padding: S.lg }}><Banner tone="owe" text={err} /></View> : <Loading />;
  const byKey = Object.fromEntries(data.map((r) => [r.key, r])) as Record<string, ConfigRow>;
  const changed = data.filter((r) => {
    const d = draft[r.key];
    return typeof r.value === "number" ? Number(d) !== r.value : d !== r.value;
  });
  const save = async () => {
    for (const r of changed) {
      if (typeof r.value === "number" && (!isFinite(Number(draft[r.key])) || Number(draft[r.key]) < 0)) {
        notify(`"${META[r.key]?.label ?? r.key}" must be a number`); return;
      }
    }
    const paidOn = changed.find((r) => r.key === "ai_paid_enabled" && draft[r.key] === true);
    if (paidOn && !(await confirm("Start charging for AI?", "Circles without Bengu Plus will get the free trial reads, then must enter bills by hand. Give your own circles Plus or set their AI to \"Always on\" first (Circles tab).", "Start charging", "Cancel"))) return;
    setBusy(true);
    try {
      for (const r of changed) await adminSetConfig(r.key, typeof r.value === "number" ? Number(draft[r.key]) : draft[r.key]);
      await reload(); notify("Saved", "Changes apply to the next bill read or check.");
    } catch (e) { notify("Couldn't save", errText(e)); } finally { setBusy(false); }
  };
  const known = new Set([...Object.keys(META), "bill_check_paid", "effort_haiku", "effort_sonnet"]);
  return (
    <View style={{ flex: 1 }}>
      <Body loading={loading} onRefresh={reload}>
        {GROUPS.map((g) => (
          <Section key={g.id} title={g.title}>
            <Card style={{ gap: S.md }}>
              {Object.entries(META).filter(([k, m]) => m.group === g.id && byKey[k]).map(([k, m]) =>
                m.kind === "bool" ? <Toggle key={k} label={m.label} hint={m.hint} value={!!draft[k]} onChange={(v) => setDraft({ ...draft, [k]: v })} />
                : m.kind === "choice" ? (
                  <View key={k} style={{ gap: 6 }}>
                    <Text style={[T.small, { color: C.ink2, fontWeight: "600" }]}>{m.label}</Text>
                    <Chips value={draft[k]} onChange={(v) => setDraft({ ...draft, [k]: v })} options={(m.choices ?? []).map((c) => ({ value: c, label: c.replace("_", " ") }))} />
                    {m.hint ? <Text style={[T.tiny, { color: C.ink3 }]}>{m.hint}</Text> : null}
                  </View>
                ) : (
                  <Field key={k} label={m.label} hint={m.hint} value={String(draft[k] ?? "")} onChangeText={(v) => setDraft({ ...draft, [k]: v })}
                    keyboardType={m.kind === "number" ? "decimal-pad" : "email-address"} autoCapitalize="none" />
                ))}
            </Card>
          </Section>
        ))}
        {data.some((r) => !known.has(r.key)) ? (
          <Text style={[T.tiny, { color: C.ink3 }]}>Other settings: {data.filter((r) => !known.has(r.key)).map((r) => `${r.key} = ${JSON.stringify(r.value)}`).join(" · ")}</Text>
        ) : null}
        <Text style={[T.tiny, { color: C.ink3 }]}>Per-circle allowances are set in the Circles tab. Secrets (API keys) stay in Supabase and are never shown here.</Text>
        <View style={{ height: 70 }} />
      </Body>
      {changed.length ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: S.lg, backgroundColor: "rgba(244,246,250,0.97)", borderTopWidth: 1, borderTopColor: C.line }}>
          <Button label={`Save ${changed.length} change${changed.length > 1 ? "s" : ""}`} icon="checkmark" loading={busy} onPress={save} />
        </View>
      ) : null}
    </View>
  );
}

