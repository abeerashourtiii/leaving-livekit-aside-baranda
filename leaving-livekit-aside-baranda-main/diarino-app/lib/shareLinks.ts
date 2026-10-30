// lib/shareLinks.ts
//
// ↔ روابط المشاركة كلها على الدومين الرسمى https://baranda.shop (مصدر واحد هنا — ما تكتبش دومين فى أى مكان تانى):
//   • الريل/الإعلان:   https://baranda.shop/property/<id>/reel   ← يفتح الريل نفسه شغّال
//   • البروفايل:       https://baranda.shop/seller/<id>           ← صفحة المعلن
//   • المقارنة:        https://baranda.shop/compare?ids=a,b,c      ← صفحة المقارنة
//   • الشروط والأحكام: https://baranda.shop/terms  (صفحة ويب ثابتة — بتفتح فى المتصفح عمدًا، مش داخل التطبيق)
// عند الضغط على الرابط:
//   • أندرويد/APK: App Links (intent-filter + autoVerify فى AndroidManifest.xml/app.json) ← يفتح التطبيق على نفس الصفحة مباشرة.
//   • آيفون: Universal Links (associatedDomains: applinks:baranda.shop) ← يفتح التطبيق على نفس الصفحة مباشرة.
//   • الويب أو التطبيق غير مثبّت: نفس الرابط بيفتح نسخة الويب على نفس المسار.
// شرط التحقق: نشر ملفى assetlinks.json وapple-app-site-association على الدومين (docs/deep-links-setup.md).
import { Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";

// الدومين الرسمى الوحيد المسجَّل للروابط العميقة (app.json ← associatedDomains و intentFilters).
// لازم يفضل ثابت فى كل الروابط المشاركة — حتى على الويب (مش origin الصفحة الحالية، عشان نسخة GitHub Pages المؤقتة ما تتشاركش).
export const APP_LINK_ORIGIN = "https://baranda.shop";

export function buildProfileLink(userId: string): string {
  return `${APP_LINK_ORIGIN}/seller/${encodeURIComponent(userId)}`;
}

// ↔ مشاركة الريل (الإعلان): بيفتح الريل مباشرة داخل التطبيق.
export function buildReelLink(propertyId: string): string {
  return `${APP_LINK_ORIGIN}/property/${encodeURIComponent(propertyId)}/reel`;
}

// ↔ مشاركة المقارنة.
export function buildCompareLink(propertyIds: string[]): string {
  return `${APP_LINK_ORIGIN}/compare?ids=${propertyIds.map((i) => encodeURIComponent(i)).join(",")}`;
}

// ↔ روابط مرجعية للمشرف (بلاغات): صفحة تفاصيل الإعلان / الطلبات / إعادة البث.
export function buildPropertyDetailsLink(propertyId: string): string {
  return `${APP_LINK_ORIGIN}/property/${encodeURIComponent(propertyId)}`;
}
export function buildRequestLink(requestId: string): string {
  return `${APP_LINK_ORIGIN}/requests?id=${encodeURIComponent(requestId)}`;
}
export function buildLiveReplayLink(liveId: string): string {
  return `${APP_LINK_ORIGIN}/live/replay/${encodeURIComponent(liveId)}`;
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
