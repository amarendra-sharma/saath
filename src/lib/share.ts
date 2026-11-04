import * as Clipboard from "expo-clipboard";
import { Linking, Platform, Share } from "react-native";

export async function openWhatsApp(text: string, phone?: string | null) {
  const digits = (phone ?? "").replace(/[^\d]/g, "");
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  try { await Linking.openURL(url); return true; } catch { return false; }
}

export async function shareText(text: string): Promise<"shared" | "copied"> {
  if (Platform.OS === "web") {
    const nav: any = (globalThis as any).navigator;
    if (nav?.share) { try { await nav.share({ text }); return "shared"; } catch {} }
    await Clipboard.setStringAsync(text);
    return "copied";
  }
  await Share.share({ message: text });
  return "shared";
}

export async function copy(text: string) {
  await Clipboard.setStringAsync(text);
}

export async function openUrl(url: string) {
  try { await Linking.openURL(url); return true; } catch { return false; }
}
