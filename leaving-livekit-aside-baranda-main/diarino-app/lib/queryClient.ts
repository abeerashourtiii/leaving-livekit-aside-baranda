// lib/queryClient.ts
//
// A single, module-level QueryClient instance, imported both by
// app/_layout.tsx (to hand to <QueryClientProvider>) and by
// lib/hooks/useAuth.ts's signOut() (to call .clear() on it directly).
// signOut() is a plain async function, not a component or a hook, so it
// has no way to reach useQueryClient() — it needs the same instance
// available as a plain import instead.
//
// ↔ React Query / data-security audit finding: nothing previously reset
// the query cache on sign-out. Every user-scoped query does key by
// user.id (useLikes, useFavorites, useNotifications, useChatsDB, etc. —
// see that audit's hook-by-hook table), so a *different* signed-in user
// on the same device would get their own correctly-keyed queries, not
// literally see the previous user's data under the same key. But admin
// dashboard data (useAdminDB.ts) and any query still sitting in the
// in-memory cache from the just-signed-out session stay resident in
// memory regardless — clearing on sign-out is the simple, correct fix:
// there's no legitimate reason to keep ANY cached query around across a
// sign-out, and the next screens simply refetch whatever they need under
// the new session's RLS.
import { QueryClient, focusManager } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";

// ↔ الطلبات الدورية (refetchInterval): React Query على الويب بيوقفها تلقائيًا لما التبويب يتخبّى (visibilitychange)، لكن على
//   أندرويد/آيفون/APK ما فيش «تركيز نافذة» فكانت بتفضل شغّالة والتطبيق فى الخلفية (استهلاك بيانات وبطارية). هنا بنربط
//   focusManager بحالة التطبيق (AppState): فى الخلفية الطلبات الدورية بتقف، وأول ما يرجع للواجهة بتتجدّد الاستعلامات اللى
//   طلبت refetchOnWindowFocus (مثل أعلام الميزات وعدّاد الرسائل) لو بقت قديمة.
if (Platform.OS !== "web") {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener("change", (state) => handleFocus(state === "active"));
    return () => sub.remove();
  });
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
