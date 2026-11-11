-- Where Saath's visitors and new accounts come from (e.g. the Saath button on macronations.com).
-- First-party and minimal: no IP address, no device details, no third-party analytics.
-- A visit row = source/medium/page + a random id the browser keeps (to count unique visitors).
-- When that visitor signs up, the source is stored once against their account.

create table if not exists public.saath_visits (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  source     text check (source is null or length(source) <= 40),
  medium     text check (medium is null or length(medium) <= 40),
  page       text check (page is null or length(page) <= 60),
  mn_sid     text check (mn_sid is null or length(mn_sid) <= 64),   -- MacroNations session id, to match its click log
  visitor    text check (visitor is null or length(visitor) <= 40)
);
create index if not exists saath_visits_at on public.saath_visits (at desc);
alter table public.saath_visits enable row level security;
revoke all on public.saath_visits from anon, authenticated;

create table if not exists public.saath_signup_sources (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  source   text, medium text, mn_sid text, visitor text,
  at       timestamptz not null default now()
);
alter table public.saath_signup_sources enable row level security;
revoke all on public.saath_signup_sources from anon, authenticated;

-- Called by the public pages and the web app. Anyone may call it; it only ever inserts one short row,
-- and the same visitor on the same page within 30 minutes counts once.
create or replace function public.saath_track_visit(p_source text, p_medium text, p_page text, p_mn_sid text, p_visitor text)
returns void language plpgsql security definer set search_path = '' as $$
declare s text := lower(left(regexp_replace(coalesce(p_source, ''), '[^A-Za-z0-9_.-]', '', 'g'), 40));
        m text := lower(left(regexp_replace(coalesce(p_medium, ''), '[^A-Za-z0-9_.-]', '', 'g'), 40));
        pg text := left(regexp_replace(coalesce(p_page, ''), '[^A-Za-z0-9_./-]', '', 'g'), 60);
        v text := left(regexp_replace(coalesce(p_visitor, ''), '[^A-Za-z0-9_-]', '', 'g'), 40);
begin
  if v <> '' and exists (select 1 from public.saath_visits where visitor = v and page is not distinct from nullif(pg, '')
                          and at > now() - interval '30 minutes') then return; end if;
  insert into public.saath_visits (source, medium, page, mn_sid, visitor)
  values (nullif(s, ''), nullif(m, ''), nullif(pg, ''),
          nullif(left(regexp_replace(coalesce(p_mn_sid, ''), '[^A-Za-z0-9_-]', '', 'g'), 64), ''), nullif(v, ''));
end $$;

-- Called once by the app after sign-in: remembers where a NEW Saath user came from (profiles older than 3 days are ignored).
create or replace function public.saath_attribute_me(p_source text, p_medium text, p_mn_sid text, p_visitor text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  -- sign-in accounts are shared with the MacroNations courses, so "new" means a new Saath profile
  if not exists (select 1 from public.saath_profiles where id = auth.uid() and created_at > now() - interval '3 days') then return; end if;
  insert into public.saath_signup_sources (user_id, source, medium, mn_sid, visitor)
  values (auth.uid(),
          nullif(lower(left(regexp_replace(coalesce(p_source, ''), '[^A-Za-z0-9_.-]', '', 'g'), 40)), ''),
          nullif(lower(left(regexp_replace(coalesce(p_medium, ''), '[^A-Za-z0-9_.-]', '', 'g'), 40)), ''),
          nullif(left(regexp_replace(coalesce(p_mn_sid, ''), '[^A-Za-z0-9_-]', '', 'g'), 64), ''),
          nullif(left(regexp_replace(coalesce(p_visitor, ''), '[^A-Za-z0-9_-]', '', 'g'), 40), ''))
  on conflict (user_id) do nothing;
end $$;

-- Admin console: visits and sign-ups by source, last 30 days and all time.
create or replace function public.saath_admin_traffic()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.saath_admin_guard();
  return jsonb_build_object(
    'by_source', coalesce((select jsonb_agg(x order by (x->>'visits_30d')::int desc) from (
        select jsonb_build_object('source', coalesce(source, 'direct'),
          'visits_30d', count(*) filter (where at > now() - interval '30 days'),
          'visitors_30d', count(distinct visitor) filter (where at > now() - interval '30 days'),
          'visits_all', count(*),
          'signups_all', (select count(*) from public.saath_signup_sources g where coalesce(g.source, 'direct') = coalesce(v.source, 'direct')),
          'signups_30d', (select count(*) from public.saath_signup_sources g where coalesce(g.source, 'direct') = coalesce(v.source, 'direct') and g.at > now() - interval '30 days')) x
        from public.saath_visits v group by coalesce(source, 'direct'), v.source) y), '[]'::jsonb),
    'pages_30d', coalesce((select jsonb_agg(jsonb_build_object('page', page, 'visits', n) order by n desc) from (
        select coalesce(page, '/') page, count(*) n from public.saath_visits where at > now() - interval '30 days' group by 1) p), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'visits', n, 'from_macronations', mn) order by d) from (
        select to_char(date_trunc('day', at at time zone 'UTC'), 'YYYY-MM-DD') d, count(*) n, count(*) filter (where source = 'macronations') mn
          from public.saath_visits where at > now() - interval '30 days' group by 1) dd), '[]'::jsonb),
    'signups_total', (select count(*) from public.saath_profiles),
    'signups_30d', (select count(*) from public.saath_profiles where created_at > now() - interval '30 days'));
end $$;

revoke all on function public.saath_track_visit(text, text, text, text, text) from public;
revoke all on function public.saath_attribute_me(text, text, text, text) from public, anon;
revoke all on function public.saath_admin_traffic() from public, anon;
grant execute on function public.saath_track_visit(text, text, text, text, text) to anon, authenticated;
grant execute on function public.saath_attribute_me(text, text, text, text) to authenticated;
grant execute on function public.saath_admin_traffic() to authenticated;
