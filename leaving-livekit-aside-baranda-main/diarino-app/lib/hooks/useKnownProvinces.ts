import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { PROVINCES } from "../../data/locations";
import { includesNormalized, normalizeArabic } from "../arabicText";

// ↔ M2: قائمة المحافظات مغلقة (27 محافظة فى data/locations.ts) ولا تُرقّى أى مساهمة من المستخدمين لتظهر للجميع.
// المطابقة بتطبيع عربى (M5): «اسكندرية» تطابق «الإسكندرية» و«المنوفيه» تطابق «المنوفية»، وتطابق أيضًا الشكل المُترجَم t(p).
export function useProvinceSuggestions(query: string, t: (s: string) => string) {
  return useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    const qLower = q.toLowerCase();
    return PROVINCES.filter((p) => includesNormalized(p, q) || t(p).toLowerCase().includes(qLower)).slice(0, 6);
  }, [query, t]);
}

// ↔ تسجيل محاولة بحث بمحافظة غير معروفة = إحصاء يراه الأدمن فقط (لا يغيّر أى قائمة للمستخدمين). فشله لا يؤثر على البحث.
export function useRecordProvinceSearchAttempt() {
  return useMutation({
    mutationFn: async (name: string): Promise<number | null> => {
      const trimmed = name.trim();
      if (!trimmed || PROVINCES.some((p) => normalizeArabic(p) === normalizeArabic(trimmed))) return null;
      const { data, error } = await supabase.rpc("record_province_search_attempt", { p_name: trimmed });
      if (error) return null;
      return (data as number | null) ?? null;
    },
  });
}
