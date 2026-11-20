// ↔ M5: تطبيع النص العربى للمطابقة والتخزين: أ/إ/آ/ٱ→ا، ة→ه، ى→ي، حذف التشكيل والتطويل والمحارف غير المرئية، وتوحيد المسافات.
// نفس قاعدة الدالة normalize_arabic_name فى قاعدة البيانات (20261116000002) كى تتطابق نتائج العميل والخادم.
const DIACRITICS_AND_INVISIBLES = /[\u064B-\u065F\u0670\u0640\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

export function normalizeArabic(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(DIACRITICS_AND_INVISIBLES, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

// هل يحتوى النص على الاستعلام بعد تطبيع الاثنين؟
export function includesNormalized(haystack: string, needle: string): boolean {
  const n = normalizeArabic(needle);
  return n.length > 0 && normalizeArabic(haystack).includes(n);
}

// إزالة التكرار بعد التطبيع مع إبقاء أول صيغة (الأولوية للقائمة الثابتة لأنها تأتى أولًا).
export function dedupeNormalized(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = normalizeArabic(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
