# Saath (साथ)

Saath helps a family share the cost of caring for someone over months or years: medical treatment, elder care, education or an event.

- **Every bill in one place.** Add a bill with a photo or PDF of the receipt. The amount is split automatically.
- **Shares each person chooses.** Use any percentages, equal or not. A single bill can be split differently when needed.
- **Two ways to share costs.** Split each actual bill, or set a fixed amount per period (for example ₹60,000 a month for a nurse).
- **Billing periods.** Weekly, fortnightly, monthly or quarterly, each with a due day. There's a statement for any date range, exportable as PDF or CSV.
- **Reminders on WhatsApp and email.** These go out automatically each period in the member's own language. The organiser can also send them on demand, or nudge one person on WhatsApp in a single tap.
- **Pay any free or low-cost way.** UPI, Wise, Remitly, Zelle, PayPal, Revolut, Venmo, Cash App, SEPA, Indian or international bank transfer, M-Pesa, Pix or cash. Money goes straight to the person or hospital you choose. Saath only shows the payment details and opens the payer's app.
- **Trust built in.** Payments can need the organiser's confirmation. Someone who pays a bill from their own pocket is credited automatically. There's a full activity log, a reminder log and reimbursements.
- **Family members without the app** can still be added and reminded. They can claim their place later.
- **Six languages:** English, हिन्दी, বাংলা, Español, Français, Português.
- **One codebase for iPhone, Android and the web** (Expo SDK 58 / React Native 0.88). The backend is Supabase.

## Folder layout

```
app.json, package.json, eas.json   app config (name, icons, bundle id com.macronations.saath)
src/app/                           screens (Expo Router — every file is a screen)
src/lib/                           data, money formatting, payments, translations (strings.*.ts)
src/components/                    shared UI
assets/                            icon, splash, favicon
supabase/migrations/               database (already applied to the live project)
supabase/functions/                edge functions (already deployed)
.github/workflows/                 cloud builds for the phone apps + web deploy
SETUP-GUIDE.md                     what's live, and the steps to the App Store / Play Store
```

## Backend (live)

The backend lives in the Supabase project **strategyarena** (`qgelvmefyexyzpwqupev`), because the free plan's two-project limit was reached. It's fully separated from the course data:

- Every table and function starts with `saath_`, row-level security is on everywhere, and signed-out and anonymous users get nothing.
- Receipts are stored in a private bucket, `saath-receipts`.
- There are four edge functions: `saath-signup`, `saath-reset`, `saath-remind` and `saath-account`.
- A daily job, `saath-daily-reminders`, runs at 13:23 UTC (6:53 pm in India, 8:23 am in New York).

To move Saath to its own project later, run the five migration files in order on the new project, deploy the four functions, and change `extra.supabaseUrl` and `extra.supabaseKey` in `app.json`.

## How Saath uses AI and what it costs

Saath calls Anthropic's Claude in two places: **reading a bill** (scan, to pre-fill the form) and **Bill Check** (looking for signs a bill is wrong). Every call is logged with its cost in `saath_ai_usage`; view `saath_ai_v_daily` shows spend per day, function and model.

**Reading a bill.** Claude Haiku (cheap) reads every file first. Claude Sonnet takes a second look at the amounts only when it isn't safe to trust Haiku alone: Haiku isn't confident, the bill is handwritten or in an Indian script, the numbers don't add up, or nothing was found. In tests Haiku and Sonnet agreed on handwritten amounts except one photo where both were unsure, so handwritten and Indian-script bills always get the Sonnet check (settings `haiku_handwritten`, `haiku_indic`). If both are unsure, the app shows the amount as low confidence for the family to check. It never guesses.

**Bill Check.** It runs cheapest first:
1. Rules in code, which are free: arithmetic, above-MRP prices, expired stock, the GSTIN checksum, duplicates, dates and the patient name.
2. The read from the scan is reused, so the file isn't read twice. A full Sonnet forensic read happens only when someone taps "Check again" on a bill of ₹10,000 or more (`escalate_amount`), a poor copy, or a bill that doesn't add up.
3. Prices are first compared with what other Saath users paid locally, which is free. A web search runs only for the top 3 items of ₹500 or more, at most 2 searches, and only when local data is thin. Results are cached for 30 days and shared across circles. Web search never runs on the automatic check after adding a bill. When `SAATH_BILL_CHECK_PAID=true`, it runs only on the paid plan.

**Cost per bill** (one phone photo, read and automatically checked; measured November 2026):

| Bill | Before | Now |
|---|---|---|
| Printed, clear | ~$0.04 | ~$0.0013 |
| Handwritten, photo resized by the app (1600 px) | ~$0.04 | ~$0.011–0.015 |
| Handwritten, full-size photo (older app) | ~$0.04 | ~$0.016 |
| "Check again" on a handwritten bill of ₹10,000+ | ~$0.02 | +~$0.013–0.022 |

**Limits** (table `saath_ai_config`; change a value with `update saath_ai_config set value='10' where key='daily_cap_usd';`):
- $2 per circle per month (`saath_circles.ai_monthly_cap_usd`). When it runs out, the app says so, bills can still be added by hand, and the free rules still run.
- $5 per day across the whole app (`daily_cap_usd`).
- 30 scans per person per day, 40 checks per circle per day, and 20 AI calls per person per hour.
- Files over 15 MB or PDFs over 40 pages are refused with a clear message.
- An alert row goes into `saath_ai_alerts` (emailed through Resend if `RESEND_API_KEY` is set) the first time a day's spend passes $1 (`alert_daily_usd`), or when a cap is hit.

**Secrets / settings the functions read** (Supabase → Edge Functions → Secrets): `ANTHROPIC_API_KEY` (required); optional `SAATH_FAST_MODEL` (default `claude-haiku-5-5`), `SAATH_STRONG_MODEL` (default `claude-sonnet-5-5`), `SAATH_PRICE_MODEL` (default Haiku), `SAATH_BILL_CHECK_PAID` (`true` = web price check only on the paid plan), `RESEND_API_KEY` and `SAATH_EMAIL_FROM` (alert emails). The older `SAATH_SCAN_MODEL` / `SAATH_CHECK_MODEL` are no longer used.

**Quality test.** `eval/compare.py` compares Haiku against Sonnet on a test set and fails if handwritten or Indian-language amounts differ. Run it again whenever models or prompts change.

## Admin console

Admins see a shield button on the home screen and an "Admin console" button in Profile (route `/admin`). It has four tabs:
- **Overview:** AI spend today, this month and all time, with the daily cap and a 30-day chart; counts of people, circles, bills and scans; spend by feature; alerts; and a banner when Anthropic credit runs out.
- **Circles:** plan (Free/Plus), the monthly AI allowance, automatic Bill Check, and archiving.
- **People:** search everyone, and make someone an admin or remove admin access.
- **Settings:** feature switches (AI bill reading, AI in Bill Check, web price search, Bill Check only on Plus), limits, alerts and advanced AI settings. Changes apply to the next bill read or check.

Admins are listed in `saath_admins` (first admin: the owner). Every admin action goes through a SECURITY DEFINER function that refuses non-admins (migration 013). The app never holds a service key.
