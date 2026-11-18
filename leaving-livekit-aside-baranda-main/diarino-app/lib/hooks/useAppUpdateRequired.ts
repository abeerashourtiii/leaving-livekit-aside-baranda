import { Platform } from "react-native";
import Constants from "expo-constants";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { isBelowMinVersion } from "../appVersion";
import { APP_STORE_URL, PLAY_STORE_URL } from "../appLinks";

// ↔ على أندرويد/آيفون فقط (الويب يتحدّث تلقائيًا). الإصدار من الجزء الأصلى (versionName / CFBundleShortVersionString) لا من manifest التحديثات OTA.
// الفشل مفتوح: بلا اتصال أو خطأ ⇒ لا حجب.
export function useAppUpdateRequired(): { required: boolean; storeUrl: string; message: string | null } {
  const native = Platform.OS === "android" || Platform.OS === "ios";
  const { data } = useQuery({
    queryKey: ["appVersionRequirement", Platform.OS],
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from("app_version_requirements" as never)
        .select("min_version, store_url, message")
        .eq("platform", Platform.OS)
        .maybeSingle();
      if (error) return null;
      return row as { min_version: string; store_url: string | null; message: string | null } | null;
    },
    enabled: native,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const current = Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? null;
  const fallbackStore = Platform.OS === "ios" ? APP_STORE_URL : PLAY_STORE_URL;
  return {
    required: native && !!data && isBelowMinVersion(current, data.min_version),
    storeUrl: data?.store_url || fallbackStore,
    message: data?.message ?? null,
  };
}
