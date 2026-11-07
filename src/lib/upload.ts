import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { RECEIPTS_BUCKET, supabase } from "./supabase";

export type LocalFile = { uri: string; name: string; mime: string; size?: number | null };

// Bills are read by AI, which is billed by image size: a 1600 px photo costs ~60% less than a full phone photo
// and reads the same (tested on handwritten bills). Also uploads faster and turns HEIC into JPEG.
const MAX_EDGE = 1600;
async function shrink(a: ImagePicker.ImagePickerAsset, name: string): Promise<LocalFile> {
  const orig: LocalFile = { uri: a.uri, name, mime: a.mimeType ?? "image/jpeg", size: a.fileSize };
  try {
    const w = a.width || 0, h = a.height || 0;
    const big = Math.max(w, h) > MAX_EDGE;
    const heic = /heic|heif/i.test(orig.mime) || /\.(heic|heif)$/i.test(name);
    if (!big && !heic) return orig;
    const ctx = ImageManipulator.manipulate(a.uri);
    if (big) ctx.resize(w >= h ? { width: MAX_EDGE } : { height: MAX_EDGE });
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
    return { uri: out.uri, name: name.replace(/\.[^.]+$/, "") + ".jpg", mime: "image/jpeg", size: null };
  } catch {
    return orig;   // never block an upload; the server reads full-size photos too
  }
}

export async function takePhoto(): Promise<LocalFile | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  return shrink(a, a.fileName ?? `receipt-${Date.now()}.jpg`);
}

export async function pickPhotos(): Promise<LocalFile[]> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, allowsMultipleSelection: true, selectionLimit: 6, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
  if (r.canceled) return [];
  return Promise.all((r.assets ?? []).map((a, i) => shrink(a, a.fileName ?? `receipt-${Date.now()}-${i}.jpg`)));
}

export async function pickPdf(): Promise<LocalFile[]> {
  const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], multiple: true, copyToCacheDirectory: true });
  if (r.canceled) return [];
  return (r.assets ?? []).map((a) => ({ uri: a.uri, name: a.name, mime: a.mimeType ?? "application/pdf", size: a.size }));
}

const ext = (f: LocalFile) =>
  (f.name.split(".").pop() || (f.mime.includes("pdf") ? "pdf" : f.mime.includes("png") ? "png" : "jpg")).toLowerCase().slice(0, 5);

/** Upload to <circle>/<folder>/<random>.<ext>; returns the storage path. */
export async function uploadFile(circleId: string, folder: string, f: LocalFile): Promise<string> {
  const body = await (await fetch(f.uri)).arrayBuffer();
  const path = `${circleId}/${folder}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext(f)}`;
  const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, body, { contentType: f.mime, upsert: false });
  if (error) throw error;
  return path;
}

export async function signedUrl(path: string) {
  const { data } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}
