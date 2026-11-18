import type { Property } from "./types";

// ↔ مطابقة الإعلان الممول لفلتر المحافظة/المنطقة ولنص البحث:
//   • الإعلان المميز فى صفحة البحث والافتتاحي/المميز فى الريلز يظهران عند الفلترة فقط لو عقارهما داخل المحافظات/المناطق
//     المحددة (فلتر فاضى = كل المحافظات)، وخارجها لا يظهران فى النتائج.
type Loc = { province?: string | null; location?: string | null };

export function matchesLocationFilter(p: Loc, provinces: string[], regions: string[]): boolean {
  if (provinces.length > 0 && !(p.province && provinces.includes(p.province))) return false;
  if (regions.length > 0 && !(p.location && regions.includes(p.location))) return false;
  return true;
}

// نفس منطق بحث الخادم تقريبًا: النص موجود فى العنوان أو المنطقة أو النوع أو الوصف أو المحافظة.
export function matchesSearchQuery(p: Pick<Property, "title" | "location" | "type" | "province"> & { description?: string | null }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [p.title, p.location, p.type, p.province, p.description].some((v) => !!v && String(v).toLowerCase().includes(q));
}
