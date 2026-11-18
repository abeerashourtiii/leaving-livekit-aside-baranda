// ↔ B8: بناء قيم فلاتر PostgREST (`.or("title.ilike.…")`) بأمان. التنظيف القديم كان يشيل % _ , . فقط، فكانت الأقواس ( ) وعلامات التنصيص و\ و: و*
//   تبقى وتكسر تحليل الفلتر (خطأ 400) لبحث مثل «شقة (مصر الجديدة)». الحل: نقتبس القيمة بعلامات مزدوجة (PostgREST يقبل داخلها أى محرف
//   ما عدا " و\ اللذين يُهربان بـ \) ونهرب محارف LIKE الخاصة (% _ \) لتُطابق حرفيًا.
/** يقتبس قيمة عادية لاستخدامها داخل or(...)/in(...). */
export function pgrstQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** قيمة ilike «يحتوى على» (%…%) آمنة، أو null لو النص فارغ بعد التنظيف. `*` مرفوض لأن PostgREST يحوّله إلى % داخل ilike. */
export function ilikeContains(raw: string, maxLen = 100): string | null {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f*]/g, "").trim().slice(0, maxLen);
  if (!cleaned) return null;
  const likeEscaped = cleaned.replace(/[\\%_]/g, (c) => `\\${c}`);
  return pgrstQuote(`%${likeEscaped}%`);
}
