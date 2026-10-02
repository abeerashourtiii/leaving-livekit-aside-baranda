import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase";

type ActiveLiveRow = {
  room_name: string;
  title: string | null;
  profiles_public: { full_name: string | null } | null;
};

export type ActiveLive = {
  roomName: string;
  title: string | null;
  hostName: string | null;
};

// ↔ `enabled` = false لما ميزة "البث المباشر" معطّلة من لوحة الأدمن —
// بيوقف الاستعلام والـ polling بالكامل بدل ما يشتغل فى الخلفية بدون فايدة.
export function useActiveLives(enabled = true) {
  return useQuery({
    queryKey: ["activeLives"],
    queryFn: async (): Promise<ActiveLive[]> => {
      const { data, error } = await supabase
        .from("lives")
        .select("room_name, title, profiles_public!host_id(full_name)")
        .eq("status", "live")
        .order("created_at", { ascending: false });
      if (error) throw error;

      return ((data ?? []) as unknown as ActiveLiveRow[]).map((row) => ({
        roomName: row.room_name,
        title: row.title,
        hostName: row.profiles_public?.full_name ?? null,
      }));
    },
    enabled,
    staleTime: 10_000,
    refetchInterval: enabled ? 20_000 : false,
  });
}