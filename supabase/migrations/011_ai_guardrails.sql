-- STEP 4 guardrails (+ settings used by the step 3 pipeline). Additive only.

-- Per-circle monthly AI allowance in USD (default $2), editable per circle by the owner via SQL.
alter table public.saath_circles add column if not exists ai_monthly_cap_usd numeric not null default 2;

-- Tunable settings, read by the edge functions (service role only). Change a value with:
--   update saath_ai_config set value = '20' where key = 'daily_cap_usd';
create table if not exists public.saath_ai_config (
  key text primary key,
  value jsonb not null,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.saath_ai_config enable row level security;
revoke all on public.saath_ai_config from anon, authenticated;
insert into public.saath_ai_config (key, value, note) values
  ('daily_cap_usd',          '5',       'Global: stop all AI calls for the rest of the UTC day once spend reaches this'),
  ('alert_daily_usd',        '1',       'Global: write an alert (and email) the first time a UTC day''s spend passes this'),
  ('alert_email',            '"sharmaaa9@yahoo.com"', 'Where spend alerts are emailed (via Resend); empty = table only'),
  ('scan_per_user_day',      '30',      'Scans per user per 24h'),
  ('checks_per_circle_day',  '40',      'Bill checks per circle per 24h'),
  ('ai_calls_per_user_hour', '20',      'Burst limit: AI calls (incl. escalations) per user per hour'),
  ('escalate_amount',        '10000',   'Audit: bills at/above this amount (circle currency) are read by Sonnet'),
  ('haiku_handwritten',      '"escalate"', 'escalate = always re-read handwritten bills with Sonnet; high_conf = keep Haiku if it is confident'),
  ('haiku_indic',            '"escalate"', 'Same, for bills in Indian scripts (Devanagari, Bengali, …)'),
  ('price_min_amount',       '500',     'Web price check only for line items at/above this amount'),
  ('price_top_items',        '3',       'Web price check: at most this many items per bill'),
  ('image_long_edge',        '1600',    'Photos are downscaled to this long edge before sending'),
  ('max_file_mb',            '15',      'Reject uploads larger than this'),
  ('max_pdf_pages',          '40',      'Reject PDFs with more pages than this (ask the user to split or pick pages)')
on conflict (key) do nothing;

-- Alerts the owner can see (and that were emailed, if configured)
create table if not exists public.saath_ai_alerts (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null,                 -- 'daily_spend', 'daily_cap_hit', 'circle_cap_hit'
  day date not null default (now() at time zone 'UTC')::date,
  circle_id uuid,
  usd numeric,
  detail text,
  emailed boolean not null default false,
  unique (kind, day, circle_id)
);
alter table public.saath_ai_alerts enable row level security;
revoke all on public.saath_ai_alerts from anon, authenticated;

-- Spend so far today (UTC), all circles
create or replace function public.saath_ai_day_cost()
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(round(sum(cost_micro_usd) / 1e6, 6), 0) from public.saath_ai_usage
   where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
$$;
revoke all on function public.saath_ai_day_cost() from public, anon, authenticated;

-- A circle's allowance for this month
create or replace function public.saath_ai_allowance(p_circle uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'cap_usd', c.ai_monthly_cap_usd,
    'spent_usd', public.saath_ai_month_cost(p_circle),
    'remaining_usd', greatest(0, c.ai_monthly_cap_usd - public.saath_ai_month_cost(p_circle)))
  from public.saath_circles c where c.id = p_circle;
$$;
revoke all on function public.saath_ai_allowance(uuid) from public, anon, authenticated;
