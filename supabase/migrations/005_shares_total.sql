-- Shares can never add up to more than 100% across the whole circle.
create or replace function public.saath_set_shares(p_circle uuid, p_shares jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare total numeric;
begin
  if not public.saath_is_admin(p_circle) then raise exception 'only an organiser can change shares'; end if;
  select coalesce(sum(case when p_shares ? m.id::text then (p_shares ->> m.id::text)::numeric else m.share_percent end), 0)
    into total from public.saath_members m where m.circle_id = p_circle and m.status = 'active';
  if total > 100.0001 then raise exception 'shares would add up to % percent (max 100)', round(total, 2); end if;
  update public.saath_members m set share_percent = round((p_shares ->> m.id::text)::numeric, 4)
   where m.circle_id = p_circle and p_shares ? m.id::text;
end $$;
