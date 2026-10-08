import { Property } from "./types";

// ↔ ترتيب إعلانات معلن واحد (صفحة المعلن، وتصفّح ريلاته): المثبّتة أولًا
// (الأحدث تثبيتًا أولًا، حد أقصى maxPinned) وبعدها باقى الإعلانات بترتيبها
// الأصلى. أى مثبّتة زيادة عن الحد (بيانات قديمة) بتتعرض كإعلان عادى.
export function orderSellerListings(all: Property[], maxPinned: number): Property[] {
  const pinned = all
    .filter((p) => p.pinned)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
    .slice(0, maxPinned);
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const rest = all.filter((p) => !pinnedIds.has(p.id)).map((p) => (p.pinned ? { ...p, pinned: false } : p));
  return [...pinned, ...rest];
}
