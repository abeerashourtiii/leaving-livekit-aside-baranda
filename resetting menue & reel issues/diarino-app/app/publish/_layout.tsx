import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { Stack, router } from "expo-router";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { promptGuestLogin } from "../../lib/guestGate";
import { useThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ النشر والطلب لأصحاب الحسابات المسجَّلة فقط (جوجل أو بريد). الضيف (جلسة
// مجهولة) أو من بلا جلسة أصلًا بيتحوّل لصفحة التسجيل مع الرسالة — الحماية هنا
// بتغطّى أى مدخل للشاشتين (كروت القائمة، المسودات، تعديل إعلان، رابط مباشر).
export default function PublishLayout() {
  const { user, loading } = useCurrentUser();
  const themeColors = useThemeColors();
  const isGuest = !loading && !!user?.is_anonymous;
  const noSession = !loading && !user;
  const blocked = isGuest || noSession;

  // ↔ ضيف وصل هنا من مدخل غير كروت القائمة (رابط مباشر، مسودة...): نرجّعه للى كان فيه ونعرض نافذة
  // «تسجيل الدخول / ليس الآن» — بدون signOut ولا مسح بيانات التطبيق. من غير جلسة أصلًا (انتهت)
  // فمفيش حاجة نحافظ عليها: صفحة الدخول مباشرة.
  useEffect(() => {
    if (isGuest) {
      promptGuestLogin();
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)");
    } else if (noSession) {
      router.replace("/");
    }
  }, [isGuest, noSession]);

  if (loading || blocked) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: themeColors.background }}>
        <ActivityIndicator color="#22A652" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, presentation: "modal" }}>
      <Stack.Screen name="create-listing" />
      <Stack.Screen name="create-request" />
    </Stack>
  );
}
