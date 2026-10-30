import { View, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { RequestsIcon, MenuIcon as GridIcon, ReelsIcon, SearchSparkleIcon } from "./_tab-icons";
import { useThemeColors } from "../../lib/hooks/useThemeColors";
import { useLanguage } from "../../lib/hooks/useLanguage";

// ↔ شريط المهام السفلي — التصميم المرجعي:
//   * كبسولة داكنة (pill) فيها 3 أيقونات: رئيسية / قائمة / طلبات.
//   * زر البحث دائرة داكنة *منفصلة* بجانب الكبسولة (مش جواها).
//   * الشريط كله "بيطفو" فوق محتوى الصفحة (position: absolute) — الصفحة
//     بتتمرّر تحته، وكل شاشة رئيسية (بحث / ريلز / قائمة / طلبات) عندها
//     paddingBottom كفاية عشان آخر عنصر يقدر يظهر فوقه.
//   * الشريط دايمًا *فوق* شريط تنقّل النظام (أزرار/إيماءات أندرويد وآيفون):
//     bottom = insets.bottom + هامش، فمش بيتغطّى بيه على أي جهاز.
//
// الاتجاه: flexDirection العادي (من غير أي إلغاء لـ auto-mirroring) — الترتيب
// فى JSX هو (بحث، ثم كبسولة [رئيسية، قائمة، طلبات]) فى RTL بيبان من
// اليمين لليسار: بحث ← رئيسية ← قائمة ← طلبات، أي بالظبط زي المرجع
// (طلبات | قائمة | رئيسية | بحث من اليسار لليمين). وفى LTR بينعكس تلقائيًا.
//
// نفس الكومبوننت مشترك بين كل التابات (app/(tabs)/_layout.tsx → prop
// `tabBar`) فالتصميم واحد على كل الصفحات الرئيسية، وعلى الأندرويد
// والآيفون والويب وبناء الـ APK بنفس الكود بدون أي شرط منصة.
//
// ↔ قاعدة تثيم الوسائط (docs/deferred-tasks.md): الشريط ده chrome عام له
// خلفية عتمة + ظل خاصين بيه دايمًا، فألوانه آمنة فوق أي فيديو ريلز.
// "account" مقصود إنه مش موجود هنا (بيتفتح من كارت "إدارة الحساب" فى القائمة).
const PILL_LIGHT = "#3A3531";
const PILL_DARK = "#26262A";
const ICON = "#C9B48F";
const ICON_ACTIVE = "#F6E7C4";
const ACTIVE_BG = "rgba(246,231,196,0.16)";

// ↔ الهامش الأفقي (تقريبًا 1 سم = ~38dp، dp بيتحسب تلقائيًا حسب كثافة
// الشاشة) متماثل من الجهتين.
const EDGE_MARGIN = 38;
const BAR_H = 52;
const GAP = 12;
const ICON_SIZE = 24;

export function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const themeColors = useThemeColors();
  const { t } = useLanguage();
  const bg = themeColors.isDark ? PILL_DARK : PILL_LIGHT;
  const activeName = state.routes[state.index]?.name;

  function go(routeName: string) {
    const route = state.routes.find((r) => r.name === routeName);
    if (!route) return;
    const isFocused = state.routes[state.index].name === routeName;
    const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(route.name);
    }
  }

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 14 }]}>
      <View style={styles.row} pointerEvents="box-none">
        {/* زر البحث — دائرة منفصلة */}
        <Pressable
          style={[styles.searchBtn, { backgroundColor: bg }]}
          onPress={() => go("search")}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t("البحث")}
        >
          <View style={[styles.hl, activeName === "search" && styles.hlOn]}>
            <SearchSparkleIcon color={activeName === "search" ? ICON_ACTIVE : ICON} size={ICON_SIZE} />
          </View>
        </Pressable>

        {/* الكبسولة: رئيسية / قائمة / طلبات */}
        <View style={[styles.pill, { backgroundColor: bg }]}>
          <TabButton onPress={() => go("index")} active={activeName === "index"} label={t("الرئيسية")}>
            <ReelsIcon color={activeName === "index" ? ICON_ACTIVE : ICON} size={ICON_SIZE} />
          </TabButton>
          <TabButton onPress={() => go("menu")} active={activeName === "menu"} label={t("القائمة")}>
            <GridIcon color={activeName === "menu" ? ICON_ACTIVE : ICON} size={ICON_SIZE} />
          </TabButton>
          <TabButton onPress={() => go("requests")} active={activeName === "requests"} label={t("الطلبات")}>
            <RequestsIcon color={activeName === "requests" ? ICON_ACTIVE : ICON} size={ICON_SIZE} />
          </TabButton>
        </View>
      </View>
    </View>
  );
}

function TabButton({
  children, onPress, active, label,
}: { children: React.ReactNode; onPress: () => void; active: boolean; label: string }) {
  return (
    <Pressable style={styles.tabBtn} onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.hl, active && styles.hlOn]}>{children}</View>
    </Pressable>
  );
}

const shadow = {
  shadowColor: "#000",
  shadowOpacity: 0.28,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 6 },
  elevation: 12,
} as const;

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: EDGE_MARGIN, right: EDGE_MARGIN },
  row: { flexDirection: "row", alignItems: "center", gap: GAP },
  pill: {
    flex: 1, height: BAR_H, borderRadius: BAR_H / 2,
    flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 6,
    ...shadow,
  },
  searchBtn: {
    width: BAR_H, height: BAR_H, borderRadius: BAR_H / 2, alignItems: "center", justifyContent: "center",
    ...shadow,
  },
  tabBtn: { flex: 1, height: "100%", alignItems: "center", justifyContent: "center" },
  // خلفية خفيفة خلف الأيقونة النشطة فقط (بدون أي تأثير على حجم/مكان الأيقونات).
  hl: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  hlOn: { backgroundColor: ACTIVE_BG },
});
