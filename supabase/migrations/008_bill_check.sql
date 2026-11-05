-- Bill Check: anomaly / overbilling warnings on bills.
-- * saath_doc_audits  : one forensic read per uploaded file (cached; a bundle PDF is read once)
-- * saath_bill_checks : latest check result per bill (flags, line items, price benchmarks, risk level)
-- * saath_price_obs   : anonymous line-item price observations (no user, no circle) → local market medians
-- * circles get a city/country (for local prices), a plan (for a future paid tier) and an auto-check switch.

alter table public.saath_circles
  add column if not exists city text,
  add column if not exists country text default 'IN',
  add column if not exists plan text not null default 'free' check (plan in ('free', 'plus')),
  add column if not exists bill_check_auto boolean not null default true;

create table if not exists public.saath_doc_audits (
  path text primary key,
  circle_id uuid not null references public.saath_circles(id) on delete cascade,
  model text,
  result jsonb not null,
  input_tokens int, output_tokens int,
  created_at timestamptz not null default now()
);
alter table public.saath_doc_audits enable row level security;
-- no client policies: written and read only by the saath-check function

create table if not exists public.saath_bill_checks (
  expense_id uuid primary key references public.saath_expenses(id) on delete cascade,
  circle_id uuid not null references public.saath_circles(id) on delete cascade,
  status text not null default 'done' check (status in ('running', 'done', 'failed')),
  risk text not null default 'none' check (risk in ('none', 'low', 'medium', 'high')),
  score int not null default 0,
  flags jsonb not null default '[]'::jsonb,
  items jsonb not null default '[]'::jsonb,
  benchmarks jsonb not null default '[]'::jsonb,
  summary text,
  had_file boolean not null default false,
  dismissed jsonb not null default '[]'::jsonb,   -- flag codes a member marked "checked, it's fine"
  model text, searches int default 0,
  checked_by uuid, checked_at timestamptz not null default now()
);
create index if not exists saath_bill_checks_circle on public.saath_bill_checks(circle_id);
alter table public.saath_bill_checks enable row level security;
drop policy if exists saath_bill_checks_read on public.saath_bill_checks;
create policy saath_bill_checks_read on public.saath_bill_checks for select to authenticated
  using (public.saath_is_member(circle_id));

create table if not exists public.saath_price_obs (
  id bigserial primary key,
  item_key text not null,           -- normalised name, e.g. "pantoprazole 40mg tab"
  item_name text not null,
  unit text,
  unit_price numeric not null check (unit_price > 0),
  mrp numeric,
  currency text not null default 'INR',
  city text, country text,
  vendor_kind text,                 -- pharmacy / hospital / lab / imaging / ...
  observed_on date,
  source_path_hash text,            -- sha256 of the file path, only to avoid counting one bill twice
  created_at timestamptz not null default now(),
  unique (source_path_hash, item_key, unit_price)
);
create index if not exists saath_price_obs_key on public.saath_price_obs(item_key, country, city);
alter table public.saath_price_obs enable row level security;
-- no client policies: anonymous aggregate data, read through saath_price_stats only

-- median & spread of what people in the same city / country paid for an item
create or replace function public.saath_price_stats(p_keys text[], p_city text, p_country text)
returns table (item_key text, scope text, n bigint, median numeric, p25 numeric, p75 numeric)
language sql stable security definer set search_path = '' as $$
  select o.item_key, 'city', count(*),
         percentile_cont(0.5) within group (order by o.unit_price)::numeric,
         percentile_cont(0.25) within group (order by o.unit_price)::numeric,
         percentile_cont(0.75) within group (order by o.unit_price)::numeric
    from public.saath_price_obs o
   where o.item_key = any(p_keys) and p_city is not null and lower(o.city) = lower(p_city)
   group by o.item_key
  union all
  select o.item_key, 'country', count(*),
         percentile_cont(0.5) within group (order by o.unit_price)::numeric,
         percentile_cont(0.25) within group (order by o.unit_price)::numeric,
         percentile_cont(0.75) within group (order by o.unit_price)::numeric
    from public.saath_price_obs o
   where o.item_key = any(p_keys) and o.country = p_country
   group by o.item_key;
$$;
revoke all on function public.saath_price_stats(text[], text, text) from public, anon, authenticated;

-- members can mark a warning as checked (kept with the bill, shown to everyone)
create or replace function public.saath_dismiss_flag(p_expense uuid, p_code text, p_undo boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare c uuid;
begin
  select circle_id into c from public.saath_bill_checks where expense_id = p_expense;
  if c is null or not public.saath_is_member(c) then raise exception 'not allowed'; end if;
  update public.saath_bill_checks
     set dismissed = case when p_undo then coalesce((select jsonb_agg(x) from jsonb_array_elements(dismissed) x where x <> to_jsonb(p_code)), '[]'::jsonb)
                          when dismissed ? p_code then dismissed else dismissed || to_jsonb(p_code) end
   where expense_id = p_expense;
end $$;
revoke all on function public.saath_dismiss_flag(uuid, text, boolean) from public, anon;
grant execute on function public.saath_dismiss_flag(uuid, text, boolean) to authenticated;

-- re-checks are needed when the amount or date of a bill changes
create or replace function public.saath_bill_check_stale()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.amount is distinct from old.amount or new.spent_on is distinct from old.spent_on or new.vendor is distinct from old.vendor then
    delete from public.saath_bill_checks where expense_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists saath_bill_check_stale on public.saath_expenses;
create trigger saath_bill_check_stale after update on public.saath_expenses
  for each row execute function public.saath_bill_check_stale();
revoke all on function public.saath_bill_check_stale() from public, anon, authenticated;

-- the plan can only be changed by the server (billing), never from the app
create or replace function public.saath_plan_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.plan is distinct from old.plan and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    new.plan := old.plan;
  end if;
  return new;
end $$;
drop trigger if exists saath_plan_guard on public.saath_circles;
create trigger saath_plan_guard before update on public.saath_circles
  for each row execute function public.saath_plan_guard();
revoke all on function public.saath_plan_guard() from public, anon, authenticated;

-- (applied as 009) matched document per check + 30-day cache of web price lookups
alter table public.saath_bill_checks add column if not exists doc jsonb;
create table if not exists public.saath_price_refs (
  key text primary key,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.saath_price_refs enable row level security;
