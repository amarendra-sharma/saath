-- Daily job: post budget charges for new periods, then call saath-remind.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'saath_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'saath_cron_secret', 'Saath daily reminder job key');
  end if;
end $$;

create or replace function public.saath_check_cron(p_secret text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'saath_cron_secret' and decrypted_secret = p_secret);
$$;
revoke all on function public.saath_check_cron(text) from public, anon, authenticated;
grant execute on function public.saath_check_cron(text) to service_role;

create or replace function public.saath_cron_tick()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.saath_daily();
  perform net.http_post(
    url := 'https://qgelvmefyexyzpwqupev.supabase.co/functions/v1/saath-remind',
    headers := jsonb_build_object('Content-Type','application/json',
               'x-saath-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'saath_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
end $$;
revoke all on function public.saath_cron_tick() from public, anon, authenticated;

-- 13:23 UTC daily = 6:53 pm India, 8:23 am New York, 1:23 pm London
select cron.schedule('saath-daily-reminders', '23 13 * * *', $$select public.saath_cron_tick()$$);
