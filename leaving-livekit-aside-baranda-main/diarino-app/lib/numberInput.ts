// ↔ إدخال الأرقام فى نماذج النشر (سعر/مساحة/غرف/حمامات/ريسبشن/دور):
//   • الأرقام الهندية (٠١٢٣…) والفارسية (۰۱۲۳…) تُحوَّل لأرقام لاتينية — قبل كده كان Number("٣") = NaN فيُرفض رقم صحيح كتبه المستخدم
//     بلوحة مفاتيح عربية (خصوصًا على الويب وبعض لوحات الأندرويد).
//   • التحقق صار صارمًا: الأعداد (غرف/حمامات/ريسبشن/دور) صحيحة غير سالبة؛ السعر والمساحة موجبة (عشرية مسموحة بنقطة واحدة) —
//     كان `isNaN` فقط فيمرّ -2 و1.5 و"1e3".
const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const a = ARABIC_INDIC.indexOf(ch);
    if (a >= 0) { out += String(a); continue; }
    const p = PERSIAN.indexOf(ch);
    if (p >= 0) { out += String(p); continue; }
    if (ch === "٫") { out += "."; continue; } // الفاصلة العشرية العربية
    if (ch === "٬" || ch === "،" || ch === ",") continue; // فواصل الآلاف
    out += ch;
  }
  return out;
}

/** لحقول الأعداد الصحيحة: يسمح بالأرقام فقط أثناء الكتابة. */
export function intFieldText(input: string, maxLen = 3): string {
  return normalizeDigits(input).replace(/\D/g, "").slice(0, maxLen);
}

/** لحقول السعر/المساحة: أرقام ونقطة عشرية واحدة (حتى خانتين عشريتين) أثناء الكتابة. */
export function decimalFieldText(input: string, maxLen = 14): string {
  const cleaned = normalizeDigits(input).replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  const text = dot === -1 ? cleaned : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  return text.slice(0, maxLen);
}

/** عدد صحيح غير سالب (أو null لو فارغ/غير صالح). */
export function parseNonNegInt(input: string): number | null {
  const s = normalizeDigits(input).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** رقم موجب (عشرى اختيارى) أو null. */
export function parsePositive(input: string): number | null {
  const s = normalizeDigits(input).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** K7: حقول الفلاتر (سعر/مساحة): أرقام هندية/فارسية ← لاتينية، إزالة الفواصل والمسافات، وnull لو المدخل غير صالح/فارغ/سالب. */
export function parseNumberInput(text: string | null | undefined): number | null {
  if (typeof text !== "string") return null;
  const s = normalizeDigits(text).replace(/[\s\u00a0]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
