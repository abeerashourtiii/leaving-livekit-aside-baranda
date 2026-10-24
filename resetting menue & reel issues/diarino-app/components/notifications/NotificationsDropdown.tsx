import { useEffect, useMemo, useRef } from "react";
import { Modal, View, Text, Pressable, FlatList, StyleSheet, Animated, Easing, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { NotifCategory, NotifItem } from "../../data/mock-notifications";
import { NotifFilter } from "../../lib/hooks/useNotifications";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { translateNotifText } from "../../lib/notificationText";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { physicalSide, topActionsSide } from "../../lib/rtl";

// ↔ صفحة الإشعارات الموحّدة: قائمة جانبية كبيرة (full height) تنزلق من نفس جهة زر الجرس (يمين فى العربية /
// شمال فى الإنجليزية) وفيها *كل* الإشعارات (إعجاب، حفظ، متابعة، شات، تنبيهات) فى قائمة واحدة بدل التبويبات
// الخمسة. الأحدث فى الأعلى، ومجمّعة بالتاريخ: «اليوم» / «أمس» / التاريخ لو أقدم، ثم إشعارات اليوم ده.
//
// ملاحظات تقنية (أندرويد/آيفون/ويب/APK): العرض رقم فعلى من useWindowDimensions() (مش نسبة مئوية — مشكلة قياس
// Modal على أندرويد)، والانزلاق Animated بـ translateX (فيزيائى، مش بيتقلب مع RTL) من جهة الإطار المطلوب.

const CAT_ICON: Record<NotifCategory, { path: string; color: string }> = {
  like: { path: "M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z", color: "#ef4444" },
  save: { path: "M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z", color: "#f59e0b" },
  follow: { path: "M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M8.5 11a4 4 0 100-8 4 4 0 000 8zM20 8v6M23 11h-6", color: "#6366f1" },
  chat: { path: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z", color: "#0ea5e9" },
  alert: { path: "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0", color: "#22A652" },
};

const FILTERS: { key: NotifFilter; label: string }[] = [
  { key: "all", label: "الكل" }, { key: "read", label: "مقروء" }, { key: "unread", label: "غير مقروء" },
];
const EN_FILTER_LABELS: Record<string, string> = { all: "All", read: "Read", unread: "Unread" };

type Props = {
  visible: boolean;
  onClose: () => void;
  filter: NotifFilter;
  onSetFilter: (f: NotifFilter) => void;
  items: NotifItem[];
  onMarkAllRead: () => void;
  // index داخل items (القائمة الموحّدة بترتيبها المعروض)
  onItemPress: (index: number) => void;
};

type Row =
  | { type: "header"; key: string; label: string }
  | { type: "item"; key: string; item: NotifItem; index: number };

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function NotificationsDropdown({ visible, onClose, filter, onSetFilter, items, onMarkAllRead, onItemPress }: Props) {
  const { t, language } = useLanguage();
  const isEn = language === "en";
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const panelWidth = Math.min(440, Math.round(windowWidth * 0.92));
  // ↔ الجهة المرئية اللى الجرس فيها (يمين بالعربى / شمال بالإنجليزى) — القائمة بتنزلق منها.
  const fromLeft = topActionsSide(language) === "left";
  const sideProp = physicalSide(fromLeft);
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    slide.setValue(0);
    Animated.timing(slide, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [visible, slide]);

  const rows = useMemo<Row[]>(() => {
    const locale = isEn ? "en-US" : "ar-EG";
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const todayKey = dayKey(today);
    const yesterdayKey = dayKey(yesterday);
    const out: Row[] = [];
    let lastKey = "";
    items.forEach((item, index) => {
      const dt = item.createdAt ? new Date(item.createdAt) : today;
      const valid = !Number.isNaN(dt.getTime());
      const d = valid ? dt : today;
      const key = dayKey(d);
      if (key !== lastKey) {
        lastKey = key;
        const label =
          key === todayKey ? (isEn ? "Today" : "اليوم")
          : key === yesterdayKey ? (isEn ? "Yesterday" : "أمس")
          : d.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
        out.push({ type: "header", key: `h-${key}`, label });
      }
      out.push({ type: "item", key: `i-${item.id ?? index}`, item, index });
    });
    return out;
  }, [items, isEn]);

  function timeLabel(item: NotifItem): string {
    if (!item.createdAt) return item.time;
    const d = new Date(item.createdAt);
    if (Number.isNaN(d.getTime())) return item.time;
    return d.toLocaleTimeString(isEn ? "en-US" : "ar-EG", { hour: "numeric", minute: "2-digit" });
  }

  if (!visible) return null;

  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [fromLeft ? -panelWidth : panelWidth, 0] });

  return (
    <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t("إغلاق")} />
      <Animated.View
        style={[
          styles.panel,
          { width: panelWidth, [sideProp]: 0, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 8), transform: [{ translateX }] },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t("الإشعارات")}</Text>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={themeColors.textMuted} strokeWidth={2}><Path d="M18 6L6 18M6 6l12 12" /></Svg>
          </Pressable>
        </View>

        <View style={styles.toolbar}>
          <View style={styles.filters}>
            {FILTERS.map((f) => (
              <Pressable key={f.key} style={[styles.filterChip, filter === f.key && styles.filterChipActive]} onPress={() => onSetFilter(f.key)}>
                <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>{isEn ? EN_FILTER_LABELS[f.key] : t(f.label)}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.markAllBtn} onPress={onMarkAllRead}>
            <Text style={styles.markAllBtnText}>{t("تحديد الكل")}</Text>
          </Pressable>
        </View>

        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 16 }}
          ListEmptyComponent={<Text style={styles.empty}>{t("لا توجد إشعارات")}</Text>}
          renderItem={({ item: row }) => {
            if (row.type === "header") {
              return (
                <View style={styles.dayHeader}>
                  <Text style={styles.dayHeaderText}>{row.label}</Text>
                </View>
              );
            }
            const n = row.item;
            const icon = n.category ? CAT_ICON[n.category] : undefined;
            return (
              <Pressable style={styles.item} onPress={() => onItemPress(row.index)}>
                {!n.read && <View style={styles.unreadDot} />}
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{n.initial}</Text>
                  {icon && (
                    <View style={styles.catBadge}>
                      <Svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke={icon.color} strokeWidth={2.4}><Path d={icon.path} /></Svg>
                    </View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemText, isEn && { textAlign: "left", writingDirection: "ltr" }]}>
                    <Text style={{ fontWeight: "900" }}>{t(n.name)}</Text> — {translateNotifText(n.text, t, isEn)}
                  </Text>
                  <Text style={[styles.itemTime, isEn && { textAlign: "left" }]}>{timeLabel(n)}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      </Animated.View>
    </Modal>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
    panel: {
      position: "absolute", top: 0, bottom: 0,
      backgroundColor: themeColors.card,
      shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 16,
    },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: themeColors.border },
    headerTitle: { fontSize: 16, fontWeight: "900", color: themeColors.text },
    closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: themeColors.surface, alignItems: "center", justifyContent: "center" },
    toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: themeColors.border },
    filters: { flexDirection: "row", gap: 6 },
    filterChip: { backgroundColor: themeColors.surface, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
    filterChipActive: { backgroundColor: "#22A652" },
    filterChipText: { fontSize: 11.5, fontWeight: "800", color: themeColors.textMuted },
    filterChipTextActive: { color: "white" },
    markAllBtn: { paddingVertical: 6, paddingHorizontal: 8 },
    markAllBtnText: { fontSize: 11.5, fontWeight: "800", color: "#22A652" },
    dayHeader: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, backgroundColor: themeColors.card },
    dayHeaderText: { fontSize: 12, fontWeight: "900", color: themeColors.textSubtle },
    item: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: themeColors.border },
    unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#22A652" },
    avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#22A652", alignItems: "center", justifyContent: "center" },
    avatarText: { color: "white", fontWeight: "900", fontSize: 15 },
    catBadge: { position: "absolute", bottom: -3, end: -3, width: 18, height: 18, borderRadius: 9, backgroundColor: themeColors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: themeColors.border },
    itemText: { fontSize: 12.5, color: themeColors.textMuted, lineHeight: 18 },
    itemTime: { fontSize: 10.5, color: themeColors.textSubtle, marginTop: 2 },
    empty: { textAlign: "center", color: themeColors.textSubtle, fontSize: 12.5, padding: 32 },
  });
}
