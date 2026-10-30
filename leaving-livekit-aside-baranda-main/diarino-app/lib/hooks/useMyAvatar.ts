import { useProfile } from "./useProfile";

// ↔ صورة الملف الشخصي للمستخدم الحالي (profiles.avatar_url) — بتستخدمها
// دائرة "إدارة الحساب" فى صفحة القائمة. بقت بتقرأ من نفس كاش useProfile
// (مصدر واحد لبيانات البروفايل) بدل query منفصل بكاش 60 ثانية، فأى تغيير
// للصورة من «تعديل بيانات الحساب» أو «حسابي» بيظهر فى القائمة لحظيًا.
// null = مفيش صورة (أو مستخدم ضيف) — الكارت بيعرض أيقونة شخص بدلها.
export function useMyAvatar(): string | null {
  const { profile } = useProfile();
  return profile?.avatarUrl ?? null;
}
