-- App admin console. Additive only.
-- Admins are listed in saath_admins. Every admin function is SECURITY DEFINER and refuses non-admins,
-- so the app talks to them with the normal signed-in user token: no service key in the app.

create table if not exists public.saath_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_by uuid,
  added_at timestamptz not null default now()
);
alter table public.saath_admins enable row level security;
revoke all on public.saath_admins from anon, authenticated;

-- first admin: the app owner (Amar)
insert into public.saath_admins (user_id) values ('1621a088-6884-4fd3-aae3-5a2ae30570ed') on conflict do nothing;

-- Feature switches (read by the edge functions and, through saath_app_flags, by the app)
insert into public.saath_ai_config (key, value, note) values
  ('scan_enabled',          'true',  'Feature: AI bill reading (scan). false = app asks people to type the bill'),
  ('bill_check_ai_enabled', 'true',  'Feature: AI part of Bill Check. false = only the free rule checks run'),
  ('price_web_enabled',     'true',  'Feature: web price search in Bill Check'),
  ('bill_check_paid',       'false', 'Feature: Bill Check only for circles on the Plus plan')
on conflict (key) do nothing;

create or replace function public.saath_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.saath_admins where user_id = auth.uid());
$$;
revoke all on function public.saath_is_admin() from public, anon;
grant execute on function public.saath_is_admin() to authenticated;

create or replace function public.saath_admin_guard()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.saath_admins where user_id = auth.uid()) then
    raise exception 'admin_only' using errcode = '42501';
  end if;
end $$;
revoke all on function public.saath_admin_guard() from public, anon, authenticated;

-- Flags every signed-in user may read (no secrets, no prices)
create or replace function public.saath_app_flags()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.saath_ai_config
   where key in ('scan_enabled', 'bill_check_ai_enabled', 'price_web_enabled', 'bill_check_paid', 'max_file_mb', 'max_pdf_pages');
$$;
revoke all on function public.saath_app_flags() from public, anon;
grant execute on function public.saath_app_flags() to authenticated;

-- ── Overview: people, circles, money, AI spend, alerts
create or replace function public.saath_admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public.saath_admin_guard();
  select jsonb_build_object(
    'users',         (select count(*) from public.saath_profiles),
    'circles',       (select count(*) from public.saath_circles where status = 'active'),
    'circles_all',   (select count(*) from public.saath_circles),
    'expenses',      (select count(*) from public.saath_expenses),
    'expense_total', (select coalesce(sum(amount), 0) from public.saath_expenses),
    'scans_30d',     (select count(*) from public.saath_scans where created_at > now() - interval '30 days'),
    'checks_30d',    (select count(*) from public.saath_bill_checks where checked_at > now() - interval '30 days'),
    'ai_today',      public.saath_ai_day_cost(),
    'ai_month',      (select coalesce(round(sum(cost_micro_usd) / 1e6, 4), 0) from public.saath_ai_usage
                       where created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'),
    'ai_all',        (select coalesce(round(sum(cost_micro_usd) / 1e6, 4), 0) from public.saath_ai_usage),
    'ai_failed_7d',  (select count(*) from public.saath_ai_usage where not ok and created_at > now() - interval '7 days'),
    'last_ai_error', (select note from public.saath_ai_usage where not ok order by id desc limit 1),
    'daily', coalesce((select jsonb_agg(d order by d->>'day') from (
        select jsonb_build_object('day', to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD'),
                                  'usd', round(sum(cost_micro_usd) / 1e6, 4), 'calls', count(*)) d
          from public.saath_ai_usage where created_at > now() - interval '30 days'
         group by date_trunc('day', created_at at time zone 'UTC')) x), '[]'::jsonb),
    'by_function', coalesce((select jsonb_agg(f order by (f->>'usd')::numeric desc) from (
        select jsonb_build_object('fn', k, 'usd', round(sum(cost_micro_usd) / 1e6, 4), 'calls', count(*)) f
          from (select cost_micro_usd, split_part(split_part(function, ':', 1), '#', 1) ||
                       case when function like '%price%' then ' (price)' when function like '%:eval%' or function like '%:test%' then ' (tests)' else '' end as k
                  from public.saath_ai_usage where created_at > now() - interval '30 days') u
         group by k) y), '[]'::jsonb),
    'alerts', coalesce((select jsonb_agg(a order by a->>'created_at' desc) from (
        select jsonb_build_object('created_at', created_at, 'kind', kind, 'usd', usd, 'detail', detail, 'emailed', emailed,
                                  'circle', (select name from public.saath_circles c where c.id = al.circle_id)) a
          from public.saath_ai_alerts al order by created_at desc limit 20) z), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function public.saath_admin_overview() from public, anon;
grant execute on function public.saath_admin_overview() to authenticated;

-- ── Circles
create or replace function public.saath_admin_circles()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.saath_admin_guard();
  return coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
    select c.id, c.name, c.purpose, c.currency, c.city, c.country, c.plan, c.status, c.bill_check_auto,
           c.ai_monthly_cap_usd as cap_usd, public.saath_ai_month_cost(c.id) as spent_usd, c.created_at,
           (select count(*) from public.saath_members m where m.circle_id = c.id and m.status = 'active') as members,
           (select count(*) from public.saath_expenses e where e.circle_id = c.id) as expenses,
           (select coalesce(sum(amount), 0) from public.saath_expenses e where e.circle_id = c.id) as expense_total,
           (select p.full_name from public.saath_profiles p where p.id = c.created_by) as owner
      from public.saath_circles c) x), '[]'::jsonb);
end $$;
revoke all on function public.saath_admin_circles() from public, anon;
grant execute on function public.saath_admin_circles() to authenticated;

create or replace function public.saath_admin_update_circle(
  p_circle uuid, p_plan text default null, p_cap_usd numeric default null, p_bill_check_auto boolean default null, p_status text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.saath_admin_guard();
  if p_plan is not null and p_plan not in ('free', 'plus') then raise exception 'bad_plan'; end if;
  if p_status is not null and p_status not in ('active', 'archived') then raise exception 'bad_status'; end if;
  if p_cap_usd is not null and (p_cap_usd < 0 or p_cap_usd > 100) then raise exception 'bad_cap'; end if;
  update public.saath_circles set
    plan = coalesce(p_plan, plan),
    ai_monthly_cap_usd = coalesce(p_cap_usd, ai_monthly_cap_usd),
    bill_check_auto = coalesce(p_bill_check_auto, bill_check_auto),
    status = coalesce(p_status, status),
    updated_at = now()
  where id = p_circle;
end $$;
revoke all on function public.saath_admin_update_circle(uuid, text, numeric, boolean, text) from public, anon;
grant execute on function public.saath_admin_update_circle(uuid, text, numeric, boolean, text) to authenticated;

-- ── People
create or replace function public.saath_admin_users()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.saath_admin_guard();
  return coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc nulls last) from (
    select p.id, p.full_name, p.email, p.phone, u.created_at, u.last_sign_in_at,
           exists (select 1 from public.saath_admins a where a.user_id = p.id) as is_admin,
           (select count(*) from public.saath_members m where m.user_id = p.id and m.status = 'active') as circles,
           (select coalesce(round(sum(cost_micro_usd) / 1e6, 4), 0) from public.saath_ai_usage g
             where g.user_id = p.id and g.created_at > now() - interval '30 days') as ai_30d
      from public.saath_profiles p left join auth.users u on u.id = p.id) x), '[]'::jsonb);
end $$;
revoke all on function public.saath_admin_users() from public, anon;
grant execute on function public.saath_admin_users() to authenticated;

create or replace function public.saath_admin_set_admin(p_user uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.saath_admin_guard();
  if p_on then
    insert into public.saath_admins (user_id, added_by) values (p_user, auth.uid()) on conflict do nothing;
  else
    if p_user = auth.uid() then raise exception 'cannot_remove_self'; end if;
    delete from public.saath_admins where user_id = p_user;
  end if;
end $$;
revoke all on function public.saath_admin_set_admin(uuid, boolean) from public, anon;
grant execute on function public.saath_admin_set_admin(uuid, boolean) to authenticated;

-- ── Settings (saath_ai_config): read all, change existing keys only, with type checks
create or replace function public.saath_admin_config()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.saath_admin_guard();
  return coalesce((select jsonb_agg(jsonb_build_object('key', key, 'value', value, 'note', note, 'updated_at', updated_at) order by key)
                     from public.saath_ai_config), '[]'::jsonb);
end $$;
revoke all on function public.saath_admin_config() from public, anon;
grant execute on function public.saath_admin_config() to authenticated;

create or replace function public.saath_admin_set_config(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare old jsonb;
begin
  perform public.saath_admin_guard();
  select value into old from public.saath_ai_config where key = p_key;
  if old is null then raise exception 'unknown_setting'; end if;
  if jsonb_typeof(old) <> jsonb_typeof(p_value) then raise exception 'wrong_type'; end if;
  if jsonb_typeof(p_value) = 'number' and (p_value::text)::numeric < 0 then raise exception 'negative'; end if;
  update public.saath_ai_config set value = p_value, updated_at = now() where key = p_key;
end $$;
revoke all on function public.saath_admin_set_config(text, jsonb) from public, anon;
grant execute on function public.saath_admin_set_config(text, jsonb) to authenticated;
