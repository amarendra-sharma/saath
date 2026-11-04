-- ============================================================================
-- Saath — shared-cost circles (medical care, elder care, events, …)
-- Lives in the strategyarena Supabase project, fully isolated:
--   * every object is prefixed saath_  (tables, functions, bucket, cron job)
--   * every table has RLS; anon has no access at all
--   * nothing here reads or writes any course (fin_/it_/sa_/eq_) object
-- Money model (a simple ledger):
--   charges        = what a member is asked to pay (their % of each expense,
--                    or their % of a fixed periodic budget, or an adjustment)
--   contributions  = what a member actually paid (confirmed), plus credit for
--                    expenses they paid out of their own pocket; minus
--                    reimbursements paid back to them
--   balance        = charges − credits   (> 0 owes, < 0 is owed / in credit)
-- ============================================================================

-- ---------- helpers ---------------------------------------------------------
create or replace function public.saath_new_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(7);
  out text := '';
begin
  for i in 0..6 loop
    out := out || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return out;
end $$;

-- ---------- tables ----------------------------------------------------------
create table public.saath_profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text not null default '',
  email           text,
  phone           text,                       -- E.164, e.g. +919876543210 (WhatsApp)
  language        text not null default 'en',
  notify_whatsapp boolean not null default true,
  notify_email    boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.saath_circles (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (length(btrim(name)) between 1 and 80),
  purpose              text not null default 'medical'
                       check (purpose in ('medical','elder_care','education','event','household','other')),
  description          text,
  currency             text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  split_mode           text not null default 'expenses' check (split_mode in ('expenses','budget')),
  budget_amount        numeric(14,2) check (budget_amount is null or budget_amount >= 0),
  period               text not null default 'monthly'
                       check (period in ('weekly','biweekly','monthly','quarterly')),
  due_day              smallint not null default 1 check (due_day between 1 and 28),
  start_date           date not null default current_date,
  require_confirmation boolean not null default true,
  remind_whatsapp      boolean not null default true,
  remind_email         boolean not null default true,
  invite_code          text not null unique default public.saath_new_code(),
  last_budget_period   date,
  last_reminder_period date,
  status               text not null default 'active' check (status in ('active','archived')),
  created_by           uuid not null default auth.uid() references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint saath_weekly_day check (period not in ('weekly','biweekly') or due_day between 1 and 7)
);

create table public.saath_members (
  id              uuid primary key default gen_random_uuid(),
  circle_id       uuid not null references public.saath_circles(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,  -- null = not on the app (yet)
  display_name    text not null check (length(btrim(display_name)) between 1 and 80),
  relation        text,
  email           text,
  phone           text,
  role            text not null default 'member' check (role in ('admin','member')),
  share_percent   numeric(7,4) not null default 0 check (share_percent between 0 and 100),
  language        text not null default 'en',
  notify_whatsapp boolean not null default true,
  notify_email    boolean not null default true,
  status          text not null default 'active' check (status in ('active','left')),
  joined_at       timestamptz,
  created_at      timestamptz not null default now(),
  unique (circle_id, user_id)
);
create index on public.saath_members (user_id);
create index on public.saath_members (circle_id);

-- who receives the money (a family member, the hospital, a care home …)
create table public.saath_payees (
  id          uuid primary key default gen_random_uuid(),
  circle_id   uuid not null references public.saath_circles(id) on delete cascade,
  name        text not null,
  kind        text not null default 'person'
              check (kind in ('person','hospital','care_provider','organization','other')),
  member_id   uuid references public.saath_members(id) on delete set null,
  notes       text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on public.saath_payees (circle_id);

create table public.saath_pay_methods (
  id          uuid primary key default gen_random_uuid(),
  payee_id    uuid not null references public.saath_payees(id) on delete cascade,
  circle_id   uuid not null references public.saath_circles(id) on delete cascade,
  method      text not null check (method in
              ('upi','bank_in','bank_intl','sepa','wise','paypal','revolut','zelle','venmo',
               'cashapp','remitly','western_union','mpesa','pix','cash','other')),
  label       text,
  handle      text,           -- UPI id, @username, email/phone, IBAN …
  details     jsonb not null default '{}'::jsonb,  -- account no, IFSC, SWIFT, bank name …
  sort        smallint not null default 0,
  created_at  timestamptz not null default now()
);
create index on public.saath_pay_methods (circle_id);

create table public.saath_expenses (
  id                uuid primary key default gen_random_uuid(),
  circle_id         uuid not null references public.saath_circles(id) on delete cascade,
  title             text not null check (length(btrim(title)) between 1 and 120),
  amount            numeric(14,2) not null check (amount > 0),
  category          text not null default 'other' check (category in
                    ('hospital','doctor','medicine','tests','nursing','therapy','equipment','travel',
                     'food','rent','utilities','insurance','fees','event','other')),
  spent_on          date not null default current_date,
  vendor            text,
  notes             text,
  paid_by_member_id uuid references public.saath_members(id) on delete set null, -- null = paid by payee / shared pot
  orig_amount       numeric(14,2),
  orig_currency     text,
  split             jsonb,   -- optional custom split: {"<member_id>": percent, …}
  created_by        uuid not null default auth.uid() references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.saath_expenses (circle_id, spent_on desc);

create table public.saath_receipts (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references public.saath_expenses(id) on delete cascade,
  circle_id   uuid not null references public.saath_circles(id) on delete cascade,
  path        text not null,
  mime        text,
  size_bytes  integer,
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now()
);
create index on public.saath_receipts (expense_id);

create table public.saath_contributions (
  id            uuid primary key default gen_random_uuid(),
  circle_id     uuid not null references public.saath_circles(id) on delete cascade,
  member_id     uuid not null references public.saath_members(id) on delete cascade,
  kind          text not null default 'payment' check (kind in ('payment','expense_paid','reimbursement')),
  amount        numeric(14,2) not null check (amount > 0),
  orig_amount   numeric(14,2),
  orig_currency text,
  method        text,
  reference     text,
  paid_on       date not null default current_date,
  payee_id      uuid references public.saath_payees(id) on delete set null,
  expense_id    uuid references public.saath_expenses(id) on delete cascade,
  proof_path    text,
  notes         text,
  status        text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  confirmed_by  uuid references auth.users(id),
  confirmed_at  timestamptz,
  created_by    uuid not null default auth.uid() references auth.users(id),
  created_at    timestamptz not null default now()
);
create index on public.saath_contributions (circle_id, paid_on desc);
create index on public.saath_contributions (member_id);
create unique index saath_contrib_expense_paid_uq on public.saath_contributions (expense_id) where kind = 'expense_paid';

create table public.saath_charges (
  id           uuid primary key default gen_random_uuid(),
  circle_id    uuid not null references public.saath_circles(id) on delete cascade,
  member_id    uuid not null references public.saath_members(id) on delete cascade,
  amount       numeric(14,2) not null,
  source       text not null check (source in ('expense','budget','adjustment')),
  expense_id   uuid references public.saath_expenses(id) on delete cascade,
  period_start date,
  on_date      date not null default current_date,
  note         text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
create index on public.saath_charges (member_id);
create index on public.saath_charges (circle_id);
create index on public.saath_charges (expense_id);
create unique index saath_charges_budget_uq on public.saath_charges (member_id, period_start) where source = 'budget';

create table public.saath_activity (
  id         bigint generated always as identity primary key,
  circle_id  uuid not null references public.saath_circles(id) on delete cascade,
  actor      uuid,
  verb       text not null,     -- expense_added, payment_recorded, payment_confirmed, member_joined …
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.saath_activity (circle_id, created_at desc);

create table public.saath_notifications (
  id           bigint generated always as identity primary key,
  circle_id    uuid not null references public.saath_circles(id) on delete cascade,
  member_id    uuid references public.saath_members(id) on delete cascade,
  channel      text not null check (channel in ('whatsapp','email')),
  trigger      text not null default 'scheduled' check (trigger in ('scheduled','manual')),
  period_start date,
  amount       numeric(14,2),
  status       text not null check (status in ('sent','failed','skipped')),
  detail       text,
  created_at   timestamptz not null default now()
);
create index on public.saath_notifications (circle_id, created_at desc);

create table public.saath_reset_codes (
  email      text primary key,
  code_hash  text not null,
  attempts   smallint not null default 0,
  expires_at timestamptz not null
);

-- ---------- membership helpers (definer, so policies don't recurse) ---------
create or replace function public.saath_is_member(p_circle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.saath_members
                 where circle_id = p_circle and user_id = auth.uid() and status = 'active');
$$;

create or replace function public.saath_is_admin(p_circle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.saath_members
                 where circle_id = p_circle and user_id = auth.uid() and status = 'active' and role = 'admin');
$$;

create or replace function public.saath_my_member_id(p_circle uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.saath_members
  where circle_id = p_circle and user_id = auth.uid() and status = 'active' limit 1;
$$;

-- ---------- period arithmetic ----------------------------------------------
-- start of the billing period that contains p_on
create or replace function public.saath_period_start(p_period text, p_due smallint, p_anchor date, p_on date)
returns date language plpgsql immutable set search_path = '' as $$
declare d date; m int; a date;
begin
  if p_period in ('monthly','quarterly') then
    d := make_date(extract(year from p_on)::int, extract(month from p_on)::int, p_due);
    if d > p_on then d := (d - interval '1 month')::date; end if;
    if p_period = 'quarterly' then
      m := (extract(year from d)::int * 12 + extract(month from d)::int)
         - (extract(year from p_anchor)::int * 12 + extract(month from p_anchor)::int);
      m := ((m % 3) + 3) % 3;
      d := (d - make_interval(months => m))::date;
    end if;
  else
    d := p_on - ((extract(isodow from p_on)::int - p_due + 7) % 7);
    if p_period = 'biweekly' then
      a := p_anchor - ((extract(isodow from p_anchor)::int - p_due + 7) % 7);
      if (((d - a) / 7) % 2) <> 0 then d := d - 7; end if;
    end if;
  end if;
  return d;
end $$;

create or replace function public.saath_period_next(p_period text, p_start date)
returns date language sql immutable set search_path = '' as $$
  select case p_period
    when 'weekly'    then p_start + 7
    when 'biweekly'  then p_start + 14
    when 'monthly'   then (p_start + interval '1 month')::date
    else                  (p_start + interval '3 months')::date end;
$$;

-- ---------- splitting -------------------------------------------------------
-- Split p_total across active members by their share % (or a custom split).
-- Amounts are exact percent of the total, rounded to cents; when the shares add
-- up to 100 the rounding remainder goes to the largest share so the parts sum
-- exactly to the total. Shares under 100 leave an "uncovered" remainder.
create or replace function public.saath_split(p_circle uuid, p_total numeric, p_custom jsonb)
returns table (member_id uuid, amount numeric)
language sql stable security definer set search_path = '' as $$
  with base as (
    select m.id as mid,
           case when p_custom is not null and jsonb_typeof(p_custom) = 'object' and p_custom <> '{}'::jsonb
                then coalesce((p_custom ->> m.id::text)::numeric, 0) else m.share_percent end as pct
    from public.saath_members m where m.circle_id = p_circle and m.status = 'active'),
  b   as (select mid, pct, round(p_total * pct / 100, 2) as amt from base where pct > 0),
  t   as (select sum(pct) as tp, p_total - sum(amt) as diff from b),
  top as (select mid from b order by pct desc, mid limit 1)
  select b.mid, b.amt + case when abs(t.tp - 100) < 0.01 and b.mid = (select mid from top) then t.diff else 0 end
  from b cross join t;
$$;

-- ---------- expense → charges + out-of-pocket credit -------------------------
create or replace function public.saath_expense_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.saath_circles;
begin
  select * into c from public.saath_circles where id = new.circle_id;
  delete from public.saath_charges where expense_id = new.id;
  if c.split_mode = 'expenses' then
    insert into public.saath_charges (circle_id, member_id, amount, source, expense_id, on_date, created_by)
    select new.circle_id, s.member_id, s.amount, 'expense', new.id, new.spent_on, new.created_by
    from public.saath_split(new.circle_id, new.amount, new.split) s;
  end if;
  -- whoever paid out of pocket is credited for it
  delete from public.saath_contributions where expense_id = new.id and kind = 'expense_paid';
  if new.paid_by_member_id is not null then
    insert into public.saath_contributions
      (circle_id, member_id, kind, amount, paid_on, expense_id, status, confirmed_at, created_by, notes)
    values (new.circle_id, new.paid_by_member_id, 'expense_paid', new.amount, new.spent_on, new.id,
            'confirmed', now(), new.created_by, new.title);
  end if;
  return new;
end $$;

create trigger saath_expense_sync_ins after insert on public.saath_expenses
  for each row execute function public.saath_expense_sync();
create trigger saath_expense_sync_upd after update of amount, split, paid_by_member_id, spent_on, title on public.saath_expenses
  for each row execute function public.saath_expense_sync();

-- ---------- guards ----------------------------------------------------------
create or replace function public.saath_contribution_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare is_admin boolean; c public.saath_circles;
begin
  -- the expense trigger (definer, no end-user context check needed) writes expense_paid rows
  if new.kind = 'expense_paid' and tg_op = 'INSERT' and pg_trigger_depth() > 1 then
    return new;
  end if;
  if auth.uid() is null then return new; end if;  -- service role
  is_admin := public.saath_is_admin(new.circle_id);
  select * into c from public.saath_circles where id = new.circle_id;
  if tg_op = 'INSERT' then
    if new.kind = 'expense_paid' then raise exception 'not allowed'; end if;
    if new.kind = 'reimbursement' and not is_admin then raise exception 'only an organiser can record reimbursements'; end if;
    if not is_admin and new.member_id is distinct from public.saath_my_member_id(new.circle_id) then
      raise exception 'you can only record your own payments';
    end if;
    new.created_by := auth.uid();
    if is_admin or not c.require_confirmation then
      new.status := 'confirmed'; new.confirmed_by := auth.uid(); new.confirmed_at := now();
    else
      new.status := 'pending'; new.confirmed_by := null; new.confirmed_at := null;
    end if;
  else -- UPDATE
    if old.kind = 'expense_paid' and pg_trigger_depth() = 1 then raise exception 'edit the expense instead'; end if;
    if not is_admin then
      if old.status <> 'pending' or old.created_by <> auth.uid() then raise exception 'not allowed'; end if;
      new.status := 'pending'; new.member_id := old.member_id; new.kind := old.kind;
    elsif new.status is distinct from old.status then
      new.confirmed_by := auth.uid(); new.confirmed_at := now();
    end if;
  end if;
  return new;
end $$;

create trigger saath_contribution_guard before insert or update on public.saath_contributions
  for each row execute function public.saath_contribution_guard();

-- non-organisers may only change their own contact/notification fields
create or replace function public.saath_member_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.saath_is_admin(old.circle_id) then return new; end if;
  if old.user_id is distinct from auth.uid() then raise exception 'not allowed'; end if;
  new.role := old.role; new.status := old.status; new.user_id := old.user_id; new.circle_id := old.circle_id;
  new.share_percent := old.share_percent;   -- shares are set by an organiser
  return new;
end $$;
create trigger saath_member_guard before update on public.saath_members
  for each row execute function public.saath_member_guard();

-- the last organiser can't step down or leave
create or replace function public.saath_keep_an_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.status = 'active' and (new.role <> 'admin' or new.status <> 'active')
     and not exists (select 1 from public.saath_members
                     where circle_id = old.circle_id and id <> old.id and role = 'admin' and status = 'active') then
    raise exception 'a circle needs at least one organiser';
  end if;
  return new;
end $$;
create trigger saath_keep_an_admin before update on public.saath_members
  for each row execute function public.saath_keep_an_admin();

create or replace function public.saath_touch()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger saath_touch before update on public.saath_circles  for each row execute function public.saath_touch();
create trigger saath_touch before update on public.saath_expenses for each row execute function public.saath_touch();
create trigger saath_touch before update on public.saath_profiles for each row execute function public.saath_touch();

-- ---------- activity log ----------------------------------------------------
create or replace function public.saath_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v text; d jsonb; cid uuid;
begin
  if tg_table_name = 'saath_expenses' then
    cid := coalesce(new.circle_id, old.circle_id);
    v := case tg_op when 'INSERT' then 'expense_added' when 'UPDATE' then 'expense_edited' else 'expense_deleted' end;
    d := jsonb_build_object('title', coalesce(new.title, old.title), 'amount', coalesce(new.amount, old.amount),
                            'id', coalesce(new.id, old.id));
  elsif tg_table_name = 'saath_contributions' then
    cid := coalesce(new.circle_id, old.circle_id);
    if coalesce(new.kind, old.kind) = 'expense_paid' then return null; end if;
    if tg_op = 'INSERT' then v := case new.kind when 'reimbursement' then 'reimbursement_recorded' else 'payment_recorded' end;
    elsif tg_op = 'DELETE' then v := 'payment_deleted';
    elsif new.status is distinct from old.status then v := 'payment_' || new.status;
    else v := 'payment_edited'; end if;
    d := jsonb_build_object('amount', coalesce(new.amount, old.amount), 'id', coalesce(new.id, old.id),
           'member', (select display_name from public.saath_members where id = coalesce(new.member_id, old.member_id)));
  elsif tg_table_name = 'saath_members' then
    cid := coalesce(new.circle_id, old.circle_id);
    if tg_op = 'INSERT' then v := 'member_added';
    elsif tg_op = 'DELETE' then v := 'member_removed';
    elsif new.user_id is not null and old.user_id is null then v := 'member_joined';
    elsif new.share_percent is distinct from old.share_percent then v := 'share_changed';
    elsif new.status is distinct from old.status then v := 'member_' || new.status;
    else return null; end if;
    d := jsonb_build_object('member', coalesce(new.display_name, old.display_name),
                            'from', old.share_percent, 'to', new.share_percent);
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.saath_circles where id = cid) then return null; end if;
  insert into public.saath_activity (circle_id, actor, verb, data) values (cid, auth.uid(), v, d);
  return null;
end $$;
create trigger saath_log after insert or update or delete on public.saath_expenses      for each row execute function public.saath_log();
create trigger saath_log after insert or update or delete on public.saath_contributions for each row execute function public.saath_log();
create trigger saath_log after insert or update or delete on public.saath_members       for each row execute function public.saath_log();

-- ---------- budget charges ----------------------------------------------------
create or replace function public.saath_post_budget(p_circle uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare c public.saath_circles; ps date; n int := 0;
begin
  select * into c from public.saath_circles where id = p_circle for update;
  if c.split_mode <> 'budget' or coalesce(c.budget_amount,0) <= 0 or c.status <> 'active' then return 0; end if;
  ps := public.saath_period_start(c.period, c.due_day, c.start_date, current_date);
  if c.last_budget_period is not null and ps <= c.last_budget_period then return 0; end if;
  insert into public.saath_charges (circle_id, member_id, amount, source, period_start, on_date)
    select p_circle, s.member_id, s.amount, 'budget', ps, ps from public.saath_split(p_circle, c.budget_amount, null) s
    on conflict do nothing;
  get diagnostics n = row_count;
  update public.saath_circles set last_budget_period = ps where id = p_circle;
  return n;
end $$;
revoke all on function public.saath_post_budget(uuid) from public, anon, authenticated;

-- ============================================================================
-- RPCs used by the app
-- ============================================================================
create or replace function public.saath_ensure_profile()
returns public.saath_profiles language plpgsql security definer set search_path = '' as $$
declare p public.saath_profiles; u auth.users;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into p from public.saath_profiles where id = auth.uid();
  if found then return p; end if;
  select * into u from auth.users where id = auth.uid();
  insert into public.saath_profiles (id, full_name, email, language)
  values (u.id, coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1), ''), u.email,
          coalesce(u.raw_user_meta_data->>'language','en'))
  returning * into p;
  return p;
end $$;

create or replace function public.saath_create_circle(
  p_name text, p_purpose text, p_currency text, p_split_mode text, p_budget numeric,
  p_period text, p_due_day int, p_description text default null, p_require_confirmation boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cid uuid; pr public.saath_profiles;
begin
  pr := public.saath_ensure_profile();
  insert into public.saath_circles (name, purpose, currency, split_mode, budget_amount, period, due_day,
                                    description, require_confirmation, created_by)
  values (btrim(p_name), p_purpose, upper(p_currency), p_split_mode, p_budget, p_period, p_due_day::smallint,
          nullif(btrim(coalesce(p_description,'')),''), p_require_confirmation, auth.uid())
  returning id into cid;
  insert into public.saath_members (circle_id, user_id, display_name, email, phone, role, share_percent,
                                    language, notify_whatsapp, notify_email, joined_at)
  values (cid, auth.uid(), coalesce(nullif(pr.full_name,''), 'Me'), pr.email, pr.phone, 'admin', 100,
          pr.language, pr.notify_whatsapp, pr.notify_email, now());
  perform public.saath_post_budget(cid);
  return cid;
end $$;

-- what someone with an invite code sees before joining
create or replace function public.saath_preview_join(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.saath_circles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into c from public.saath_circles where invite_code = upper(btrim(p_code)) and status = 'active';
  if not found then return null; end if;
  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'purpose', c.purpose, 'currency', c.currency,
    'already_member', public.saath_is_member(c.id),
    'members', (select count(*) from public.saath_members where circle_id = c.id and status = 'active'),
    'placeholders', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', display_name) order by display_name)
                              from public.saath_members where circle_id = c.id and user_id is null and status = 'active'), '[]'::jsonb));
end $$;

create or replace function public.saath_join(p_code text, p_claim uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.saath_circles; pr public.saath_profiles; mid uuid;
begin
  pr := public.saath_ensure_profile();
  select * into c from public.saath_circles where invite_code = upper(btrim(p_code)) and status = 'active';
  if not found then raise exception 'invalid code'; end if;
  if exists (select 1 from public.saath_members where circle_id = c.id and user_id = auth.uid()) then
    update public.saath_members set status = 'active' where circle_id = c.id and user_id = auth.uid();
    return c.id;
  end if;
  if p_claim is not null then
    update public.saath_members
       set user_id = auth.uid(), joined_at = now(),
           email = coalesce(email, pr.email), phone = coalesce(phone, pr.phone), language = pr.language
     where id = p_claim and circle_id = c.id and user_id is null
    returning id into mid;
    if mid is null then raise exception 'that person has already joined'; end if;
  else
    insert into public.saath_members (circle_id, user_id, display_name, email, phone, language,
                                      notify_whatsapp, notify_email, joined_at)
    values (c.id, auth.uid(), coalesce(nullif(pr.full_name,''), split_part(pr.email,'@',1)), pr.email, pr.phone,
            pr.language, pr.notify_whatsapp, pr.notify_email, now());
  end if;
  return c.id;
end $$;

create or replace function public.saath_set_shares(p_circle uuid, p_shares jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare total numeric;
begin
  if not public.saath_is_admin(p_circle) then raise exception 'only an organiser can change shares'; end if;
  select coalesce(sum((value)::numeric),0) into total from jsonb_each_text(p_shares);
  if total > 100.0001 then raise exception 'shares add up to more than 100%%'; end if;
  update public.saath_members m set share_percent = round((p_shares ->> m.id::text)::numeric, 4)
   where m.circle_id = p_circle and p_shares ? m.id::text;
end $$;

create or replace function public.saath_regen_code(p_circle uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  if not public.saath_is_admin(p_circle) then raise exception 'not allowed'; end if;
  update public.saath_circles set invite_code = public.saath_new_code() where id = p_circle returning invite_code into code;
  return code;
end $$;

create or replace function public.saath_add_adjustment(p_circle uuid, p_member uuid, p_amount numeric, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.saath_is_admin(p_circle) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.saath_members where id = p_member and circle_id = p_circle) then raise exception 'bad member'; end if;
  insert into public.saath_charges (circle_id, member_id, amount, source, note, created_by)
  values (p_circle, p_member, round(p_amount,2), 'adjustment', p_note, auth.uid());
  insert into public.saath_activity (circle_id, actor, verb, data)
  values (p_circle, auth.uid(), 'adjustment', jsonb_build_object('amount', p_amount, 'note', p_note,
          'member', (select display_name from public.saath_members where id = p_member)));
end $$;

create or replace function public.saath_leave(p_circle uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.saath_members set status = 'left' where circle_id = p_circle and user_id = auth.uid();
end $$;

-- per-member ledger totals
create or replace function public.saath_balances(p_circle uuid)
returns table (member_id uuid, charged numeric, credited numeric, balance numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.saath_is_member(p_circle) and coalesce(auth.role(),'') <> 'service_role' then raise exception 'not a member'; end if;
  return query
  with ch as (select c.member_id, sum(c.amount) s from public.saath_charges c where c.circle_id = p_circle group by 1),
       cr as (select k.member_id, sum(case when k.kind = 'reimbursement' then -k.amount else k.amount end) s
              from public.saath_contributions k where k.circle_id = p_circle and k.status = 'confirmed' group by 1)
  select m.id, coalesce(ch.s,0)::numeric, coalesce(cr.s,0)::numeric, (coalesce(ch.s,0) - coalesce(cr.s,0))::numeric
  from public.saath_members m left join ch on ch.member_id = m.id left join cr on cr.member_id = m.id
  where m.circle_id = p_circle;
end $$;

-- everything the circle overview screen needs, in one call
create or replace function public.saath_circle_summary(p_circle uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.saath_circles; ps date; pe date; res jsonb;
begin
  if not public.saath_is_member(p_circle) then raise exception 'not a member'; end if;
  select * into c from public.saath_circles where id = p_circle;
  ps := public.saath_period_start(c.period, c.due_day, c.start_date, current_date);
  pe := public.saath_period_next(c.period, ps) - 1;
  select jsonb_build_object(
    'circle', to_jsonb(c),
    'me', public.saath_my_member_id(p_circle),
    'is_admin', public.saath_is_admin(p_circle),
    'period', jsonb_build_object('start', ps, 'end', pe, 'next_due', pe + 1,
       'expenses', (select coalesce(sum(amount),0) from public.saath_expenses where circle_id = p_circle and spent_on between ps and pe),
       'collected', (select coalesce(sum(amount),0) from public.saath_contributions
                     where circle_id = p_circle and status = 'confirmed' and kind = 'payment' and paid_on between ps and pe)),
    'totals', jsonb_build_object(
       'expenses', (select coalesce(sum(amount),0) from public.saath_expenses where circle_id = p_circle),
       'expenses_count', (select count(*) from public.saath_expenses where circle_id = p_circle),
       'contributed', (select coalesce(sum(amount),0) from public.saath_contributions
                       where circle_id = p_circle and status = 'confirmed' and kind in ('payment','expense_paid')),
       'pending', (select count(*) from public.saath_contributions where circle_id = p_circle and status = 'pending'),
       'pot', (select coalesce(sum(case when kind = 'payment' then amount when kind = 'reimbursement' then -amount else 0 end),0)
               from public.saath_contributions where circle_id = p_circle and status = 'confirmed')
             - (select coalesce(sum(amount),0) from public.saath_expenses where circle_id = p_circle and paid_by_member_id is null),
       'outstanding', (select coalesce(sum(greatest(b.balance,0)),0) from public.saath_balances(p_circle) b),
       'shares_total', (select coalesce(sum(share_percent),0) from public.saath_members where circle_id = p_circle and status = 'active')),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
         'id', m.id, 'name', m.display_name, 'relation', m.relation, 'role', m.role, 'share', m.share_percent,
         'status', m.status, 'joined', m.user_id is not null, 'is_me', m.user_id = auth.uid(),
         'phone', m.phone, 'email', m.email, 'language', m.language,
         'notify_whatsapp', m.notify_whatsapp, 'notify_email', m.notify_email,
         'charged', b.charged, 'credited', b.credited, 'balance', b.balance)
         order by (m.status = 'active') desc, m.role, m.display_name), '[]'::jsonb)
       from public.saath_members m join public.saath_balances(p_circle) b on b.member_id = m.id
       where m.circle_id = p_circle),
    'payees', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind,
         'notes', p.notes, 'is_default', p.is_default, 'member_id', p.member_id,
         'methods', (select coalesce(jsonb_agg(to_jsonb(pm) order by pm.sort, pm.created_at), '[]'::jsonb)
                     from public.saath_pay_methods pm where pm.payee_id = p.id))
         order by p.is_default desc, p.created_at), '[]'::jsonb)
       from public.saath_payees p where p.circle_id = p_circle),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'total', t) order by t desc), '[]'::jsonb)
       from (select category, sum(amount) t from public.saath_expenses where circle_id = p_circle group by 1) x)
  ) into res;
  return res;
end $$;

-- home screen: my circles with my balance
create or replace function public.saath_my_circles()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'purpose', c.purpose, 'currency', c.currency, 'status', c.status,
      'role', m.role, 'share', m.share_percent,
      'members', (select count(*) from public.saath_members x where x.circle_id = c.id and x.status = 'active'),
      'balance', (select b.balance from public.saath_balances(c.id) b where b.member_id = m.id),
      'pending', (select count(*) from public.saath_contributions k where k.circle_id = c.id and k.status = 'pending'),
      'last_activity', (select max(created_at) from public.saath_activity a where a.circle_id = c.id))
      order by c.status, c.created_at desc)
    from public.saath_members m join public.saath_circles c on c.id = m.circle_id
    where m.user_id = auth.uid() and m.status = 'active'), '[]'::jsonb);
end $$;

-- statement for a date range (whole circle, or one member)
create or replace function public.saath_statement(p_circle uuid, p_from date, p_to date, p_member uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.saath_is_member(p_circle) then raise exception 'not a member'; end if;
  return jsonb_build_object(
    'circle', (select jsonb_build_object('name', name, 'currency', currency) from public.saath_circles where id = p_circle),
    'from', p_from, 'to', p_to,
    'expenses', (select coalesce(jsonb_agg(jsonb_build_object('date', e.spent_on, 'title', e.title, 'category', e.category,
                   'vendor', e.vendor, 'amount', e.amount,
                   'paid_by', (select display_name from public.saath_members where id = e.paid_by_member_id),
                   'receipts', (select count(*) from public.saath_receipts r where r.expense_id = e.id))
                   order by e.spent_on, e.created_at), '[]'::jsonb)
                 from public.saath_expenses e where e.circle_id = p_circle and e.spent_on between p_from and p_to),
    'contributions', (select coalesce(jsonb_agg(jsonb_build_object('date', k.paid_on, 'member', m.display_name, 'kind', k.kind,
                   'amount', k.amount, 'method', k.method, 'reference', k.reference, 'status', k.status)
                   order by k.paid_on, k.created_at), '[]'::jsonb)
                 from public.saath_contributions k join public.saath_members m on m.id = k.member_id
                 where k.circle_id = p_circle and k.paid_on between p_from and p_to
                   and (p_member is null or k.member_id = p_member)),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
                   'name', m.display_name, 'share', m.share_percent,
                   'opening', coalesce((select sum(amount) from public.saath_charges c where c.member_id = m.id and c.on_date < p_from),0)
                            - coalesce((select sum(case when kind='reimbursement' then -amount else amount end) from public.saath_contributions k
                                        where k.member_id = m.id and k.status = 'confirmed' and k.paid_on < p_from),0),
                   'charged', coalesce((select sum(amount) from public.saath_charges c where c.member_id = m.id
                                        and c.on_date between p_from and p_to),0),
                   'paid', coalesce((select sum(case when kind='reimbursement' then -amount else amount end) from public.saath_contributions k
                                     where k.member_id = m.id and k.status = 'confirmed' and k.paid_on between p_from and p_to),0))
                   order by m.display_name), '[]'::jsonb)
                 from public.saath_members m where m.circle_id = p_circle and (p_member is null or m.id = p_member))
  );
end $$;

-- service-role only: who should get a reminder now
create or replace function public.saath_reminder_batch(p_circle uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare res jsonb := '[]'::jsonb; c public.saath_circles; ps date;
begin
  for c in select * from public.saath_circles
           where status = 'active' and (p_circle is null or id = p_circle) loop
    ps := public.saath_period_start(c.period, c.due_day, c.start_date, current_date);
    if p_circle is null then
      -- scheduled run: only within 3 days of a new period, once per period
      if current_date - ps > 3 or (c.last_reminder_period is not null and c.last_reminder_period >= ps) then continue; end if;
      update public.saath_circles set last_reminder_period = ps where id = c.id;
    end if;
    res := res || coalesce((
      select jsonb_agg(jsonb_build_object(
        'circle_id', c.id, 'circle', c.name, 'currency', c.currency, 'period_start', ps,
        'due_date', public.saath_period_next(c.period, ps),
        'whatsapp', c.remind_whatsapp and m.notify_whatsapp, 'email', c.remind_email and m.notify_email,
        'member_id', m.id, 'name', m.display_name, 'phone', m.phone, 'mail', m.email,
        'language', m.language, 'amount', b.balance))
      from public.saath_members m join public.saath_balances(c.id) b on b.member_id = m.id
      where m.circle_id = c.id and m.status = 'active' and b.balance > 0.5
        and (m.phone is not null or m.email is not null)), '[]'::jsonb);
  end loop;
  return res;
end $$;
revoke all on function public.saath_reminder_batch(uuid) from public, anon, authenticated;

-- daily tick (pg_cron): post budget charges for new periods
create or replace function public.saath_daily()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.saath_circles where status = 'active' and split_mode = 'budget' loop
    n := n + public.saath_post_budget(r.id);
  end loop;
  return n;
end $$;
revoke all on function public.saath_daily() from public, anon, authenticated;

-- ============================================================================
-- Row-level security
-- ============================================================================
alter table public.saath_profiles      enable row level security;
alter table public.saath_circles       enable row level security;
alter table public.saath_members       enable row level security;
alter table public.saath_payees        enable row level security;
alter table public.saath_pay_methods   enable row level security;
alter table public.saath_expenses      enable row level security;
alter table public.saath_receipts      enable row level security;
alter table public.saath_contributions enable row level security;
alter table public.saath_charges       enable row level security;
alter table public.saath_activity      enable row level security;
alter table public.saath_notifications enable row level security;
alter table public.saath_reset_codes   enable row level security;

revoke all on public.saath_profiles, public.saath_circles, public.saath_members, public.saath_payees,
  public.saath_pay_methods, public.saath_expenses, public.saath_receipts, public.saath_contributions,
  public.saath_charges, public.saath_activity, public.saath_notifications, public.saath_reset_codes from anon;
revoke all on public.saath_reset_codes from authenticated;

create policy saath_profiles_self on public.saath_profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy saath_circles_read  on public.saath_circles for select to authenticated using (public.saath_is_member(id));
create policy saath_circles_admin on public.saath_circles for update to authenticated
  using (public.saath_is_admin(id)) with check (public.saath_is_admin(id));

create policy saath_members_read   on public.saath_members for select to authenticated using (public.saath_is_member(circle_id));
create policy saath_members_insert on public.saath_members for insert to authenticated
  with check (public.saath_is_admin(circle_id) and user_id is null);
create policy saath_members_update on public.saath_members for update to authenticated
  using (public.saath_is_admin(circle_id) or user_id = (select auth.uid()))
  with check (public.saath_is_admin(circle_id) or user_id = (select auth.uid()));
create policy saath_members_delete on public.saath_members for delete to authenticated
  using (public.saath_is_admin(circle_id) and user_id is null
         and not exists (select 1 from public.saath_contributions k where k.member_id = saath_members.id));

create policy saath_payees_read  on public.saath_payees for select to authenticated using (public.saath_is_member(circle_id));
create policy saath_payees_write on public.saath_payees for all to authenticated
  using (public.saath_is_admin(circle_id)) with check (public.saath_is_admin(circle_id));
create policy saath_pm_read  on public.saath_pay_methods for select to authenticated using (public.saath_is_member(circle_id));
create policy saath_pm_write on public.saath_pay_methods for all to authenticated
  using (public.saath_is_admin(circle_id)) with check (public.saath_is_admin(circle_id));

create policy saath_exp_read   on public.saath_expenses for select to authenticated using (public.saath_is_member(circle_id));
create policy saath_exp_insert on public.saath_expenses for insert to authenticated
  with check (public.saath_is_member(circle_id) and created_by = (select auth.uid()));
create policy saath_exp_update on public.saath_expenses for update to authenticated
  using (public.saath_is_admin(circle_id) or (created_by = (select auth.uid()) and public.saath_is_member(circle_id)))
  with check (public.saath_is_member(circle_id));
create policy saath_exp_delete on public.saath_expenses for delete to authenticated
  using (public.saath_is_admin(circle_id) or (created_by = (select auth.uid()) and public.saath_is_member(circle_id)));

create policy saath_rcpt_read   on public.saath_receipts for select to authenticated using (public.saath_is_member(circle_id));
create policy saath_rcpt_insert on public.saath_receipts for insert to authenticated
  with check (public.saath_is_member(circle_id) and uploaded_by = (select auth.uid()));
create policy saath_rcpt_delete on public.saath_receipts for delete to authenticated
  using (public.saath_is_admin(circle_id) or uploaded_by = (select auth.uid()));

create policy saath_contrib_read   on public.saath_contributions for select to authenticated using (public.saath_is_member(circle_id));
create policy saath_contrib_insert on public.saath_contributions for insert to authenticated with check (public.saath_is_member(circle_id));
create policy saath_contrib_update on public.saath_contributions for update to authenticated
  using (public.saath_is_admin(circle_id) or (created_by = (select auth.uid()) and status = 'pending'))
  with check (public.saath_is_member(circle_id));
create policy saath_contrib_delete on public.saath_contributions for delete to authenticated
  using (kind <> 'expense_paid' and (public.saath_is_admin(circle_id) or (created_by = (select auth.uid()) and status = 'pending')));

create policy saath_charges_read  on public.saath_charges  for select to authenticated using (public.saath_is_member(circle_id));
create policy saath_activity_read on public.saath_activity for select to authenticated using (public.saath_is_member(circle_id));
create policy saath_notif_read    on public.saath_notifications for select to authenticated using (public.saath_is_admin(circle_id));

-- RPCs: signed-in users only
revoke execute on function public.saath_ensure_profile(), public.saath_create_circle(text,text,text,text,numeric,text,int,text,boolean),
  public.saath_preview_join(text), public.saath_join(text,uuid), public.saath_set_shares(uuid,jsonb),
  public.saath_regen_code(uuid), public.saath_add_adjustment(uuid,uuid,numeric,text), public.saath_leave(uuid),
  public.saath_balances(uuid), public.saath_circle_summary(uuid), public.saath_my_circles(),
  public.saath_statement(uuid,date,date,uuid), public.saath_split(uuid,numeric,jsonb), public.saath_new_code()
  from public, anon;
grant execute on function public.saath_ensure_profile(), public.saath_create_circle(text,text,text,text,numeric,text,int,text,boolean),
  public.saath_preview_join(text), public.saath_join(text,uuid), public.saath_set_shares(uuid,jsonb),
  public.saath_regen_code(uuid), public.saath_add_adjustment(uuid,uuid,numeric,text), public.saath_leave(uuid),
  public.saath_balances(uuid), public.saath_circle_summary(uuid), public.saath_my_circles(),
  public.saath_statement(uuid,date,date,uuid)
  to authenticated;

-- ============================================================================
-- Receipt storage: private bucket, files at <circle_id>/<file>
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('saath-receipts', 'saath-receipts', false, 15728640,
        array['image/jpeg','image/png','image/heic','image/heif','image/webp','application/pdf'])
on conflict (id) do nothing;

create or replace function public.saath_storage_circle(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end;
$$;

create policy saath_receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'saath-receipts' and public.saath_is_member(public.saath_storage_circle(name)));
create policy saath_receipts_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'saath-receipts' and public.saath_is_member(public.saath_storage_circle(name)));
create policy saath_receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'saath-receipts' and (owner_id = (select auth.uid())::text
         or public.saath_is_admin(public.saath_storage_circle(name))));
