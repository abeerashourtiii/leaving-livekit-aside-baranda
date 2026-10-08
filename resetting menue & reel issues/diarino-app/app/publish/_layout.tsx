import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { Stack } from "expo-router";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { redirectGuestToLogin } from "../../lib/guestGate";
import { useThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ النشر والطلب لأصحاب الحسابات المسجَّلة فقط (جوجل أو بريد). الضيف (جلسة
// مجهولة) أو من بلا جلسة أصلًا بيتحوّل لصفحة التسجيل مع الرسالة — الحماية هنا
// بتغطّى أى مدخل للشاشتين (كروت القائمة، المسودات، تعديل إعلان، رابط مباشر).
export default function PublishLayout() {
  const { user, loading } = useCurrentUser();
  const themeColors = useThemeColors();
  const blocked = !loading && (!user || !!user.is_anonymous);

  useEffect(() => {
    if (blocked) void redirectGuestToLogin();
  }, [blocked]);

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
