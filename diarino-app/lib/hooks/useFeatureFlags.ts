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
    staleTime: 60_000,
  });
}

// ↔ convenience for gating one feature. Defaults to enabled (true)
// while the flags are still loading or if the fetch fails — same
// default the feature_flags table itself uses (`enabled ... default
// true`), so a slow/failed network call never hides an otherwise-on
// feature. Once the row loads, an explicit `enabled: false` from the
// admin panel is respected everywhere this hook is used.
export function useFeatureFlag(key: FeatureKey): boolean {
  const { data } = useFeatureFlags();
  return data?.[key] ?? true;
}
