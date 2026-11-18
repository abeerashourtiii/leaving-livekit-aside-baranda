// ↔ كاشف الأرقام والروابط فى التعليقات — نسخة العميل المطابقة لدالة الخادم public.reel_comment_blocked_reason
// (supabase/migrations/20261014000000_comment_filter_pin_owner_like.sql). الغرض: تنبيه المستخدم فورًا قبل الإرسال.
// الخادم هو المرجع الحقيقى (العميل المعدَّل لا يتجاوزه) — لو غيّرت أى قاعدة هنا غيّرها هناك بنفس الشكل.
export type BlockedReason = "phone" | "link" | "email" | "handle";

const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

const NUMBER_WORDS =
  /(صفر|واحد|واحدة|اثنين|اتنين|اثنان|ثلاثة|ثلاث|تلاتة|تلات|اربعة|أربعة|أربع|اربع|خمسة|خمس|ستة|سبعة|سبع|ثمانية|تمانية|ثماني|تسعة|تسع|zero|one|two|three|four|five|six|seven|eight|nine)/gi;

export function blockedCommentReason(body: string): BlockedReason | null {
  let v = (body ?? "").replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d] ?? d);
  v = v.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u0640]/g, "");

  if (/[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/i.test(v)) return "email";
  if (/(^|\s)@[a-z0-9_.]{3,}/i.test(v)) return "handle";

  if (
    /(https?:\/\/|www\.)/i.test(v) ||
    /(^|[^a-z0-9])[a-z0-9-]{2,}\.(com|net|org|io|me|app|co|eg|info|xyz|link|ly|gl|ae|sa|tv|online|site|shop|store|biz|cc|ws|us|uk)([^a-z0-9]|$)/i.test(v) ||
    /(^|[^a-z0-9])(t\.me|wa\.me|bit\.ly|goo\.gl|tinyurl\.com)/i.test(v) ||
    /(instagram|facebook|tiktok|snapchat|telegram|whatsapp)\.[a-z]/i.test(v) ||
    /(دوت|نقطة)\s*(كوم|نت|اورج|أورج)/.test(v)
  ) return "link";

  if (/\d([\s.\-()]*\d){9,}/.test(v) || /(\+|00)\s*\d{8,}/.test(v)) return "phone";
  if ((v.toLowerCase().match(NUMBER_WORDS) ?? []).length >= 7) return "phone";
  return null;
}
