# Saath setup guide

Everything here is done through GitHub Desktop and websites. No Terminal needed.

## 0. Already done for you

| Part | Status |
|---|---|
| Database: 12 tables, money ledger, security rules | Live in Supabase project *strategyarena* and tested |
| Receipt storage (private) | Live |
| Sign-up, password reset, reminders, account deletion | Deployed and tested |
| Daily reminder job (13:23 UTC) | Scheduled and tested |
| iPhone / Android / web app | Code complete. Web build tested on a phone-sized screen |
| Email reminders | Wired to your existing Resend key. **Needs step 6 before real families get them** |
| WhatsApp reminders | Wired to the Meta Cloud API. **Needs step 5.** The one-tap "Remind on WhatsApp" button already works without it |

---

## 1. Put the code on GitHub (GitHub Desktop)

1. Open GitHub Desktop and choose **File → Add Local Repository**. Pick `Documents/GitHub/saath`.
2. When it says this isn't a repository yet, click **create a repository**, then **Publish repository**. Name it `saath` and keep it **private**.

## 2. Use it on the web right away (optional)

1. On github.com, open the `saath` repo and go to **Settings → Pages**. Set **Source** to **GitHub Actions**.
2. The "Deploy Saath web" action runs on every push. The app is served at **https://saath.macronations.com** (like the other MacroNations courses):
   - DNS: a **CNAME** record `saath → amarendra-sharma.github.io` at the macronations.com DNS provider.
   - GitHub: Settings → Pages → Custom domain = `saath.macronations.com`, then tick **Enforce HTTPS** once it's offered.
   - The app is built for the domain's root (no `/saath` path), so the old `amarendra-sharma.github.io/saath/` address redirects to the new one.

## 3. Build the phone apps (Expo, free tier)

1. Create a free account at **expo.dev**. Go to **Account settings → Access tokens → Create token**.
2. In the GitHub repo, go to **Settings → Secrets and variables → Actions → New secret**. Name it `EXPO_TOKEN` and paste the token.
3. Go to **Actions → Build Saath apps → Run workflow** and use these settings:
   - platform `android`
   - profile `preview`
4. The build appears on expo.dev under **Projects → saath → Builds** in about 15 minutes. Open the link on an Android phone to install it and try it.

## 4. Publish to the stores

You need two store accounts:

- **Google Play** costs a one-time **$25** at play.google.com/console.
- **Apple App Store** costs **$99 a year** at developer.apple.com.

Both stores ask for:

- **A privacy-policy web page.** It's written: `public/privacy.html`, linked in the app (sign-up screen and Profile). Once step 2 is done it's live at `https://saath.macronations.com/privacy.html`. Paste that URL into both store listings. Make sure `privacy@macronations.com` receives mail, or change the address in the file.
- **Screenshots.** I made phone screenshots during testing that you can use.
- **Account deletion.** Already built: Profile → Delete my account.
- **Short description:** "Share the cost of caring for someone you love — bills, receipts, fair splits and gentle reminders."

**Android**

1. In Play Console, create the app with package name `com.macronations.saath`.
2. Run the workflow with platform `android` and profile `production`.
3. Download the `.aab` from expo.dev and upload it in Play Console under **Testing → Internal testing**. Google requires the first upload to be done by hand.
4. Later releases can use `submit: true`.

**iPhone**

1. In App Store Connect, create the app with bundle ID `com.macronations.saath`.
2. Under **Users and Access → Integrations**, create an **App Store Connect API key** (Admin role).
3. On expo.dev, open the project's **Credentials → iOS** page and add that key. Expo then creates the certificates for you.
4. Run the workflow with platform `ios`, profile `production` and submit `true`. The build goes to TestFlight, and from there you submit it for review.

## 5. Turn on automatic WhatsApp reminders

Without this step, the app still has one-tap "Remind on WhatsApp" buttons, which open WhatsApp with the message filled in. This step adds the **automatic** periodic messages.

1. At **business.facebook.com**, create or choose your business. Then at **developers.facebook.com**, go to **Create app → Business → add WhatsApp**.
2. Add and verify a phone number for sending. It can't be a number already used in the normal WhatsApp app.
3. Create a **permanent token**: Business Settings → System users → add an Admin user → Generate token with `whatsapp_business_messaging`.
4. Copy the **Phone number ID** from WhatsApp → API Setup.
5. Go to **WhatsApp Manager → Message templates → Create**. Use these settings:
   - Category: **Utility**
   - Name: `saath_dues_reminder`
   - Add one language version for each language your family uses. The body must use exactly these 4 variables.

| Language (Meta code) | Template body |
|---|---|
| English (`en`) | Hello {{1}}, this is a reminder from Saath for "{{2}}". Your share currently due is {{3}}, by {{4}}. Please pay when you can and mark it in the Saath app. Thank you. |
| Hindi (`hi`) | नमस्ते {{1}}, "{{2}}" के लिए साथ की ओर से अनुस्मारक। आपका बकाया हिस्सा {{3}} है, {{4}} तक। सुविधा अनुसार भुगतान करें और साथ ऐप में दर्ज करें। धन्यवाद। |
| Bengali (`bn`) | নমস্কার {{1}}, "{{2}}"-এর জন্য সাথ থেকে অনুস্মারক। আপনার বকেয়া অংশ {{3}}, {{4}}-এর মধ্যে। সুবিধামতো পরিশোধ করে সাথ অ্যাপে লিখে রাখুন। ধন্যবাদ। |
| Spanish (`es`) | Hola {{1}}, te recordamos desde Saath para "{{2}}". Tu parte pendiente es {{3}}, antes del {{4}}. Paga cuando puedas y márcalo en la app Saath. Gracias. |
| French (`fr`) | Bonjour {{1}}, rappel de Saath pour « {{2}} ». Votre part due est de {{3}}, avant le {{4}}. Payez dès que possible et indiquez-le dans l'application Saath. Merci. |
| Portuguese (`pt_BR`) | Olá {{1}}, lembrete do Saath para "{{2}}". Sua parte em aberto é {{3}}, até {{4}}. Pague quando puder e registre no app Saath. Obrigado. |

6. In **Supabase → strategyarena → Edge Functions → Secrets**, add:
   - `WHATSAPP_TOKEN`: the permanent token
   - `WHATSAPP_PHONE_NUMBER_ID`: the ID from API Setup

If a language version isn't approved yet, Saath falls back to the English template automatically. Meta charges a small fee per utility message, which depends on the recipient's country.

## 6. Turn on email reminders for everyone

Your Resend account currently sends from `onboarding@resend.dev`. Resend only delivers mail from that address to the account owner's own inbox.

1. In **resend.com → Domains**, add `macronations.com` and add the DNS records it shows.
2. In Supabase Edge Function secrets, add `SAATH_EMAIL_FROM` with the value `Saath <saath@macronations.com>`.

## 7. Turn on bill scanning

"Scan a bill" (Add a bill screen) reads photos, scans and PDFs, printed or handwritten, in any language. It fills in the amount, date, who was paid and the category. A PDF holding many bills becomes a review list. Payment slips, deposit receipts and settlement summaries are left unticked so nothing is counted twice.

1. Get an API key at **console.anthropic.com → API keys** and add some credit.
2. In **Supabase → strategyarena → Edge Functions → Secrets → Add new secret**, set the name to `ANTHROPIC_API_KEY` and paste the key.
3. Optional: add `SAATH_SCAN_MODEL` to choose the model. The default, `claude-sonnet-5-5`, handles handwriting well. `claude-haiku-5-5` is cheaper.

Cost is roughly ₹1–2 for a one-page bill, and more for long scanned PDFs, since each page is read as an image. Each person is limited to 80 scans a day. Usage is logged in the `saath_scans` table.

---

## How the money works

- **Charge:** what a person is asked to pay.
  - In "split each bill" mode, it's their percentage of each bill.
  - In "fixed amount" mode, it's their percentage of the period's amount, posted on the due day.
  - The organiser can also add a manual adjustment.
- **Credit:** what a person has actually paid.
  - Confirmed payments count.
  - Bills they paid from their own pocket count in full.
  - Money the organiser paid back to them is subtracted.
- **Balance = charges − credits.** A positive balance means they still owe; a negative one means they paid extra.
- Changing someone's share affects new bills only. Past bills keep the split they had.
- **"Balance with [receiver]"** shows money received minus bills paid from the shared fund. A negative number means the receiver is out of pocket.

## Good to know

- **Saath shares sign-in with your course apps.** Saath users appear in strategyarena's Auth user list, and an existing MacroNations login also works in Saath. Course data stays invisible to Saath, and the reverse.
  - Saath creates its own accounts, which skips the course-branded confirmation email.
  - Saath sends its own password-reset codes.
  - Deleting a Saath account never removes a course login.
- **Adding a language:** copy `src/lib/strings.hi.ts`, translate it, and add it in `src/lib/strings.ts`.
- **Your live course projects were not changed,** except two standard Supabase extensions enabled in strategyarena: `pg_cron` (for the daily job) and `pg_net` (to call the reminder function).

## 8. Bill Check (overbilling and tampering warnings)

Bill Check is already switched on and uses the same `ANTHROPIC_API_KEY` as bill scanning. There's nothing to set up.

- **Where it shows:** on each bill (a "Bill Check" card), as a ⚠ badge in the Expenses list, and as a "Check all bills" button at the top of Expenses.
- **City for local prices:** Circle settings → Bill Check → City. Price lookups use it.
- **Cost:** about ₹2–8 per bill (the AI reads the bill, plus a few web searches). Price lookups are cached for 30 days, so the same medicine or test isn't looked up twice.

### Making it a paid feature later
1. In Supabase → Edge Functions → Secrets, add `SAATH_BILL_CHECK_PAID` = `true`.
2. In `src/lib/billcheck.ts`, change `BILL_CHECK_PAID = false` to `true` and push.
3. Mark paying circles with SQL: `update saath_circles set plan = 'plus' where id = '<circle id>';`
   (The app can't change `plan` itself, so members can't unlock it on their own.)
