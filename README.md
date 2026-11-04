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
