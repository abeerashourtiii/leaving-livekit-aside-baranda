import { Redirect, Stack, useSegments } from "expo-router";
import { View } from "react-native";
import { useFeatureFlags } from "../../lib/hooks/useFeatureFlags";
import { useIsAdmin } from "../../lib/hooks/useIsAdmin";

// ↔ حارس مسارات البث المباشر (/live/broadcast, /live/[id], /live/replay/[id]).
//
// إخفاء الأزرار وحده (القائمة / الحساب / صفحة المعلن) مش كفاية: أي رابط
// مباشر (deep link، رابط ويب، حالة تنقل قديمة، إشعار قديم) كان لسه بيقدر
// يفتح شاشة اللايف. الحارس ده بيمنع الوصول للمسارات نفسها لما الأدمن
// يعطّل ميزة "البث المباشر" من لوحة التحكم — على الأندرويد والآيفون
// والويب والـ APK بنفس الكود (expo-router Redirect شغّال على كل المنصات).
//
// الاستثناء الوحيد: الأدمن يقدر يفتح شاشة إعادة العرض (replay) حتى والميزة
// معطّلة، لأن لوحة الأدمن (components/admin/AdminLives.tsx) بتفتحها لمراجعة
// المحتوى المسجّل. البث نفسه (broadcast / المشاهدة المباشرة) ممنوع على
// الكل بما فيهم الأدمن طالما الميزة معطّلة.
//
// كود LiveKit نفسه (الشاشات، الـ hooks، الـ Edge Functions) ما اتلمسش
// خالص — الحارس ده طبقة فوقه بس، ولما الميزة تتفعّل تاني كل حاجة بترجع
// تشتغل زي ما كانت من غير أي تعديل.
export default function LiveLayout() {
  const { data: flags, isLoading: flagsLoading } = useFeatureFlags();
  const { isAdmin, checking: adminChecking } = useIsAdmin();
  const segments = useSegments() as string[];

  const enabled = flags?.live ?? false; // fail-closed: مفيش صف/فشل جلب = معطّلة
  const isReplayRoute = segments.includes("replay");

  if (flagsLoading || adminChecking) {
    // لحظات قصيرة (الـ flags عادةً متخزّنة فى الكاش) — شاشة سوداء بدل وميض.
    return <View style={{ flex: 1, backgroundColor: "#000" }} />;
  }

  if (!enabled && !(isAdmin && isReplayRoute)) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false, presentation: "fullScreenModal" }}>
      <Stack.Screen name="broadcast" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="replay/[id]" options={{ presentation: "modal" }} />
    </Stack>
  );
}
