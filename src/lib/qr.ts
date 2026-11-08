import qrcode from "qrcode-generator";

/** QR matrix (true = dark module) for any text, UTF-8 encoded, error correction M. */
export function qrMatrix(text: string): boolean[][] {
  const prev = qrcode.stringToBytes;
  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
  try {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
  } finally {
    qrcode.stringToBytes = prev;
  }
}

// ── Payment QR payloads. Each one is a published standard that banking/payment apps scan.

/** UPI (India): the same upi://pay link the phone apps open; every UPI app scans it. */
export const upiPayload = (vpa: string, name: string, amount: number, note: string) =>
  `upi://pay?pa=${encodeURIComponent(vpa.trim()).replace(/%40/g, "@")}&pn=${encodeURIComponent(name)}` +
  (amount > 0 ? `&am=${amount.toFixed(2)}` : "") + `&cu=INR&tn=${encodeURIComponent(note.slice(0, 80))}`;

/** SEPA credit transfer (EPC069-12 "GiroCode"), scanned by most European banking apps. EUR only. */
export function epcPayload(o: { iban: string; name: string; bic?: string; amount: number; text: string }) {
  const iban = o.iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban) || !o.name.trim()) return null;
  return ["BCD", "002", "1", "SCT", (o.bic ?? "").replace(/\s+/g, "").toUpperCase(), o.name.trim().slice(0, 70), iban,
    o.amount > 0 ? `EUR${o.amount.toFixed(2)}` : "", "", "", o.text.slice(0, 140)].join("\n");
}

/** Pix (Brazil) static "copia e cola" BR Code, EMV format with CRC16. BRL only. */
export function pixPayload(o: { key: string; name: string; city: string; amount: number; txid?: string }) {
  const ascii = (s: string, max: number) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 .\-]/g, "").trim().toUpperCase().slice(0, max);
  const f = (id: string, v: string) => id + String(v.length).padStart(2, "0") + v;
  const key = o.key.trim();
  if (!key) return null;
  const mai = f("00", "br.gov.bcb.pix") + f("01", key);
  let p = f("00", "01") + f("26", mai) + f("52", "0000") + f("53", "986") +
    (o.amount > 0 ? f("54", o.amount.toFixed(2)) : "") + f("58", "BR") +
    f("59", ascii(o.name, 25) || "RECEBEDOR") + f("60", ascii(o.city, 15) || "BRASIL") +
    f("62", f("05", (o.txid ?? "***").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***")) + "6304";
  return p + crc16(p);
}
function crc16(s: string) {
  let crc = 0xffff;
  for (const b of new TextEncoder().encode(s)) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
