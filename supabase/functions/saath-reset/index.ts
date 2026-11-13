// saath-reset — Bengu-branded password reset with a 6-digit code by e-mail.
// Deploy with verify_jwt = false.
//   { action: "send",   email, language }
//   { action: "verify", email, code, new_password }
// Needs RESEND_API_KEY (already a project secret). Optional SAATH_EMAIL_FROM,
// e.g. "Bengu <saath@macronations.com>" once that domain is verified in Resend.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const T: Record<string, { subject: string; body: (c: string) => string }> = {
  en: { subject: "Your Bengu reset code", body: (c) => `Your Bengu password reset code is ${c}. It expires in 15 minutes. If you did not ask for this, you can ignore this e-mail.` },
  hi: { subject: "आपका Bengu रीसेट कोड", body: (c) => `आपका Bengu पासवर्ड रीसेट कोड ${c} है। यह 15 मिनट में समाप्त हो जाएगा। अगर आपने यह अनुरोध नहीं किया, तो इस ई-मेल को अनदेखा करें।` },
  es: { subject: "Tu código de Bengu", body: (c) => `Tu código para restablecer la contraseña de Bengu es ${c}. Caduca en 15 minutos. Si no lo solicitaste, ignora este correo.` },
  fr: { subject: "Votre code Bengu", body: (c) => `Votre code de réinitialisation Bengu est ${c}. Il expire dans 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.` },
  pt: { subject: "Seu código do Bengu", body: (c) => `Seu código para redefinir a senha do Bengu é ${c}. Ele expira em 15 minutos. Se você não pediu isso, ignore este e-mail.` },
  bn: { subject: "আপনার Bengu রিসেট কোড", body: (c) => `আপনার Bengu পাসওয়ার্ড রিসেট কোড ${c}। এটি ১৫ মিনিটে মেয়াদ শেষ হবে। আপনি অনুরোধ না করলে এই ই-মেইলটি উপেক্ষা করুন।` },
};

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function findUser(email: string) {
  const { data } = await admin.rpc("saath_user_id_by_email", { p_email: email });
  return data ? { id: data as string } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email) return json({ error: "invalid_email" }, 400);

    if (body.action === "send") {
      const lang = T[String(body.language ?? "en").slice(0, 2)] ? String(body.language).slice(0, 2) : "en";
      const user = await findUser(email);
      // Always answer the same way so the endpoint can't be used to probe e-mails.
      if (!user) return json({ ok: true });
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
      await admin.from("saath_reset_codes").upsert({
        email, code_hash: await sha(email + ":" + code), attempts: 0,
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      });
      const key = Deno.env.get("RESEND_API_KEY");
      if (!key) return json({ error: "email_not_configured" }, 503);
      const from = Deno.env.get("SAATH_EMAIL_FROM") ?? "Bengu <onboarding@resend.dev>";
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [email], subject: T[lang].subject, text: T[lang].body(code) }),
      });
      if (!r.ok) return json({ error: "email_failed", detail: await r.text() }, 502);
      return json({ ok: true });
    }

    if (body.action === "verify") {
      const pw = String(body.new_password ?? "");
      if (pw.length < 8) return json({ error: "weak_password" }, 400);
      const { data: row } = await admin.from("saath_reset_codes").select("*").eq("email", email).maybeSingle();
      if (!row || new Date(row.expires_at) < new Date() || row.attempts >= 5) return json({ error: "code_expired" }, 400);
      if (row.code_hash !== (await sha(email + ":" + String(body.code ?? "").trim()))) {
        await admin.from("saath_reset_codes").update({ attempts: row.attempts + 1 }).eq("email", email);
        return json({ error: "wrong_code" }, 400);
      }
      const user = await findUser(email);
      if (!user) return json({ error: "code_expired" }, 400);
      const { error } = await admin.auth.admin.updateUserById(user.id, { password: pw, email_confirm: true });
      if (error) return json({ error: "reset_failed", detail: error.message }, 400);
      await admin.from("saath_reset_codes").delete().eq("email", email);
      return json({ ok: true });
    }
    return json({ error: "bad_action" }, 400);
  } catch (err) {
    return json({ error: "bad_request", detail: String(err) }, 400);
  }
});
