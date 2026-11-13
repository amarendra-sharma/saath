// saath-remind — periodic dues reminders over WhatsApp (Meta Cloud API) and e-mail (Resend).
// Deploy with verify_jwt = false (it checks auth itself):
//   * scheduled: pg_cron POSTs {} with header  x-saath-cron: <vault saath_cron_secret>
//   * manual:    the app POSTs {circle_id} with the organiser's JWT
// Secrets:
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID   (Meta WhatsApp Cloud API; optional)
//   WHATSAPP_TEMPLATE  (default "bengu_dues_reminder"; 4 body params: name, circle, amount, due date)
//   RESEND_API_KEY (already set), SAATH_EMAIL_FROM (optional)
// The cron key lives in Supabase Vault (saath_cron_secret), checked via saath_check_cron().
// If a channel isn't configured the attempt is logged as "skipped" — nothing breaks.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-saath-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

type Item = {
  circle_id: string; circle: string; currency: string; period_start: string; due_date: string;
  whatsapp: boolean; email: boolean; member_id: string; name: string; phone: string | null;
  mail: string | null; language: string; amount: number;
};

const LOCALE: Record<string, string> = { en: "en-IN", hi: "hi-IN", es: "es-ES", fr: "fr-FR", pt: "pt-BR", bn: "bn-IN" };
const WA_LANG: Record<string, string> = { en: "en", hi: "hi", es: "es", fr: "fr", pt: "pt_BR", bn: "bn" };

const TXT: Record<string, { subject: (c: string) => string; body: (n: string, c: string, a: string, d: string, pay: string) => string }> = {
  en: {
    subject: (c) => `Bengu reminder: your share for ${c}`,
    body: (n, c, a, d, pay) => `Hello ${n},\n\nThis is a friendly reminder from Bengu for "${c}".\nYour share currently due is ${a} (by ${d}).\n${pay}\nOnce you have paid, please mark it in the Bengu app so everyone can see it.\n\nThank you for being there.\n— Bengu`,
  },
  hi: {
    subject: (c) => `Bengu अनुस्मारक: ${c} में आपका हिस्सा`,
    body: (n, c, a, d, pay) => `नमस्ते ${n},\n\n"${c}" के लिए Bengu की ओर से एक विनम्र अनुस्मारक।\nआपका बकाया हिस्सा ${a} है (${d} तक)।\n${pay}\nभुगतान के बाद कृपया Bengu ऐप में दर्ज करें ताकि सभी देख सकें।\n\nसाथ देने के लिए धन्यवाद।\n— Bengu`,
  },
  es: {
    subject: (c) => `Recordatorio de Bengu: tu parte de ${c}`,
    body: (n, c, a, d, pay) => `Hola ${n}:\n\nTe recordamos desde Bengu para "${c}".\nTu parte pendiente es ${a} (antes del ${d}).\n${pay}\nCuando pagues, márcalo en la app Bengu para que todos lo vean.\n\nGracias por estar ahí.\n— Bengu`,
  },
  fr: {
    subject: (c) => `Rappel Bengu : votre part pour ${c}`,
    body: (n, c, a, d, pay) => `Bonjour ${n},\n\nPetit rappel de Bengu pour « ${c} ».\nVotre part à régler est de ${a} (avant le ${d}).\n${pay}\nUne fois payé, indiquez-le dans l'application Bengu pour que tout le monde le voie.\n\nMerci de votre soutien.\n— Bengu`,
  },
  pt: {
    subject: (c) => `Lembrete do Bengu: sua parte de ${c}`,
    body: (n, c, a, d, pay) => `Olá ${n},\n\nUm lembrete do Bengu para "${c}".\nSua parte pendente é ${a} (até ${d}).\n${pay}\nDepois de pagar, registre no app Bengu para que todos vejam.\n\nObrigado pelo apoio.\n— Bengu`,
  },
  bn: {
    subject: (c) => `Bengu অনুস্মারক: ${c}-এ আপনার অংশ`,
    body: (n, c, a, d, pay) => `নমস্কার ${n},\n\n"${c}"-এর জন্য Bengu থেকে একটি অনুস্মারক।\nআপনার বকেয়া অংশ ${a} (${d}-এর মধ্যে)।\n${pay}\nপরিশোধের পর অনুগ্রহ করে Bengu অ্যাপে চিহ্নিত করুন যাতে সবাই দেখতে পান।\n\nপাশে থাকার জন্য ধন্যবাদ।\n— Bengu`,
  },
};
const PAY_HDR: Record<string, string> = { en: "You can pay to:", hi: "आप यहाँ भुगतान कर सकते हैं:", es: "Puedes pagar a:", fr: "Vous pouvez payer à :", pt: "Você pode pagar para:", bn: "আপনি এখানে পরিশোধ করতে পারেন:" };

const lang2 = (l: string) => (TXT[(l || "en").slice(0, 2)] ? (l || "en").slice(0, 2) : "en");
const money = (n: number, cur: string, l: string) => {
  try { return new Intl.NumberFormat(LOCALE[l] ?? "en-IN", { style: "currency", currency: cur }).format(n); }
  catch { return `${cur} ${n.toFixed(2)}`; }
};
const day = (d: string, l: string) => {
  try { return new Intl.DateTimeFormat(LOCALE[l] ?? "en-IN", { day: "numeric", month: "long", year: "numeric" }).format(new Date(d + "T12:00:00Z")); }
  catch { return d; }
};

async function payHint(circleId: string, l: string) {
  const { data } = await admin.from("saath_payees").select("name, is_default, saath_pay_methods(method, handle, label)")
    .eq("circle_id", circleId).order("is_default", { ascending: false }).limit(1);
  const p = data?.[0] as any;
  if (!p) return "";
  const lines = (p.saath_pay_methods ?? []).slice(0, 3)
    .filter((m: any) => m.handle).map((m: any) => `  • ${m.label || m.method.toUpperCase()}: ${m.handle}`);
  return lines.length ? `\n${PAY_HDR[l]} ${p.name}\n${lines.join("\n")}\n` : "";
}

async function sendWhatsApp(it: Item, l: string) {
  const token = Deno.env.get("WHATSAPP_TOKEN"), phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) return { status: "skipped", detail: "whatsapp not configured" };
  if (!it.phone) return { status: "skipped", detail: "no phone" };
  const to = it.phone.replace(/[^\d]/g, "");
  const template = Deno.env.get("WHATSAPP_TEMPLATE") ?? "bengu_dues_reminder";
  const params = [it.name, it.circle, money(it.amount, it.currency, l), day(it.due_date, l)]
    .map((text) => ({ type: "text", text }));
  const call = (code: string) => fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "template",
      template: { name: template, language: { code }, components: [{ type: "body", parameters: params }] },
    }),
  });
  let r = await call(WA_LANG[l] ?? "en");
  if (!r.ok && l !== "en") r = await call("en"); // template not approved in that language yet
  return r.ok ? { status: "sent", detail: null } : { status: "failed", detail: (await r.text()).slice(0, 400) };
}

async function sendEmail(it: Item, l: string, pay: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { status: "skipped", detail: "email not configured" };
  if (!it.mail) return { status: "skipped", detail: "no email" };
  const from = Deno.env.get("SAATH_EMAIL_FROM") ?? "Bengu <onboarding@resend.dev>";
  const t = TXT[l];
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [it.mail], subject: t.subject(it.circle),
      text: t.body(it.name, it.circle, money(it.amount, it.currency, l), day(it.due_date, l), pay),
    }),
  });
  return r.ok ? { status: "sent", detail: null } : { status: "failed", detail: (await r.text()).slice(0, 400) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    let circleId: string | null = null;
    let trigger: "scheduled" | "manual" = "scheduled";

    const cronHeader = req.headers.get("x-saath-cron");
    let isCron = false;
    if (cronHeader) {
      const { data: okCron } = await admin.rpc("saath_check_cron", { p_secret: cronHeader });
      isCron = okCron === true;
      if (!isCron) return json({ error: "unauthorized" }, 401);
    }
    if (!isCron) {
      // manual: caller must be an organiser of the circle
      const auth = req.headers.get("Authorization") ?? "";
      circleId = body.circle_id ?? null;
      if (!circleId || !auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
      const user = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: auth } }, auth: { persistSession: false },
      });
      const { data: ok } = await user.rpc("saath_is_admin", { p_circle: circleId });
      if (!ok) return json({ error: "forbidden" }, 403);
      const since = new Date(Date.now() - 6 * 3600_000).toISOString();
      const { count } = await admin.from("saath_notifications").select("id", { count: "exact", head: true })
        .eq("circle_id", circleId).eq("trigger", "manual").eq("status", "sent").gte("created_at", since);
      if ((count ?? 0) > 0 && !body.force) return json({ ok: true, throttled: true });
      trigger = "manual";
    } else {
      await admin.rpc("saath_daily");
    }

    const { data, error } = await admin.rpc("saath_reminder_batch", { p_circle: circleId });
    if (error) return json({ error: error.message }, 500);
    const items = (data ?? []) as Item[];
    const hints = new Map<string, string>();
    const results = { whatsapp: { sent: 0, failed: 0, skipped: 0 }, email: { sent: 0, failed: 0, skipped: 0 } };
    const log: any[] = [];

    for (const it of items) {
      const l = lang2(it.language);
      const hk = it.circle_id + l;
      if (!hints.has(hk)) hints.set(hk, await payHint(it.circle_id, l));
      if (it.whatsapp && it.phone) {
        const r = await sendWhatsApp(it, l);
        (results.whatsapp as any)[r.status]++;
        log.push({ circle_id: it.circle_id, member_id: it.member_id, channel: "whatsapp", trigger, period_start: it.period_start, amount: it.amount, ...r });
      }
      if (it.email && it.mail) {
        const r = await sendEmail(it, l, hints.get(hk)!);
        (results.email as any)[r.status]++;
        log.push({ circle_id: it.circle_id, member_id: it.member_id, channel: "email", trigger, period_start: it.period_start, amount: it.amount, ...r });
      }
    }
    if (log.length) await admin.from("saath_notifications").insert(log);
    return json({ ok: true, members: items.length, results });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
