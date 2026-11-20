// ↔ حد أدنى لإصدار التطبيق (نشر تدريجى للتضييق الأمنى): جدول app_version_requirements (migration 20261116100002).
// مقارنة إصدارات مثل 1.2.0 (حتى 3 أجزاء رقمية). نص غير صالح ⇒ null ⇒ لا حجب (الفشل مفتوح).
export function parseVersion(v: string | null | undefined): [number, number, number] | null {
  const m = /^\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/.exec(v ?? "");
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

// true فقط إن كان الإصدار الحالى *أقل* من الحد الأدنى بوضوح؛ أى غموض/خطأ ⇒ false (لا نحجب المستخدم بالخطأ).
export function isBelowMinVersion(current: string | null | undefined, min: string | null | undefined): boolean {
  if (!current || !min) return false;
  return compareVersions(current, min) === -1;
}
