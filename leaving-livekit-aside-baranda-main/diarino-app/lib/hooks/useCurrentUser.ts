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

// دالة تفحص التغيير الحقيقي قبل إطلاق التحديث
function updateSnapshot(newUser: User | null, newLoading: boolean) {
  const isSameUser = snapshot.user?.id === newUser?.id;
  const isSameLoading = snapshot.loading === newLoading;

  // إذا لم يطرأ تغيير حقيقي على ID المستخدم أو حالة التحميل، لا تنشئ snapshot جديد
  if (isSameUser && isSameLoading) return;

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