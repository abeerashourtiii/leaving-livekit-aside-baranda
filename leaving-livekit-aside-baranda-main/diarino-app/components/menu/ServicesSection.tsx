import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, Animated, Easing, PanResponder, StyleSheet, Platform, type LayoutChangeEvent, type ViewStyle } from "react-native";
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
import { LtrTrack } from "../shared/LtrTrack";

// ↔ قسم «الخدمات» فى صفحة القائمة (أسفل صف «احمي استثمارك» + «الإعدادات» بعرض الشاشة كاملًا):
//   عنوان أخضر + كروت التصنيفات الخمسة تتحرك تلقائيًا حركة متصلة منتظمة (Continuous marquee بسرعة ثابتة وبلا قفزات، وتدور
//   بلا نهاية) نحو اليمين، مع سحب يدوى يمينًا ويسارًا وأسهم، وزر «أضف شركتك (+)» أسفلها. الضغط على كارت يفتح /services/<التصنيف>.
//   الكاروسيل مبنى يدويًا (Animated + PanResponder + LtrTrack) بدل ScrollView أفقى لتفادى اختلاف سلوك الـ RTL بين أندرويد وآيفون والويب.
//   الترتيب المرئى من أقصى اليمين: التطوير العقارى ← التسويق العقارى ← لوازم الكهرباء والسباكة والدهانات ← التشطيبات والديكور ← الونش ونقل الأثاث
//   (ترتيب العرض هنا فقط؛ ترتيب COMPANY_CATEGORIES العام لا يتغير فلا تتأثر شاشات أخرى).
//   الدوران اللانهائى بتكرار الكروت عدة نسخ (كل نسخة = دورة كاملة)، فالانتقال من آخر كارت لأول كارت غير ملحوظ.
const GAP = 8;
const SPEED = 30; // dp فى الثانية (الدورة الكاملة للكروت الخمسة ≈ 20 ثانية)
const RESUME_MS = 1500; // الاستئناف بعد آخر لمس
const CARD_IMG_ASPECT = 0.92;
const LABEL_H = 44;
const PENDING_ADD_KEY = "shahir:pending-add-company";
const PENDING_ADD_TTL_MS = 20 * 60 * 1000;

const GREEN = "#0B6B35";

const SERVICES_ORDER = ["development", "marketing", "supplies", "finishing", "moving"];
const rankOf = (k: string) => { const i = SERVICES_ORDER.indexOf(k); return i < 0 ? 99 : i; };
// ترتيب القراءة (أول عنصر على أقصى اليمين) ثم الترتيب المرئى من اليسار لليمين.
const READING_ORDER = [...COMPANY_CATEGORIES].sort((a, b) => rankOf(a.key) - rankOf(b.key));
const VISUAL_ORDER = [...READING_ORDER].reverse();

// عدد الكروت الظاهرة معًا (كسرى ليظهر أن الشريط يتحرك): 2.75 على الموبايل (بين 2.5 و3).
function visibleCount(w: number): number {
  if (w >= 820) return 4.5;
  if (w >= 620) return 4;
  if (w >= 420) return 3.5;
  return 2.75;
}

const wrapPhase = (v: number, period: number) => (period > 0 ? ((v % period) + period) % period : 0);

export function ServicesSection() {
  const { t, language } = useLanguage();
  const colors = useThemeColors();
  const { user } = useCurrentUser();
  const isGuest = !user || !!user.is_anonymous;
  const { data: myCompany } = useMyCompany(isGuest ? undefined : user?.id);

  const [width, setWidth] = useState(0);
  const n = VISUAL_ORDER.length;

  const PAD = 12;
  const innerW = Math.max(0, width - 2 * 2 - PAD * 2);
  const cardW = innerW > 0 ? Math.floor((innerW + GAP) / visibleCount(innerW) - GAP) : 0;
  const step = cardW + GAP;
  const period = step * n; // طول دورة كاملة
  // نسخ كافية لتغطية العرض + هامش دورة على الجانبين (للسحب والأسهم).
  const copies = step > 0 ? Math.ceil((innerW + GAP / 2) / period) + 3 : 0;
  // موضع الحافة اليسرى للمسار عند الطور 0: أول كارت (التطوير) ملاصق تمامًا للحافة اليمنى غير مقصوص.
  const xbase = innerW + GAP / 2 - (copies - 1) * period;

  const trackItems = useMemo(
    () => Array.from({ length: copies }).flatMap((_, k) => VISUAL_ORDER.map((c) => ({ c, id: `${c.key}-${k}` }))),
    [copies]
  );

  const x = useRef(new Animated.Value(0)).current;
  const geo = useRef({ xbase: 0, period: 0, step: 0 });
  geo.current = { xbase, period, step };
  const run = useRef({ running: false, t0: 0, p0: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStart = useRef(0);
  const lastPhase = useRef(0);
  const useNative = Platform.OS !== "web";

  const currentPhase = useCallback(() => {
    const r = run.current;
    const p = geo.current.period;
    if (!r.running) return wrapPhase(r.p0, p);
    return wrapPhase(r.p0 + (SPEED * (Date.now() - r.t0)) / 1000, p);
  }, []);

  // إيقاف الحركة وإرجاع الطور الحالى (0 ≤ طور < الدورة).
  const halt = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const ph = currentPhase();
    run.current = { running: false, t0: 0, p0: ph };
    x.stopAnimation();
    return ph;
  }, [currentPhase, x]);

  // حركة خطية بسرعة ثابتة حتى نهاية الدورة ثم تكرار من البداية (النقطة نفسها بصريًا).
  const start: (from: number) => void = useCallback(
    (from: number) => {
      const { xbase: xb, period: P } = geo.current;
      if (P <= 0) return;
      const ph = wrapPhase(from, P);
      run.current = { running: true, t0: Date.now(), p0: ph };
      x.setValue(xb + ph);
      Animated.timing(x, {
        toValue: xb + P,
        duration: Math.max(50, ((P - ph) / SPEED) * 1000),
        easing: Easing.linear,
        useNativeDriver: useNative,
      }).start(({ finished }) => {
        if (finished && run.current.running) start(0);
      });
    },
    [x, useNative]
  );

  const resumeLater = useCallback(
    (ph: number) => {
      run.current = { running: false, t0: 0, p0: ph };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        start(ph);
      }, RESUME_MS);
    },
    [start]
  );

  // يبدأ/يعيد الضبط عند ظهور المقاس أو تغيّره (دوران/تغيير نافذة الويب).
  useEffect(() => {
    if (period <= 0) return;
    start(0);
    return () => {
      run.current.running = false;
      x.stopAnimation();
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    };
  }, [period, xbase, start, x]);

  // السهم: خطوة كارت واحد بحركة ناعمة ثم يستأنف الدوران. اليسار = يظهر ما على اليسار (المحتوى يتحرك يمينًا).
  const nudge = useCallback(
    (delta: number) => {
      const { xbase: xb, period: P } = geo.current;
      if (P <= 0) return;
      const ph = halt();
      const target = ph + delta;
      const settled = wrapPhase(target, P);
      run.current = { running: false, t0: 0, p0: settled };
      x.setValue(xb + ph);
      Animated.timing(x, { toValue: xb + target, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: useNative }).start(({ finished }) => {
        if (!finished) return;
        x.setValue(xb + settled);
        timer.current = setTimeout(() => {
          timer.current = null;
          start(settled);
        }, RESUME_MS);
      });
    },
    [halt, start, x, useNative]
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
        onPanResponderGrant: () => {
          dragStart.current = halt();
          lastPhase.current = dragStart.current;
        },
        onPanResponderMove: (_e, g) => {
          const { xbase: xb, period: P } = geo.current;
          lastPhase.current = wrapPhase(dragStart.current + g.dx, P); // السحب يمينًا يحرّك المحتوى يمينًا
          x.setValue(xb + lastPhase.current);
        },
        onPanResponderRelease: () => resumeLater(lastPhase.current),
        onPanResponderTerminate: () => resumeLater(lastPhase.current),
        onPanResponderTerminationRequest: () => false,
      }),
    [halt, resumeLater, x]
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
              <LtrTrack
                visual={trackItems}
                keyOf={(it) => it.id}
                cellW={step}
                pad={GAP / 2}
                translate={x}
                contentDir={language === "ar" ? "rtl" : "ltr"}
                renderItem={(it, w) => (
                  <Pressable
                    style={[styles.card, { width: w }]}
                    onPress={() => router.push(`/services/${it.c.key}` as Href)}
                    accessibilityRole="button"
                    accessibilityLabel={t(it.c.label)}
                  >
                    <Image source={it.c.image} style={{ width: w, height: Math.round(w * CARD_IMG_ASPECT) }} contentFit="cover" />
                    <View style={styles.cardLabel}>
                      <Text style={styles.cardLabelText} numberOfLines={3}>{t(it.c.label)}</Text>
                    </View>
                  </Pressable>
                )}
              />
            </View>

            <Pressable
              style={[styles.arrow, { left: 2, top: Math.round(cardW * CARD_IMG_ASPECT / 2) - 13 }]}
              onPress={() => nudge(step)}
              accessibilityRole="button"
              accessibilityLabel={t("التالى")}
              hitSlop={8}
            >
              <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M15 5l-7 7 7 7" />
              </Svg>
            </Pressable>
            <Pressable
              style={[styles.arrow, { right: 2, top: Math.round(cardW * CARD_IMG_ASPECT / 2) - 13 }]}
              onPress={() => nudge(-step)}
              accessibilityRole="button"
              accessibilityLabel={t("السابق")}
              hitSlop={8}
            >
              <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M9 5l7 7-7 7" />
              </Svg>
            </Pressable>
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
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.2} strokeLinecap="round">
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
  outer: { width: "100%", paddingTop: 22, paddingBottom: 26 },
  container: { borderWidth: 2, borderRadius: 24, paddingTop: 24, paddingBottom: 26, overflow: "visible" },
  titlePill: {
    position: "absolute", top: -16, alignSelf: "center", backgroundColor: GREEN, borderRadius: 999,
    paddingHorizontal: 30, paddingVertical: 4, zIndex: 2,
  },
  titleText: { color: "white", fontSize: 16, fontWeight: "900", textAlign: "center" },
  viewportWrap: { position: "relative" },
  viewport: { overflow: "hidden", direction: "ltr" as const },
  card: {
    borderRadius: 14, overflow: "hidden", backgroundColor: GREEN, borderWidth: 1, borderColor: "#7BC59A",
    shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  cardLabel: { height: LABEL_H, backgroundColor: GREEN, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  cardLabelText: { color: "white", fontSize: 10.5, fontWeight: "900", textAlign: "center", lineHeight: 14 },
  arrow: {
    position: "absolute", width: 26, height: 26, borderRadius: 13, backgroundColor: GREEN,
    alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "white", zIndex: 3,
  },
  addWrap: { position: "absolute", left: 0, right: 0, bottom: -20, alignItems: "center" },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 2, borderRadius: 999,
    paddingVertical: 4, paddingStart: 6, paddingEnd: 18,
  },
  plusCircle: { width: 24, height: 24, borderRadius: 12, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  addText: { fontSize: 13.5, fontWeight: "900" },
});
