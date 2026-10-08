import { useState } from "react";
import { router, Href } from "expo-router";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PageTopBar } from "../../components/shared/PageTopBar";
import { NotificationsDropdown } from "../../components/notifications/NotificationsDropdown";
import { useNotifications } from "../../lib/hooks/useNotifications";
import { useActiveLives } from "../../lib/hooks/useActiveLives";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useFeatureFlag } from "../../lib/hooks/useFeatureFlags";
import { waLink } from "../../lib/whatsapp";
import { openExternalUrl } from "../../lib/linking";
import { redirectGuestToLogin } from "../../lib/guestGate";
import { useActiveAdBanners } from "../../lib/hooks/useAdBanners";
import { AdBannerCarousel } from "../../components/menu/AdBannerCarousel";
import { MenuCard } from "../../components/menu/MenuCard";
import { menuArtCardFor, CRANE_CARD_ASPECT } from "../../lib/menuIconRegistry";
import { useActiveMenuItems, MenuItem } from "../../lib/hooks/useMenuItems";
import { useThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ صفوف الصفحة (التصميم المرجعي). الترتيب بييجي من public.menu_items
// (sort_order) والشكل من size:
//   half + half + tall  -> stackTall : نصفين مكدّسين + كارت طويل على الجنب التاني
//   tall + half + half  -> tallPair  : كارت طويل + نصفين مكدّسين
//   half + round        -> wideRound : كارت عريض + دائرة صغيرة (إدارة الحساب)
//   round + half        -> roundPair : دائرة + كارت عريض (الترتيب القديم)
//   half + half         -> pair       |   full / أي حاجة تانية -> full
// الصفوف كلها بتعتمد على flexDirection العادي فبتنعكس تلقائيًا مع RTL/LTR.
type Row =
  | { type: "full"; item: MenuItem }
  | { type: "pair"; items: [MenuItem, MenuItem] }
  | { type: "tallPair"; tall: MenuItem; stack: [MenuItem, MenuItem] }
  | { type: "stackTall"; tall: MenuItem; stack: [MenuItem, MenuItem] }
  | { type: "roundPair"; round: MenuItem; wide: MenuItem }
  | { type: "wideRound"; wide: MenuItem; round: MenuItem };

function buildRows(menuItems: MenuItem[]): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < menuItems.length; i++) {
    const item = menuItems[i];
    const a = menuItems[i + 1];
    const b = menuItems[i + 2];
    if (item.size === "tall") {
      if (a?.size === "half" && b?.size === "half") {
        rows.push({ type: "tallPair", tall: item, stack: [a, b] });
        i += 2;
        continue;
      }
      rows.push({ type: "full", item });
      continue;
    }
    if (item.size === "round") {
      if (a?.size === "half") {
        rows.push({ type: "roundPair", round: item, wide: a });
        i += 1;
        continue;
      }
      rows.push({ type: "full", item });
      continue;
    }
    if (item.size === "full") {
      rows.push({ type: "full", item });
      continue;
    }
    // item.size === "half"
    if (a?.size === "half" && b?.size === "tall") {
      rows.push({ type: "stackTall", tall: b, stack: [item, a] });
      i += 2;
      continue;
    }
    if (a?.size === "round") {
      rows.push({ type: "wideRound", wide: item, round: a });
      i += 1;
      continue;
    }
    if (a?.size === "half") {
      rows.push({ type: "pair", items: [item, a] });
      i += 1;
      continue;
    }
    rows.push({ type: "full", item });
  }
  return rows;
}

// ↔ أي عنصر قائمة بيوجّه لمسار /live/... (زي كارت "اطلع اللايف" —
// /live/broadcast) بيتخبّى لما الأدمن يعطّل خاصية "البث المباشر". الفلتر
// على مسار الوجهة نفسه مش على عنوان الكارت، فيشتغل حتى لو الأدمن غيّر
// اسم الكارت أو أضاف كارت جديد بنفس الوجهة.
function isLiveMenuItem(item: MenuItem): boolean {
  return item.actionType === "route" && /^\/live(\/|$|\?)/.test(item.actionValue.trim());
}

// ارتفاعات الكروت (dp) — مستخرجة من نسب التصميم المرجعي على عرض ~390.
const H = { stackTall: 208, tallPair: 224, wide: 98 };

export default function MenuScreen() {
  const { t } = useLanguage();
  const [notifMenuVisible, setNotifMenuVisible] = useState(false);
  const notifications = useNotifications();
  const { user } = useCurrentUser();
  const insets = useSafeAreaInsets();
  // ↔ عرض منطقة المحتوى الفعلى (مش عرض الشاشة — على الويب الصفحة ممكن تكون أضيق من النافذة):
  // بنقيسه بـ onLayout ونحسب منه عرض العمود الواحد فى الصفين (padding 14×2 + gap 12).
  const [scrollW, setScrollW] = useState(0);
  const colW = scrollW > 0 ? (scrollW - 28 - 12) / 2 : 0;
  // ↔ ارتفاع كارت "ونش ونقل أثاث" لما يتكدّس مع "الإعدادات": صورته (1070×935) بتتعرض كاملة بعرض
  // العمود بالظبط بالارتفاع ده. بنديه للكارتين المتكدّسين (الإعدادات + الونش) عشان يبقوا
  // *نفس الحجم* — قبل كده الإعدادات كانت بتاخد 147 والونش بيتبقّى له 47 بس فتفاصيله مكانتش واضحة.
  // الحد الأدنى 150: محتوى كارت الإعدادات نفسه (أيقونة كبيرة + عنوان) ≈ 147 — لو الحد أقل منه
  // على الشاشات الضيقة الإعدادات هيفضل أطول من الونش بفرق بسيط بدل ما يتساووا.
  const artStackMinHeight = colW > 0 ? Math.max(150, Math.ceil(colW / CRANE_CARD_ASPECT)) : undefined;
  const liveFeatureEnabled = useFeatureFlag("live");
  // ↔ مفيش داعي نعمل polling على اللايفات النشطة والميزة مخفية.
  const { data: activeLivesData } = useActiveLives(liveFeatureEnabled);
  const activeLives = liveFeatureEnabled ? activeLivesData : undefined;
  const { data: adBanners } = useActiveAdBanners();
  const { data: menuItems = [] } = useActiveMenuItems();
  const themeColors = useThemeColors();

  function runAction(item: MenuItem) {
    // ↔ انشر عقارك / اطلب عقارك للمسجَّلين فقط — الضيف يتحوّل لصفحة التسجيل
    // برسالة (lib/guestGate.ts). الحماية الأساسية كمان فى app/publish/_layout.tsx.
    if (item.actionType === "route" && /^\/publish(\/|$)/.test(item.actionValue) && user?.is_anonymous) {
      void redirectGuestToLogin();
      return;
    }
    if (item.actionType === "route" && item.actionValue === "/live/broadcast" && user?.is_anonymous) {
      Alert.alert(t("يجب تسجيل الدخول بحساب Google لبدء بث مباشر"), t("المتابعة كضيف لا تتيح بدء بث مباشر."));
      return;
    }
    if (item.actionType === "route") {
      try {
        router.push(item.actionValue as Href);
      } catch (err: unknown) {
        console.warn("Menu item navigation failed:", item.actionValue, err);
        Alert.alert(t("تعذر فتح هذا القسم"), t("حدث خطأ غير متوقع، برجاء المحاولة لاحقًا."));
      }
    } else if (item.actionType === "whatsapp") {
      openExternalUrl(waLink(t(item.actionValue)));
    } else if (item.actionType === "url") {
      openExternalUrl(item.actionValue);
    }
  }

  // buildRows بتتعامل مع الحذف بأمان: الكارت اللي كان مقترن بالكارت
  // المخفي بيتحوّل لصف مستقل.
  const visibleMenuItems = liveFeatureEnabled ? menuItems : menuItems.filter((i) => !isLiveMenuItem(i));
  const rows = buildRows(visibleMenuItems);

  const content = (
    <>
      <PageTopBar
        title={t("القائمة")}
        notifBadgeCount={notifications.totalUnread}
        onOpenNotifications={() => setNotifMenuVisible(true)}
      />

      {/* ↔ paddingBottom كبير عشان آخر كارت يقدر يتمرّر فوق شريط المهام العائم
          (ارتفاعه 52 + 14 هامش + حافة الأمان السفلية) بدل ما يتغطّى بيه. */}
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 112 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        onLayout={(e) => setScrollW(Math.round(e.nativeEvent.layout.width))}
      >
        {/* ↔ البانر الإعلاني: إعلانات الأدمن + صورة "ضع إعلانك هنا" الدائمة فى دورة واحدة
            (الأدمن يقدر يعطّل الصورة الدائمة من لوحة التحكم) — شوف AdBannerCarousel. */}
        <AdBannerCarousel
          banners={adBanners ?? []}
          onPlaceholderPress={() => openExternalUrl(waLink(t("مرحباً، أرغب في حجز مساحة إعلانية داخل تطبيق باراندا")))}
        />

        {/* عناصر القائمة الديناميكية */}
        {rows.map((row) => {
          if (row.type === "full") {
            return (
              <MenuCard key={row.item.id} item={row.item} iconBoxHeight={row.item.ctaLabel ? 92 : 46} minHeight={row.item.size === "full" ? undefined : H.wide} onPress={() => runAction(row.item)} />
            );
          }
          if (row.type === "pair") {
            return (
              <View key={row.items.map((r) => r.id).join("-")} style={styles.row}>
                {row.items.map((item) => (
                  <MenuCard key={item.id} item={item} flex iconBoxHeight={56} onPress={() => runAction(item)} />
                ))}
              </View>
            );
          }
          if (row.type === "stackTall") {
            // نصفين مكدّسين (أول عنصر فى JSX = بداية الصف: يمين فى RTL) + الطويل بعدهم.
            return (
              <View key={row.tall.id + "-stacktall"} style={styles.row}>
                <View style={styles.stackCol}>
                  {row.stack.map((item) => (
                    <MenuCard key={item.id} item={item} flex iconBoxHeight={70} onPress={() => runAction(item)} />
                  ))}
                </View>
                <MenuCard item={row.tall} flex minHeight={H.stackTall} iconBoxHeight={90} onPress={() => runAction(row.tall)} />
              </View>
            );
          }
          if (row.type === "tallPair") {
            return (
              <View key={row.tall.id + "-tall"} style={styles.row}>
                <MenuCard item={row.tall} flex minHeight={H.tallPair} iconBoxHeight={104} onPress={() => runAction(row.tall)} />
                <View style={styles.stackCol}>
                  {row.stack.map((item) => (
                    <MenuCard
                      key={item.id}
                      item={item}
                      flex
                      // ↔ لو فى الصف كارت صورة جاهزة (الونش): الاتنين بنفس الارتفاع الأدنى فيتساووا ولا يتقلّص أى واحد.
                      minHeight={row.stack.some((it) => !!menuArtCardFor(it)) ? artStackMinHeight : undefined}
                      iconBoxHeight={54}
                      onPress={() => runAction(item)}
                    />
                  ))}
                </View>
              </View>
            );
          }
          if (row.type === "wideRound") {
            return (
              <View key={row.wide.id + "-wideround"} style={[styles.row, { alignItems: "center" }]}>
                <MenuCard item={row.wide} flex minHeight={H.wide} iconBoxHeight={72} onPress={() => runAction(row.wide)} />
                <MenuCard item={row.round} shape="circle" iconBoxHeight={26} onPress={() => runAction(row.round)} />
              </View>
            );
          }
          return (
            <View key={row.round.id + "-round"} style={[styles.row, { alignItems: "center" }]}>
              <MenuCard item={row.round} shape="circle" iconBoxHeight={26} onPress={() => runAction(row.round)} />
              <MenuCard item={row.wide} flex minHeight={H.wide} iconBoxHeight={72} onPress={() => runAction(row.wide)} />
            </View>
          );
        })}

        {!!activeLives?.length && (
          <Pressable
            style={styles.liveNowBanner}
            onPress={() => router.push(`/live/${activeLives[0].roomName}` as Href)}
          >
            <View style={styles.liveNowDot} />
            <Text style={styles.liveNowText} numberOfLines={1}>
              {activeLives[0].hostName || t("أحد المعلنين")} {t("يبث مباشرة الآن")}
              {activeLives.length > 1 ? ` +${activeLives.length - 1}` : ""}
            </Text>
            <Text style={styles.liveNowJoin}>{t("مشاهدة")}</Text>
          </Pressable>
        )}
      </ScrollView>

      <NotificationsDropdown
        visible={notifMenuVisible}
        onClose={() => setNotifMenuVisible(false)}
        activeCat={notifications.activeCat}
        onSwitchCat={notifications.setActiveCat}
        filter={notifications.filter}
        onSetFilter={notifications.setFilter}
        badges={notifications.badges}
        items={notifications.visibleItems}
        onMarkAllRead={notifications.markAllRead}
        onItemPress={(index) => {
          const item = notifications.visibleItems[index];
          notifications.markItemRead(notifications.activeCat, index);
          setNotifMenuVisible(false);
          if (!item?.action) return;
          const a = item.action;
          if (a.type === "seller") router.push(`/seller/${a.id}` as Href);
          else if (a.type === "property") router.push(`/property/${a.id}` as Href);
          else if (a.type === "reel") router.push(`/property/${a.propertyId}` as Href);
          else if (a.type === "chat") router.push(`/chat/${a.id}` as Href);
        }}
      />
    </>
  );

  // ↔ خلفية الصفحة (الوضع الفاتح): تدرّج بيج/كريمي زي المرجع. الوضع
  // الداكن بيفضل على لون الثيم العادي.
  if (themeColors.isDark) {
    return <View style={[styles.container, { backgroundColor: themeColors.background }]}>{content}</View>;
  }
  return (
    <LinearGradient colors={["#E8D2A6", "#F1DDB5", "#FAEFD4"]} style={styles.container}>
      {content}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 14, gap: 12 },
  row: { flexDirection: "row", gap: 12 },
  stackCol: { flex: 1, gap: 12 },
  liveNowBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#111827", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 4,
  },
  liveNowDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#ef4444" },
  liveNowText: { flex: 1, color: "white", fontSize: 12, fontWeight: "800" },
  liveNowJoin: { color: "#22A652", fontSize: 12, fontWeight: "900" },
});