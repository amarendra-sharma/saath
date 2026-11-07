-- Settings added after the staging tests (6 Nov 2026). Additive only.
insert into public.saath_ai_config (key, value, note) values
 ('effort_verify', '"medium"', 'Effort for the short Sonnet amount check on escalated scans (low/medium/high; tested: same amounts, 448 vs 703 output tokens at high)'),
 ('server_resize', 'false', 'Resize photos in the edge function (off: 12 MP decode hits worker limits under load; the app resizes before upload)')
on conflict (key) do nothing;
