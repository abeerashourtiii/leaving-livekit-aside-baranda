import { useCallback, useMemo, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Share, FlatList, ViewToken, ListRenderItemInfo } from "react-native";
import Svg, { Path } from "react-native-svg";
import { MAX_PINNED_PROPERTIES, useMyProperties, usePropertyDetail } from "../../../lib/hooks/useProperties";
import { fmtPrice, Property } from "../../../lib/types";
import { properties as demoProperties } from "../../../data/mock-properties";
import { orderSellerListings } from "../../../lib/listingOrder";
import { reelPagingProps } from "../../../lib/reelPaging";
import { SnapCell } from "../../../components/reel/SnapCell";
import { useReelHeight } from "../../../lib/uiConstants";
import { useReelPreferences } from "../../../lib/hooks/useReelPreferences";
import { ReelCard } from "../../../components/reel/ReelCard";
import { useFollows } from "../../../lib/hooks/useFollows";
import { useFavorites } from "../../../lib/hooks/useFavorites";
import { useLikes } from "../../../lib/hooks/useLikes";
import { useCompareSelection } from "../../../lib/hooks/useCompareSelection";
import { showToast } from "../../../components/shared/Toast";
import { ReportModal } from "../../../components/shared/ReportModal";
import { useLanguage } from "../../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../../lib/hooks/useThemeColors";

// ↔ إصلاح "الضغط على عقار فى صفحة البحث كان بيودّي لصفحة التفاصيل
// العادية (تمرير + وصف + أزرار تواصل) بدل تجربة الريل الكاملة (فيديو
// بشاشة كاملة + الأيقونات الجانبية زي اللايك/المشاركة/المتابعة + شريط
// الـ seek) اللي موجودة فى تبويب الريلز": بدل ما نغيّر شاشة
// app/property/[id].tsx نفسها (مستخدمة فى أكتر من 15 مكان فى التطبيق
// كصفحة تفاصيل عادية — تغييرها كان هيكسر كل الاستخدامات التانية دي)،
// عملنا شاشة جديدة منفصلة هنا بتعرض نفس مكوّن <ReelCard> المستخدم
// بالظبط فى تبويب الريلز (app/(tabs)/index.tsx) لعقار واحد بس — نفس
// الشكل والتفاعل بالظبط، من غير ما نلمس أي استخدام قديم لصفحة التفاصيل
// العادية فى باقي الشاشات. ReelCard نفسه بيحدد ارتفاعه الكامل لوحده
// (useReelHeight) فمحتاجينش أي FlatList أو حاوية بارتفاع محسوب يدويًا.
//
// ↔ تصفّح ريلات معلن (من صفحة المعلن أو «إعلاناتي» فى إدارة الحساب): لو
// اتبعت ?sellerId=<id> الشاشة بتعرض ريلات المعلن ده كلها فى قائمة رأسية بتبدأ
// من الريل اللى اتضغط عليه — السحب لأعلى بينقل للريل اللى بعده مباشرة والسحب
// لأسفل للى قبله، من غير تخطّى (lib/reelPaging.ts). من غير sellerId (مثلًا من
// البحث) بتعرض ريل واحد زى الأول.
export default function PropertyReelScreen() {
  const { id, sellerId } = useLocalSearchParams<{ id: string; sellerId?: string }>();
  const sellerIdParam = Array.isArray(sellerId) ? sellerId[0] : sellerId;
  if (sellerIdParam && id) return <SellerReelsViewer sellerId={sellerIdParam} startId={id} />;
  return <SingleReelScreen id={id} />;
}

function goBackOrHome() {
  if (router.canGoBack()) router.back();
  else router.replace("/(tabs)");
}

function SellerReelsViewer({ sellerId, startId }: { sellerId: string; startId: string }) {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { data, isLoading } = useMyProperties(sellerId);
  const items = useMemo(
    () => orderSellerListings([...(data ?? []), ...demoProperties.filter((p) => p.seller.id === sellerId)], MAX_PINNED_PROPERTIES),
    [data, sellerId]
  );
  // ↔ نثبّت نقطة البداية عند أول تحميل — غير كده أى refetch (ترتيب أو حذف) كان هيقفز بالقائمة.
  const initialIndexRef = useRef<number | null>(null);
  if (initialIndexRef.current === null && items.length > 0) {
    initialIndexRef.current = items.findIndex((p) => p.id === startId);
  }

  if (isLoading && items.length === 0) {
    return (
      <View style={styles.notFound}>
        <ActivityIndicator size="large" color="#22A652" />
      </View>
    );
  }
  // الريل مش ضمن قائمة المعلن (غير معتمد/محذوف...) ← نرجع للعرض المنفرد.
  if (initialIndexRef.current === null || initialIndexRef.current < 0) return <SingleReelScreen id={startId} />;
  return <ReelsPager items={items} startIndex={initialIndexRef.current} />;
}

function ReelsPager({ items, startIndex }: { items: Property[]; startIndex: number }) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const reelHeight = useReelHeight();
  const { autoAdvance } = useReelPreferences();
  const { followedIds, toggleFollow } = useFollows();
  const { favoriteProperties, toggleFavoriteProperty } = useFavorites();
  const { likedIds, toggleLike } = useLikes();
  const compareSelection = useCompareSelection();

  const [activeIndex, setActiveIndex] = useState(startIndex);
  const activeIndexRef = useRef(startIndex);
  const [detailsOpenId, setDetailsOpenId] = useState<string | null>(null);
  const [reportProperty, setReportProperty] = useState<Property | null>(null);
  const listRef = useRef<FlatList<Property>>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index != null) {
      activeIndexRef.current = viewableItems[0].index;
      setActiveIndex(viewableItems[0].index);
    }
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  const handleReelFinished = useCallback(() => {
    if (!autoAdvance) return;
    const idx = activeIndexRef.current;
    if (idx >= itemsRef.current.length - 1) return;
    listRef.current?.scrollToOffset({ offset: reelHeight * (idx + 1), animated: true });
  }, [autoAdvance, reelHeight]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Property>) => (
      <SnapCell height={reelHeight}>
        <ReelCard
          property={item}
          index={index}
          isActive={index === activeIndex}
          isNearActive={Math.abs(index - activeIndex) <= 1}
          isFollowing={followedIds.has(item.seller.id)}
          isFavorite={favoriteProperties.has(item.id)}
          isLiked={likedIds.has(item.id)}
          isComparing={compareSelection.isSelected(item.id)}
          detailsOpen={index === activeIndex && detailsOpenId === item.id}
          onCloseDetails={() => setDetailsOpenId(null)}
          onOpenDetails={(propertyId) => setDetailsOpenId(propertyId)}
          onOpenSeller={(sid) => router.push(`/seller/${sid}`)}
          onToggleFollow={(sid) => toggleFollow(sid)}
          onToggleFavorite={(propertyId) => toggleFavoriteProperty(propertyId)}
          onToggleLike={(propertyId) => toggleLike(propertyId)}
          onToggleCompare={(propertyId) => {
            const result = compareSelection.toggle(propertyId);
            if (result === "full") showToast(t(`تقدر تقارن حتى ${compareSelection.max} عقارات بس`));
          }}
          onShare={(p) => Share.share({ message: `${p.title} — ${fmtPrice(p.price)} ج.م\nhttps://diarino.app/property/${p.id}` })}
          onReport={(p) => setReportProperty(p)}
          onFinished={handleReelFinished}
        />
      </SnapCell>
    ),
    [reelHeight, activeIndex, detailsOpenId, followedIds, favoriteProperties, likedIds, compareSelection, toggleFollow, toggleFavoriteProperty, toggleLike, handleReelFinished, t]
  );

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(p) => p.id}
        renderItem={renderItem}
        extraData={{ activeIndex, detailsOpenId, followedIds, favoriteProperties, likedIds, ids: compareSelection.ids }}
        {...reelPagingProps(reelHeight)}
        scrollEnabled={!detailsOpenId}
        showsVerticalScrollIndicator={false}
        initialScrollIndex={startIndex}
        getItemLayout={(_, index) => ({ length: reelHeight, offset: reelHeight * index, index })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        windowSize={5}
        initialNumToRender={2}
        maxToRenderPerBatch={3}
        removeClippedSubviews
      />

      <Pressable style={styles.closeBtn} onPress={goBackOrHome} hitSlop={8}>
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}>
          <Path d="M6 6l12 12M18 6L6 18" />
        </Svg>
      </Pressable>

      <ReportModal
        visible={!!reportProperty}
        onClose={() => setReportProperty(null)}
        quickMode
        targetType="property"
        targetId={reportProperty?.id ?? ""}
        targetTitle={reportProperty?.title ?? ""}
      />
    </View>
  );
}

function SingleReelScreen({ id }: { id: string | undefined }) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { data: property, isLoading } = usePropertyDetail(id);

  const { followedIds, toggleFollow } = useFollows();
  const { favoriteProperties, toggleFavoriteProperty } = useFavorites();
  const { likedIds, toggleLike } = useLikes();
  const compareSelection = useCompareSelection();

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);

  if (isLoading) {
    return (
      <View style={styles.notFound}>
        <ActivityIndicator size="large" color="#22A652" />
      </View>
    );
  }

  if (!property) {
    return (
      <View style={styles.notFound}>
        <Text style={styles.notFoundText}>{t("هذا العقار لم يعد متاحًا")}</Text>
        <Pressable style={styles.backBtn} onPress={goBackOrHome}>
          <Text style={styles.backBtnText}>{t("رجوع")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ReelCard
        property={property}
        index={0}
        isActive
        isNearActive
        isFollowing={followedIds.has(property.seller.id)}
        isFavorite={favoriteProperties.has(property.id)}
        isLiked={likedIds.has(property.id)}
        isComparing={compareSelection.isSelected(property.id)}
        detailsOpen={detailsOpen}
        onCloseDetails={() => setDetailsOpen(false)}
        onOpenDetails={() => setDetailsOpen(true)}
        onOpenSeller={(sellerId) => router.push(`/seller/${sellerId}`)}
        onToggleFollow={(sellerId) => toggleFollow(sellerId)}
        onToggleFavorite={(propertyId) => toggleFavoriteProperty(propertyId)}
        onToggleLike={(propertyId) => toggleLike(propertyId)}
        onToggleCompare={(propertyId) => {
          const result = compareSelection.toggle(propertyId);
          if (result === "full") showToast(t(`تقدر تقارن حتى ${compareSelection.max} عقارات بس`));
        }}
        onShare={(p) => Share.share({ message: `${p.title} — ${fmtPrice(p.price)} ج.م\nhttps://diarino.app/property/${p.id}` })}
        onReport={() => setReportVisible(true)}
      />

      <Pressable style={styles.closeBtn} onPress={goBackOrHome} hitSlop={8}>
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}>
          <Path d="M6 6l12 12M18 6L6 18" />
        </Svg>
      </Pressable>

      <ReportModal
        visible={reportVisible}
        onClose={() => setReportVisible(false)}
        quickMode
        targetType="property"
        targetId={property.id}
        targetTitle={property.title}
      />
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: "#000" },
    notFound: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, backgroundColor: themeColors.background },
    notFoundText: { fontSize: 14, fontWeight: "800", color: themeColors.textMuted },
    backBtn: { backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 10, paddingHorizontal: 24 },
    backBtnText: { color: "white", fontWeight: "900" },
    // ↔ zIndex 60: أعلى من أي عنصر داخلي فى ReelCard (أعلى قيمة عندهم 50
    // فى ReelCard.tsx نفسه) عشان زرار الإغلاق يفضل ظاهر فوق كل حاجة.
    closeBtn: {
      position: "absolute", top: 50, left: 14, width: 32, height: 32, borderRadius: 16,
      backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", zIndex: 60,
    },
  });
}
