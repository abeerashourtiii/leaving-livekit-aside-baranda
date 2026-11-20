// lib/linking.ts
//
// ↔ فتح الروابط الخارجية بأمان (G5). كل الروابط كانت تُفتح بـ Linking.openURL بلا فحص للمخطط (scheme)، ومنها قيم يحدّدها الأدمن
//   (عناصر القائمة والبانرات وقنوات المشاركة) وقيم يدخلها مستخدمون (أرقام الهاتف فى tel: ورابط فيديو الترويج). الآن دالة واحدة تسمح فقط بـ:
//     • https://… (ويشمل https://wa.me)  • tel:  • mailto:
//   وترفض أى مخطط آخر (javascript:/intent:/file:/market:/http:/تطبيقات أخرى…) وتنظّف tel: إلى «+» وأرقام فقط، وmailto: إلى عنوان واحد بلا معاملات.
//   Linking.openURL() أيضًا ترفض لو لا شيء على الجهاز يعالج الرابط (واتساب غير مثبّت…): نُظهر رسالة بدل صمت.
//
// ملاحظة: مشاركة البروفايل (الإعدادات) بتستخدم lib/shareLinks.ts (شيت المشاركة الأصلي للنظام) مش openURL.
import { Linking } from "react-native";
import { showToast } from "../components/shared/Toast";

const MAX_URL_LENGTH = 2048;

/** يرجّع الرابط المنظَّف لو مسموح، وإلا null. دالة نقية (قابلة للاختبار). */
export function sanitizeExternalUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (!url || url.length > MAX_URL_LENGTH || /[\u0000-\u001f\u007f\s]/.test(url)) return null;

  const lower = url.toLowerCase();
  if (lower.startsWith("https://")) {
    try {
      const u = new URL(url);
      return u.protocol === "https:" && !!u.hostname && !u.username && !u.password ? url : null;
    } catch {
      return null;
    }
  }
  if (lower.startsWith("tel:")) {
    const body = url.slice(4);
    const digits = body.replace(/\D/g, "");
    if (digits.length < 5 || digits.length > 20) return null;
    return `tel:${body.trim().startsWith("+") ? "+" : ""}${digits}`;
  }
  if (lower.startsWith("mailto:")) {
    const addr = url.slice(7);
    return /^[^\s@,;?&:/]+@[^\s@,;?&:/]+\.[^\s@,;?&:/]+$/.test(addr) ? `mailto:${addr}` : null;
  }
  return null;
}

export function openExternalUrl(url: string, failureMessage = "تعذر فتح الرابط"): void {
  const safe = sanitizeExternalUrl(url);
  if (!safe) {
    showToast(failureMessage);
    return;
  }
  Linking.openURL(safe).catch(() => {
    showToast(failureMessage);
  });
}
