import { callFn } from "./supabase";
import { LocalFile, uploadFile } from "./upload";

export type ScanDoc = {
  doc_type: "bill" | "payment_receipt" | "settlement_summary" | "deposit_receipt" | "report" | "prescription" | "other";
  title: string; vendor?: string; bill_number?: string; date?: string; amount: number; currency: string;
  category: string; patient_name?: string; pages: number[]; handwritten?: boolean;
  confidence: "high" | "medium" | "low"; note?: string;
};
export type ScanResult = {
  path: string; mime: string; size: number | null; name: string;
  documents: ScanDoc[]; overall_note?: string; circleCurrency?: string;
};

/** Upload the file once, then ask the server to read every bill in it. */
export async function scanFile(circleId: string, f: LocalFile, lang: string): Promise<ScanResult> {
  const path = await uploadFile(circleId, "scans", f);
  const r = await callFn<{ documents: ScanDoc[]; overall_note?: string }>("saath-scan", { circle_id: circleId, path, language: lang }, true);
  return { path, mime: f.mime, size: f.size ?? null, name: f.name, documents: r.documents ?? [], overall_note: r.overall_note };
}

export const isBill = (d: ScanDoc) => d.doc_type === "bill" && d.amount > 0;

// hand-off between the Add-bill screen and the review screen (results can be large)
let pending: ScanResult | null = null;
export const setPendingScan = (r: ScanResult | null) => { pending = r; };
export const takePendingScan = () => pending;
