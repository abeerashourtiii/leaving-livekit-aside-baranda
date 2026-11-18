import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase";

// ↔ L1-ج: التسجيلات فى حاوية خاصة؛ رابط التشغيل يأتى من الدالة live-recording-url (رابط موقّع قصير العمر بعد التحقق من
//   المضيف/الأدمن/النشر العام). لا نخزّن الرابط ولا نعرضه للمشاركة؛ يُجدَّد قبل انتهائه (نصف العمر) أو عند خطأ التشغيل (refetch).
export type SignedRecording = { url: string; expiresIn: number };

export function useLiveRecordingUrl(liveId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["liveRecordingUrl", liveId],
    queryFn: async (): Promise<SignedRecording> => {
      if (!liveId) throw new Error("liveId is required");
      const { data, error } = await supabase.functions.invoke<SignedRecording>("live-recording-url", { body: { liveId } });
      if (error || !data?.url) throw error ?? new Error("recording_unavailable");
      return data;
    },
    enabled: enabled && !!liveId,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: false,
  });
}
