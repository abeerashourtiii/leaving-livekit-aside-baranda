import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useEnsureSession } from "../../lib/hooks/useEnsureSession";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ روابط المشاركة (https://baranda.shop/property/<id>/reel، /compare?ids=…، /property/<id>) بتفتح الشاشة المطلوبة مباشرة
// من غير ما تعدّى على شاشة الدخول اللى بتجهّز جلسة Supabase، وكل سياسات RLS مقصورة على `authenticated`.
// الغلاف ده بيضمن وجود جلسة (ضيف لو لزم) *قبل* ما الشاشة تبدأ تقرا بياناتها — فالرابط يشتغل لأى زائر جديد
// على أندرويد/آيفون/الويب/APK (نفس فكرة صفحة المعلن: app/seller/[id].tsx).
export function DeepLinkSessionGate({ children }: { children: React.ReactNode }) {
  const { ready, failed } = useEnsureSession();
  const { t } = useLanguage();
  const themeColors = useThemeColors();

  if (ready) return <>{children}</>;
  return (
    <View style={[styles.wrap, { backgroundColor: themeColors.background }]}>
      {failed ? (
        <>
          <Text style={[styles.text, { color: themeColors.text }]}>{t("سجّل دخولك لعرض هذه الصفحة")}</Text>
          <Pressable style={styles.btn} onPress={() => router.replace("/")}>
            <Text style={styles.btnText}>{t("تسجيل الدخول")}</Text>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator color="#22A652" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  text: { fontSize: 14, fontWeight: "800", textAlign: "center" },
  btn: { backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 12, paddingHorizontal: 28 },
  btnText: { color: "white", fontWeight: "900", fontSize: 13.5 },
});
