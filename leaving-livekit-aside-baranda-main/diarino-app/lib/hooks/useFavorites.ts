import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trackSignal } from "../recommendation/store";
import { supabase } from "../supabase";
import { useCurrentUser } from "./useCurrentUser";
import { requestToggle } from "../optimisticToggle";
import { showToast } from "../../components/shared/Toast";
import { translate } from "./useLanguage";

// ↔ state.favoriteProperties / state.favoriteRequests (Sets) in
// app-viewer.html — both now backed by the real `favorites` table, shared
// across devices/sessions instead of resetting on every app relaunch.

type FavoriteRow = {
  property_id?: string | null;
  request_id?: string | null;
};

type FavoriteInsert = {
  user_id: string;
  property_id?: string;
  request_id?: string;
};

async function fetchFavoriteIds(userId: string, column: "property_id" | "request_id"): Promise<Set<string>> {
  const { data, error } = await supabase.from("favorites").select(column).eq("user_id", userId).not(column, "is", null);
  if (error) throw error;
  const rows = (data ?? []) as FavoriteRow[];
  const ids = rows
    .map((r) => r[column])
    .filter((val): val is string => typeof val === "string");
  return new Set(ids);
}

function useFavoriteSet(column: "property_id" | "request_id") {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const userId = user?.id;
  const queryKey = ["favorites", column, userId];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchFavoriteIds(userId!, column),
    enabled: !!userId,
    staleTime: 15_000,
  });

  // ↔ إصلاح (تحليل الأخطاء): الحالة كانت تُقرَّر من الكاش القديم (ضغطتان سريعتان = إدراج مرتين والثانى يفشل بصمت) وإشارة
  //   التوصية كانت تُسجَّل قبل نجاح الطلب. الآن: تحديث متفائل + طلب واحد لكل عنصر فى كل مرة + رسالة عند الفشل +
  //   الإشارة بعد نجاح الخادم (lib/optimisticToggle.ts). دالة مستقرّة (useCallback).
  const toggle = useCallback(
    (targetId: string) => {
      if (!userId) return;
      const key = ["favorites", column, userId];
      const current = qc.getQueryData<Set<string>>(key)?.has(targetId) ?? false;
      requestToggle({
        key: `fav:${column}:${userId}:${targetId}`,
        current,
        apply: (state) => {
          void qc.cancelQueries({ queryKey: key });
          qc.setQueryData<Set<string>>(key, (old) => {
            const next = new Set(old ?? []);
            if (state) next.add(targetId); else next.delete(targetId);
            return next;
          });
        },
        send: async (state) => {
          if (state) {
            const payload: FavoriteInsert = { user_id: userId };
            if (column === "property_id") payload.property_id = targetId;
            if (column === "request_id") payload.request_id = targetId;
            const { error } = await supabase.from("favorites").insert(payload);
            if (error && error.code !== "23505") throw error; // 23505 = محفوظ بالفعل
          } else {
            const { error } = await supabase.from("favorites").delete().eq("user_id", userId).eq(column, targetId);
            if (error) throw error;
          }
        },
        // ↔ إشارة لنظام التوصية: حفظ العقار فى المفضلة (أو إزالته) — بعد نجاح الخادم.
        confirmed: (state) => { if (column === "property_id") trackSignal(state ? "save" : "unsave", targetId); },
        failed: () => showToast(translate("تعذر تحديث المفضلة. تحقق من الاتصال وحاول مرة أخرى.")),
      });
    },
    [qc, userId, column]
  );

  return { ids: query.data ?? new Set<string>(), toggle };
}

export function useFavorites() {
  const properties = useFavoriteSet("property_id");
  const requests = useFavoriteSet("request_id");
  return {
    favoriteProperties: properties.ids,
    favoriteRequests: requests.ids,
    totalCount: properties.ids.size + requests.ids.size,
    toggleFavoriteProperty: properties.toggle,
    toggleFavoriteRequest: requests.toggle,
  };
}