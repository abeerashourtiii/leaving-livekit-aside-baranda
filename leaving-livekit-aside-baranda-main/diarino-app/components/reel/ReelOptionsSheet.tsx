import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, View, Text, Pressable, StyleSheet, Switch, PanResponder } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useReelPreferences } from "../../lib/hooks/useReelPreferences";
import { usePiPPreference } from "../../lib/hooks/usePiPPreference";
import { PLAYBACK_SPEEDS, formatSpeed, usePlaybackSpeed } from "../../lib/hooks/usePlaybackSpeed";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

type Props = {
  visible: boolean;
  onClose: () => void;
  onOpenReport: () => void;
  // ↔ صوت الخلفية بيبان بس لو الريل ده فعليًا معاه موسيقى مرفقة
  // (property.music) — زي ما اتطلب بالظبط: "فى حالة ارفاق موسيقى للريل".
  hasMusic: boolean;
  /** «مهتم»: يسجّل تفضيل المستخدم لهذا المحتوى/التصنيف فى خوارزمية التوصية (والشاشة تعرض Toast). */
  onInterested?: () => void;
  /** «غير مهتم»: يقلّل ظهور ريلز مشابهة ويخفى الريل الحالى وينتقل للتالى (والشاشة تعرض Toast). */
  onNotInterested?: () => void;
};

// ↔ قائمة خيارات الريل (تفتح بزر ••• فى العمود الجانبى وبالضغط المطوّل على كارت وصف الريل — نفس القائمة):
//   مهتم / غير مهتم (إشارتان صريحتان لخوارزمية التوصية)، سرعة التشغيل (0.75x–2x، تُطبَّق فورًا وتظهر السرعة النشطة بجانب الخيار)،
//   تمرير تلقائي (مفتاح)، صوت الخلفية (مفتاح، لو للريل موسيقى)، عرض التطبيق فوق التطبيقات الأخرى (مفتاح مباشر بنفس شكل «تمرير تلقائي»)،
//   الإبلاغ عن هذا الريل، إلغاء. تمت إزالة «الترجمة النصية (Captions)» نهائيًا من هذه القائمة.
//   تفضيلات التمرير/الصوت/PiP تُخزَّن فى lib/hooks/useReelPreferences.ts وusePiPPreference.ts (نفس مخازن شاشة الإعدادات: التغيير يظهر فى المكانين فورًا)،
//   والسرعة فى lib/hooks/usePlaybackSpeed.ts (مشتركة مع مشغل الريل).
export function ReelOptionsSheet({ visible, onClose, onOpenReport, hasMusic, onInterested, onNotInterested }: Props) {
  const { t } = useLanguage();
  const { autoAdvance, setAutoAdvance, musicMuted, setMusicMuted } = useReelPreferences();
  const { preference: pipPreference, setPreference: setPipPreference } = usePiPPreference();
  const pipOn = pipPreference !== "declined"; // "unset" يُعامَل كمفعّل (المفعّل افتراضيًا)
  const { speed, setSpeed } = usePlaybackSpeed();
  const [speedOpen, setSpeedOpen] = useState(false);
  useEffect(() => { if (!visible) setSpeedOpen(false); }, [visible]);
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);

  // ↔ #3: إغلاق القائمة بالسحب لأسفل من مقبض السحب أو من أي فراغ فى
  // الشريط العلوي — نفس الفكرة والتقنية المستخدمة فى لوحة تفاصيل العقار
  // (components/reel/ReelCard.tsx، sheetPanResponder) بس بمقياس أبسط:
  // translateY بالبكسل مباشرة (مش قيمة 0..1 مُطبَّقة على تفاعل ثانوي)،
  // لأن القائمة دي مالهاش حالة "مصغّرة" زي لوحة التفاصيل، بس مفتوحة أو
  // مقفولة.
  const translateY = useRef(new Animated.Value(0)).current;
  const sheetHeight = useRef(0);
  const dragStartY = useRef(0);

  function animateCloseFromDrag() {
    Animated.timing(translateY, {
      toValue: sheetHeight.current || 400, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true,
    }).start(() => {
      translateY.setValue(0);
      onClose();
    });
  }

  const dragPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 4 && gesture.dy > 0,
      onPanResponderGrant: () => {
        translateY.stopAnimation((value) => { dragStartY.current = value; });
      },
      onPanResponderMove: (_evt, gesture) => {
        if (gesture.dy <= 0) return;
        translateY.setValue(dragStartY.current + gesture.dy);
      },
      onPanResponderRelease: (_evt, gesture) => {
        const threshold = (sheetHeight.current || 400) * 0.3;
        if (gesture.dy > threshold || gesture.vy > 0.8) {
          animateCloseFromDrag();
        } else {
          Animated.timing(translateY, {
            toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      },
    })
  ).current;

  if (!visible) return null;

  const iconProps = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: themeColors.text, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { setSpeedOpen(false); onClose(); }}>
      <Pressable style={styles.backdrop} onPress={() => { setSpeedOpen(false); onClose(); }} />
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY }] }]}
        onLayout={(e) => { sheetHeight.current = e.nativeEvent.layout.height; }}
        {...dragPanResponder.panHandlers}
      >
        {/* ↔ #8: منطقة السحب بقت على القائمة كلها مش بس المقبض — القائمة دي مالهاش ScrollView داخلي (عدد الصفوف ثابت وقليل)،
            فمفيش تعارض مع أي سكرول داخلي؛ onMoveShouldSetPanResponder بيتفعّل مع سحب فعلي (dy>4) فالمفاتيح والأزرار بتفضل شغالة بالضغط العادي. */}
        <View style={styles.dragZone}>
          <View style={styles.handle} />
        </View>

        {onInterested ? (
          <Pressable style={styles.row} onPress={() => { onClose(); onInterested(); }} accessibilityRole="button">
            <Svg {...iconProps}>
              <Path d="M7 10v12M15 5.88L14 10h5.83a2 2 0 011.92 2.56l-2.33 8A2 2 0 0117.5 22H4a2 2 0 01-2-2v-8a2 2 0 012-2h2.76a2 2 0 001.79-1.11L12 2a3.13 3.13 0 013 3.88z" />
            </Svg>
            <Text style={styles.rowText}>{t("مهتم")}</Text>
          </Pressable>
        ) : null}

        {onNotInterested ? (
          <Pressable style={styles.row} onPress={() => { onClose(); onNotInterested(); }} accessibilityRole="button">
            <Svg {...iconProps}>
              <Path d="M17 14V2M9 18.12L10 14H4.17a2 2 0 01-1.92-2.56l2.33-8A2 2 0 016.5 2H20a2 2 0 012 2v8a2 2 0 01-2 2h-2.76a2 2 0 00-1.79 1.11L12 22a3.13 3.13 0 01-3-3.88z" />
            </Svg>
            <Text style={styles.rowText}>{t("غير مهتم")}</Text>
          </Pressable>
        ) : null}

        <Pressable style={styles.row} onPress={() => setSpeedOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: speedOpen }}>
          <Svg {...iconProps}>
            <Path d="M12 14l4-4" />
            <Path d="M3.34 19a10 10 0 1117.32 0" />
          </Svg>
          <Text style={styles.rowText}>{t("سرعة التشغيل")}</Text>
          <Text style={styles.rowBadge}>{speed === 1 ? `${t("عادية")} (${formatSpeed(1)})` : formatSpeed(speed)}</Text>
        </Pressable>
        {speedOpen ? (
          <View style={styles.speedRow}>
            {PLAYBACK_SPEEDS.map((v) => {
              const on = speed === v;
              return (
                <Pressable
                  key={v}
                  style={[styles.speedChip, on && styles.speedChipActive]}
                  onPress={() => { setSpeed(v); setSpeedOpen(false); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.speedText, on && styles.speedTextActive]}>{formatSpeed(v)}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.row}>
          <Svg {...iconProps}>
            <Path d="M5 12h14M13 6l6 6-6 6" />
          </Svg>
          <Text style={styles.rowText}>{t("تمرير تلقائي")}</Text>
          <Switch value={autoAdvance} onValueChange={setAutoAdvance} trackColor={{ true: "#22A652" }} />
        </View>

        {hasMusic && (
          <View style={styles.row}>
            <Svg {...iconProps}>
              {musicMuted ? (
                <Path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
              ) : (
                <Path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
              )}
            </Svg>
            <Text style={styles.rowText}>{t("صوت الخلفية")}</Text>
            <Switch value={!musicMuted} onValueChange={(on) => setMusicMuted(!on)} trackColor={{ true: "#22A652" }} />
          </View>
        )}

        {/* ↔ عرض التطبيق فوق التطبيقات الأخرى (PiP): مفتاح تفعيل/تعطيل مباشر بنفس شكل «تمرير تلقائي» بدل كلمة «مفعّل» ونافذة وسيطة. */}
        <View style={styles.row}>
          <Svg {...iconProps}>
            <Rect x={3} y={3} width={18} height={14} rx={2} />
            <Rect x={12} y={11} width={7} height={5} rx={1} />
          </Svg>
          <Text style={styles.rowText}>{t("عرض التطبيق فوق التطبيقات الأخرى")}</Text>
          <Switch value={pipOn} onValueChange={(on) => setPipPreference(on ? "enabled" : "declined")} trackColor={{ true: "#22A652" }} />
        </View>

        <Pressable style={styles.row} onPress={() => { onClose(); onOpenReport(); }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#991B1B" strokeWidth={2}>
            <Path d="M4 22V4" /><Path d="M4 4h13l-2 4 2 4H4" />
          </Svg>
          <Text style={[styles.rowText, styles.rowTextDanger]}>{t("الإبلاغ عن هذا الريل")}</Text>
        </Pressable>

        <Pressable style={styles.cancelItem} onPress={() => { setSpeedOpen(false); onClose(); }}>
          <Text style={styles.cancelItemText}>{t("إلغاء")}</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
    sheet: {
      position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: themeColors.card,
      borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24, paddingTop: 6,
    },
    handle: { width: 42, height: 4, borderRadius: 2, backgroundColor: themeColors.border, alignSelf: "center" },
    dragZone: { paddingTop: 10, paddingBottom: 10 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 20 },
    rowText: { fontSize: 13.5, fontWeight: "900", color: themeColors.text, flex: 1 },
    rowTextDanger: { color: "#991B1B" },
    rowBadge: { fontSize: 11, fontWeight: "900", color: "#22A652" },
    speedRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 20, paddingBottom: 8, marginTop: -2 },
    speedChip: { minWidth: 56, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: themeColors.surface, alignItems: "center" },
    speedChipActive: { backgroundColor: "#22A652" },
    speedText: { fontSize: 12.5, fontWeight: "900", color: themeColors.textSubtle },
    speedTextActive: { color: "white" },
    cancelItem: { paddingVertical: 14, alignItems: "center", marginTop: 4 },
    cancelItemText: { fontSize: 13.5, fontWeight: "900", color: themeColors.textSubtle },
  });
}
