import { useEffect } from "react";
import { Image } from "expo-image";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "./useCurrentUser";
import { fetchMenuRows, MenuItem } from "./useMenuItems";
import { fetchActiveAdBanners, AdBanner } from "./useAdBanners";
import { cldOptimized } from "../cloudinary";

// ↔ صفحة «القائمة» لحظية من أول مرة: قبل كده كروت القائمة والبانرات الإعلانية كانت بتتجاب من الخادم لحظة ما المستخدم
// يفتح التبويب لأول مرة (والتبويب نفسه كان بيتركّب وقتها)، فالصفحة كانت بتظهر فاضية/بطيئة. دلوقتى:
//   1) بنقرا آخر نسخة محفوظة من الكروت والبانرات من الجهاز ونحطها فى كاش React Query فورًا (تظهر لحظيًا حتى قبل الشبكة)،
//   2) بنجلب النسخة الجديدة من الخادم فى الخلفية أول ما المستخدم يدخل التطبيق ونحدّث الكاش والنسخة المحفوظة،
//   3) بنحمّل صور الكروت والبانرات مسبقًا (expo-image) عشان تظهر من غير وميض،
//   4) تبويب القائمة بيتركّب مع بدء التطبيق (lazy:false فى app/(tabs)/_layout.tsx) فمفيش وقت تركيب عند الانتقال.
const CACHE_KEY = "menu_prewarm_v1";

type Snapshot = { menu?: MenuItem[]; banners?: AdBanner[] };

function imageUrls(menu: MenuItem[] | undefined, banners: AdBanner[] | undefined): string[] {
  const urls: string[] = [];
  menu?.forEach((m) => { if (m.imageUrl) urls.push(cldOptimized(m.imageUrl)); });
  banners?.forEach((b) => { if (b.imageUrl) urls.push(cldOptimized(b.imageUrl)); });
  return urls;
}

export function useMenuPrewarm(): void {
  const qc = useQueryClient();
  const { user, loading } = useCurrentUser();
  const userId = user?.id;

  useEffect(() => {
    if (loading || !userId) return;
    let cancelled = false;
    const menuKey = ["menuItems", "active", userId];
    const bannerKey = ["adBanners", "active"];

    (async () => {
      // 1) النسخة المحفوظة (updatedAt:0 → تتعامل كـ«قديمة» فالكاش يتحدّث من الخادم فورًا بعدها).
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (raw && !cancelled) {
          const cached = JSON.parse(raw) as Snapshot;
          if (cached.menu && !qc.getQueryData(menuKey)) qc.setQueryData(menuKey, cached.menu, { updatedAt: 0 });
          if (cached.banners && !qc.getQueryData(bannerKey)) qc.setQueryData(bannerKey, cached.banners, { updatedAt: 0 });
          Image.prefetch(imageUrls(cached.menu, cached.banners)).catch(() => {});
        }
      } catch { /* الكاش المحلى اختيارى */ }
      if (cancelled) return;

      // 2) النسخة الجديدة من الخادم.
      const [menu, banners] = await Promise.all([
        qc.fetchQuery({ queryKey: menuKey, queryFn: () => fetchMenuRows(true), staleTime: 30_000 }).catch(() => undefined),
        qc.fetchQuery({ queryKey: bannerKey, queryFn: fetchActiveAdBanners, staleTime: 60_000 }).catch(() => undefined),
      ]);
      if (cancelled || (!menu && !banners)) return;
      const snapshot: Snapshot = { menu: menu ?? qc.getQueryData<MenuItem[]>(menuKey), banners: banners ?? qc.getQueryData<AdBanner[]>(bannerKey) };
      Image.prefetch(imageUrls(snapshot.menu, snapshot.banners)).catch(() => {});
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(snapshot)).catch(() => {});
    })();

    return () => { cancelled = true; };
  }, [qc, loading, userId]);
}
