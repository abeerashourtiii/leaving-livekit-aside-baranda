import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveSponsoredReels } from "./useSponsoredReels";
import { usePropertiesByIds } from "./useProperties";
import { matchesLocationFilter, matchesSearchQuery } from "../sponsorMatch";
import type { Property } from "../types";

// ↔ «إعلانات مميزة» (شريط الكروت) — المصدر نفسه الذى كان يغذّى كروت «مميز» فى صفحة البحث: الريلز الممولة بنوع in_feed (sponsored_reels)
//   مع الاستهداف (العمر/هدف الوصول) من useActiveSponsoredReels، وبيانات العقار من usePropertiesByIds (روابط الصور/الفيديو المخزّنة فى Supabase كما هى — لا رفع جديد).
//   الانتهاء التلقائى: end_date (شامل، بتوقيت UTC كاستعلام الخادم) يُعاد تقييمه محليًا كل 30 ثانية وتُحدَّث القائمة من الخادم كل دقيقة،
//   فيختفى الإعلان من كل الأماكن فور انتهاء مدته (ويبقى كإعلان عادى غير مميز طالما الإعلان نفسه نشط). الإعلان المُغلق بصفقة/غير النشط لا يظهر.
export type FeaturedAd = { reelId: string; property: Property };

export type FeaturedFilters = {
  excludePropertyId?: string;
  provinces?: string[];
  regions?: string[];
  query?: string;
};

const todayUtc = () => new Date().toISOString().slice(0, 10);

export function useFeaturedAds(filters: FeaturedFilters = {}): { ads: FeaturedAd[]; isLoading: boolean } {
  const qc = useQueryClient();
  const { data: sponsored, isLoading: sponsoredLoading } = useActiveSponsoredReels();
  const [today, setToday] = useState(todayUtc);

  useEffect(() => {
    const id = setInterval(() => {
      setToday(todayUtc());
      void qc.invalidateQueries({ queryKey: ["sponsoredReels", "active"] });
    }, 60_000);
    return () => clearInterval(id);
  }, [qc]);
  useEffect(() => {
    const id = setInterval(() => setToday(todayUtc()), 30_000);
    return () => clearInterval(id);
  }, []);

  const inFeed = useMemo(
    () => (sponsored ?? []).filter((s) => s.placement === "in_feed" && (!s.endDate || s.endDate >= today)),
    [sponsored, today]
  );
  const ids = useMemo(() => [...new Set(inFeed.map((s) => s.propertyId))], [inFeed]);
  const { data: properties, isLoading: propsLoading } = usePropertiesByIds(ids);

  const { excludePropertyId, provinces, regions, query } = filters;
  const ads = useMemo(() => {
    const byId = new Map((properties ?? []).map((p) => [p.id, p]));
    const seen = new Set<string>();
    const out: FeaturedAd[] = [];
    for (const s of inFeed) { // مرتبة من الأحدث تفعيلًا
      if (seen.has(s.propertyId) || s.propertyId === excludePropertyId) continue;
      const p = byId.get(s.propertyId);
      if (!p || p.closedType || p.isActive === false) continue;
      if (provinces?.length || regions?.length) {
        if (!matchesLocationFilter(p, provinces ?? [], regions ?? [])) continue;
      }
      if (query && !matchesSearchQuery(p, query)) continue;
      seen.add(p.id);
      out.push({ reelId: s.id, property: p });
    }
    return out;
  }, [inFeed, properties, excludePropertyId, provinces, regions, query]);

  return { ads, isLoading: sponsoredLoading || (ids.length > 0 && propsLoading) };
}
