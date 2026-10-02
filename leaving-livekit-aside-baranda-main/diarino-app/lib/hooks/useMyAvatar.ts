import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { useCurrentUser } from "./useCurrentUser";

// ↔ صورة الملف الشخصي للمستخدم الحالي (profiles.avatar_url) — بتستخدمها
// دائرة "إدارة الحساب" فى صفحة القائمة. نفس مصدر البيانات اللى بتعرضه
// شاشة الحساب (app/(tabs)/account.tsx) وبتعمل invalidate لنفس الـ
// queryKey (["myAvatar"]) بعد رفع صورة جديدة، فالاتنين متزامنين.
// null = مفيش صورة (أو مستخدم ضيف) — الكارت بيعرض أيقونة شخص بدلها.
export function useMyAvatar(): string | null {
  const { user, loading } = useCurrentUser();
  const { data } = useQuery({
    queryKey: ["myAvatar", user?.id ?? "anonymous"],
    queryFn: async (): Promise<string | null> => {
      const { data: row } = await supabase.from("profiles").select("avatar_url").eq("id", user!.id).maybeSingle();
      return (row?.avatar_url as string | null | undefined) ?? null;
    },
    enabled: !loading && !!user,
    staleTime: 60_000,
  });
  return data ?? null;
}
