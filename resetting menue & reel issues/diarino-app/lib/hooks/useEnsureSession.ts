import { useEffect, useRef, useState } from "react";
import { useCurrentUser } from "./useCurrentUser";
import { signInAsGuest } from "./useAuth";

// ↔ الروابط العميقة (مثلاً رابط مشاركة بروفايل): فتح الرابط بيوصل لصفحة
// المعلن مباشرة من غير ما يعدّى على شاشة الدخول (app/index.tsx) اللى بتجهّز
// جلسة Supabase. كل سياسات RLS مقصورة على `authenticated`، فمن غير جلسة
// الصفحة بترجع فاضية. لو مفيش مستخدم بعد ما اتحمّلت حالة الدخول، بنفتح جلسة
// ضيف (anonymous sign-in، نفس "المتابعة كضيف") مرة واحدة، فالرابط يشتغل
// لأى زائر جديد على أندرويد/آيفون/الويب. لو فشل (الدخول كضيف مش مفعّل مثلاً)
// بيرجع failed=true والشاشة بتعرض زر تسجيل الدخول.
export function useEnsureSession(): { ready: boolean; failed: boolean } {
  const { user, loading } = useCurrentUser();
  const startedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (loading || user || startedRef.current) return;
    startedRef.current = true;
    signInAsGuest()
      .then(({ error }) => { if (error) setFailed(true); })
      .catch(() => setFailed(true));
  }, [loading, user]);

  return { ready: !!user, failed: failed && !user };
}
