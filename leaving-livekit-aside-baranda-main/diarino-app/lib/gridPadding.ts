// ↔ شبكة الكروت (FlatList numColumns=2) فى البحث وصفحة المعلن: الكارت الأخير لو
// لوحده فى الصف كان بياخد الصف كله (card: flex 1) فيطلع أكبر من باقى الكروت.
// الحل: نكمّل عدد العناصر لعدد زوجى بعنصر فاضى (null) بيترسم View شفاف بنفس
// flex:1 — فالكارت الأخير بياخد نص الصف بالظبط زى الباقى، ومفيش اعتماد على
// عرض ثابت فالتخطيط يفضل مرن على الموبايل والويب (أى عرض شاشة).
export function padToEvenColumns<T>(items: T[], columns = 2): (T | null)[] {
  const remainder = items.length % columns;
  if (remainder === 0) return items;
  return [...items, ...Array.from({ length: columns - remainder }, () => null)];
}
