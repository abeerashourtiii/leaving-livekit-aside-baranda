import { Property } from "./types";

// ↔ ترتيب إعلانات معلن واحد (صفحة المعلن، وتصفّح ريلاته): المثبّتة أولًا
// (الأحدث تثبيتًا أولًا، حد أقصى maxPinned) وبعدها باقى الإعلانات بترتيبها
// الأصلى. أى مثبّتة زيادة عن الحد (بيانات قديمة) بتتعرض كإعلان عادى.
// ↔ الإعلانات «الممولة» (ترويج مدفوع مفعّل): لها الأولوية فى أعلى القائمة قبل المثبّتة، والأحدث تفعيلًا أولًا إن تعددت.
//   (نفس منطق «مميز» أعلى نتائج صفحة البحث.) الإعلان المُغلق بصفقة لا يُعامل كممول. rank = وقت تفعيل الإعلان الممول.
export type SponsorInfo = { reelId: string; rank: number };
export function sponsorFirst(list: Property[], sponsors?: Map<string, SponsorInfo>): Property[] {
  if (!sponsors || sponsors.size === 0) return list;
  const sp = list
    .filter((p) => sponsors.has(p.id) && !p.closedType)
    .sort((a, b) => (sponsors.get(b.id)?.rank ?? 0) - (sponsors.get(a.id)?.rank ?? 0));
  if (sp.length === 0) return list;
  const ids = new Set(sp.map((p) => p.id));
  return [...sp, ...list.filter((p) => !ids.has(p.id))];
}

export function orderSellerListings(all: Property[], maxPinned: number, sponsors?: Map<string, SponsorInfo>): Property[] {
  const pinned = all
    .filter((p) => p.pinned)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
    .slice(0, maxPinned);
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const rest = all.filter((p) => !pinnedIds.has(p.id)).map((p) => (p.pinned ? { ...p, pinned: false } : p));
  return sponsorFirst([...pinned, ...rest], sponsors);
}
