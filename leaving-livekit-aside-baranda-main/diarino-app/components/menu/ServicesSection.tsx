import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, Animated, PanResponder, StyleSheet, Platform, type LayoutChangeEvent, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { router, type Href } from "expo-router";
import Svg, { Path } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors } from "../../lib/hooks/useThemeColors";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { useMyCompany } from "../../lib/hooks/useCompanies";
import { COMPANY_CATEGORIES } from "../../lib/companies";
import { redirectGuestToLogin } from "../../lib/guestGate";
import { showGuestLoginPrompt } from "../shared/GuestLoginPrompt";
import { showToast } from "../shared/Toast";

// ↔ قسم «الخدمات» فى صفحة القائمة (أسفل صف «احمي استثمارك» + «الإعدادات» بعرض الشاشة كاملًا):
//   عنوان أخضر + كروت التصنيفات الخمسة تتحرك تلقائيًا (Auto-scroll) نحو اليمين مع سحب يدوى وأسهم ونقاط تصفح،
//   وزر «أضف شركتك (+)» أسفلها. الضغط على كارت يفتح /services/<التصنيف>.
//   الكاروسيل مبنى يدويًا (Animated + PanResponder) بدل ScrollView أفقى لتفادى اختلاف سلوك الـ RTL بين أندرويد وآيفون والويب:
//   المسار دائمًا direction:ltr والترتيب المرئى (يمين → يسار) = التصنيفات بترتيبها، فالكارت الأول (التسويق العقارى) على اليمين.
const GAP = 10;
const AUTO_MS = 3500;
const PAUSE_AFTER_TOUCH_MS = 7000;
const CARD_IMG_ASPECT = 520 / 480;
const LABEL_H = 74;
const PENDING_ADD_KEY = "shahir:pending-add-company";
const PENDING_ADD_TTL_MS = 20 * 60 * 1000;

const GREEN = "#0B6B35";
const GREEN_LIGHT = "#22A652";

function visibleCount(w: number): number {
  if (w >= 820) return 5;
  if (w >= 620) return 4;
  if (w >= 420) return 3;
  return 2;
}

export function ServicesSection() {
  const { t } = useLanguage();
  const colors = useThemeColors();
  const { user } = useCurrentUser();
  const isGuest = !user || !!user.is_anonymous;
  const { data: myCompany } = useMyCompany(isGuest ? undefined : user?.id);

  const [width, setWidth] = useState(0);
  const items = useMemo(() => [...COMPANY_CATEGORIES].reverse(), []); // الترتيب المرئى يسار → يمين
  const n = items.length;

  const PAD = 14;
  const innerW = Math.max(0, width - 2 * 2 - PAD * 2);
  const visible = Math.min(n, visibleCount(innerW));
  const cardW = innerW > 0 ? (innerW - GAP * (visible - 1)) / visible : 0;
  const step = cardW + GAP;
  const maxP = Math.max(0, n - visible);
  const pages = maxP + 1;

  const x = useRef(new Animated.Value(0)).current;
  const [page, setPage] = useState(0);
  const pageRef = useRef(0);
  const pausedUntil = useRef(0);
  const dragging = useRef(false);

  const offsetFor = useCallback((p: number) => -(maxP - p) * step, [maxP, step]);

  const goTo = useCallback(
    (p: number, animated = true) => {
      const clamped = Math.max(0, Math.min(maxP, p));
      pageRef.current = clamped;
      setPage(clamped);
      const toValue = offsetFor(clamped);
      if (!animated) {
        x.setValue(toValue);
        return;
      }
      Animated.timing(x, { toValue, duration: 420, useNativeDriver: Platform.OS !== "web" }).start();
    },
    [maxP, offsetFor, x]
  );

  // عند تغيّر المقاس (دوران/تغيير نافذة الويب) نعيد الضبط على الصفحة الحالية بدون حركة.
  useEffect(() => {
    if (step > 0) goTo(Math.min(pageRef.current, maxP), false);
  }, [step, maxP, goTo]);

  // الحركة التلقائية نحو اليمين (يظهر الكارت التالى من اليسار). تتوقف مؤقتًا بعد أى لمس.
  useEffect(() => {
    if (pages <= 1 || step <= 0) return;
    const id = setInterval(() => {
      if (dragging.current || Date.now() < pausedUntil.current) return;
      goTo(pageRef.current >= maxP ? 0 : pageRef.current + 1);
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [pages, step, maxP, goTo]);

  function pauseAuto() {
    pausedUntil.current = Date.now() + PAUSE_AFTER_TOUCH_MS;
  }

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
        onPanResponderGrant: () => {
          dragging.current = true;
          x.stopAnimation();
        },
        onPanResponderMove: (_e, g) => {
          const base = offsetFor(pageRef.current);
          x.setValue(Math.max(-maxP * step, Math.min(0, base + g.dx)));
        },
        onPanResponderRelease: (_e, g) => {
          dragging.current = false;
          pausedUntil.current = Date.now() + PAUSE_AFTER_TOUCH_MS;
          const threshold = Math.max(24, step * 0.22);
          let p = pageRef.current;
          // السحب لليمين (dx > 0) يحرّك المحتوى يمينًا فيظهر ما على اليسار = التالى.
          if (g.dx > threshold || g.vx > 0.5) p += Math.max(1, Math.round(Math.abs(g.dx) / Math.max(step, 1)));
          else if (g.dx < -threshold || g.vx < -0.5) p -= Math.max(1, Math.round(Math.abs(g.dx) / Math.max(step, 1)));
          goTo(p);
        },
        onPanResponderTerminate: () => {
          dragging.current = false;
          goTo(pageRef.current);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [maxP, step, offsetFor, goTo, x]
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w !== width) setWidth(w);
  };

  const openAddCompany = useCallback(() => {
    if (isGuest) {
      // الزائر: نافذة «تسجيل الدخول» ← بعد الدخول (جوجل/بريد) نفتح له نموذج الشركة تلقائيًا (أول مرة يفتح فيها القائمة).
      showGuestLoginPrompt("company", () => {
        void AsyncStorage.setItem(PENDING_ADD_KEY, String(Date.now())).catch(() => {});
        void redirectGuestToLogin(null);
      });
      return;
    }
    if (myCompany) {
      showToast(t("لديك شركة مسجّلة بالفعل — يمكنك إدارتها"));
      router.push("/my-company" as Href);
      return;
    }
    router.push("/company-form" as Href);
  }, [isGuest, myCompany, t]);

  // أكمل نية «أضف شركتك» بعد تسجيل الدخول.
  useEffect(() => {
    if (isGuest || !user?.id) return;
    let cancelled = false;
    void AsyncStorage.getItem(PENDING_ADD_KEY)
      .then(async (v) => {
        if (cancelled || !v) return;
        await AsyncStorage.removeItem(PENDING_ADD_KEY).catch(() => {});
        const at = Number(v);
        if (!Number.isFinite(at) || Date.now() - at > PENDING_ADD_TTL_MS) return;
        router.push("/company-form" as Href);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isGuest, user?.id]);

  const containerBg = colors.isDark ? "#1B2A20" : "#FBF7E6";
  const webTouch = Platform.OS === "web" ? ({ touchAction: "pan-y", userSelect: "none" } as unknown as ViewStyle) : null;

  return (
    <View style={styles.outer}>
      <View style={[styles.container, { backgroundColor: containerBg, borderColor: GREEN }]} onLayout={onLayout}>
        <View style={styles.titlePill} pointerEvents="none">
          <Text style={styles.titleText}>{t("الخدمات")}</Text>
        </View>

        {cardW > 0 && (
          <View style={[styles.viewportWrap, { paddingHorizontal: PAD }]}>
            <View style={[styles.viewport, webTouch]} {...pan.panHandlers}>
              <Animated.View
                style={[
                  styles.track,
                  { width: n * cardW + (n - 1) * GAP, transform: [{ translateX: x }] },
                ]}
              >
                {items.map((c, i) => (
                  <Pressable
                    key={c.key}
                    style={[styles.card, { width: cardW, marginRight: i === n - 1 ? 0 : GAP }]}
                    onPress={() => router.push(`/services/${c.key}` as Href)}
                    accessibilityRole="button"
                    accessibilityLabel={t(c.label)}
                  >
                    <Image source={c.image} style={{ width: cardW, height: cardW * CARD_IMG_ASPECT }} contentFit="cover" />
                    <View style={styles.cardLabel}>
                      <Text style={styles.cardLabelText} numberOfLines={3}>{t(c.label)}</Text>
                    </View>
                  </Pressable>
                ))}
              </Animated.View>
            </View>

            {pages > 1 && (
              <>
                <Pressable
                  style={[styles.arrow, { left: 2 }]}
                  onPress={() => { pauseAuto(); goTo(pageRef.current >= maxP ? 0 : pageRef.current + 1); }}
                  accessibilityRole="button"
                  accessibilityLabel={t("التالى")}
                  hitSlop={8}
                >
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                    <Path d="M15 5l-7 7 7 7" />
                  </Svg>
                </Pressable>
                <Pressable
                  style={[styles.arrow, { right: 2 }]}
                  onPress={() => { pauseAuto(); goTo(pageRef.current <= 0 ? maxP : pageRef.current - 1); }}
                  accessibilityRole="button"
                  accessibilityLabel={t("السابق")}
                  hitSlop={8}
                >
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                    <Path d="M9 5l7 7-7 7" />
                  </Svg>
                </Pressable>
              </>
            )}
          </View>
        )}

        {pages > 1 && (
          <View style={styles.dots}>
            {Array.from({ length: pages }).map((_, i) => {
              // النقطة الأولى (الخضراء) = بداية القائمة من اليمين.
              const on = i === page;
              return (
                <Pressable
                  key={i}
                  onPress={() => { pauseAuto(); goTo(i); }}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`${i + 1}`}
                  style={[styles.dot, on ? styles.dotOn : { backgroundColor: colors.isDark ? "#3b4a40" : "#D1D5DB" }]}
                />
              );
            })}
          </View>
        )}

        <View style={styles.addWrap} pointerEvents="box-none">
          <Pressable
            style={[styles.addBtn, { backgroundColor: containerBg, borderColor: GREEN }]}
            onPress={openAddCompany}
            accessibilityRole="button"
            accessibilityLabel={t("أضف شركتك")}
          >
            <View style={styles.plusCircle}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.2} strokeLinecap="round">
                <Path d="M12 5v14M5 12h14" />
              </Svg>
            </View>
            <Text style={[styles.addText, { color: colors.isDark ? "#E5F4EA" : GREEN }]}>{t("أضف شركتك")}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { width: "100%", paddingTop: 30, paddingBottom: 34 },
  container: { borderWidth: 2, borderRadius: 30, paddingTop: 34, paddingBottom: 40, overflow: "visible" },
  titlePill: {
    position: "absolute", top: -22, alignSelf: "center", backgroundColor: GREEN, borderRadius: 999,
    paddingHorizontal: 44, paddingVertical: 8, zIndex: 2,
  },
  titleText: { color: "white", fontSize: 24, fontWeight: "900", textAlign: "center" },
  viewportWrap: { position: "relative" },
  viewport: { overflow: "hidden", direction: "ltr" as const },
  track: { flexDirection: "row", direction: "ltr" as const },
  card: {
    borderRadius: 18, overflow: "hidden", backgroundColor: GREEN, borderWidth: 1, borderColor: "#7BC59A",
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardLabel: { height: LABEL_H, backgroundColor: GREEN, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  cardLabelText: { color: "white", fontSize: 13.5, fontWeight: "900", textAlign: "center", lineHeight: 20 },
  arrow: {
    position: "absolute", top: "34%", width: 34, height: 34, borderRadius: 17, backgroundColor: GREEN,
    alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "white", zIndex: 3,
  },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 9, marginTop: 14, direction: "ltr" as const },
  dot: { width: 11, height: 11, borderRadius: 6 },
  dotOn: { backgroundColor: GREEN_LIGHT, width: 13, height: 13, borderRadius: 7 },
  addWrap: { position: "absolute", left: 0, right: 0, bottom: -26, alignItems: "center" },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 2, borderRadius: 999,
    paddingVertical: 9, paddingStart: 10, paddingEnd: 26,
  },
  plusCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  addText: { fontSize: 18, fontWeight: "900" },
});
