import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { AccountType, isAccountType } from "../accountTypes";

// ↔ بيانات البروفايل العامة لأى مستخدم من profiles_public (الفيو الآمن: بدون
// هاتف ولا bio) — بتخلّى صفحة المعلن (app/seller/[id].tsx) تفتح حتى لو
// صاحب الحساب مالوش أى إعلان (قبل كده الصفحة كانت بتاخد الاسم من أول
// إعلان فقط، فرابط بروفايل بدون إعلانات كان بيعرض "هذا البائع غير متاح").
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PublicProfile = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  verified: boolean;
  isPublic: boolean;
  bio: string | null;
  accountType: AccountType | null;
};

type PublicProfileRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  verified: boolean | null;
  is_public: boolean | null;
  bio?: string | null;
  account_type?: string | null;
};

export function usePublicProfile(id: string | undefined, enabled = true) {
  // الحسابات التجريبية (data/mock-properties.ts) ids مش UUID — ماينفعش تتبعت لعمود uuid.
  const validId = !!id && UUID_RE.test(id);
  return useQuery({
    queryKey: ["publicProfile", id],
    queryFn: async (): Promise<PublicProfile | null> => {
      // ↔ النبذة (bio) بتتقرأ من الفيو بعد migration 20261007000002. لو لسه ما اتطبّقتش
      // (العمود مش موجود) نرجع للاستعلام القديم بدونها بدل ما الصفحة كلها تفشل.
      // ↔ بنجرّب الأعمدة الأحدث الأول (account_type بعد migration 20261009000000، ثم bio بعد 20261007000002)
      // ونرجع للأقدم لو العمود لسه مش موجود، بدل ما الصفحة كلها تفشل.
      const attempts = [
        "id, full_name, avatar_url, verified, is_public, bio, account_type",
        "id, full_name, avatar_url, verified, is_public, bio",
        "id, full_name, avatar_url, verified, is_public",
      ];
      let res = await supabase.from("profiles_public").select(attempts[0]).eq("id", id!).maybeSingle();
      for (let i = 1; res.error && i < attempts.length; i++) {
        res = (await supabase.from("profiles_public").select(attempts[i]).eq("id", id!).maybeSingle()) as typeof res;
      }
      if (res.error) throw res.error;
      if (!res.data) return null;
      const row = res.data as unknown as PublicProfileRow;
      return {
        id: row.id,
        name: row.full_name,
        avatarUrl: row.avatar_url,
        verified: row.verified ?? false,
        isPublic: row.is_public ?? true,
        bio: row.bio ?? null,
        accountType: isAccountType(row.account_type) ? row.account_type : null,
      };
    },
    enabled: validId && enabled,
    staleTime: 30_000,
  });
}
