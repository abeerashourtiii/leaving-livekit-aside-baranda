import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import type { MediaItem } from "./types";

// ↔ وسائط المسودات المحلية. المسودة بتتحفظ فى قاعدة البيانات لكن وسائطها (صور/فيديو) مجرد مسارات على جهاز المستخدم:
//   file:// فى مجلد الكاش (النظام ممكن يمسحه)، أو blob: على الويب (بتموت بإعادة تحميل الصفحة)، أو المسودة تتفتح من جهاز تانى.
//   النتيجة كانت إن النشر يفشل بخطأ عام. دلوقتى:
//   • عند حفظ المسودة على أندرويد/آيفون: ننسخ الملفات لمجلد التطبيق الدائم (documentDirectory/draft-media) فما يمسحهاش الكاش.
//   • عند فتح المسودة وقبل النشر: نتحقق إن كل ملف محلى لسه موجود، ونشيل المفقود ونقول للمستخدم يعيد اختياره.
//   • بعد النشر/حذف المسودة: نمسح النسخ الدائمة (best-effort).
const DIR = Platform.OS === "web" ? "" : `${FileSystem.documentDirectory ?? ""}draft-media/`;

export const isRemoteUrl = (u: string) => /^https?:\/\//i.test(u);
export const isLocalMedia = (u: string) => !!u && !isRemoteUrl(u);
const isPersistent = (u: string) => !!DIR && u.startsWith(DIR);

function extOf(uri: string, type: "image" | "video"): string {
  const m = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(uri);
  return (m?.[1] ?? (type === "video" ? "mp4" : "jpg")).toLowerCase();
}

/** هل الملف المحلى لسه موجود وصالح؟ */
export async function localMediaExists(uri: string): Promise<boolean> {
  if (!isLocalMedia(uri)) return true;
  try {
    if (Platform.OS === "web") {
      if (!uri.startsWith("blob:")) return false;
      const res = await fetch(uri);
      void res.body?.cancel?.();
      return res.ok;
    }
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
  }
}

/** ينسخ ملفًا محليًا لمجلد المسودات الدائم (أندرويد/آيفون). لو فشل النسخ يرجّع المسار الأصلى بدون كسر الحفظ. */
export async function persistLocalMedia(item: MediaItem): Promise<MediaItem> {
  if (Platform.OS === "web" || !isLocalMedia(item.url) || isPersistent(item.url)) return item;
  try {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    const dest = `${DIR}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extOf(item.url, item.type)}`;
    await FileSystem.copyAsync({ from: item.url, to: dest });
    return { ...item, url: dest };
  } catch (err) {
    console.warn("draft media copy failed:", err);
    return item;
  }
}

/** يمسح النسخة الدائمة (لو كان المسار منها). */
export async function deleteDraftCopy(uri: string | null | undefined): Promise<void> {
  if (!uri || !isPersistent(uri)) return;
  try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch { /* best-effort */ }
}

/** يمسح كل النسخ الدائمة المذكورة فى بيانات مسودة (videoItem/coverItem/photoItems). */
export async function deleteDraftCopiesFromData(data: unknown): Promise<void> {
  const d = (data ?? {}) as { videoItem?: MediaItem | null; coverItem?: MediaItem | null; photoItems?: MediaItem[] };
  const uris = [d.videoItem?.url, d.coverItem?.url, ...(Array.isArray(d.photoItems) ? d.photoItems.map((p) => p?.url) : [])];
  await Promise.all(uris.map((u) => deleteDraftCopy(u)));
}
