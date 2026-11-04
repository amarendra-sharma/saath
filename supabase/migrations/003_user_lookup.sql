-- Server-only helpers for the edge functions.
create or replace function public.saath_user_id_by_email(p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(btrim(p_email)) limit 1;
$$;
revoke all on function public.saath_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.saath_user_id_by_email(text) to service_role;
grant execute on function public.saath_reminder_batch(uuid), public.saath_daily(), public.saath_post_budget(uuid) to service_role;
