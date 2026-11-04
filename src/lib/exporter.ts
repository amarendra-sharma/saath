import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

function webDownload(name: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const a = (globalThis as any).document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function exportPdf(html: string, name: string) {
  if (Platform.OS === "web") { await Print.printAsync({ html }); return; }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: name });
}

export async function exportCsv(csv: string, name: string) {
  const content = "﻿" + csv; // BOM so Excel reads Hindi/Bengali text correctly
  if (Platform.OS === "web") { webDownload(name, "text/csv;charset=utf-8", content); return; }
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create();
  await f.write(content);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(f.uri, { mimeType: "text/csv", dialogTitle: name });
}

export const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
