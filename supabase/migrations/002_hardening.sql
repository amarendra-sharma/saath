-- Block anonymous sign-ins from Saath data; tighten function execute grants.
create or replace function public.saath_is_member(p_circle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false
     and exists (select 1 from public.saath_members
                 where circle_id = p_circle and user_id = auth.uid() and status = 'active');
$$;
create or replace function public.saath_is_admin(p_circle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false
     and exists (select 1 from public.saath_members
                 where circle_id = p_circle and user_id = auth.uid() and status = 'active' and role = 'admin');
$$;
create or replace function public.saath_ensure_profile()
returns public.saath_profiles language plpgsql security definer set search_path = '' as $$
declare p public.saath_profiles; u auth.users;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'not signed in'; end if;
  select * into p from public.saath_profiles where id = auth.uid();
  if found then return p; end if;
  select * into u from auth.users where id = auth.uid();
  insert into public.saath_profiles (id, full_name, email, language)
  values (u.id, coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1), ''), u.email,
          coalesce(u.raw_user_meta_data->>'language','en'))
  returning * into p;
  return p;
end $$;
revoke execute on function public.saath_is_member(uuid), public.saath_is_admin(uuid), public.saath_my_member_id(uuid),
  public.saath_storage_circle(text) from public, anon;
grant execute on function public.saath_is_member(uuid), public.saath_is_admin(uuid), public.saath_my_member_id(uuid),
  public.saath_storage_circle(text) to authenticated;
revoke execute on function public.saath_expense_sync(), public.saath_contribution_guard(), public.saath_member_guard(),
  public.saath_keep_an_admin(), public.saath_log(), public.saath_touch(), public.saath_split(uuid,numeric,jsonb),
  public.saath_new_code() from public, anon, authenticated;
revoke execute on function public.saath_ensure_profile(), public.saath_my_circles() from public, anon;
grant execute on function public.saath_ensure_profile(), public.saath_my_circles() to authenticated;
