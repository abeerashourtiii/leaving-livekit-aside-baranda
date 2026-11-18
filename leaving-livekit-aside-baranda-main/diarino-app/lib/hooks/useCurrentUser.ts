import { useSyncExternalStore } from "react";
import { User } from "@supabase/supabase-js";
import { supabase } from "../supabase";
import { withTimeout } from "../async";

type AuthSnapshot = { user: User | null; loading: boolean };
export type AuthStateListener = () => void;

let snapshot: AuthSnapshot = { user: null, loading: true };
let initialized = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

// ↔ إصلاح: المقارنة كانت بالـ id فقط، فتغيّر بيانات نفس المستخدم (الاسم فى user_metadata، أو is_anonymous عند تحويل حساب
//   الضيف لحساب مسجّل — الـ id بيفضل نفسه!) ما كانش بينعكس على displayName وبوابة الضيف. دلوقتى بنقارن الحقول اللى بتأثر على
//   الواجهة (id, is_anonymous, email, phone, updated_at, user_metadata). ولو ما اتغيّرش شيء منها (مثلًا TOKEN_REFRESHED اللى
//   بيرجّع كائن user جديد بنفس البيانات) بنفضل على الـ snapshot القديم بنفس المرجع، فالهوكس اللى بتعتمد على `user` ما تعيدش
//   الجلب بدون داعى.
function sameUserData(a: User | null, b: User | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.is_anonymous === b.is_anonymous &&
    a.email === b.email &&
    a.phone === b.phone &&
    a.updated_at === b.updated_at &&
    JSON.stringify(a.user_metadata ?? null) === JSON.stringify(b.user_metadata ?? null)
  );
}

function updateSnapshot(newUser: User | null, newLoading: boolean) {
  if (sameUserData(snapshot.user, newUser) && snapshot.loading === newLoading) return;

  snapshot = { user: newUser, loading: newLoading };
  emit();
}

export function getAuthSnapshot() {
  return snapshot;
}

export function subscribeAuthState(listener: AuthStateListener) {
  listeners.add(listener);
  initializeAuthState();
  return () => {
    listeners.delete(listener);
  };
}

function initializeAuthState() {
  if (initialized) return;
  initialized = true;

  // ↔ إصلاح «شاشة تفضل تحميل/بيضاء عند فتح التطبيق»: getSession() ممكن يتأخر (قفل الجلسة/التخزين). لو ما رجعش خلال 8 ثوانٍ
  // نعتبر مفيش مستخدم مؤقتًا (فتظهر شاشة الدخول) — وأى حدث دخول/استعادة جلسة لاحق بيحدّث الحالة تلقائيًا من onAuthStateChange.
  withTimeout(supabase.auth.getSession(), 8000, "getSession")
    .then(({ data }) => {
      updateSnapshot(data.session?.user ?? null, false);
    })
    .catch((err: unknown) => {
      console.warn("Failed to fetch current user:", err);
      updateSnapshot(snapshot.user, false);
    });

  supabase.auth.onAuthStateChange((_event, session) => {
    updateSnapshot(session?.user ?? null, false);
  });
}

export function useCurrentUser() {
  const authState = useSyncExternalStore(
    subscribeAuthState,
    () => snapshot,
    () => snapshot,
  );

  const displayName =
    (authState.user?.user_metadata?.full_name as string) || 
    (authState.user?.user_metadata?.name as string) || 
    authState.user?.email || 
    "مستخدم";

  return { user: authState.user, displayName, loading: authState.loading };
}