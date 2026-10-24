import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { rowStartingAt, topActionsSide } from "../../lib/rtl";
import { OffersIcon } from "../shared/OffersIcon";

// ↔ reelsHeaderHtml() in app-viewer.html.
// Deferred for now: the LIVE pill button (only shows when there are active
// broadcasts) and the camera-switch button (only shown while broadcasting) —
// both belong to the live-streaming pass, not the base reel feed.
type Props = {
  onOpenFilter: () => void;
  onOpenNotifications: () => void;
  notifBadgeCount?: number;
  // ↔ أيقونة «العروض» بجوار الجرس + نقطة حمراء لرسائل العروض الجديدة (منفصلة عن نقطة الجرس).
  onOpenOffers?: () => void;
  offersBadge?: boolean;
  // ↔ المحافظة/المناطق المحددة فى الفلتر: لو فيه تحديد يظهر زر صغير تحت الأيقونات (اضغط الاسم لتعديل الفلتر، أو ✕ لإلغاء التحديد فورًا).
  filterLabel?: string;
  onClearFilter?: () => void;
};

// ↔ The account-menu icon (three stacked lines) used to sit here and open
// AccountDropdown. Removed per product decision: settings now live solely
// behind the dedicated "الإعدادات" card on the menu page (routes to
// /settings), so this header only needs the filter and notifications icons.
export function ReelsHeader({ onOpenFilter, onOpenNotifications, notifBadgeCount = 0, onOpenOffers, offersBadge = false, filterLabel, onClearFilter }: Props) {
  const { language, t } = useLanguage();
  // ↔ الجرس أعلى اليمين والفلتر بجانبه (على يساره) فى العربية؛ والعكس فى الإنجليزية (الجرس أعلى الشمال والفلتر
  // على يمينه). الجروب بيبدأ من جهة الجرس: [جرس، فلتر] — على أندرويد/آيفون/الويب/APK بنفس النتيجة المرئية.
  return (
    <SafeAreaView style={styles.header} edges={["top"]} pointerEvents="box-none">
      <View style={[styles.group, { flexDirection: rowStartingAt(topActionsSide(language)) }]}>
        <IconBtn onPress={onOpenNotifications}>
          <View>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
              <Path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />
            </Svg>
            {notifBadgeCount > 0 && <View style={styles.notifBadge} />}
          </View>
        </IconBtn>
        {onOpenOffers && (
          <IconBtn onPress={onOpenOffers}>
            <View>
              <OffersIcon color="white" />
              {offersBadge && <View style={styles.notifBadge} />}
            </View>
          </IconBtn>
        )}
        <IconBtn onPress={onOpenFilter}>
          <View>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" color="white" strokeWidth={2}>
              <Path d="M22 3H2l8 9.46V19l4 2v-8.54z" />
            </Svg>
            {!!filterLabel && <View style={styles.filterDot} />}
          </View>
        </IconBtn>
      </View>
      {!!filterLabel && (
        <View style={[styles.pillRow, { flexDirection: rowStartingAt(topActionsSide(language)) }]} pointerEvents="box-none">
          <View style={styles.pill}>
            <Pressable onPress={onOpenFilter} hitSlop={4} style={styles.pillLabelBtn} accessibilityRole="button">
              <Text style={styles.pillText} numberOfLines={1}>{filterLabel}</Text>
            </Pressable>
            <Pressable
              onPress={onClearFilter}
              hitSlop={10}
              style={styles.pillClose}
              accessibilityRole="button"
              accessibilityLabel={t("إلغاء التحديد")}
            >
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3}>
                <Path d="M18 6L6 18M6 6l12 12" />
              </Svg>
            </Pressable>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function IconBtn({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable style={styles.iconBtn} onPress={onPress} hitSlop={6}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    paddingHorizontal: 14,
  },
  group: { alignItems: "center", gap: 8 },
  notifBadge: {
    position: "absolute", top: -1, right: -1, width: 9, height: 9, borderRadius: 4.5,
    backgroundColor: "#ef4444", borderWidth: 2, borderColor: "rgba(0,0,0,0.35)",
  },
  filterDot: {
    position: "absolute", top: -2, right: -2, width: 9, height: 9, borderRadius: 4.5,
    backgroundColor: "#22A652", borderWidth: 2, borderColor: "rgba(0,0,0,0.35)",
  },
  pillRow: { marginTop: 8 },
  pill: {
    flexDirection: "row", alignItems: "center", maxWidth: 230, borderRadius: 999,
    backgroundColor: "rgba(34,166,82,0.92)", paddingStart: 12, paddingEnd: 4, paddingVertical: 4, gap: 6,
  },
  pillLabelBtn: { flexShrink: 1, paddingVertical: 3 },
  pillText: { color: "white", fontSize: 12, fontWeight: "800" },
  pillClose: { width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.28)", alignItems: "center", justifyContent: "center" },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
});
