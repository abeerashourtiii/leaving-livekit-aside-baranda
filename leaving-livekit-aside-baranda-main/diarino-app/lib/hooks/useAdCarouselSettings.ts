import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";

export type AdCarouselSettings = {
  rotationMode: "auto" | "manual";
  durationMs: number;
  // ↔ إظهار صورة "ضع إعلانك هنا" الدائمة ضمن دورة الإعلانات (الأدمن يقدر يعطّلها).
  showPlaceholder: boolean;
};

const DEFAULTS: AdCarouselSettings = { rotationMode: "auto", durationMs: 4000, showPlaceholder: true };

// ↔ admin control over whether the "مساحة إعلانية" carousel advances on
// its own, or only when the person swipes it themselves — and if
// automatic, how long each banner stays up before advancing — and whether
// the permanent "ضع إعلانك هنا" image is part of the rotation.
export function useAdCarouselSettings() {
  return useQuery({
    queryKey: ["adCarouselSettings"],
    queryFn: async (): Promise<AdCarouselSettings> => {
      let res = await supabase
        .from("ad_carousel_settings")
        .select("rotation_mode, duration_ms, show_placeholder")
        .eq("id", true)
        .maybeSingle();

      // ↔ العمود show_placeholder مضاف فى migration 20261003000000 — لو لسه متطبّقتش
      // (أو ما اتعملتش على الـ APK/الويب بعد) نرجع للاستعلام القديم بدل ما الصفحة تقع.
      if (res.error) {
        res = (await supabase
          .from("ad_carousel_settings")
          .select("rotation_mode, duration_ms")
          .eq("id", true)
          .maybeSingle()) as unknown as typeof res;
      }
      const { data, error } = res;
      if (error) throw error;
      if (!data) return DEFAULTS;

      return {
        rotationMode: (data.rotation_mode as "auto" | "manual") ?? "auto",
        durationMs: data.duration_ms,
        showPlaceholder: (data as { show_placeholder?: boolean }).show_placeholder ?? true,
      };
    },
    staleTime: 30_000,
  });
}

export function useUpdateAdCarouselSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<AdCarouselSettings>) => {
      const row: { rotation_mode?: string; duration_ms?: number; show_placeholder?: boolean } = {};
      if (patch.rotationMode !== undefined) row.rotation_mode = patch.rotationMode;
      if (patch.durationMs !== undefined) row.duration_ms = patch.durationMs;
      if (patch.showPlaceholder !== undefined) row.show_placeholder = patch.showPlaceholder;

      const { error } = await supabase
        .from("ad_carousel_settings")
        .update(row)
        .eq("id", true);

      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adCarouselSettings"] }),
  });
}
