import { useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { router, type Href } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { useLanguage } from "../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../lib/hooks/useThemeColors";
import { useCurrentUser } from "../lib/hooks/useCurrentUser";
import { useChatList, ChatSummary } from "../lib/hooks/useChatsDB";
import { useOffersMeta, OfferMeta, OFFER_STATUS_LABELS } from "../lib/hooks/useOffersHub";
import { fmtPrice } from "../lib/types";
import { timeAgo } from "../lib/timeAgo";

// ↔ صفحة «العروض» (أيقونة جنب جرس الإشعارات فى الريلز/القائمة/الطلبات/إدارة الحساب): كل عرض مُقدَّم أو مُستلَم = محادثة مع الطرف
// التانى. مقسّمة: الكل / عروض الريلز (عروض على إعلانات) / عروض الطلبات. المحادثة الأحدث (آخر رسالة) فى الأعلى، والمحادثة اللى فيها رسائل
// جديدة عليها عدّاد أحمر. الضغط يفتح المحادثة (app/chat/[id].tsx) اللى فيها بيانات العرض وقبول/اعتذار للمستلم.
// تعليقات الريلز وردودها بتفضل فى جرس الإشعارات (مش هنا). شغالة بنفس الكود على أندرويد/آيفون/الويب/APK.
const GREEN = "#22A652";
const STATUS_COLOR = { new: "#D97706", accepted: "#15803D", declined: "#6B7280" } as const;

type Tab = "all" | "reel" | "request";

function kindOf(c: ChatSummary, meta: OfferMeta | undefined): "reel" | "request" | null {
  if (meta) return meta.kind;
  if (c.propertyId) return "reel";
  if (c.requestId) return "request";
  return null;
}

export default function OffersScreen() {
  const { t, language } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { user } = useCurrentUser();
  const isGuest = !user || !!user.is_anonymous;
  const userId = isGuest ? undefined : user?.id;

  const [tab, setTab] = useState<Tab>("all");
  const chats = useChatList(userId);
  const metaQ = useOffersMeta(userId);
  const meta = metaQ.data;

  const rows = useMemo(() => {
    const all = chats.data ?? [];
    return all.filter((c) => {
      const k = kindOf(c, meta?.get(c.id));
      if (tab === "all") return true;
      return k === tab;
    });
  }, [chats.data, meta, tab]);

  // عدّاد غير المقروء لكل تبويب (نقطة حمراء/رقم على التبويب).
  const unreadBy = useMemo(() => {
    const r = { all: 0, reel: 0, request: 0 };
    for (const c of chats.data ?? []) {
      const k = kindOf(c, meta?.get(c.id));
      r.all += c.unread;
      if (k === "reel") r.reel += c.unread;
      if (k === "request") r.request += c.unread;
    }
    return r;
  }, [chats.data, meta]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: t("الكل") },
    { key: "reel", label: t("عروض الريلز") },
    { key: "request", label: t("عروض الطلبات") },
  ];

  function renderRow({ item: c }: { item: ChatSummary }) {
    const m = meta?.get(c.id);
    const k = kindOf(c, m);
    const title = k === "request" ? c.requestTitle : c.propertyTitle;
    const preview = (c.lastMessage || "").replace(/\s+/g, " ").trim();
    return (
      <Pressable style={styles.row} onPress={() => router.push(`/chat/${c.id}` as Href)} accessibilityRole="button">
        <View style={styles.avatar}><Text style={styles.avatarText}>{c.partnerInitial || "؟"}</Text></View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.topLine}>
            <Text style={[styles.name, c.unread > 0 && styles.nameUnread]} numberOfLines={1}>{t(c.partnerName)}</Text>
            <Text style={styles.time}>{timeAgo(c.lastMessageAt, language)}</Text>
          </View>
          <View style={styles.ctxLine}>
            {k && (
              <View style={[styles.kindChip, k === "request" && styles.kindChipRequest]}>
                <Text style={styles.kindChipText}>{k === "request" ? t("طلب") : t("ريل")}</Text>
              </View>
            )}
            <Text style={styles.ctxTitle} numberOfLines={1}>{title ?? t("إعلان لم يعد متاحًا")}</Text>
          </View>
          <Text style={[styles.preview, c.unread > 0 && styles.previewUnread]} numberOfLines={1}>
            {c.lastMessageFromMe ? `${t("أنت")}: ` : ""}{preview || "…"}
          </Text>
          {m && (
            <View style={styles.metaLine}>
              <View style={[styles.statusChip, { backgroundColor: STATUS_COLOR[m.status] }]}>
                <Text style={styles.statusChipText}>{t(OFFER_STATUS_LABELS[m.status])}</Text>
              </View>
              {m.price != null && <Text style={styles.price}>{`${fmtPrice(m.price)} ${t("ج.م")}`}</Text>}
              <Text style={styles.role}>{m.role === "offerer" ? t("عرضك") : t("عرض مستلم")}</Text>
            </View>
          )}
        </View>
        {c.unread > 0 && (
          <View style={styles.unreadBadge}><Text style={styles.unreadText}>{c.unread > 99 ? "99+" : c.unread}</Text></View>
        )}
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.iconBtn} onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("رجوع")}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={themeColors.text} strokeWidth={2}>
            <Path d="M18 6L6 18M6 6l12 12" />
          </Svg>
        </Pressable>
        <Text style={styles.headerTitle}>{t("العروض")}</Text>
        <View style={{ width: 34 }} />
      </View>

      <View style={styles.tabs}>
        {tabs.map((x) => (
          <Pressable key={x.key} style={[styles.tab, tab === x.key && styles.tabOn]} onPress={() => setTab(x.key)}>
            <Text style={[styles.tabText, tab === x.key && styles.tabTextOn]}>{x.label}</Text>
            {unreadBy[x.key] > 0 && <View style={styles.tabDot} />}
          </Pressable>
        ))}
      </View>

      {isGuest ? (
        <Text style={styles.empty}>{t("سجّل الدخول لمتابعة عروضك")}</Text>
      ) : chats.isLoading ? (
        <ActivityIndicator color={GREEN} style={{ marginTop: 40 }} />
      ) : chats.isError ? (
        <View style={{ alignItems: "center", gap: 10, marginTop: 40 }}>
          <Text style={styles.empty}>{t("تعذر تحميل العروض")}</Text>
          <Pressable style={styles.retryBtn} onPress={() => chats.refetch()}><Text style={styles.retryText}>{t("إعادة المحاولة")}</Text></Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(c) => c.id}
          renderItem={renderRow}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 40 }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {tab === "request" ? t("لا توجد عروض على الطلبات بعد.")
                : tab === "reel" ? t("لا توجد عروض على الإعلانات بعد. اضغط أيقونة «تقديم عرض» في تفاصيل أي عقار.")
                : t("لا توجد عروض بعد. قدّم عرضًا من تفاصيل عقار أو من صفحة الطلبات، أو انتظر عروضًا على إعلاناتك وطلباتك.")}
            </Text>
          }
        />
      )}
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: themeColors.background },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 54, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: themeColors.border },
    iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: themeColors.surface, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 15, fontWeight: "900", color: themeColors.text },
    tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
    tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: themeColors.surface },
    tabOn: { backgroundColor: GREEN },
    tabText: { fontSize: 12.5, fontWeight: "800", color: themeColors.textMuted },
    tabTextOn: { color: "white" },
    tabDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#ef4444" },
    empty: { textAlign: "center", fontSize: 13, color: themeColors.textSubtle, lineHeight: 21, marginTop: 36, paddingHorizontal: 28 },
    retryBtn: { backgroundColor: themeColors.surface, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
    retryText: { fontSize: 12.5, fontWeight: "800", color: GREEN },
    sep: { height: StyleSheet.hairlineWidth, backgroundColor: themeColors.border, marginHorizontal: 16 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
    avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
    avatarText: { color: "white", fontSize: 18, fontWeight: "900" },
    topLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    name: { flex: 1, fontSize: 14, fontWeight: "700", color: themeColors.text },
    nameUnread: { fontWeight: "900" },
    time: { fontSize: 11, color: themeColors.textSubtle },
    ctxLine: { flexDirection: "row", alignItems: "center", gap: 6 },
    kindChip: { backgroundColor: GREEN, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
    kindChipRequest: { backgroundColor: "#2563EB" },
    kindChipText: { color: "white", fontSize: 9.5, fontWeight: "900" },
    ctxTitle: { flex: 1, fontSize: 12, fontWeight: "700", color: themeColors.textMuted },
    preview: { fontSize: 12.5, color: themeColors.textSubtle },
    previewUnread: { color: themeColors.text, fontWeight: "700" },
    metaLine: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap" },
    statusChip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    statusChipText: { color: "white", fontSize: 10, fontWeight: "900" },
    price: { fontSize: 11.5, fontWeight: "900", color: GREEN },
    role: { fontSize: 11, color: themeColors.textSubtle },
    unreadBadge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
    unreadText: { color: "white", fontSize: 11, fontWeight: "900" },
  });
}
