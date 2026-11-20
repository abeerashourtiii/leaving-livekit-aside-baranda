// ↔ B2: العمر الأدنى للتسجيل 18 سنة (يطابق الشروط وسياسة الخصوصية data/policies.ts).
export const MIN_SIGNUP_AGE = 18;

/** يرجّع null لو التاريخ غير صالح (يوم/شهر غير موجود، مستقبل، قبل 1900) وإلا العمر بالسنوات الكاملة. */
export function ageFromParts(year: number, month: number, day: number, now: Date = new Date()): number | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || month < 1 || month > 12 || day < 1) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  if (d.getTime() > today) return null;
  let age = now.getFullYear() - year;
  if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age -= 1;
  return age;
}
