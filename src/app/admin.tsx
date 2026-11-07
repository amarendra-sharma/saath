// App admin console (owner only). English-only on purpose: it is a tool for the people who run Saath.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { Avatar, Banner, Button, Card, Chips, Empty, Field, Icon, Loading, Pill, Row, Screen, Section, Segmented, Sheet, Toggle, hashTone } from "../components/ui";
import {
  AdminCircle, AdminOverview, AdminUser, ConfigRow, adminCircles, adminConfig, adminOverview, adminSetAdmin, adminSetConfig,
  adminUpdateCircle, adminUsers, usd,
} from "../lib/admin";
import { confirm, notify, useApp } from "../lib/app";
import { money } from "../lib/format";
import { errText } from "../lib/supabase";
import { C, R, S, T } from "../lib/theme";

type Tab = "overview" | "circles" | "people" | "settings";

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
    <Screen title="Admin console" subtitle="Saath · run the app" scroll={false} padded={false}>
      <View style={{ paddingHorizontal: S.lg, paddingBottom: S.sm }}>
        <Segmented value={tab} onChange={setTab} options={[
          { value: "overview", label: "Overview" }, { value: "circles", label: "Circles" },
          { value: "people", label: "People" }, { value: "settings", label: "Settings" },
        ]} />
      </View>
      {tab === "overview" ? <OverviewTab /> : tab === "circles" ? <CirclesTab /> : tab === "people" ? <PeopleTab /> : <SettingsTab />}
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

function OverviewTab() {
  const fn = useCallback(async () => {
    const [o, cfg] = await Promise.all([adminOverview(), adminConfig()]);
    return { o, cfg: Object.fromEntries(cfg.map((r) => [r.key, r.value])) as Record<string, any> };
  }, []);
  const { data, err, loading, reload } = useAdmin(fn);
  if (!data) return err ? <View style={{ padding: S.lg }}><Banner tone="owe" text={err} /></View> : <Loading />;
  const { o, cfg } = data;
  const cap = Number(cfg.daily_cap_usd ?? 5);
  const max = Math.max(0.01, ...o.daily.map((d) => Number(d.usd)));
  const credit = /credit balance is too low/i.test(o.last_ai_error ?? "");
  return (
    <Body loading={loading} onRefresh={reload}>
      {credit ? <Banner tone="owe" icon="card-outline" text="Anthropic credit has run out, so bill reading is failing. Add credit at console.anthropic.com → Billing." /> : null}
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
      </View>

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
              <Pill text={c.plan === "plus" ? "Plus" : "Free"} tone={c.plan === "plus" ? "primary" : "neutral"} />
            </View>
            <Text style={[T.small, { color: C.ink3 }]}>
              {c.owner ?? "—"} · {c.members} members · {c.expenses} bills · {money(Number(c.expense_total), c.currency, lang)}{c.city ? ` · ${c.city}` : ""}
            </Text>
            <View style={{ gap: 4 }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: C.bg, overflow: "hidden" }}>
                <View style={{ width: `${pct}%`, height: 6, backgroundColor: pct >= 100 ? C.owe : pct > 75 ? C.pending : C.primary }} />
              </View>
              <Text style={[T.tiny, { color: C.ink3 }]}>AI this month {usd(c.spent_usd)} of {usd(c.cap_usd)} · auto Bill Check {c.bill_check_auto ? "on" : "off"}</Text>
            </View>
          </Card>
        );
      })}
      <CircleSheet circle={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </Body>
  );
}

function CircleSheet({ circle, onClose, onSaved }: { circle: AdminCircle | null; onClose: () => void; onSaved: () => void }) {
  const [plan, setPlan] = useState("free");
  const [cap, setCap] = useState("2");
  const [auto, setAuto] = useState(true);
  const [status, setStatus] = useState("active");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (circle) { setPlan(circle.plan); setCap(String(circle.cap_usd)); setAuto(circle.bill_check_auto); setStatus(circle.status); }
  }, [circle]);
  const save = async () => {
    if (!circle) return;
    const n = Number(cap);
    if (!isFinite(n) || n < 0 || n > 100) { notify("Monthly AI allowance must be between $0 and $100."); return; }
    setBusy(true);
    try { await adminUpdateCircle(circle.id, { plan, cap_usd: n, bill_check_auto: auto, status }); onSaved(); }
    catch (e) { notify("Couldn't save", errText(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet visible={!!circle} onClose={onClose} title={circle?.name ?? ""}>
      <Section title="Plan">
        <Chips value={plan} onChange={setPlan} options={[{ value: "free", label: "Free" }, { value: "plus", label: "Plus" }]} />
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
  bill_check_paid:       { group: "features", kind: "bool", label: "Bill Check only on Plus", hint: "Free circles won't see Bill Check" },
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
    setBusy(true);
    try {
      for (const r of changed) await adminSetConfig(r.key, typeof r.value === "number" ? Number(draft[r.key]) : draft[r.key]);
      await reload(); notify("Saved", "Changes apply to the next bill read or check.");
    } catch (e) { notify("Couldn't save", errText(e)); } finally { setBusy(false); }
  };
  const known = new Set(Object.keys(META));
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

