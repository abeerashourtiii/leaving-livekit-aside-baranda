import { Image } from "expo-image";
import { Property, getReelMode } from "./types";
import { cldOptimized, cldReelPoster } from "./cloudinary";

// ↔ تحميل مسبق لأول صورة/بوستر للريلز اللي جاية (قبل ما المستخدم يوصلها)
// فى كاش expo-image — بنفس الـ URL بالظبط اللي ReelCard بيعرضه، فلما
// الريل يظهر بيتعرض من الكاش فورًا من غير انتظار شبكة. مفيش أي تحميل
// للفيديو نفسه هنا (ده بتتكفّل بيه ReelVideoPlayer للريلز القريبة).
const requested = new Set<string>();
const MAX_REMEMBERED = 300;

export function prefetchReelPosters(items: Property[], fromIndex: number, count = 4): void {
  const urls: string[] = [];
  const end = Math.min(items.length, fromIndex + count);
  for (let i = Math.max(0, fromIndex); i < end; i++) {
    const p = items[i];
    if (!p) continue;
    const mode = getReelMode(p);
    let url: string | null = null;
    if (mode === "video") {
      const v = p.media.find((m) => m.type === "video");
      if (v) url = cldReelPoster(v.url);
    } else if (mode === "slideshow") {
      const img = p.media.find((m) => m.type === "image");
      if (img) url = cldOptimized(img.url);
    }
    if (url && !requested.has(url)) {
      requested.add(url);
      urls.push(url);
    }
  }
  if (requested.size > MAX_REMEMBERED) requested.clear();
  if (!urls.length) return;
  // ↔ best-effort: أي فشل (شبكة، أو اختلاف تنفيذ الويب) بيتجاهل بهدوء —
  // التحميل المسبق تحسين بس، مش شرط لعمل الريل.
  try {
    const result = Image.prefetch(urls) as Promise<boolean> | undefined;
    result?.catch?.(() => {});
  } catch {
    /* ignore */
  }
}
