import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { router } from "expo-router";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Platform,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { useIsAdmin, AdminSection } from "../../lib/hooks/useIsAdmin";
import { AdminOverview } from "../../components/admin/AdminOverview";
import { AdminReels } from "../../components/admin/AdminReels";
import { AdminLives } from "../../components/admin/AdminLives";
import { AdminSupport } from "../../components/admin/AdminSupport";
import { AdminAnalytics } from "../../components/admin/AdminAnalytics";
import { AdminUsers } from "../../components/admin/AdminUsers";
import { refetchAdminDB, useAdminDBStatus } from "../../lib/hooks/useAdminDB";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { AdminFeatures } from "../../components/admin/AdminFeatures";
import { AdminManagement } from "../../components/admin/AdminManagement";
import { AdminAdBanners } from "../../components/admin/AdminAdBanners";
import { AdminSponsoredReels } from "../../components/admin/AdminSponsoredReels";
import { AdminAuditLog } from "../../components/admin/AdminAuditLog";
import { AdminUserActivityLog } from "../../components/admin/AdminUserActivityLog";
import { AdminMenuItems } from "../../components/admin/AdminMenuItems";
import { AdminMusic } from "../../components/admin/AdminMusic";
import { AdminDeals } from "../../components/admin/AdminDeals";
import { AdminOffers } from "../../components/admin/AdminOffers";
import { AdminRequests } from "../../components/admin/AdminRequests";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

type AdminPage =
  | "overview"
  | "reels"
  | "lives"
  | "reports"
  | "analytics"
  | "users"
  | "features"
  | "admins"
  | "ads"
  | "sponsoredReels"
  | "auditLog"
  | "userActivity"
  | "menuItems"
  | "music"
  | "deals"
  | "offers"
  | "requests";

const PAGES: {
  key: AdminPage;
  icon: string;
  label: string;
  title: string;
  subtitle: string;
  section?: AdminSection;
  superAdminOnly?: boolean;
}[] = [
  { key: "overview", icon: "📊", label: "نظرة عامة", title: "نظرة عامة", subtitle: "ملخص أداء المنصة اليوم" },
  { key: "reels", icon: "🎬", label: "الريلز", title: "إدارة الريلز", subtitle: "الموافقة، الرفض، والحذف", section: "reels" },
  { key: "lives", icon: "📡", label: "البث المسجل", title: "البث المباشر المسجل", subtitle: "مراجعة وإدارة البث المنشور", section: "lives" },
  { key: "reports", icon: "🎧", label: "الدعم", title: "الدعم", subtitle: "البلاغات، المساحة الإعلانية، المقترحات، والتواصل معنا", section: "reports" },
  { key: "analytics", icon: "📈", label: "التحليلات", title: "التحليلات", subtitle: "مشاهدات، إعلانات، وتحويلات واتساب" },
  { key: "users", icon: "👥", label: "المستخدمون", title: "المستخدمون", subtitle: "بيانات كل مستخدم، البحث والفلاتر، والتحكم في الصلاحيات", section: "users" },
  { key: "features", icon: "⚙️", label: "الميزات العامة", title: "الميزات العامة", subtitle: "تفعيل أو تعطيل ميزات المنصة", section: "features" },
  { key: "ads", icon: "🖼️", label: "المساحة الإعلانية", title: "المساحة الإعلانية", subtitle: "إدارة بانرات الإعلانات المتناوبة", section: "ads" },
  { key: "menuItems", icon: "🧩", label: "أيقونات القائمة", title: "أيقونات صفحة القائمة", subtitle: "التحكم الكامل في أيقونات صفحة القائمة", section: "menuItems" },
  { key: "music", icon: "🎵", label: "المكتبة الموسيقية", title: "المكتبة الموسيقية", subtitle: "إضافة وحذف وإخفاء موسيقى الإعلانات (على Cloudinary)", section: "music" },
  { key: "requests", icon: "📋", label: "إدارة الطلبات", title: "إدارة الطلبات", subtitle: "حذف الطلبات القديمة وغير الفعّالة (صاحب الطلب يحذف طلبه خلال 24 ساعة فقط)", section: "requests" },
  { key: "offers", icon: "🏷️", label: "العروض المقدمة", title: "العروض المقدمة", subtitle: "كل العروض على الريلز والطلبات (الكل / ريلز / طلبات) لمعرفة عمليات البيع الجارية عبر التطبيق", section: "offers" },
  { key: "deals", icon: "🤝", label: "الصفقات والرسوم", title: "الصفقات والرسوم", subtitle: "الصفقات المُبلَّغ عنها، متابعة رسوم البيع والتأجير وتحصيلها", section: "deals" },
  { key: "sponsoredReels", icon: "⭐", label: "الريلز المميزة", title: "الريلز المميزة", subtitle: "ترويج الريلز وإدارة الوصول والاستهداف", section: "sponsoredReels" },
  { key: "auditLog", icon: "🧾", label: "سجل التدقيق", title: "سجل تدقيق الأدمن", subtitle: "كل عملية أدمن على الريلز والبث والإعلانات", section: "auditLog" },
  { key: "userActivity", icon: "🕒", label: "نشاط المستخدمين", title: "سجل نشاط المستخدمين", subtitle: "تسجيلات الدخول وتغييرات الأدوار", section: "userActivity" },
  { key: "admins", icon: "👑", label: "المشرفون", title: "إدارة المشرفين", subtitle: "منح أو إزالة صلاحيات المشرفين", superAdminOnly: true },
];

export default function AdminScreen() {
  const { isAdmin, isSuperAdmin, canAccess, checking } = useIsAdmin();
  const [page, setPage] = useState<AdminPage>("overview");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);

  // ↔ تحميل بيانات اللوحة بجلسة الأدمن عند فتحها (التحميل الأول وقت تشغيل التطبيق كان بيحصل قبل الدخول).
  const { user: adminUser } = useCurrentUser();
  const dbStatus = useAdminDBStatus();
  useEffect(() => {
    if (isAdmin) void refetchAdminDB();
  }, [isAdmin, adminUser?.id]);

  // ↔ رجوع التطبيق من الخلفية والأدمن فاتح اللوحة: نحدّث البيانات (التوكن ممكن يكون اتجدّد) بدل ما تفضل فاضية/قديمة.
  useEffect(() => {
    if (!isAdmin) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refetchAdminDB();
    });
    return () => sub.remove();
  }, [isAdmin]);

  if (checking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6366f1" size="large" />
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Text style={styles.deniedTitle}>غير مصرح لك بالدخول</Text>
        <Text style={styles.deniedText}>هذه الصفحة مخصصة لمسؤولي المنصة فقط.</Text>
        <Pressable style={styles.backBtn} onPress={() => router.replace("/(tabs)")}>
          <Text style={styles.backBtnText}>رجوع</Text>
        </Pressable>
      </View>
    );
  }

  const visiblePages = PAGES.filter((p) => {
    if (p.superAdminOnly) return isSuperAdmin;
    if (p.section) return canAccess(p.section);
    return true;
  });
  const current = visiblePages.find((p) => p.key === page) ?? visiblePages[0];

  const handleSelectPage = (key: AdminPage) => {
    setPage(key);
    setIsSidebarOpen(false);
  };

  return (
    <View style={styles.container}>
      {/* الهيدر العلوي ويتضمن زر القائمة الجانبية */}
      <View style={styles.header}>
        <Pressable
          style={styles.menuBtn}
          onPress={() => setIsSidebarOpen(true)}
          hitSlop={8}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={themeColors.text} strokeWidth={2}>
            <Path d="M3 12h18M3 6h18M3 18h18" />
          </Svg>
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{current.title}</Text>
          <Text style={styles.headerSubtitle}>{current.subtitle}</Text>
        </View>

        <Pressable style={styles.refreshBtn} onPress={() => { void refetchAdminDB(); }} hitSlop={6} disabled={dbStatus.loading}>
          {dbStatus.loading ? <ActivityIndicator size="small" color="#6366f1" /> : <Text style={styles.refreshBtnText}>🔄</Text>}
        </Pressable>

        <Pressable style={styles.exitBtn} onPress={() => router.replace("/(tabs)")}>
          <Text style={styles.exitBtnText}>الخروج للتطبيق</Text>
        </Pressable>
      </View>

      {/* ↔ فشل تحميل بيانات اللوحة: رسالة واضحة + إعادة المحاولة (بدل شاشات فاضية بدون تفسير). */}
      {!!dbStatus.error && !dbStatus.loading && (
        <Pressable style={styles.errorBar} onPress={() => { void refetchAdminDB(); }}>
          <Text style={styles.errorBarText}>تعذر تحميل بعض بيانات اللوحة ({dbStatus.error}). اضغط لإعادة المحاولة.</Text>
        </Pressable>
      )}

      {/* محتوى الصفحة التي تم اختيارها */}
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {current.key === "overview" && <AdminOverview />}
        {current.key === "reels" && <AdminReels />}
        {current.key === "lives" && <AdminLives />}
        {current.key === "reports" && <AdminSupport />}
        {current.key === "analytics" && <AdminAnalytics />}
        {current.key === "users" && <AdminUsers />}
        {current.key === "features" && <AdminFeatures />}
        {current.key === "ads" && <AdminAdBanners />}
        {current.key === "menuItems" && <AdminMenuItems />}
        {current.key === "music" && <AdminMusic />}
        {current.key === "deals" && <AdminDeals />}
        {current.key === "offers" && <AdminOffers />}
        {current.key === "requests" && <AdminRequests />}
        {current.key === "sponsoredReels" && <AdminSponsoredReels />}
        {current.key === "auditLog" && <AdminAuditLog />}
        {current.key === "userActivity" && <AdminUserActivityLog />}
        {current.key === "admins" && <AdminManagement />}
      </ScrollView>

      {/* القائمة الجانبية (Drawer Sidebar Modal) */}
      <Modal
        visible={isSidebarOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsSidebarOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.backdrop} onPress={() => setIsSidebarOpen(false)} />

          <View style={styles.sidebar}>
            <View style={styles.sidebarHeader}>
              <Text style={styles.sidebarHeaderTitle}>اقسام لوحة التحكم</Text>
              <Pressable style={styles.closeBtn} onPress={() => setIsSidebarOpen(false)} hitSlop={8}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={themeColors.text} strokeWidth={2}>
                  <Path d="M18 6L6 18M6 6l12 12" />
                </Svg>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              {visiblePages.map((p) => {
                const isActive = current.key === p.key;
                return (
                  <Pressable
                    key={p.key}
                    style={[styles.sidebarItem, isActive && styles.sidebarItemActive]}
                    onPress={() => handleSelectPage(p.key)}
                  >
                    <Text style={styles.sidebarIcon}>{p.icon}</Text>
                    <Text style={[styles.sidebarLabel, isActive && styles.sidebarLabelActive]}>
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: themeColors.background },
    center: { flex: 1, backgroundColor: themeColors.background, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
    deniedTitle: { fontSize: 16, fontWeight: "900", color: themeColors.text },
    deniedText: { fontSize: 12.5, color: themeColors.textSubtle, textAlign: "center" },
    backBtn: { marginTop: 8, backgroundColor: themeColors.isDark ? "#334155" : "#0f172a", borderRadius: 999, paddingVertical: 10, paddingHorizontal: 24 },
    backBtnText: { color: "white", fontWeight: "900" },

    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingTop: Platform.OS === "ios" ? 56 : Platform.OS === "android" ? 44 : 16,
      paddingBottom: 14,
      paddingHorizontal: 16,
      backgroundColor: themeColors.card,
      borderBottomWidth: 1,
      borderBottomColor: themeColors.border,
    },
    refreshBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: themeColors.surface, alignItems: "center", justifyContent: "center" },
    refreshBtnText: { fontSize: 16 },
    errorBar: { backgroundColor: themeColors.isDark ? "rgba(239,68,68,0.18)" : "#fef2f2", borderBottomWidth: 1, borderBottomColor: "#ef4444", paddingVertical: 8, paddingHorizontal: 14 },
    errorBarText: { color: "#dc2626", fontSize: 12, fontWeight: "800", textAlign: "center" },
    menuBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: themeColors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: themeColors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: { fontSize: 16, fontWeight: "900", color: themeColors.text },
    headerSubtitle: { fontSize: 11.5, color: themeColors.textSubtle, marginTop: 1 },
    exitBtn: { backgroundColor: themeColors.surface, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
    exitBtnText: { fontSize: 11, fontWeight: "900", color: themeColors.textMuted },

    content: { padding: 16, gap: 14, paddingBottom: 40 },

    /* Drawer Styles */
    modalOverlay: {
      flex: 1,
      flexDirection: "row-reverse", // محاذاة القائمة لترتيب RTL لتفتح من اليمين
      backgroundColor: "rgba(0, 0, 0, 0.45)",
    },
    backdrop: {
      flex: 1,
    },
    sidebar: {
      width: 270,
      backgroundColor: themeColors.card,
      height: "100%",
      paddingTop: Platform.OS === "ios" ? 54 : 20,
      paddingHorizontal: 16,
      elevation: 10,
      shadowColor: "#000",
      shadowOffset: { width: -2, height: 0 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
    },
    sidebarHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingBottom: 14,
      marginBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: themeColors.border,
    },
    sidebarHeaderTitle: {
      fontSize: 15,
      fontWeight: "900",
      color: themeColors.text,
    },
    sidebarItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 12,
      marginBottom: 4,
    },
    sidebarItemActive: {
      backgroundColor: themeColors.isDark ? "#334155" : "#0f172a",
    },
    sidebarIcon: {
      fontSize: 16,
    },
    sidebarLabel: {
      fontSize: 13,
      fontWeight: "800",
      color: themeColors.textMuted,
    },
    sidebarLabelActive: {
      color: "white",
    },
  });
}