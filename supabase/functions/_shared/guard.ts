// Spend guardrails for Saath AI calls: global daily cap, per-circle monthly cap, daily and hourly limits,
// and a once-a-day spend alert. Settings live in public.saath_ai_config (service role only).

const DEFAULTS: Record<string, any> = {
  daily_cap_usd: 5, alert_daily_usd: 1, alert_email: "",
  scan_per_user_day: 30, checks_per_circle_day: 40, ai_calls_per_user_hour: 20,
  escalate_amount: 10000, haiku_handwritten: "escalate", haiku_indic: "escalate",
  price_min_amount: 500, price_top_items: 3, image_long_edge: 1600, max_file_mb: 15, max_pdf_pages: 40, server_resize: false,
  scan_enabled: true, bill_check_ai_enabled: true, price_web_enabled: true, bill_check_paid: false,
};

export async function loadConfig(admin: any): Promise<Record<string, any>> {
  const { data } = await admin.from("saath_ai_config").select("key, value");
  const c = { ...DEFAULTS };
  for (const r of data ?? []) c[r.key] = r.value;
  return c;
}

export type Allowance = { cap_usd: number; spent_usd: number; remaining_usd: number };

export async function allowance(admin: any, circleId: string): Promise<Allowance> {
  const { data } = await admin.rpc("saath_ai_allowance", { p_circle: circleId });
  return {
    cap_usd: Number(data?.cap_usd ?? 2), spent_usd: Number(data?.spent_usd ?? 0),
    remaining_usd: Number(data?.remaining_usd ?? 0),
  };
}

export type GuardResult = { ok: boolean; allowance: Allowance; status?: number; error?: string; message?: string };

/** Run before any AI call. kind decides which daily limit applies. */
export async function guard(admin: any, cfg: Record<string, any>, o: { circleId: string; userId: string | null; kind: "scan" | "check" }): Promise<GuardResult> {
  const a = await allowance(admin, o.circleId);
  const no = (status: number, error: string, message: string): GuardResult => ({ ok: false, status, error, message, allowance: a });

  // feature switches set by the app admin (admin console → Features)
  if (o.kind === "scan" && cfg.scan_enabled === false)
    return no(503, "scan_off", "Bill reading is switched off for now. Please enter the bill by hand.");
  if (o.kind === "check" && cfg.bill_check_ai_enabled === false)
    return no(503, "ai_off", "The AI part of Bill Check is switched off for now; the basic checks still ran.");

  const { data: day } = await admin.rpc("saath_ai_day_cost");
  if (Number(day ?? 0) >= Number(cfg.daily_cap_usd)) {
    await alert(admin, cfg, "daily_cap_hit", null, Number(day), `Global daily AI cap of $${cfg.daily_cap_usd} reached; AI paused until 00:00 UTC.`);
    return no(503, "ai_paused", "Bill reading is paused for today because the app's daily AI limit was reached. Please try again tomorrow or enter the bill by hand.");
  }
  if (a.remaining_usd <= 0) {
    await alert(admin, cfg, "circle_cap_hit", o.circleId, a.spent_usd, `Circle reached its monthly AI allowance of $${a.cap_usd}.`);
    return no(429, "ai_limit_reached", `This circle has used its AI allowance for this month ($${a.cap_usd.toFixed(2)}). Bills can still be added by hand; reading resumes next month.`);
  }
  if (o.userId) {
    const hour = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from("saath_ai_usage").select("id", { count: "exact", head: true }).eq("user_id", o.userId).gte("created_at", hour);
    if ((count ?? 0) >= Number(cfg.ai_calls_per_user_hour)) return no(429, "too_many_requests", "Too many bills read in the last hour. Please wait a little and try again.");
  }
  const since = new Date(Date.now() - 864e5).toISOString();
  if (o.kind === "scan" && o.userId) {
    const { count } = await admin.from("saath_scans").select("id", { count: "exact", head: true }).eq("user_id", o.userId).gte("created_at", since);
    if ((count ?? 0) >= Number(cfg.scan_per_user_day)) return no(429, "scan_limit", `You can read up to ${cfg.scan_per_user_day} bills a day. Please try again tomorrow.`);
  }
  if (o.kind === "check") {
    const { count } = await admin.from("saath_bill_checks").select("expense_id", { count: "exact", head: true }).eq("circle_id", o.circleId).gte("checked_at", since);
    if ((count ?? 0) >= Number(cfg.checks_per_circle_day)) return no(429, "scan_limit", `This circle can check up to ${cfg.checks_per_circle_day} bills a day. Please try again tomorrow.`);
  }
  return { ok: true, allowance: a };
}

/** After AI calls: alert once per UTC day when spend passes the threshold. Never throws. */
export async function afterCalls(admin: any, cfg: Record<string, any>) {
  try {
    const { data: day } = await admin.rpc("saath_ai_day_cost");
    if (Number(day ?? 0) >= Number(cfg.alert_daily_usd))
      await alert(admin, cfg, "daily_spend", null, Number(day), `Saath AI spend today (UTC) has passed $${cfg.alert_daily_usd}: now $${Number(day).toFixed(4)}.`);
  } catch (_) { /* never block */ }
}

async function alert(admin: any, cfg: Record<string, any>, kind: string, circleId: string | null, usd: number, detail: string) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    let q = admin.from("saath_ai_alerts").select("id").eq("kind", kind).eq("day", day);
    q = circleId ? q.eq("circle_id", circleId) : q.is("circle_id", null);
    const { data: seen } = await q.maybeSingle();
    if (seen) return;
    const { data: row } = await admin.from("saath_ai_alerts").insert({ kind, day, circle_id: circleId, usd, detail }).select("id").single();
    const to = String(cfg.alert_email ?? "").trim(), key = Deno.env.get("RESEND_API_KEY");
    if (row && to && key) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: Deno.env.get("SAATH_EMAIL_FROM") ?? "Saath <onboarding@resend.dev>", to: [to],
          subject: `Saath AI alert: ${kind.replace(/_/g, " ")}`,
          text: `${detail}\n\nSee table saath_ai_alerts and view saath_ai_v_daily in Supabase (project strategyarena).`,
        }),
      });
      if (r.ok) await admin.from("saath_ai_alerts").update({ emailed: true }).eq("id", row.id);
    }
  } catch (_) { /* never block */ }
}
