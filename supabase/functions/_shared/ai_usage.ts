// Records every Anthropic call Bengu makes into public.saath_ai_usage, with cost.
// Prices: USD per million tokens, from platform.claude.com/docs/en/about-claude/pricing (checked 6 Nov 2026).
// Haiku 5.5 is tiered: a request whose whole prompt (input + cache reads + cache writes) is over 100,000 tokens
// pays the higher row for ALL of its tokens. Web search: $10 per 1,000 searches.
// Note: USD per million tokens == micro-USD per token, so cost_micro_usd = Σ tokens × price.

type Rates = { in: number; w5: number; w1h: number; read: number; out: number };
const PRICES: Record<string, { base: Rates; over100k?: Rates }> = {
  "claude-haiku-5-5": {
    base: { in: 0.10, w5: 0.125, w1h: 0.20, read: 0.01, out: 0.50 },
    over100k: { in: 0.50, w5: 0.625, w1h: 1.00, read: 0.05, out: 2.50 },
  },
  "claude-sonnet-5-5": { base: { in: 2, w5: 2.50, w1h: 4, read: 0.10, out: 10 } },
  // Opus 5.5: $4 in / $20 out; cache read 5% of input; writes at the standard 1.25× / 2× multipliers
  "claude-opus-5-5": { base: { in: 4, w5: 5, w1h: 8, read: 0.20, out: 20 } },
};
const WEB_SEARCH_MICRO_USD = 10_000; // $10 / 1000 searches

export function costOf(model: string, usage: any): { micro: number; priced: boolean } {
  const p = PRICES[model];
  const u = usage ?? {};
  const inp = u.input_tokens ?? 0, out = u.output_tokens ?? 0, read = u.cache_read_input_tokens ?? 0;
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5 = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h);
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  const r = p ? (p.over100k && inp + read + w5 + w1h > 100_000 ? p.over100k : p.base) : PRICES["claude-sonnet-5-5"].base;
  const micro = inp * r.in + w5 * r.w5 + w1h * r.w1h + read * r.read + out * r.out + searches * WEB_SEARCH_MICRO_USD;
  return { micro: Math.round(micro), priced: !!p };
}

export type UsageCtx = { admin: any; fn: string; userId?: string | null; circleId?: string | null };

/** POST to the Messages API and log the call (success or failure). Returns { r, out } like a plain fetch. */
export async function anthropic(ctx: UsageCtx, key: string, body: Record<string, any>) {
  const t0 = Date.now();
  let r: Response | null = null, out: any = null, err = "";
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    out = await r.json().catch(() => ({}));
    if (!r.ok) err = out?.error?.message ?? `http_${r.status}`;
  } catch (e) {
    err = String((e as Error)?.message ?? e);
  }
  const u = out?.usage ?? {};
  const { micro, priced } = costOf(body.model, u);
  const note = [err, out?.stop_reason ? `stop=${out.stop_reason}` : "", priced ? "" : "unpriced model (Sonnet rates used)"].filter(Boolean).join("; ");
  try {
    await ctx.admin.from("saath_ai_usage").insert({
      function: ctx.fn, user_id: ctx.userId ?? null, circle_id: ctx.circleId ?? null, model: body.model,
      input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0,
      cache_read_tokens: u.cache_read_input_tokens ?? 0, cache_write_tokens: u.cache_creation_input_tokens ?? 0,
      web_searches: u.server_tool_use?.web_search_requests ?? 0,
      cost_micro_usd: micro, latency_ms: Date.now() - t0, ok: !err, note: note.slice(0, 500) || null,
    });
  } catch (_) { /* logging must never break the user's request */ }
  if (!r) throw new Error(err || "network_error");
  return { r, out };
}
