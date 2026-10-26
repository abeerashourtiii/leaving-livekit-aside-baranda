// lib/shareLinks.ts
//
// ↔ مشاركة البروفايل (الإعدادات ← "مشاركة البروفايل"): نفس سلوك مشاركة الريل
// بالظبط — شيت المشاركة الأصلي للنظام (Share.share) بنص + رابط https واحد،
// بدل شبكة الأزرار القديمة (ماسنجر/انستجرام/تيك توك كانت بتنسخ الرابط وتفتح
// التطبيق بس، مش مشاركة حقيقية). الرابط نفسه https://<domain>/seller/<id>:
//   • أندرويد: بيفتح التطبيق على صفحة المعلن مباشرة (intent-filter بـ
//     autoVerify على المسار /seller — راجع AndroidManifest.xml + app.json)
//     بشرط نشر ملف assetlinks.json على الدومين (docs/deep-links-setup.md).
//   • آيفون: Universal Link (associatedDomains موجود) بشرط نشر ملف
//     apple-app-site-association على نفس الدومين.
//   • الويب / التطبيق غير مثبّت: نفس الرابط بيفتح نسخة الويب على نفس المسار،
//     وصفحة المعلن بتفتح لوحدها (app/seller/[id].tsx).
import { Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";

// الدومين الرسمي الوحيد المسجَّل للروابط العميقة (app.json ← associatedDomains
// و intentFilters). لازم يفضل ثابت فى كل الروابط المشاركة.
export const APP_LINK_ORIGIN = "https://diarino.app";

// على الويب (غير localhost) بنستخدم نفس الـ origin اللي المستخدم فاتح عليه
// التطبيق، فلو الويب منشور على دومين مؤقت/تجريبى يفضل الرابط شغّال هناك.
function linkOrigin(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const { origin, hostname } = window.location;
    if (/^https?:/i.test(origin) && hostname !== "localhost" && hostname !== "127.0.0.1") {
      return origin;
    }
  }
  return APP_LINK_ORIGIN;
}

export function buildProfileLink(userId: string): string {
  return `${linkOrigin()}/seller/${encodeURIComponent(userId)}`;
}

export type ShareLinkResult = "shared" | "copied" | "dismissed" | "failed";

type ShareLinkInput = { text: string; url: string; dialogTitle?: string };

// أندرويد/آيفون: Share.share بـ message واحد فيه النص والرابط (زى الريل).
// الويب: navigator.share لو المتصفح بيدعمه، وإلا نسخ الرابط للحافظة (RN-web
// بيرفض Share.share فى المتصفحات اللي مفيهاش navigator.share).
export async function shareLink({ text, url, dialogTitle }: ShareLinkInput): Promise<ShareLinkResult> {
  try {
    if (Platform.OS === "web") {
      const nav = typeof navigator !== "undefined" ? navigator : undefined;
      if (nav && typeof nav.share === "function") {
        try {
          await nav.share({ text, url });
          return "shared";
        } catch (err) {
          if ((err as { name?: string } | null)?.name === "AbortError") return "dismissed";
          // أى خطأ تانى (مثلاً NotAllowedError) ← نكمّل بنسخ الرابط
        }
      }
      await Clipboard.setStringAsync(url);
      return "copied";
    }

    const result = await Share.share({ message: `${text}\n${url}` }, { dialogTitle });
    return result.action === Share.dismissedAction ? "dismissed" : "shared";
  } catch {
    return "failed";
  }
}
