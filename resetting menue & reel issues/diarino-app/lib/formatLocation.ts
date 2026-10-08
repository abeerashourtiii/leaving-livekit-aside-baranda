// ↔ سطر الموقع فى وصف الريل وتفاصيل العقار: المحافظة أولًا ثم المنطقة
// ("القاهرة · التجمع الخامس"). لو المنطقة مكتوبة بنفس اسم المحافظة بنعرضها مرة واحدة.
export function formatLocationLine(
  province: string | null | undefined,
  location: string | null | undefined,
  t: (s: string) => string,
  separator = " · "
): string {
  const prov = (province ?? "").trim();
  const loc = (location ?? "").trim();
  const parts = [prov ? t(prov) : "", loc && loc !== prov ? t(loc) : ""].filter(Boolean);
  return parts.join(separator);
}
