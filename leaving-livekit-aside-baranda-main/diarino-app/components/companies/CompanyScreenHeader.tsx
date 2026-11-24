import { View, Text, Pressable } from "react-native";
import { router, type Href } from "expo-router";
import Svg, { Path } from "react-native-svg";
import type { createCompanyStyles } from "./companyStyles";

// رأس موحّد لشاشات «الخدمات»: زر إغلاق + عنوان. الرجوع الآمن (لو مفيش تاريخ نرجع للقائمة) — نفس سلوك شاشة المساحة الإعلانية.
export function CompanyScreenHeader({ title, color, styles, fallback = "/(tabs)/menu" }: {
  title: string;
  color: string;
  styles: ReturnType<typeof createCompanyStyles>;
  fallback?: string;
}) {
  function close() {
    if (router.canGoBack()) router.back();
    else router.replace(fallback as Href);
  }
  return (
    <View style={styles.header}>
      <Pressable style={styles.closeBtn} onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="رجوع">
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
          <Path d="M18 6L6 18M6 6l12 12" />
        </Svg>
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={{ width: 34 }} />
    </View>
  );
}
