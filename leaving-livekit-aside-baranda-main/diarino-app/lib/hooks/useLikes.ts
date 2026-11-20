import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trackSignal } from "../recommendation/store";
import { supabase } from "../supabase";
import { useCurrentUser } from "./useCurrentUser";
import { patchCounters } from "../cacheCounters";
import { requestToggle } from "../optimisticToggle";
import { showToast } from "../../components/shared/Toast";
import { translate } from "./useLanguage";

// ↔ مدعوم بجدول `likes` الحقيقى (20260802000000_notifications_backend.sql) والـ trigger على الخادم هو اللى بيحدّث properties.likes.
// ↔ إصلاح (تحليل الأخطاء):
//   1) لا invalidateQueries(["properties"]) بعد كل إعجاب (كان يعيد جلب كل صفحات الفيد): بنعدّل عدّاد العقار نفسه فى الكاش (lib/cacheCounters.ts).
//   2) تحديث متفائل + حماية من الضغط المتكرر + رسالة عند الفشل + إشارة التوصية بعد نجاح الخادم فقط (lib/optimisticToggle.ts).

async function fetchLikedIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("likes").select("property_id").eq("user_id", userId);
  if (error) throw error;
  return new Set(((data ?? []) as { property_id: string }[]).map((r) => r.property_id));
}

export function useLikes() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const userId = user?.id;
  const queryKey = ["likes", userId];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchLikedIds(userId!),
    enabled: !!userId,
    staleTime: 15_000,
  });

  // ↔ مستقرّة (useCallback): الكروت المتذكَّرة (memo) ما تتعاد رسمها مع كل render.
  const toggleLike = useCallback(
    (propertyId: string) => {
      if (!userId) return;
      const key = ["likes", userId];
      const current = qc.getQueryData<Set<string>>(key)?.has(propertyId) ?? false;
      let shown = current; // آخر حالة طبّقناها على الواجهة (لحساب فرق العدّاد بدقة)
      requestToggle({
        key: `like:${userId}:${propertyId}`,
        current,
        apply: (state) => {
          void qc.cancelQueries({ queryKey: key }); // لا نسمح لجلب قديم يدهس الحالة المتفائلة
          qc.setQueryData<Set<string>>(key, (old) => {
            const next = new Set(old ?? []);
            if (state) next.add(propertyId); else next.delete(propertyId);
            return next;
          });
          if (state !== shown) patchCounters(qc, "properties", propertyId, { likes: state ? 1 : -1 });
          shown = state;
        },
        send: async (state) => {
          if (state) {
            const { error } = await supabase.from("likes").insert({ user_id: userId, property_id: propertyId });
            if (error && error.code !== "23505") throw error; // 23505 = معجب بالفعل
          } else {
            const { error } = await supabase.from("likes").delete().eq("user_id", userId).eq("property_id", propertyId);
            if (error) throw error;
          }
        },
        // ↔ إشارة لنظام التوصية بعد نجاح الخادم فقط: إعجاب/إلغاء إعجاب بهذا النوع من العقارات.
        confirmed: (state) => trackSignal(state ? "like" : "unlike", propertyId),
        failed: () => showToast(translate("تعذر تحديث الإعجاب. تحقق من الاتصال وحاول مرة أخرى.")),
      });
    },
    [qc, userId]
  );

  return {
    likedIds: query.data ?? new Set<string>(),
    toggleLike,
  };
}
