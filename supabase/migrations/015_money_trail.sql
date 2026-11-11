-- Money trail: proof that money collected by a receiver actually reached the hospital / provider.
-- Additive only. Nothing existing changes meaning; old bills simply show as "not marked paid yet".
--
--  contributions (kind = payment, to payee P)  ──►  money held by P  ──►  payouts by P (to a provider)
--                                                                         └─ payout_items: which bills each payout paid
--  A member who pays a bill out of pocket keeps working as before (paid_by_member_id → credited automatically).
--
-- Rules that make it hard to fake:
--  * payouts are written only through the functions below (no direct table writes from the app);
--  * only the receiver (the payee's own member) or an organiser can record a payout;
--  * someone else in the circle must verify it (or question it); the recorder can never verify their own;
--  * a verified payout is locked; a questioned one stays visible until the person who questioned it clears it;
--  * a bill can't be marked paid for more than its amount, and a paid bill can't be deleted or shrunk below what was paid;
--  * every step is written to the activity log, including deletions (with the amounts).

alter table public.saath_circles add column if not exists trail_alert_days smallint not null default 7
  check (trail_alert_days between 1 and 90);

create table if not exists public.saath_payouts (
  id            uuid primary key default gen_random_uuid(),
  circle_id     uuid not null references public.saath_circles(id) on delete cascade,
  payee_id      uuid not null references public.saath_payees(id) on delete restrict,  -- whose money paid it
  vendor        text check (vendor is null or length(vendor) <= 120),
  amount        numeric(14,2) not null check (amount > 0),
  paid_on       date not null check (paid_on <= current_date + 1),
  method        text,
  reference     text check (reference is null or length(reference) <= 120),
  proof_path    text,
  notes         text check (notes is null or length(notes) <= 1000),
  status        text not null default 'recorded' check (status in ('recorded', 'verified', 'questioned')),
  verified_by   uuid references auth.users(id),
  verified_at   timestamptz,
  question      text,
  questioned_by uuid references auth.users(id),
  questioned_at timestamptz,
  created_by    uuid not null default auth.uid() references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists saath_payouts_circle on public.saath_payouts (circle_id, paid_on desc);
create index if not exists saath_payouts_payee on public.saath_payouts (payee_id);

create table if not exists public.saath_payout_items (
  payout_id  uuid not null references public.saath_payouts(id) on delete cascade,
  expense_id uuid not null references public.saath_expenses(id) on delete restrict,
  amount     numeric(14,2) not null check (amount > 0),
  primary key (payout_id, expense_id)
);
create index if not exists saath_payout_items_exp on public.saath_payout_items (expense_id);

alter table public.saath_payouts enable row level security;
alter table public.saath_payout_items enable row level security;
revoke all on public.saath_payouts, public.saath_payout_items from anon, authenticated;
grant select on public.saath_payouts, public.saath_payout_items to authenticated;
drop policy if exists saath_payouts_read on public.saath_payouts;
create policy saath_payouts_read on public.saath_payouts for select to authenticated using (public.saath_is_member(circle_id));
drop policy if exists saath_payout_items_read on public.saath_payout_items;
create policy saath_payout_items_read on public.saath_payout_items for select to authenticated
  using (exists (select 1 from public.saath_payouts p where p.id = payout_id and public.saath_is_member(p.circle_id)));

-- A bill that has been paid (fully or partly) can't be deleted or reduced below what was paid.
create or replace function public.saath_expense_paid_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare paid numeric;
begin
  select coalesce(sum(amount), 0) into paid from public.saath_payout_items where expense_id = old.id;
  if paid = 0 then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then raise exception 'bill_has_payment' using errcode = 'P0001'; end if;
  if new.amount + 1 < paid then raise exception 'bill_below_paid' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists saath_expense_paid_guard_del on public.saath_expenses;
create trigger saath_expense_paid_guard_del before delete on public.saath_expenses for each row execute function public.saath_expense_paid_guard();
drop trigger if exists saath_expense_paid_guard_upd on public.saath_expenses;
create trigger saath_expense_paid_guard_upd before update of amount on public.saath_expenses for each row execute function public.saath_expense_paid_guard();

-- Who may record a payout from payee P: an organiser, or the member who is P.
create or replace function public.saath_can_pay_from(p_payee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.saath_payees p where p.id = p_payee and (
    public.saath_is_admin(p.circle_id)
    or exists (select 1 from public.saath_members m where m.id = p.member_id and m.user_id = auth.uid() and m.status = 'active')));
$$;

-- items: [{"expense_id": "...", "amount": 123.45}, ...]
create or replace function public.saath_payout_record(
  p_payee uuid, p_amount numeric, p_paid_on date, p_vendor text, p_method text, p_reference text,
  p_proof_path text, p_notes text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cid uuid; pid uuid; it jsonb; e public.saath_expenses; already numeric; total numeric := 0;
begin
  select circle_id into cid from public.saath_payees where id = p_payee;
  if cid is null then raise exception 'not_found'; end if;
  if not public.saath_can_pay_from(p_payee) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'bad_amount'; end if;
  if p_paid_on is null or p_paid_on > current_date + 1 then raise exception 'bad_date'; end if;
  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> cid::text then raise exception 'bad_proof'; end if;
  insert into public.saath_payouts (circle_id, payee_id, vendor, amount, paid_on, method, reference, proof_path, notes)
  values (cid, p_payee, nullif(btrim(p_vendor), ''), round(p_amount, 2), p_paid_on, nullif(btrim(p_method), ''),
          nullif(btrim(p_reference), ''), p_proof_path, nullif(btrim(p_notes), ''))
  returning id into pid;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into e from public.saath_expenses where id = (it->>'expense_id')::uuid;
    if e.id is null or e.circle_id <> cid then raise exception 'bad_bill'; end if;
    if e.paid_by_member_id is not null then raise exception 'bill_paid_by_member'; end if;
    select coalesce(sum(amount), 0) into already from public.saath_payout_items where expense_id = e.id;
    if (it->>'amount')::numeric <= 0 or already + (it->>'amount')::numeric > e.amount + 1 then raise exception 'bill_overpaid'; end if;
    insert into public.saath_payout_items (payout_id, expense_id, amount) values (pid, e.id, round((it->>'amount')::numeric, 2));
    total := total + (it->>'amount')::numeric;
  end loop;
  if total > p_amount + 1 then raise exception 'items_exceed_amount'; end if;
  insert into public.saath_activity (circle_id, actor, verb, data) values (cid, auth.uid(), 'payout_recorded',
    jsonb_build_object('payout', pid, 'amount', round(p_amount, 2), 'vendor', coalesce(nullif(btrim(p_vendor), ''), ''),
      'payee', (select name from public.saath_payees where id = p_payee), 'bills', jsonb_array_length(coalesce(p_items, '[]'::jsonb)),
      'proof', p_proof_path is not null));
  return pid;
end $$;

-- Add or replace the proof / reference later (recorder or receiver). Clears a question so it can be looked at again.
create or replace function public.saath_payout_add_proof(p_payout uuid, p_proof_path text, p_reference text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.saath_payouts;
begin
  select * into p from public.saath_payouts where id = p_payout;
  if p.id is null then raise exception 'not_found'; end if;
  if not (p.created_by = auth.uid() or public.saath_can_pay_from(p.payee_id)) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p.status = 'verified' then raise exception 'locked'; end if;
  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> p.circle_id::text then raise exception 'bad_proof'; end if;
  update public.saath_payouts set
    proof_path = coalesce(p_proof_path, proof_path), reference = coalesce(nullif(btrim(p_reference), ''), reference),
    notes = case when nullif(btrim(p_note), '') is null then notes else concat_ws(E'\n', notes, btrim(p_note)) end,
    updated_at = now()
  where id = p_payout;
  insert into public.saath_activity (circle_id, actor, verb, data) values (p.circle_id, auth.uid(), 'payout_proof_added',
    jsonb_build_object('payout', p.id, 'amount', p.amount, 'vendor', coalesce(p.vendor, '')));
end $$;

-- Verify: another member has seen the proof and agrees. Never the person who recorded it, never the receiver themselves.
create or replace function public.saath_payout_verify(p_payout uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.saath_payouts; me uuid;
begin
  select * into p from public.saath_payouts where id = p_payout;
  if p.id is null then raise exception 'not_found'; end if;
  if not public.saath_is_member(p.circle_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p.created_by = auth.uid() then raise exception 'cannot_verify_own'; end if;
  select m.id into me from public.saath_members m join public.saath_payees y on y.member_id = m.id
   where y.id = p.payee_id and m.user_id = auth.uid();
  if me is not null then raise exception 'cannot_verify_own'; end if;
  if p.status = 'questioned' and p.questioned_by <> auth.uid() then raise exception 'questioned_by_other'; end if;
  update public.saath_payouts set status = 'verified', verified_by = auth.uid(), verified_at = now(), updated_at = now() where id = p_payout;
  insert into public.saath_activity (circle_id, actor, verb, data) values (p.circle_id, auth.uid(), 'payout_verified',
    jsonb_build_object('payout', p.id, 'amount', p.amount, 'vendor', coalesce(p.vendor, '')));
end $$;

-- Question: something looks wrong (no proof, wrong amount, bill not actually paid). Anyone except the recorder.
create or replace function public.saath_payout_question(p_payout uuid, p_question text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.saath_payouts;
begin
  select * into p from public.saath_payouts where id = p_payout;
  if p.id is null then raise exception 'not_found'; end if;
  if not public.saath_is_member(p.circle_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p.created_by = auth.uid() then raise exception 'cannot_question_own'; end if;
  if length(btrim(coalesce(p_question, ''))) < 3 then raise exception 'question_required'; end if;
  update public.saath_payouts set status = 'questioned', question = left(btrim(p_question), 500), questioned_by = auth.uid(),
    questioned_at = now(), verified_by = null, verified_at = null, updated_at = now() where id = p_payout;
  insert into public.saath_activity (circle_id, actor, verb, data) values (p.circle_id, auth.uid(), 'payout_questioned',
    jsonb_build_object('payout', p.id, 'amount', p.amount, 'vendor', coalesce(p.vendor, ''), 'question', left(btrim(p_question), 140)));
end $$;

-- The person who asked the question (or an organiser who isn't the receiver) can withdraw it.
create or replace function public.saath_payout_clear_question(p_payout uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.saath_payouts;
begin
  select * into p from public.saath_payouts where id = p_payout;
  if p.id is null or p.status <> 'questioned' then raise exception 'not_found'; end if;
  if not (p.questioned_by = auth.uid() or (public.saath_is_admin(p.circle_id) and p.created_by <> auth.uid()
          and not exists (select 1 from public.saath_payees y join public.saath_members m on m.id = y.member_id
                          where y.id = p.payee_id and m.user_id = auth.uid())))
  then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.saath_payouts set status = 'recorded', updated_at = now() where id = p_payout;
  insert into public.saath_activity (circle_id, actor, verb, data) values (p.circle_id, auth.uid(), 'payout_question_cleared',
    jsonb_build_object('payout', p.id, 'amount', p.amount, 'vendor', coalesce(p.vendor, '')));
end $$;

-- Remove a mistaken entry: recorder or organiser, never once verified. The log keeps what was removed.
create or replace function public.saath_payout_delete(p_payout uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.saath_payouts;
begin
  select * into p from public.saath_payouts where id = p_payout;
  if p.id is null then raise exception 'not_found'; end if;
  if not (p.created_by = auth.uid() or public.saath_is_admin(p.circle_id)) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p.status = 'verified' then raise exception 'locked'; end if;
  insert into public.saath_activity (circle_id, actor, verb, data) values (p.circle_id, auth.uid(), 'payout_deleted',
    jsonb_build_object('amount', p.amount, 'vendor', coalesce(p.vendor, ''), 'paid_on', p.paid_on,
      'payee', (select name from public.saath_payees where id = p.payee_id),
      'bills', (select coalesce(jsonb_agg(jsonb_build_object('title', e.title, 'amount', i.amount)), '[]'::jsonb)
                  from public.saath_payout_items i join public.saath_expenses e on e.id = i.expense_id where i.payout_id = p.id)));
  delete from public.saath_payouts where id = p_payout;
end $$;

-- Paid status of every bill: member_paid | paid | verified | partial | unpaid (+ questioned flag)
create or replace function public.saath_bill_status(p_circle uuid)
returns table (expense_id uuid, status text, paid numeric, questioned boolean, payouts int)
language sql stable security definer set search_path = '' as $$
  select e.id,
    case when e.paid_by_member_id is not null then 'member_paid'
         when coalesce(x.paid, 0) >= e.amount - 1 and x.unverified = 0 then 'verified'
         when coalesce(x.paid, 0) >= e.amount - 1 then 'paid'
         when coalesce(x.paid, 0) > 0 then 'partial'
         else 'unpaid' end,
    case when e.paid_by_member_id is not null then e.amount else coalesce(x.paid, 0) end,
    coalesce(x.questioned, false), coalesce(x.n, 0)::int
  from public.saath_expenses e
  left join (select i.expense_id, sum(i.amount) paid, count(*) n,
                    count(*) filter (where p.status <> 'verified') unverified, bool_or(p.status = 'questioned') questioned
               from public.saath_payout_items i join public.saath_payouts p on p.id = i.payout_id
              where p.circle_id = p_circle group by i.expense_id) x on x.expense_id = e.id
  where e.circle_id = p_circle and public.saath_is_member(p_circle);
$$;

-- Everything the Money trail screen needs, in one call.
create or replace function public.saath_money_trail(p_circle uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare res jsonb; days int; def uuid;
begin
  if not public.saath_is_member(p_circle) then raise exception 'not a member'; end if;
  select trail_alert_days into days from public.saath_circles where id = p_circle;
  select id into def from public.saath_payees where circle_id = p_circle order by is_default desc, created_at limit 1;

  with ins as (   -- money into each payee: confirmed payments (no payee given = the default payee)
    select coalesce(c.payee_id, def) payee_id, c.id, c.paid_on d, c.amount, c.method, c.reference, c.proof_path is not null proof,
           (select display_name from public.saath_members where id = c.member_id) who, c.created_at
      from public.saath_contributions c where c.circle_id = p_circle and c.kind = 'payment' and c.status = 'confirmed'),
  reimb as (      -- money paid back to members out of the pool
    select coalesce(c.payee_id, def) payee_id, c.id, c.paid_on d, c.amount, c.method, c.reference, c.proof_path is not null proof,
           (select display_name from public.saath_members where id = c.member_id) who, c.created_at
      from public.saath_contributions c where c.circle_id = p_circle and c.kind = 'reimbursement' and c.status = 'confirmed'),
  outs as (
    select p.*, (select coalesce(sum(amount), 0) from public.saath_payout_items i where i.payout_id = p.id) allocated
      from public.saath_payouts p where p.circle_id = p_circle),
  bills as (select b.*, e.title, e.amount, e.spent_on, e.vendor, e.category, (current_date - e.spent_on) age
              from public.saath_bill_status(p_circle) b join public.saath_expenses e on e.id = b.expense_id),
  holders as (
    select y.id, y.name, y.kind, y.member_id,
      (select coalesce(sum(amount), 0) from ins where ins.payee_id = y.id) received,
      (select coalesce(sum(amount), 0) from outs where outs.payee_id = y.id) paid_out,
      (select coalesce(sum(amount), 0) from reimb where reimb.payee_id = y.id) reimbursed,
      (select coalesce(sum(amount), 0) from outs where outs.payee_id = y.id and outs.status = 'verified') verified,
      (select coalesce(sum(amount), 0) from outs where outs.payee_id = y.id and outs.proof_path is null) no_proof,
      (select max(paid_on) from outs where outs.payee_id = y.id) last_payout,
      (select max(d) from ins where ins.payee_id = y.id) last_received
    from public.saath_payees y where y.circle_id = p_circle)
  select jsonb_build_object(
    'alert_days', days,
    'can_record', (select coalesce(jsonb_agg(y.id), '[]'::jsonb) from public.saath_payees y where y.circle_id = p_circle and public.saath_can_pay_from(y.id)),
    'holders', (select coalesce(jsonb_agg(jsonb_build_object('payee_id', id, 'name', name, 'kind', kind, 'member_id', member_id,
        'received', received, 'paid_out', paid_out, 'reimbursed', reimbursed, 'balance', received - paid_out - reimbursed,
        'verified', verified, 'no_proof', no_proof, 'last_payout', last_payout, 'last_received', last_received)
        order by received desc), '[]'::jsonb) from holders where received > 0 or paid_out > 0 or reimbursed > 0),
    'totals', jsonb_build_object(
        'bills', (select coalesce(sum(amount), 0) from bills),
        'bills_paid', (select coalesce(sum(least(paid, amount)), 0) from bills),
        'bills_unpaid', (select coalesce(sum(greatest(amount - paid, 0)), 0) from bills),
        'unpaid_count', (select count(*) from bills where status in ('unpaid', 'partial')),
        'held', (select coalesce(sum(received - paid_out - reimbursed), 0) from holders)),
    'bills', (select coalesce(jsonb_agg(jsonb_build_object('id', expense_id, 'title', title, 'amount', amount, 'paid', paid,
        'status', status, 'questioned', questioned, 'spent_on', spent_on, 'vendor', vendor, 'category', category, 'age', age)
        order by spent_on, title), '[]'::jsonb) from bills where status in ('unpaid', 'partial')),
    'payouts', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'payee_id', o.payee_id,
        'payee', (select name from public.saath_payees where id = o.payee_id), 'vendor', o.vendor, 'amount', o.amount,
        'allocated', o.allocated, 'paid_on', o.paid_on, 'method', o.method, 'reference', o.reference, 'proof_path', o.proof_path,
        'notes', o.notes, 'status', o.status, 'question', o.question, 'created_at', o.created_at,
        'mine', o.created_by = auth.uid(),
        'recorded_by', (select full_name from public.saath_profiles where id = o.created_by),
        'verified_by', (select full_name from public.saath_profiles where id = o.verified_by), 'verified_at', o.verified_at,
        'questioned_by', (select full_name from public.saath_profiles where id = o.questioned_by), 'questioned_at', o.questioned_at,
        'asked_by_me', o.questioned_by = auth.uid(),
        'i_am_receiver', exists (select 1 from public.saath_payees y join public.saath_members m on m.id = y.member_id
                                  where y.id = o.payee_id and m.user_id = auth.uid()),
        'items', (select coalesce(jsonb_agg(jsonb_build_object('expense_id', i.expense_id, 'title', e.title, 'amount', i.amount,
                    'bill_amount', e.amount, 'spent_on', e.spent_on)), '[]'::jsonb)
                    from public.saath_payout_items i join public.saath_expenses e on e.id = i.expense_id where i.payout_id = o.id))
        order by o.paid_on desc, o.created_at desc), '[]'::jsonb) from outs o),
    'ledger', (select coalesce(jsonb_agg(l order by l->>'d', l->>'at'), '[]'::jsonb) from (
        select jsonb_build_object('payee_id', payee_id, 'type', 'in', 'd', d, 'at', created_at, 'amount', amount, 'who', who,
                                  'method', method, 'reference', reference, 'proof', proof) l from ins
        union all
        select jsonb_build_object('payee_id', payee_id, 'type', 'reimb', 'd', d, 'at', created_at, 'amount', amount, 'who', who,
                                  'method', method, 'reference', reference, 'proof', proof) from reimb
        union all
        select jsonb_build_object('payee_id', payee_id, 'type', 'out', 'd', paid_on, 'at', created_at, 'amount', amount, 'who', vendor,
                                  'method', method, 'reference', reference, 'proof', proof_path is not null, 'status', status, 'id', id) from outs) z),
    'checks', (select coalesce(jsonb_agg(c), '[]'::jsonb) from (
        -- a bill unpaid for longer than the circle allows
        select jsonb_build_object('code', 'bill_unpaid', 'severity', case when b.age > days * 3 then 'high' else 'medium' end,
                 'expense_id', b.expense_id, 'title', b.title, 'amount', b.amount - b.paid, 'days', b.age) c
          from bills b where b.status in ('unpaid', 'partial') and b.age > days
        union all
        select jsonb_build_object('code', 'payout_no_proof', 'severity', 'medium', 'payout_id', o.id, 'vendor', o.vendor, 'amount', o.amount, 'payee',
                 (select name from public.saath_payees where id = o.payee_id))
          from outs o where o.proof_path is null and o.status <> 'verified'
        union all
        select jsonb_build_object('code', 'payout_unverified', 'severity', 'low', 'payout_id', o.id, 'vendor', o.vendor, 'amount', o.amount,
                 'days', current_date - o.created_at::date)
          from outs o where o.status = 'recorded' and o.created_at < now() - interval '3 days'
        union all
        select jsonb_build_object('code', 'payout_questioned', 'severity', 'high', 'payout_id', o.id, 'vendor', o.vendor, 'amount', o.amount, 'question', o.question)
          from outs o where o.status = 'questioned'
        union all
        -- money sitting with someone while bills wait
        select jsonb_build_object('code', 'money_held_bills_waiting', 'severity', 'high', 'payee', h.name,
                 'held', h.received - h.paid_out - h.reimbursed,
                 'unpaid', (select coalesce(sum(b.amount - b.paid), 0) from bills b where b.status in ('unpaid', 'partial') and b.age > days))
          from holders h where h.kind = 'person' and h.received - h.paid_out - h.reimbursed > 1
           and exists (select 1 from bills b where b.status in ('unpaid', 'partial') and b.age > days)
        union all
        -- paid out more than received: the receiver is covering from their own pocket (good to know, not a problem)
        select jsonb_build_object('code', 'holder_advanced', 'severity', 'info', 'payee', h.name, 'amount', -(h.received - h.paid_out - h.reimbursed))
          from holders h where h.kind = 'person' and h.received - h.paid_out - h.reimbursed < -1
        union all
        -- payout amount not linked to any bill (an advance or deposit): fine, but say so
        select jsonb_build_object('code', 'payout_unallocated', 'severity', 'info', 'payout_id', o.id, 'vendor', o.vendor, 'amount', o.amount - o.allocated)
          from outs o where o.amount - o.allocated > 1
      ) x)
  ) into res;
  return res;
end $$;

revoke all on function public.saath_can_pay_from(uuid) from public, anon;
revoke all on function public.saath_payout_record(uuid, numeric, date, text, text, text, text, text, jsonb) from public, anon;
revoke all on function public.saath_payout_add_proof(uuid, text, text, text) from public, anon;
revoke all on function public.saath_payout_verify(uuid) from public, anon;
revoke all on function public.saath_payout_question(uuid, text) from public, anon;
revoke all on function public.saath_payout_clear_question(uuid) from public, anon;
revoke all on function public.saath_payout_delete(uuid) from public, anon;
revoke all on function public.saath_bill_status(uuid) from public, anon;
revoke all on function public.saath_money_trail(uuid) from public, anon;
grant execute on function public.saath_can_pay_from(uuid) to authenticated;
grant execute on function public.saath_payout_record(uuid, numeric, date, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.saath_payout_add_proof(uuid, text, text, text) to authenticated;
grant execute on function public.saath_payout_verify(uuid) to authenticated;
grant execute on function public.saath_payout_question(uuid, text) to authenticated;
grant execute on function public.saath_payout_clear_question(uuid) to authenticated;
grant execute on function public.saath_payout_delete(uuid) to authenticated;
grant execute on function public.saath_bill_status(uuid) to authenticated;
grant execute on function public.saath_money_trail(uuid) to authenticated;
