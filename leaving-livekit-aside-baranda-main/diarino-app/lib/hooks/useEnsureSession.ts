import { useEffect, useRef, useState } from "react";
import { useCurrentUser } from "./useCurrentUser";
import { signInAsGuest } from "./useAuth";
import { withTimeout } from "../async";

// ↔ الروابط العميقة (مثلاً رابط مشاركة بروفايل): فتح الرابط بيوصل لصفحة
// المعلن مباشرة من غير ما يعدّى على شاشة الدخول (app/index.tsx) اللى بتجهّز
// جلسة Supabase. كل سياسات RLS مقصورة على `authenticated`، فمن غير جلسة
// الصفحة بترجع فاضية. لو مفيش مستخدم بعد ما اتحمّلت حالة الدخول، بنفتح جلسة
// ضيف (anonymous sign-in، نفس "المتابعة كضيف") فالرابط يشتغل
// لأى زائر جديد على أندرويد/آيفون/الويب. لو فشل (الدخول كضيف مش مفعّل مثلاً)
// بيرجع failed=true والشاشة بتعرض زر تسجيل الدخول.
//
// ↔ إصلاح «تحميل بلا نهاية»: startedRef كان بيفضل true للأبد، فلو المستخدم خرج (أو الجلسة انتهت) أثناء صفحة الرابط العميق
//   ما كانتش بتتعمل محاولة تانية (ready=false وfailed=false = تحميل بلا نهاية). دلوقتى: (1) المحاولة بتتصفّر لما يظهر مستخدم،
//   فأى خروج لاحق بيبدأ محاولة جديدة؛ (2) لكل محاولة مهلة 15 ثانية؛ (3) لو نجحت المحاولة وما وصلش المستخدم خلال 8 ثوانٍ
//   (حدث الجلسة اتأخر/ضاع) نعتبرها فاشلة بدل التحميل للأبد. ولو فشلت محاولة ما بنكرّرش تلقائيًا (لا حلقة طلبات) — الشاشة
//   بتعرض زر الدخول.
const ATTEMPT_TIMEOUT_MS = 15_000;
const USER_ARRIVAL_TIMEOUT_MS = 8_000;

export function useEnsureSession(): { ready: boolean; failed: boolean } {
  const { user, loading } = useCurrentUser();
  const startedRef = useRef(false);
  const userRef = useRef(user);
  userRef.current = user;
  const [failed, setFailed] = useState(false);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (loading) return;
    if (userId) {
      // فى مستخدم: نصفّر الحالة عشان أى خروج لاحق يقدر يبدأ محاولة جديدة.
      startedRef.current = false;
      setFailed(false);
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    let arrivalTimer: ReturnType<typeof setTimeout> | undefined;
    withTimeout(signInAsGuest(), ATTEMPT_TIMEOUT_MS, "ensure-guest-session")
      .then(({ error }) => {
        if (error) { setFailed(true); return; }
        arrivalTimer = setTimeout(() => { if (!userRef.current) setFailed(true); }, USER_ARRIVAL_TIMEOUT_MS);
      })
      .catch(() => setFailed(true));
    return () => { if (arrivalTimer) clearTimeout(arrivalTimer); };
  }, [loading, userId]);

  return { ready: !!user, failed: failed && !user };
}
