import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";

type SupabaseConfigurationNoticeProps = {
  message: string;
};

export function SupabaseConfigurationNotice({
  message,
}: SupabaseConfigurationNoticeProps) {
  useEffect(() => {
    void SplashScreen.hideAsync().catch((error: unknown) => {
      console.warn("Failed to hide splash screen:", error);
    });
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>يلزم إعداد الاتصال بالتطبيق</Text>
      <Text style={styles.message}>
        لم يتمكن التطبيق من الاتصال بـ Supabase لأن إعدادات المشروع غير مكتملة.
      </Text>
      <Text selectable style={styles.details}>
        {message}
      </Text>
      <Text style={styles.instructions}>
        انسخ .env.example إلى .env داخل مجلد التطبيق، وأضف رابط مشروع Supabase
        ومفتاح anon أو publishable الصحيحين، ثم أعد تشغيل التطبيق أو البناء.
        راجع قسم Supabase setup في README.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f8fafc",
    direction: "rtl",
  },
  title: {
    marginBottom: 12,
    color: "#0f172a",
    fontSize: 22,
    fontWeight: "700",
    textAlign: "right",
  },
  message: {
    marginBottom: 12,
    color: "#334155",
    fontSize: 16,
    lineHeight: 26,
    textAlign: "right",
  },
  details: {
    marginBottom: 16,
    color: "#b91c1c",
    fontSize: 13,
    textAlign: "left",
  },
  instructions: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 24,
    textAlign: "right",
  },
});
