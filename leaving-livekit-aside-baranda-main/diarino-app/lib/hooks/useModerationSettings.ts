import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";

// ↔ مفتاح «اشتراط موافقة الأدمن قبل نشر الريلز» (moderation_settings.require_reel_approval — 20261019000000_reel_approval.sql).
// الافتراضى: مفعَّل (كل إعلان جديد = «قيد المراجعة» ولا يظهر للعامة قبل موافقة الأدمن). الأدمن بصلاحية «إدارة الريلز» يعطّله
// فيُنشر كل إعلان جديد فورًا. الخادم (trigger) هو اللى بيطبّق القرار — العميل بس بيعرضه ويعدّله.
// لو الجدول لسه ما اتطبقش (migration) بنفترض الافتراضى (مفعَّل) من غير ما نرمى خطأ.
export function useReelApprovalRequired() {
  const q = useQuery({
    queryKey: ["moderationSettings"],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.from("moderation_settings").select("require_reel_approval").eq("id", true).maybeSingle();
      if (error || !data) return true;
      return data.require_reel_approval;
    },
    staleTime: 60_000,
  });
  return { required: q.data ?? true, isLoading: q.isLoading };
}

export function useSetReelApprovalRequired() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (required: boolean) => {
      const { data, error } = await supabase
        .from("moderation_settings")
        .update({ require_reel_approval: required, updated_at: new Date().toISOString() })
        .eq("id", true)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["moderationSettings"] }),
  });
}
