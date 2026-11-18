import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { useCurrentUser } from "./useCurrentUser";
import { retryWithTimeout } from "../async";

// ↔ checkAdmin(uid) — queries user_roles for an 'admin' row matching the
// current user. Granting used to be a manual/server-side-only action;
// 20260807000000_super_admin_system.sql replaces that with a real
// in-app super-admin system, so this now also reads is_super_admin/
// full_access/permissions for gating individual admin sections.
export type AdminSection =
  | "reels"
  | "lives"
  | "reports"
  | "users"
  | "features"
  | "ads"
  | "sponsoredReels"
  | "auditLog"
  | "userActivity"
  | "menuItems"
  | "music"
  | "deals"
  | "offers"
  | "requests";

type UserRoleRow = {
  role: string;
  is_super_admin: boolean | null;
  full_access: boolean | null;
  permissions: AdminSection[] | null;
};

// ↔ إصلاحان (تحليل الأخطاء):
//   1) المهلة: التعليق القديم كان بيقول «مرتين» والكود attempts:3 × 8 ثوانٍ (≈25 ثانية قبل الرفض على شبكة ضعيفة). دلوقتى
//      محاولتان × 6 ثوانٍ (≈12 ثانية كحد أقصى) والنتيجة عند الفشل «ليس أدمن» (الافتراضى الآمن) — تنعكس فورًا.
//   2) الازدواج: أكتر من شاشة/مكوّن بيستدعوا useIsAdmin فى نفس الوقت (_layout، الإعدادات، لوحة الأدمن…) وكل واحد كان بيبعت
//      طلب جدول user_roles لوحده. دلوقتى عبر React Query بمفتاح واحد لكل مستخدم (طلب واحد مشترك، وكاش 60 ثانية). لو الطلب فشل
//      ما بيتخزّنش كنتيجة، فالمحاولة الجاية (فتح شاشة أخرى) بتجرّب من جديد.
const ADMIN_ATTEMPTS = 2;
const ADMIN_TIMEOUT_MS = 6000;

type AdminState = { isAdmin: boolean; isSuperAdmin: boolean; fullAccess: boolean; permissions: AdminSection[] };
const NOT_ADMIN: AdminState = { isAdmin: false, isSuperAdmin: false, fullAccess: false, permissions: [] };

export async function fetchAdminState(userId: string): Promise<AdminState> {
  try {
    const { data, error } = await retryWithTimeout(
      () => supabase
        .from("user_roles")
        .select("role, is_super_admin, full_access, permissions")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle(),
      { attempts: ADMIN_ATTEMPTS, timeoutMs: ADMIN_TIMEOUT_MS, label: "admin-role" },
    );
    if (error) throw error;
    const roleData = data as UserRoleRow | null;
    if (!roleData) return NOT_ADMIN;
    return {
      isAdmin: true,
      isSuperAdmin: !!roleData.is_super_admin,
      fullAccess: roleData.full_access ?? false,
      permissions: roleData.permissions ?? [],
    };
  } catch (err: unknown) {
    // ↔ فشل الشبكة كان زمان بيسيب `checking` معلّقة للأبد (شاشة بوابة الأدمن تدور بلا نهاية). الافتراضى الآمن: لو ما اتأكدناش
    //   إنه أدمن نعامله كغير أدمن (والنتيجة دى ما بتتخزّنش فى الكاش: نرمى بعد التسجيل ليحاول المستخدم لاحقًا).
    console.warn("Failed to check admin status:", err);
    throw err;
  }
}

export function useIsAdmin() {
  const { user, loading: userLoading } = useCurrentUser();
  const userId = user?.id;
  const query = useQuery({
    queryKey: ["isAdmin", userId],
    queryFn: () => fetchAdminState(userId!),
    enabled: !userLoading && !!userId,
    staleTime: 60_000,
    retry: false, // إعادة المحاولة جوّه fetchAdminState (بمهلة) — مفيش ضرب مضاعف
  });

  const state = query.data ?? NOT_ADMIN;
  // نعتبرها «بتتحقق» ما دام مفيش نتيجة بعد وفيه محاولة شغّالة أو لسه ما فشلتش؛ بعد الفشل النهائى = رفض (checking=false).
  const checking = userLoading || (!!userId && query.data === undefined && (!query.isError || query.isFetching));

  function canAccess(section: AdminSection): boolean {
    if (state.isSuperAdmin || state.fullAccess) return true;
    return state.permissions.includes(section);
  }

  return {
    isAdmin: state.isAdmin,
    isSuperAdmin: state.isSuperAdmin,
    fullAccess: state.fullAccess,
    permissions: state.permissions,
    canAccess,
    checking,
  };
}
