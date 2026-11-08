// Ways family members can send money — chosen so people anywhere can use
// a free or low-cost rail. The app never moves money itself: it opens the
// payer's own app/site with the details pre-filled, then they mark it paid.
import { epcPayload, pixPayload, upiPayload } from "./qr";

export type MethodKey =
  | "upi" | "bank_in" | "bank_intl" | "sepa" | "wise" | "paypal" | "revolut" | "zelle" | "venmo"
  | "cashapp" | "remitly" | "western_union" | "mpesa" | "pix" | "cash" | "other";

export type Field = { key: string; labelKey: string; placeholder?: string; keyboard?: "default" | "email-address" | "phone-pad" };

export type MethodDef = {
  key: MethodKey;
  name: string;           // brand names are not translated
  icon: string;           // Ionicons name
  region: string;         // translation key for where it's typically used
  costKey: string;        // translation key: "usually free" / "low fee" …
  handleLabelKey: string; // what the main field means
  handlePlaceholder: string;
  fields?: Field[];       // extra details (bank etc.)
  link?: (p: LinkArgs) => string | null;
  /** A standard payment QR code that the payer's app scans (UPI, Pix, SEPA "GiroCode"). */
  qr?: (p: LinkArgs) => string | null;
  qrHintKey?: string;
  /** Plain-words steps when there is no link (Zelle lives inside bank apps, M-Pesa in the SIM menu, …). */
  howKey?: string;
};
export type LinkArgs = { handle: string; amount: number; currency: string; name: string; note: string; details: Record<string, string>; city: string };

const enc = encodeURIComponent;

export const METHODS: MethodDef[] = [
  { key: "upi", name: "UPI", icon: "phone-portrait-outline", region: "region_india", costKey: "cost_free",
    handleLabelKey: "f_upi_id", handlePlaceholder: "name@okbank",
    link: ({ handle, amount, currency, name, note }) => (currency === "INR" && handle.includes("@") ? upiPayload(handle, name, amount, note) : null),
    qr: ({ handle, amount, currency, name, note }) => (currency === "INR" && handle.includes("@") ? upiPayload(handle, name, amount, note) : null),
    qrHintKey: "qr_hint_upi" },
  { key: "wise", name: "Wise", icon: "globe-outline", region: "region_world", costKey: "cost_low_intl",
    handleLabelKey: "f_wise_tag", handlePlaceholder: "@yourname or email",
    link: ({ handle }) => (handle.includes("@") && !handle.startsWith("@")) ? "https://wise.com/send" : `https://wise.com/pay/me/${enc(handle.replace(/^@/, ""))}` },
  { key: "remitly", name: "Remitly", icon: "paper-plane-outline", region: "region_to_india", costKey: "cost_low_intl",
    handleLabelKey: "f_receiver", handlePlaceholder: "Receiver name / phone",
    link: () => "https://www.remitly.com" },
  { key: "zelle", name: "Zelle", icon: "flash-outline", region: "region_us", costKey: "cost_free",
    handleLabelKey: "f_email_or_phone", handlePlaceholder: "email or US phone",
    link: () => null, howKey: "how_zelle" },
  { key: "paypal", name: "PayPal", icon: "logo-paypal", region: "region_world", costKey: "cost_free_friends",
    handleLabelKey: "f_paypal_me", handlePlaceholder: "paypal.me username",
    link: ({ handle, amount, currency }) => `https://paypal.me/${enc(handle.replace(/^.*paypal\.me\//, ""))}/${amount.toFixed(2)}${currency}` },
  { key: "revolut", name: "Revolut", icon: "card-outline", region: "region_europe", costKey: "cost_free",
    handleLabelKey: "f_revtag", handlePlaceholder: "revtag",
    link: ({ handle }) => `https://revolut.me/${enc(handle.replace(/^@/, ""))}` },
  { key: "venmo", name: "Venmo", icon: "logo-venmo", region: "region_us", costKey: "cost_free",
    handleLabelKey: "f_username", handlePlaceholder: "@username",
    link: ({ handle, amount, note }) => `https://venmo.com/${enc(handle.replace(/^@/, ""))}?txn=pay&amount=${amount.toFixed(2)}&note=${enc(note)}` },
  { key: "cashapp", name: "Cash App", icon: "cash-outline", region: "region_us_uk", costKey: "cost_free",
    handleLabelKey: "f_cashtag", handlePlaceholder: "$cashtag",
    link: ({ handle, amount }) => `https://cash.app/$${enc(handle.replace(/^\$/, ""))}/${amount.toFixed(2)}` },
  { key: "sepa", name: "SEPA", icon: "business-outline", region: "region_europe", costKey: "cost_free",
    handleLabelKey: "f_iban", handlePlaceholder: "DE89 3704 …",
    fields: [{ key: "account_name", labelKey: "f_account_name" }, { key: "bic", labelKey: "f_bic" }],
    qr: ({ handle, amount, currency, name, note, details }) =>
      currency === "EUR" ? epcPayload({ iban: handle, name: details.account_name || name, bic: details.bic, amount, text: note }) : null,
    qrHintKey: "qr_hint_sepa", howKey: "how_bank" },
  { key: "bank_in", name: "Bank (India)", icon: "business-outline", region: "region_india", costKey: "cost_free",
    handleLabelKey: "f_account_no", handlePlaceholder: "Account number",
    fields: [{ key: "account_name", labelKey: "f_account_name" }, { key: "ifsc", labelKey: "f_ifsc", placeholder: "SBIN0001234" }, { key: "bank", labelKey: "f_bank" }],
    howKey: "how_bank" },
  { key: "bank_intl", name: "Bank transfer", icon: "business-outline", region: "region_world", costKey: "cost_bank",
    handleLabelKey: "f_account_or_iban", handlePlaceholder: "Account / IBAN",
    fields: [{ key: "account_name", labelKey: "f_account_name" }, { key: "swift", labelKey: "f_swift" }, { key: "routing", labelKey: "f_routing" }, { key: "bank", labelKey: "f_bank" }],
    howKey: "how_bank" },
  { key: "mpesa", name: "M-Pesa", icon: "phone-portrait-outline", region: "region_africa", costKey: "cost_low",
    handleLabelKey: "f_phone_or_till", handlePlaceholder: "+2547… / till no.", howKey: "how_mpesa" },
  { key: "pix", name: "Pix", icon: "qr-code-outline", region: "region_brazil", costKey: "cost_free",
    handleLabelKey: "f_pix_key", handlePlaceholder: "Pix key",
    qr: ({ handle, amount, currency, name, city }) => (currency === "BRL" ? pixPayload({ key: handle, name, city, amount }) : null),
    qrHintKey: "qr_hint_pix" },
  { key: "western_union", name: "Western Union", icon: "earth-outline", region: "region_world", costKey: "cost_varies",
    handleLabelKey: "f_receiver", handlePlaceholder: "Receiver name",
    link: () => "https://www.westernunion.com" },
  { key: "cash", name: "Cash", icon: "wallet-outline", region: "region_in_person", costKey: "cost_free",
    handleLabelKey: "f_where", handlePlaceholder: "Hand to …" },
  { key: "other", name: "Other", icon: "ellipsis-horizontal-circle-outline", region: "region_any", costKey: "cost_varies",
    handleLabelKey: "f_details", handlePlaceholder: "" },
];

/** Services that send money across borders to a bank account or UPI ID — offered to someone paying from another country. */
export const ABROAD = [
  { name: "Wise", url: "https://wise.com/send" },
  { name: "Remitly", url: "https://www.remitly.com" },
  { name: "Western Union", url: "https://www.westernunion.com" },
];

export const methodDef = (k: string) => METHODS.find((m) => m.key === k) ?? METHODS[METHODS.length - 1];

/** Text block to copy/share for a method (bank details etc.) */
export function methodText(m: { method: string; handle?: string | null; label?: string | null; details?: Record<string, string> | null }, tr: (k: string) => string) {
  const d = methodDef(m.method);
  const lines = [`${m.label || d.name}`];
  if (m.handle) lines.push(`${tr(d.handleLabelKey)}: ${m.handle}`);
  for (const f of d.fields ?? []) {
    const v = m.details?.[f.key];
    if (v) lines.push(`${tr(f.labelKey)}: ${v}`);
  }
  return lines.join("\n");
}
