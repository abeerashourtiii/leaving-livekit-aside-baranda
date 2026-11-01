import { useEffect, useRef } from "react";
import { router, usePathname, type Href } from "expo-router";
import { useCurrentUser } from "./useCurrentUser";
import { useProfile } from "./useProfile";
import { POLICIES_VERSION } from "../../data/policies";

// ↔ بوابة «نوع الحساب + الموافقة على السياسات» لأى حساب مسجَّل (جوجل أو بريد، مش ضيف): لو نوع الحساب لسه ما اتحددش أو إصدار السياسات اللى وافق عليه قديم
// بنفتح شاشة بيانات الحساب فى وضع الإكمال (?onboarding=1) — مفيش طريق للتطبيق إلا بعد اختيار النوع
// والضغط على «استمر». شغّالة من app/(tabs)/_layout.tsx فتغطى أندرويد/آيفون/الويب/APK (ورجوع OAuth على الويب).
// لو migration العمود مش متطبّقة (accountTypeSupported=false) بنسيب المستخدم يدخل بدل ما نحبسه.
export function useAccountTypeGate(): void {
  const { user } = useCurrentUser();
  const { profile } = useProfile();
  const pathname = usePathname();
  const openedRef = useRef(false);

  // ↔ أى مستخدم مسجَّل (جوجل أو بريد/كلمة مرور) غير الضيف: حسابات البريد القديمة كمان لازم توافق على الإصدار الجديد من السياسات
  // (كانت البوابة لحسابات جوجل بس). حسابات البريد اللى نوع حسابها محدد هتشوف الشاشة بس لو الإصدار اتغيّر.
  const isRegisteredUser = !!user && !user.is_anonymous;
  // ↔ الشاشة الإجبارية: تسجيل بيانات الحساب (نوع الحساب) + الموافقة على الشروط والسياسات (الإصدار الحالى).
  const needsAccountType =
    isRegisteredUser &&
    !!profile &&
    ((profile.accountTypeSupported && !profile.accountType) || (profile.policiesSupported && (!profile.policiesAcceptedAt || profile.policiesVersion !== POLICIES_VERSION)));

  useEffect(() => {
    if (!needsAccountType) {
      openedRef.current = false;
      return;
    }
    if (openedRef.current || pathname === "/edit-profile") return;
    openedRef.current = true;
    router.push("/edit-profile?onboarding=1" as Href);
  }, [needsAccountType, pathname]);
}
