import { parseNumberInput } from "./numberInput";

// ↔ A4/A5: تحقق صارم لحقول الأدمن الرقمية. Number("") يساوى 0 وNumber(x)||7 تُخفى الخطأ؛ هنا الفارغ/غير الصالح ⇒ null صراحةً.
// يقبل الأرقام الهندية/الفارسية والفواصل (عبر parseNumberInput) ويرفض الكسور والسالب والنص.

/** عدد صحيح فى المدى [min, max] أو null (فارغ/غير صالح/خارج المدى). */
export function parseAdminInt(raw: string | null | undefined, min: number, max: number): number | null {
  const n = parseNumberInput(raw);
  if (n === null || !Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/** مبلغ غير سالب (يقبل كسورًا) أو null (فارغ/غير صالح). */
export function parseAdminMoney(raw: string | null | undefined): number | null {
  return parseNumberInput(raw);
}

export type SponsoredTargeting =
  | { ok: true; reachGoal?: number; ageMin?: number; ageMax?: number; endDate?: string }
  | { ok: false; message: string };

/** تاريخ بصيغة YYYY-MM-DD (يقبل أرقامًا هندية) صالح فعلًا؛ يُرجع النص الموحَّد أو null. */
export function parseAdminDate(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return s;
}

const blank = (s: string) => s.trim() === "";

/**
 * الريل المميز: لازم حد واحد على الأقل — هدف وصول (> 0) أو تاريخ انتهاء (YYYY-MM-DD، اليوم أو بعده) — حتى لا تعمل حملة بلا نهاية.
 * والعمر ≥ 18 والأدنى ≤ الأقصى (≤ 100). `today` (YYYY-MM-DD) اختيارى للاختبار.
 */
export function validateSponsoredTargeting(input: { reach: string; ageMin: string; ageMax: string; endDate?: string }, today?: string): SponsoredTargeting {
  const out: { reachGoal?: number; ageMin?: number; ageMax?: number; endDate?: string } = {};
  if (!blank(input.reach)) {
    const n = parseAdminInt(input.reach, 1, 100_000_000);
    if (n === null) return { ok: false, message: "هدف الوصول لازم يكون رقمًا صحيحًا أكبر من صفر." };
    out.reachGoal = n;
  }
  if (!blank(input.ageMin)) {
    const n = parseAdminInt(input.ageMin, 18, 100);
    if (n === null) return { ok: false, message: "أقل عمر لازم يكون رقمًا صحيحًا من 18 إلى 100." };
    out.ageMin = n;
  }
  if (!blank(input.ageMax)) {
    const n = parseAdminInt(input.ageMax, 18, 100);
    if (n === null) return { ok: false, message: "أكبر عمر لازم يكون رقمًا صحيحًا من 18 إلى 100." };
    out.ageMax = n;
  }
  if (!blank(input.endDate ?? "")) {
    const d = parseAdminDate(input.endDate);
    if (d === null) return { ok: false, message: "تاريخ الانتهاء لازم يكون بصيغة YYYY-MM-DD (مثال 2026-12-31)." };
    const now = new Date();
    const todayStr = today ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (d < todayStr) return { ok: false, message: "تاريخ الانتهاء لا يمكن أن يكون فى الماضى." };
    out.endDate = d;
  }
  if (out.reachGoal === undefined && out.endDate === undefined) {
    return { ok: false, message: "حدّد حدًّا واحدًا على الأقل: هدف الوصول أو تاريخ الانتهاء (حتى لا تعمل الحملة بلا نهاية)." };
  }
  if (out.ageMin !== undefined && out.ageMax !== undefined && out.ageMin > out.ageMax) {
    return { ok: false, message: "أقل عمر لا يمكن أن يكون أكبر من أكبر عمر." };
  }
  return { ok: true, ...out };
}
