-- Platform: Saath Plus (AI as a paid add-on per circle), regional pricing, free AI trial, admin AI switch per circle,
-- upgrade requests, circle agreements with e-acceptance, insights, more circle templates. Additive only.

-- ───────── circles: billing / AI access columns
alter table public.saath_circles add column if not exists ai_override text not null default 'auto';
alter table public.saath_circles add column if not exists plus_until timestamptz;
alter table public.saath_circles add column if not exists plus_source text;
alter table public.saath_circles add column if not exists ai_trial_used integer not null default 0;
do $$ begin
  alter table public.saath_circles add constraint saath_circles_ai_override_check check (ai_override in ('auto', 'on', 'off'));
exception when duplicate_object then null; end $$;

-- more kinds of circles and categories
alter table public.saath_circles drop constraint if exists saath_circles_purpose_check;
alter table public.saath_circles add constraint saath_circles_purpose_check check (purpose in
  ('medical','elder_care','education','event','household','trip','community','project','memorial','fundraiser','pets','other'));
alter table public.saath_expenses drop constraint if exists saath_expenses_category_check;
alter table public.saath_expenses add constraint saath_expenses_category_check check (category in
  ('hospital','doctor','medicine','tests','nursing','therapy','equipment','travel','food','rent','utilities','insurance','fees','event',
   'lodging','supplies','services','donation','repairs','pets','other'));

-- Billing fields can only be changed by app admins (via the admin console) or the server (service role).
create or replace function public.saath_plan_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') and not public.saath_is_admin() then
    new.plan := old.plan; new.ai_override := old.ai_override; new.plus_until := old.plus_until;
    new.plus_source := old.plus_source; new.ai_trial_used := old.ai_trial_used; new.ai_monthly_cap_usd := old.ai_monthly_cap_usd;
  end if;
  return new;
end $$;

-- ───────── settings
insert into public.saath_ai_config (key, value, note) values
  ('ai_paid_enabled',      'false', 'Charge for AI: true = AI needs Saath Plus (or the free trial). false = AI free for everyone (today)'),
  ('free_ai_trial_scans',  '10',    'Free AI bill reads per circle before Plus is needed (only when charging is on)')
on conflict (key) do nothing;

-- ───────── regional pricing (per circle; one subscription covers the whole family)
create table if not exists public.saath_pricing (
  country text primary key,          -- ISO 3166 alpha-2, or '*' = everywhere else
  tier text not null check (tier in ('A','B','C','D')),
  currency text not null,
  monthly numeric not null check (monthly >= 0),
  yearly numeric not null check (yearly >= 0),
  pass90 numeric not null check (pass90 >= 0),   -- 90-day event pass (trips, weddings, one-off care episodes)
  ai_allowance_usd numeric not null default 3,    -- fair-use AI allowance per month for Plus circles
  updated_at timestamptz not null default now()
);
alter table public.saath_pricing enable row level security;
drop policy if exists saath_pricing_read on public.saath_pricing;
create policy saath_pricing_read on public.saath_pricing for select to authenticated using (true);
revoke insert, update, delete on public.saath_pricing from anon, authenticated;
insert into public.saath_pricing (country, tier, currency, monthly, yearly, pass90, ai_allowance_usd) values
  ('US','A','USD',3.99,29.99,7.99,4),
  ('CA','A','CAD',4.99,39.99,9.99,4),
  ('GB','A','GBP',3.49,24.99,6.99,4),
  ('DE','A','EUR',3.99,29.99,7.99,4),
  ('FR','A','EUR',3.99,29.99,7.99,4),
  ('IT','A','EUR',3.99,29.99,7.99,4),
  ('ES','A','EUR',3.99,29.99,7.99,4),
  ('NL','A','EUR',3.99,29.99,7.99,4),
  ('IE','A','EUR',3.99,29.99,7.99,4),
  ('BE','A','EUR',3.99,29.99,7.99,4),
  ('AT','A','EUR',3.99,29.99,7.99,4),
  ('PT','A','EUR',3.99,29.99,7.99,4),
  ('FI','A','EUR',3.99,29.99,7.99,4),
  ('LU','A','EUR',3.99,29.99,7.99,4),
  ('GR','A','EUR',3.99,29.99,7.99,4),
  ('SK','A','EUR',3.99,29.99,7.99,4),
  ('SI','A','EUR',3.99,29.99,7.99,4),
  ('EE','A','EUR',3.99,29.99,7.99,4),
  ('LV','A','EUR',3.99,29.99,7.99,4),
  ('LT','A','EUR',3.99,29.99,7.99,4),
  ('CY','A','EUR',3.99,29.99,7.99,4),
  ('MT','A','EUR',3.99,29.99,7.99,4),
  ('HR','A','EUR',3.99,29.99,7.99,4),
  ('CH','A','CHF',3.99,29.99,7.99,4),
  ('NO','A','NOK',45,349,89,4),
  ('SE','A','SEK',45,349,89,4),
  ('DK','A','DKK',29,229,59,4),
  ('AU','A','AUD',5.99,44.99,11.99,4),
  ('NZ','A','NZD',6.99,49.99,12.99,4),
  ('SG','A','SGD',4.98,39.98,9.98,4),
  ('JP','A','JPY',600,4500,1200,4),
  ('AE','A','AED',14.99,109.99,29.99,4),
  ('SA','A','SAR',14.99,109.99,29.99,4),
  ('QA','A','QAR',14.99,109.99,29.99,4),
  ('KW','A','USD',3.99,29.99,7.99,4),
  ('BH','A','USD',3.99,29.99,7.99,4),
  ('OM','A','USD',3.99,29.99,7.99,4),
  ('HK','A','HKD',29,229,59,4),
  ('IL','A','ILS',14.9,109.9,29.9,4),
  ('KR','A','KRW',5500,39000,11000,4),
  ('TW','A','TWD',120,890,240,4),
  ('BR','B','BRL',9.9,69.9,19.9,3),
  ('MX','B','MXN',49,349,99,3),
  ('TR','B','TRY',79.99,599.99,159.99,3),
  ('ZA','B','ZAR',39.99,299.99,79.99,3),
  ('MY','B','MYR',9.9,69.9,19.9,3),
  ('TH','B','THB',79,599,159,3),
  ('CN','B','CNY',18,128,38,3),
  ('AR','B','USD',1.99,14.99,3.99,3),
  ('CL','B','CLP',1990,14900,3990,3),
  ('CO','B','COP',8900,64900,17900,3),
  ('PE','B','PEN',7.9,54.9,15.9,3),
  ('PL','B','PLN',9.99,74.99,19.99,3),
  ('RO','B','RON',9.99,74.99,19.99,3),
  ('RU','B','RUB',199,1490,399,3),
  ('CZ','B','CZK',79,599,159,3),
  ('HU','B','HUF',990,7490,1990,3),
  ('IN','C','INR',149,999,349,1.5),
  ('PK','C','PKR',399,2999,899,1.5),
  ('BD','C','BDT',199,1499,449,1.5),
  ('LK','C','LKR',399,2999,899,1.5),
  ('NP','C','NPR',199,1499,449,1.5),
  ('NG','C','NGN',1500,10000,3500,1.5),
  ('KE','C','KES',249,1799,549,1.5),
  ('GH','C','GHS',19.99,149,45,1.5),
  ('PH','C','PHP',99,699,229,1.5),
  ('ID','C','IDR',29000,199000,65000,1.5),
  ('VN','C','VND',39000,279000,89000,1.5),
  ('EG','C','EGP',79,549,179,1.5),
  ('MA','C','MAD',19.99,149,45,1.5),
  ('UA','C','UAH',79,599,179,1.5),
  ('ET','D','USD',0.99,6.99,2.49,1),
  ('UG','D','USD',0.99,6.99,2.49,1),
  ('TZ','D','USD',0.99,6.99,2.49,1),
  ('MW','D','USD',0.99,6.99,2.49,1),
  ('MZ','D','USD',0.99,6.99,2.49,1),
  ('AF','D','USD',0.99,6.99,2.49,1),
  ('HT','D','USD',0.99,6.99,2.49,1),
  ('SN','D','USD',0.99,6.99,2.49,1),
  ('ZM','D','USD',0.99,6.99,2.49,1),
  ('ZW','D','USD',0.99,6.99,2.49,1),
  ('RW','D','USD',0.99,6.99,2.49,1),
  ('MM','D','USD',0.99,6.99,2.49,1),
  ('KH','D','USD',0.99,6.99,2.49,1),
  ('LA','D','USD',0.99,6.99,2.49,1),
  ('CM','D','USD',0.99,6.99,2.49,1),
  ('CI','D','USD',0.99,6.99,2.49,1),
  ('BJ','D','USD',0.99,6.99,2.49,1),
  ('BF','D','USD',0.99,6.99,2.49,1),
  ('ML','D','USD',0.99,6.99,2.49,1),
  ('NE','D','USD',0.99,6.99,2.49,1),
  ('TD','D','USD',0.99,6.99,2.49,1),
  ('SL','D','USD',0.99,6.99,2.49,1),
  ('LR','D','USD',0.99,6.99,2.49,1),
  ('GN','D','USD',0.99,6.99,2.49,1),
  ('MG','D','USD',0.99,6.99,2.49,1),
  ('SD','D','USD',0.99,6.99,2.49,1),
  ('YE','D','USD',0.99,6.99,2.49,1),
  ('*','B','USD',2.49,17.99,5.99,3)
on conflict (country) do nothing;

create or replace function public.saath_price_for(p_country text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(p) from public.saath_pricing p
   where p.country = upper(coalesce(p_country, '*')) or p.country = '*'
   order by (p.country = '*') limit 1;
$$;
revoke all on function public.saath_price_for(text) from public, anon;
grant execute on function public.saath_price_for(text) to authenticated;

-- ───────── AI access for a circle
create or replace function public.saath_circle_ai_status(p_circle uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.saath_circles; paid boolean; trial int; plus_on boolean; left_ int; enabled boolean; why text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.saath_is_member(p_circle) and not public.saath_is_admin() then
    raise exception 'not a member';
  end if;
  select * into c from public.saath_circles where id = p_circle;
  if c.id is null then return null; end if;
  select coalesce((value)::text::boolean, false) into paid from public.saath_ai_config where key = 'ai_paid_enabled';
  select coalesce((value)::text::int, 10) into trial from public.saath_ai_config where key = 'free_ai_trial_scans';
  paid := coalesce(paid, false); trial := coalesce(trial, 10);
  plus_on := c.plan = 'plus' and (c.plus_until is null or c.plus_until > now());
  left_ := greatest(0, trial - c.ai_trial_used);
  if c.ai_override = 'off' then enabled := false; why := 'admin_off';
  elsif c.ai_override = 'on' then enabled := true; why := 'admin_on';
  elsif plus_on then enabled := true; why := 'plus';
  elsif not paid then enabled := true; why := 'free_mode';
  elsif left_ > 0 then enabled := true; why := 'trial';
  else enabled := false; why := 'plus_required';
  end if;
  return jsonb_build_object('enabled', enabled, 'reason', why, 'paid_mode', paid, 'plus', plus_on, 'plus_until', c.plus_until,
    'trial_total', trial, 'trial_left', left_, 'override', c.ai_override, 'country', c.country);
end $$;
revoke all on function public.saath_circle_ai_status(uuid) from public, anon;
grant execute on function public.saath_circle_ai_status(uuid) to authenticated, service_role;

create or replace function public.saath_ai_trial_use(p_circle uuid)
returns void language sql security definer set search_path = '' as $$
  update public.saath_circles set ai_trial_used = ai_trial_used + 1 where id = p_circle;
$$;
revoke all on function public.saath_ai_trial_use(uuid) from public, anon, authenticated;
grant execute on function public.saath_ai_trial_use(uuid) to service_role;

-- ───────── upgrade requests (until a payment provider is connected, admins grant Plus by hand)
create table if not exists public.saath_upgrade_requests (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.saath_circles(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  period text not null check (period in ('month','year','pass90')),
  price_text text,
  status text not null default 'open' check (status in ('open','granted','declined')),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
alter table public.saath_upgrade_requests enable row level security;
revoke all on public.saath_upgrade_requests from anon, authenticated;

create or replace function public.saath_request_upgrade(p_circle uuid, p_period text, p_price_text text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.saath_is_member(p_circle) then raise exception 'not a member'; end if;
  if exists (select 1 from public.saath_upgrade_requests where circle_id = p_circle and status = 'open') then
    update public.saath_upgrade_requests set period = p_period, price_text = left(p_price_text, 60), created_at = now()
     where circle_id = p_circle and status = 'open';
  else
    insert into public.saath_upgrade_requests (circle_id, period, price_text) values (p_circle, p_period, left(p_price_text, 60));
  end if;
end $$;
revoke all on function public.saath_request_upgrade(uuid, text, text) from public, anon;
grant execute on function public.saath_request_upgrade(uuid, text, text) to authenticated;

create or replace function public.saath_my_upgrade_request(p_circle uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(r) from public.saath_upgrade_requests r
   where r.circle_id = p_circle and public.saath_is_member(p_circle) order by created_at desc limit 1;
$$;
revoke all on function public.saath_my_upgrade_request(uuid) from public, anon;
grant execute on function public.saath_my_upgrade_request(uuid) to authenticated;

-- subscription history (admin grants now; payment webhooks later)
create table if not exists public.saath_subscriptions (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.saath_circles(id) on delete cascade,
  source text not null,              -- 'admin', later 'stripe' / 'apple' / 'google'
  months integer,
  ends_at timestamptz,
  amount numeric, currency text,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.saath_subscriptions enable row level security;
revoke all on public.saath_subscriptions from anon, authenticated;

-- ───────── admin: AI switch, grant/revoke Plus, requests, pricing
create or replace function public.saath_admin_set_ai(p_circle uuid, p_override text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.saath_admin_guard();
  if p_override not in ('auto','on','off') then raise exception 'bad_value'; end if;
  update public.saath_circles set ai_override = p_override, updated_at = now() where id = p_circle;
end $$;
revoke all on function public.saath_admin_set_ai(uuid, text) from public, anon;
grant execute on function public.saath_admin_set_ai(uuid, text) to authenticated;

create or replace function public.saath_admin_grant_plus(p_circle uuid, p_months integer, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.saath_circles; until_ timestamptz; allow numeric;
begin
  perform public.saath_admin_guard();
  select * into c from public.saath_circles where id = p_circle;
  if c.id is null then raise exception 'not_found'; end if;
  if p_months <= 0 then
    update public.saath_circles set plan = 'free', plus_until = null, plus_source = null, updated_at = now() where id = p_circle;
    insert into public.saath_subscriptions (circle_id, source, months, note) values (p_circle, 'admin', 0, coalesce(p_note, 'revoked'));
    return;
  end if;
  until_ := greatest(now(), coalesce(case when c.plan = 'plus' then c.plus_until end, now())) + make_interval(months => p_months);
  select ai_allowance_usd into allow from public.saath_pricing
   where country = upper(coalesce(c.country, '*')) or country = '*' order by (country = '*') limit 1;
  update public.saath_circles set plan = 'plus', plus_until = until_, plus_source = 'admin',
         ai_monthly_cap_usd = greatest(ai_monthly_cap_usd, coalesce(allow, 3)), updated_at = now() where id = p_circle;
  insert into public.saath_subscriptions (circle_id, source, months, ends_at, note) values (p_circle, 'admin', p_months, until_, p_note);
  update public.saath_upgrade_requests set status = 'granted', handled_at = now() where circle_id = p_circle and status = 'open';
end $$;
revoke all on function public.saath_admin_grant_plus(uuid, integer, text) from public, anon;
grant execute on function public.saath_admin_grant_plus(uuid, integer, text) to authenticated;

create or replace function public.saath_admin_requests()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.saath_admin_guard();
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'circle_id', r.circle_id, 'circle', c.name, 'country', c.country,
      'period', r.period, 'price_text', r.price_text, 'created_at', r.created_at, 'by', p.full_name, 'email', p.email) order by r.created_at desc)
    from public.saath_upgrade_requests r join public.saath_circles c on c.id = r.circle_id
    left join public.saath_profiles p on p.id = r.user_id where r.status = 'open'), '[]'::jsonb);
end $$;
revoke all on function public.saath_admin_requests() from public, anon;
grant execute on function public.saath_admin_requests() to authenticated;

create or replace function public.saath_admin_decline_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.saath_admin_guard();
  update public.saath_upgrade_requests set status = 'declined', handled_at = now() where id = p_id;
end $$;
revoke all on function public.saath_admin_decline_request(uuid) from public, anon;
grant execute on function public.saath_admin_decline_request(uuid) to authenticated;

create or replace function public.saath_admin_set_price(p_country text, p_tier text, p_currency text, p_monthly numeric, p_yearly numeric, p_pass90 numeric, p_allowance numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.saath_admin_guard();
  if p_country !~ '^([A-Z]{2}|\*)$' or p_currency !~ '^[A-Z]{3}$' then raise exception 'bad_code'; end if;
  insert into public.saath_pricing (country, tier, currency, monthly, yearly, pass90, ai_allowance_usd, updated_at)
  values (p_country, p_tier, p_currency, p_monthly, p_yearly, p_pass90, p_allowance, now())
  on conflict (country) do update set tier = excluded.tier, currency = excluded.currency, monthly = excluded.monthly,
    yearly = excluded.yearly, pass90 = excluded.pass90, ai_allowance_usd = excluded.ai_allowance_usd, updated_at = now();
end $$;
revoke all on function public.saath_admin_set_price(text, text, text, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.saath_admin_set_price(text, text, text, numeric, numeric, numeric, numeric) to authenticated;

-- circles list for the console, now with AI access fields
create or replace function public.saath_admin_circles()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.saath_admin_guard();
  return coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
    select c.id, c.name, c.purpose, c.currency, c.city, c.country, c.plan, c.status, c.bill_check_auto,
           c.ai_monthly_cap_usd as cap_usd, public.saath_ai_month_cost(c.id) as spent_usd, c.created_at,
           c.ai_override, c.plus_until, c.plus_source, c.ai_trial_used,
           (c.plan = 'plus' and (c.plus_until is null or c.plus_until > now())) as plus_active,
           (select count(*) from public.saath_members m where m.circle_id = c.id and m.status = 'active') as members,
           (select count(*) from public.saath_expenses e where e.circle_id = c.id) as expenses,
           (select coalesce(sum(amount), 0) from public.saath_expenses e where e.circle_id = c.id) as expense_total,
           (select p.full_name from public.saath_profiles p where p.id = c.created_by) as owner,
           exists (select 1 from public.saath_upgrade_requests r where r.circle_id = c.id and r.status = 'open') as wants_plus
      from public.saath_circles c) x), '[]'::jsonb);
end $$;

-- ───────── circle agreements (charter) with e-acceptance
create table if not exists public.saath_agreements (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.saath_circles(id) on delete cascade,
  version integer not null,
  title text not null check (length(btrim(title)) between 1 and 120),
  body text not null check (length(body) between 1 and 20000),
  terms jsonb not null default '{}'::jsonb,
  body_hash text not null,
  status text not null default 'active' check (status in ('active','superseded')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (circle_id, version)
);
create table if not exists public.saath_agreement_signatures (
  agreement_id uuid not null references public.saath_agreements(id) on delete cascade,
  member_id uuid not null references public.saath_members(id) on delete cascade,
  user_id uuid not null,
  signed_name text not null check (length(btrim(signed_name)) between 2 and 80),
  body_hash text not null,
  signed_at timestamptz not null default now(),
  primary key (agreement_id, member_id)
);
alter table public.saath_agreements enable row level security;
alter table public.saath_agreement_signatures enable row level security;
revoke all on public.saath_agreements, public.saath_agreement_signatures from anon, authenticated;

create or replace function public.saath_agreement_publish(p_circle uuid, p_title text, p_body text, p_terms jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v int; nid uuid;
begin
  if not public.saath_is_admin(p_circle) then raise exception 'only the circle organiser can publish the agreement'; end if;
  select coalesce(max(version), 0) + 1 into v from public.saath_agreements where circle_id = p_circle;
  update public.saath_agreements set status = 'superseded' where circle_id = p_circle and status = 'active';
  insert into public.saath_agreements (circle_id, version, title, body, terms, body_hash)
  values (p_circle, v, btrim(p_title), p_body, coalesce(p_terms, '{}'::jsonb), encode(sha256(convert_to(p_body, 'UTF8')), 'hex'))
  returning id into nid;
  insert into public.saath_activity (circle_id, actor, verb, data) values (p_circle, auth.uid(), 'agreement_published', jsonb_build_object('version', v));
  return nid;
end $$;
revoke all on function public.saath_agreement_publish(uuid, text, text, jsonb) from public, anon;
grant execute on function public.saath_agreement_publish(uuid, text, text, jsonb) to authenticated;

create or replace function public.saath_agreement_sign(p_agreement uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.saath_agreements; mid uuid;
begin
  select * into a from public.saath_agreements where id = p_agreement;
  if a.id is null or a.status <> 'active' then raise exception 'agreement_not_active'; end if;
  mid := public.saath_my_member_id(a.circle_id);
  if mid is null then raise exception 'not a member'; end if;
  insert into public.saath_agreement_signatures (agreement_id, member_id, user_id, signed_name, body_hash)
  values (p_agreement, mid, auth.uid(), btrim(p_name), a.body_hash) on conflict do nothing;
  insert into public.saath_activity (circle_id, actor, verb, data) values (a.circle_id, auth.uid(), 'agreement_signed', jsonb_build_object('version', a.version));
end $$;
revoke all on function public.saath_agreement_sign(uuid, text) from public, anon;
grant execute on function public.saath_agreement_sign(uuid, text) to authenticated;

create or replace function public.saath_agreement_current(p_circle uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a public.saath_agreements;
begin
  if not public.saath_is_member(p_circle) then raise exception 'not a member'; end if;
  select * into a from public.saath_agreements where circle_id = p_circle and status = 'active';
  if a.id is null then return null; end if;
  return jsonb_build_object('id', a.id, 'version', a.version, 'title', a.title, 'body', a.body, 'terms', a.terms,
    'body_hash', a.body_hash, 'created_at', a.created_at,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('member_id', m.id, 'name', m.display_name, 'is_me', m.user_id = auth.uid(),
        'joined', m.user_id is not null, 'signed_name', s.signed_name, 'signed_at', s.signed_at) order by s.signed_at nulls last, m.display_name), '[]'::jsonb)
      from public.saath_members m left join public.saath_agreement_signatures s on s.agreement_id = a.id and s.member_id = m.id
      where m.circle_id = p_circle and m.status = 'active'));
end $$;
revoke all on function public.saath_agreement_current(uuid) from public, anon;
grant execute on function public.saath_agreement_current(uuid) to authenticated;

-- ───────── insights
create or replace function public.saath_circle_insights(p_circle uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare m0 date := date_trunc('month', current_date)::date; r jsonb;
begin
  if not public.saath_is_member(p_circle) then raise exception 'not a member'; end if;
  select jsonb_build_object(
    'months', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(g, 'YYYY-MM'),
        'spent', (select coalesce(sum(amount), 0) from public.saath_expenses e where e.circle_id = p_circle and e.spent_on >= g and e.spent_on < g + interval '1 month'),
        'paid_in', (select coalesce(sum(amount), 0) from public.saath_contributions c where c.circle_id = p_circle and c.status = 'confirmed'
                      and c.kind in ('payment','expense_paid') and c.paid_on >= g and c.paid_on < g + interval '1 month')) order by g), '[]'::jsonb)
      from generate_series(m0 - interval '11 months', m0, interval '1 month') g),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'total', t, 'count', n) order by t desc), '[]'::jsonb)
      from (select category, sum(amount) t, count(*) n from public.saath_expenses where circle_id = p_circle group by 1) x),
    'categories_90d', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'total', t) order by t desc), '[]'::jsonb)
      from (select category, sum(amount) t from public.saath_expenses where circle_id = p_circle and spent_on >= current_date - 90 group by 1) x),
    'vendors', (select coalesce(jsonb_agg(jsonb_build_object('name', v, 'total', t, 'count', n) order by t desc), '[]'::jsonb)
      from (select coalesce(nullif(btrim(vendor), ''), title) v, sum(amount) t, count(*) n from public.saath_expenses
             where circle_id = p_circle group by 1 order by 2 desc limit 6) x),
    'largest', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'amount', amount, 'spent_on', spent_on, 'category', category) order by amount desc), '[]'::jsonb)
      from (select id, title, amount, spent_on, category from public.saath_expenses where circle_id = p_circle order by amount desc limit 5) x),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.display_name, 'share', m.share_percent,
        'charged', b.charged, 'credited', b.credited, 'balance', b.balance,
        'on_time', (select count(*) from public.saath_contributions c where c.member_id = m.id and c.status = 'confirmed' and c.kind = 'payment'),
        'pending', (select count(*) from public.saath_contributions c where c.member_id = m.id and c.status = 'pending')) order by b.credited desc), '[]'::jsonb)
      from public.saath_members m join public.saath_balances(p_circle) b on b.member_id = m.id
      where m.circle_id = p_circle and m.status = 'active'),
    'stats', jsonb_build_object(
      'total', (select coalesce(sum(amount), 0) from public.saath_expenses where circle_id = p_circle),
      'count', (select count(*) from public.saath_expenses where circle_id = p_circle),
      'this_month', (select coalesce(sum(amount), 0) from public.saath_expenses where circle_id = p_circle and spent_on >= m0),
      'last_month', (select coalesce(sum(amount), 0) from public.saath_expenses where circle_id = p_circle and spent_on >= m0 - interval '1 month' and spent_on < m0),
      'avg_3m', (select coalesce(sum(amount), 0) / 3.0 from public.saath_expenses where circle_id = p_circle and spent_on >= m0 - interval '3 months' and spent_on < m0),
      'first_date', (select min(spent_on) from public.saath_expenses where circle_id = p_circle),
      'outstanding', (select coalesce(sum(greatest(b.balance, 0)), 0) from public.saath_balances(p_circle) b),
      'checks_flagged', (select count(*) from public.saath_bill_checks k where k.circle_id = p_circle and k.risk in ('medium','high')),
      'receipts_pct', (select case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where exists (select 1 from public.saath_receipts r where r.expense_id = e.id)) / count(*)) end
                        from public.saath_expenses e where e.circle_id = p_circle))
  ) into r;
  return r;
end $$;
revoke all on function public.saath_circle_insights(uuid) from public, anon;
grant execute on function public.saath_circle_insights(uuid) to authenticated;
