-- Log of bill scans (cost tracking + daily limit for saath-scan).
create table public.saath_scans (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  circle_id     uuid not null references public.saath_circles(id) on delete cascade,
  path          text not null,
  model         text,
  status        text not null check (status in ('ok','failed')),
  input_tokens  integer,
  output_tokens integer,
  result        jsonb,
  detail        text,
  created_at    timestamptz not null default now()
);
create index on public.saath_scans (user_id, created_at desc);
alter table public.saath_scans enable row level security;
revoke all on public.saath_scans from anon;
create policy saath_scans_read on public.saath_scans for select to authenticated using (user_id = (select auth.uid()));
