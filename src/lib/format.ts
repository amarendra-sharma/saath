const LOCALES: Record<string, string> = { en: "en-IN", hi: "hi-IN", es: "es-ES", fr: "fr-FR", pt: "pt-BR", bn: "bn-IN" };
export const localeFor = (lang: string) => LOCALES[lang] ?? "en-IN";

export function money(n: number | string | null | undefined, currency = "INR", lang = "en", opts: { compact?: boolean } = {}) {
  const v = Number(n ?? 0);
  try {
    return new Intl.NumberFormat(localeFor(lang), {
      style: "currency", currency,
      maximumFractionDigits: opts.compact || Number.isInteger(v) ? 0 : 2,
      minimumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}

export function dateLabel(d: string | Date | null | undefined, lang = "en", withYear = false) {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d.length === 10 ? d + "T12:00:00" : d) : d;
  try {
    return new Intl.DateTimeFormat(localeFor(lang), { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }).format(dt);
  } catch {
    return dt.toDateString();
  }
}

export function monthLabel(d: string, lang = "en") {
  const dt = new Date(d + "T12:00:00");
  try { return new Intl.DateTimeFormat(localeFor(lang), { month: "long", year: "numeric" }).format(dt); }
  catch { return d.slice(0, 7); }
}

export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** Parse "1,234.50" / "1.234,50" / "१२३" leniently into a number. */
export function parseAmount(s: string): number {
  const devanagari = "०१२३४५६७८९", bengali = "০১২৩৪৫৬৭৮৯";
  let t = (s || "").replace(/[०-९]/g, (c) => String(devanagari.indexOf(c))).replace(/[০-৯]/g, (c) => String(bengali.indexOf(c)));
  t = t.replace(/[^\d.,]/g, "");
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = /,\d{1,2}$/.test(t) ? t.replace(",", ".") : t.replace(/,/g, "");
  const n = parseFloat(t);
  return isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export const initials = (name: string) =>
  (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

export const CURRENCIES = ["INR", "USD", "GBP", "EUR", "CAD", "AUD", "AED", "SGD", "NZD", "CHF", "SAR", "QAR", "KWD", "BDT", "NPR", "LKR", "PKR", "KES", "NGN", "ZAR", "BRL", "MXN", "JPY", "MYR"];
