-- When shares change (or members are added), re-split existing bills that use the
-- circle's default shares. Bills with a custom per-bill split are left alone.
create or replace function public.saath_resplit(p_circle uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.saath_is_admin(p_circle) and current_user not in ('postgres', 'service_role') then
    raise exception 'only an organiser can re-split bills';
  end if;
  if (select split_mode from public.saath_circles where id = p_circle) <> 'expenses' then return; end if;

  delete from public.saath_charges ch
   using public.saath_expenses e
   where ch.expense_id = e.id and ch.source = 'expense' and e.circle_id = p_circle
     and (e.split is null or e.split = '{}'::jsonb or jsonb_typeof(e.split) <> 'object');

  insert into public.saath_charges (circle_id, member_id, amount, source, expense_id, on_date, created_by)
  select e.circle_id, s.member_id, s.amount, 'expense', e.id, e.spent_on, e.created_by
    from public.saath_expenses e
    cross join lateral public.saath_split(e.circle_id, e.amount, null) s
   where e.circle_id = p_circle
     and (e.split is null or e.split = '{}'::jsonb or jsonb_typeof(e.split) <> 'object');
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
  perform public.saath_resplit(p_circle);
end $$;

revoke execute on function public.saath_resplit(uuid) from public, anon;
grant execute on function public.saath_resplit(uuid) to authenticated;
