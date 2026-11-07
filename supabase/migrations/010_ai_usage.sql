-- STEP 1 (measure only): one row per Anthropic API call made by Saath edge functions.
-- Service role only: RLS on, no policies, no grants to app roles.

create table if not exists public.saath_ai_usage (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  function text not null,                -- 'saath-scan', 'saath-check:audit', 'saath-check:price', … (':test' suffix = owner self-test)
  user_id uuid,                          -- who triggered it (null for owner/scheduler runs)
  circle_id uuid,
  model text not null,
  input_tokens int not null default 0,   -- uncached input
  output_tokens int not null default 0,  -- includes thinking tokens
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  web_searches int not null default 0,
  cost_micro_usd bigint not null default 0,   -- 1 USD = 1,000,000
  latency_ms int,
  ok boolean not null default true,
  note text                               -- error text, stop_reason, 'unpriced model', …
);
create index if not exists saath_ai_usage_circle_time on public.saath_ai_usage (circle_id, created_at);
create index if not exists saath_ai_usage_time on public.saath_ai_usage (created_at);
alter table public.saath_ai_usage enable row level security;
revoke all on public.saath_ai_usage from anon, authenticated;
revoke all on sequence public.saath_ai_usage_id_seq from anon, authenticated;

-- Daily roll-up. security_invoker so the view obeys the table's RLS (app roles see nothing).
create or replace view public.saath_ai_v_daily with (security_invoker = true) as
select (created_at at time zone 'UTC')::date as day,
       function, model,
       count(*)                                  as calls,
       count(*) filter (where not ok)            as failed,
       sum(input_tokens)                         as input_tokens,
       sum(output_tokens)                        as output_tokens,
       sum(cache_read_tokens)                    as cache_read_tokens,
       sum(cache_write_tokens)                   as cache_write_tokens,
       sum(web_searches)                         as web_searches,
       round(sum(cost_micro_usd) / 1e6, 4)       as usd,
       round(avg(latency_ms))                    as avg_latency_ms
  from public.saath_ai_usage
 group by 1, 2, 3;
revoke all on public.saath_ai_v_daily from anon, authenticated;

-- Spend for one circle in the current calendar month (UTC), in USD. Used for caps in step 4.
create or replace function public.saath_ai_month_cost(p_circle uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(round(sum(cost_micro_usd) / 1e6, 6), 0)
    from public.saath_ai_usage
   where circle_id = p_circle
     and created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
$$;
revoke all on function public.saath_ai_month_cost(uuid) from public, anon, authenticated;
