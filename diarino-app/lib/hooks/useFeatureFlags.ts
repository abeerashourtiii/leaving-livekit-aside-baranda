import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase";

// ↔ public.feature_flags (20260801000000_admin_backend.sql) — the admin
// "الميزات العامة للمنصة" page (components/admin/AdminFeatures.tsx)
// already reads/writes this table, but nothing on the app side ever
// read it back: toggling a flag off in the admin panel had zero effect
// on what users could actually reach. This hook is what wires it up.
export type FeatureKey =
  | "reels" | "live" | "stories" | "ads" | "wa" | "comments" | "saved" | "ai";

export function useFeatureFlags() {
  return useQuery({
    queryKey: ["featureFlags"],
    queryFn: async (): Promise<Record<string, boolean>> => {
      const { data, error } = await supabase.from("feature_flags").select("key, enabled");
      if (error) throw error;
      const map: Record<string, boolean> = {};
      for (const row of data ?? []) map[row.key as string] = row.enabled as boolean;
      return map;
    },
    // ↔ 30s + إعادة جلب دورية كل 60s: التاب (مثل القائمة) بيفضل mounted
    // طول الجلسة، فمن غير refetchInterval كان تغيير الأدمن للـ flag مش
    // بيوصل لباقي المستخدمين إلا بعد إعادة تشغيل التطبيق.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ↔ القيمة الافتراضية *لحد ما* الـ flag يتحمّل فعليًا من قاعدة البيانات
// (أو لو الطلب فشل / الصف مش موجود). الميزات القديمة افتراضيها "مفعّلة"
// عشان بطء الشبكة ما يخبّيش ميزة شغّالة. البث المباشر ("live") استثناء
// مقصود: مخفي افتراضيًا (fail-closed) — لو الطلب لسه بيتحمّل أو فشل،
// الأزرار ما تظهرش أصلًا بدل ما تظهر وتختفي (وميض)، ولا يحصل إن مستخدم
// يدخل شاشة اللايف بالغلط لأن الأدمن كان معطّلها. تتفعّل فقط لما الأدمن
// يشغّل مفتاح "البث المباشر" من لوحة التحكم (ويتحوّل الصف لـ enabled=true).
const FLAG_DEFAULTS: Partial<Record<FeatureKey, boolean>> = {
  live: false,
};

// ↔ convenience for gating one feature. Falls back to FLAG_DEFAULTS
// (above) while the flags are still loading, if the fetch fails, or if
// the row doesn't exist — enabled for every feature except "live", which
// is fail-closed. Once the row loads, the admin panel's explicit value
// is respected everywhere this hook is used.
export function useFeatureFlag(key: FeatureKey): boolean {
  const { data } = useFeatureFlags();
  return data?.[key] ?? FLAG_DEFAULTS[key] ?? true;
}
