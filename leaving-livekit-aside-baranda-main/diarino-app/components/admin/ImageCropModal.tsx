import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, PanResponder, Platform, useWindowDimensions, ActivityIndicator, GestureResponderEvent, PanResponderGestureState } from "react-native";
import { Image } from "expo-image";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ↔ نافذة قص الصورة داخل التطبيق (بدل واجهة النظام اللى كان فيها زر "Crop"):
//  * إطار ثابت بنسبة المساحة المطلوبة (aspect)، والمشرف بيحرّك الصورة ويكبّرها جواه:
//    سحب بإصبع، تكبير بإصبعين، عجلة الماوس على الويب، أو أزرار + / −.
//  * الموافقة بعلامة صح ✅ (أعلى اليمين)، والإلغاء بـ ✕ — مفيش زر "Crop".
//  * بترجّع إحداثيات القص نسبية (0..1 من عرض/ارتفاع الصورة) فالرفع والقص الفعلى
//    بيتم بعدها (cldCrop) — نفس السلوك على أندرويد/آيفون/ويب/APK، وبدون أي مكتبة native.
export type CropRect = { x: number; y: number; w: number; h: number };

type Props = {
  visible: boolean;
  uri: string | null;
  aspect: number; // عرض ÷ ارتفاع الإطار
  specText?: string; // المقاس المطلوب (يتعرض للمشرف)
  onCancel: () => void;
  onConfirm: (rect: CropRect, natural: { width: number; height: number }) => void;
};

const MAX_ZOOM = 6;

export function ImageCropModal({ visible, uri, aspect, specText, onCancel, onConfirm }: Props) {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const frameW = Math.min(winW - 32, 680);
  const frameH = frameW / aspect;

  const [nat, setNat] = useState<{ width: number; height: number } | null>(null);
  const [view, setView] = useState({ zoom: 1, ox: 0, oy: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const natRef = useRef(nat);
  natRef.current = nat;

  // أبعاد الصورة الفعلية كما بتتعرض (بعد تدوير EXIF) من onLoad بتاع expo-image.
  useEffect(() => { setNat(null); }, [uri]);

  const baseScale = nat ? Math.max(frameW / nat.width, frameH / nat.height) : 1;

  function clamp(zoom: number, ox: number, oy: number) {
    const n = natRef.current;
    if (!n) return { zoom, ox, oy };
    const bs = Math.max(frameW / n.width, frameH / n.height);
    const dw = n.width * bs * zoom;
    const dh = n.height * bs * zoom;
    return {
      zoom,
      ox: Math.min(0, Math.max(frameW - dw, ox)),
      oy: Math.min(0, Math.max(frameH - dh, oy)),
    };
  }

  // أول ما الأبعاد تتحمّل: تكبير 1 والصورة متمركزة داخل الإطار.
  useEffect(() => {
    if (!nat) return;
    const dw = nat.width * baseScale;
    const dh = nat.height * baseScale;
    setView({ zoom: 1, ox: (frameW - dw) / 2, oy: (frameH - dh) / 2 });
  }, [nat, frameW, frameH, baseScale]);

  // تكبير/تصغير حول مركز الإطار.
  function zoomTo(newZoom: number) {
    const cur = viewRef.current;
    const z = Math.min(MAX_ZOOM, Math.max(1, newZoom));
    const ratio = z / cur.zoom;
    const cx = frameW / 2;
    const cy = frameH / 2;
    setView(clamp(z, cx - (cx - cur.ox) * ratio, cy - (cy - cur.oy) * ratio));
  }

  const pan = useRef({ ox: 0, oy: 0, dx0: 0, dy0: 0, touches: 0, pinchDist: 0, pinchZoom: 1 });
  const dist = (e: GestureResponderEvent) => {
    const t = e.nativeEvent.touches;
    if (!t || t.length < 2) return 0;
    return Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
  };
  const rebase = (gs: PanResponderGestureState, e: GestureResponderEvent) => {
    const cur = viewRef.current;
    const p = pan.current;
    p.ox = cur.ox; p.oy = cur.oy; p.dx0 = gs.dx; p.dy0 = gs.dy;
    p.touches = e.nativeEvent.touches?.length ?? 1;
    p.pinchDist = dist(e); p.pinchZoom = cur.zoom;
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e, gs) => rebase(gs, e),
        onPanResponderMove: (e, gs) => {
          const count = e.nativeEvent.touches?.length ?? 1;
          if (count !== pan.current.touches) rebase(gs, e);
          const p = pan.current;
          const cur = viewRef.current;
          let zoom = cur.zoom;
          let ox = p.ox + (gs.dx - p.dx0);
          let oy = p.oy + (gs.dy - p.dy0);
          if (count >= 2 && p.pinchDist > 0) {
            const d = dist(e);
            zoom = Math.min(MAX_ZOOM, Math.max(1, p.pinchZoom * (d / p.pinchDist)));
            const ratio = zoom / cur.zoom;
            const cx = frameW / 2, cy = frameH / 2;
            ox = cx - (cx - ox) * ratio;
            oy = cy - (cy - oy) * ratio;
          }
          setView(clamp(zoom, ox, oy));
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frameW, frameH]
  );

  function confirm() {
    if (!nat) return;
    const dw = nat.width * baseScale * view.zoom;
    const dh = nat.height * baseScale * view.zoom;
    onConfirm(
      {
        x: Math.min(1, Math.max(0, -view.ox / dw)),
        y: Math.min(1, Math.max(0, -view.oy / dh)),
        w: Math.min(1, frameW / dw),
        h: Math.min(1, frameH / dh),
      },
      nat
    );
  }

  const dw = nat ? nat.width * baseScale * view.zoom : 0;
  const dh = nat ? nat.height * baseScale * view.zoom : 0;
  const cropW = nat ? Math.round((frameW / dw) * nat.width) : 0;
  const cropH = nat ? Math.round((frameH / dh) * nat.height) : 0;

  // عجلة الماوس (ويب فقط).
  const wheelProps =
    Platform.OS === "web"
      ? ({ onWheel: (e: { deltaY: number; preventDefault?: () => void }) => { e.preventDefault?.(); zoomTo(viewRef.current.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } } as object)
      : {};

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <View style={[styles.root, { paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.header}>
          <Pressable style={[styles.roundBtn, styles.cancelBtn]} onPress={onCancel} hitSlop={8} accessibilityLabel="إلغاء">
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.6} strokeLinecap="round"><Path d="M18 6L6 18M6 6l12 12" /></Svg>
          </Pressable>
          <Text style={styles.title}>ضبط الصورة</Text>
          {/* ✅ الموافقة على القص (بدل زر Crop) */}
          <Pressable
            style={[styles.roundBtn, styles.okBtn, !nat && { opacity: 0.4 }]}
            onPress={confirm}
            disabled={!nat}
            hitSlop={8}
            accessibilityLabel="موافق"
          >
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><Path d="M20 6L9 17l-5-5" /></Svg>
          </Pressable>
        </View>

        <View style={styles.stage}>
          <View style={{ width: frameW, height: frameH }} {...panResponder.panHandlers} {...wheelProps}>
            <View style={[styles.frame, { width: frameW, height: frameH }]}>
              {uri && nat ? (
                <Image
                  source={{ uri }}
                  style={{ position: "absolute", left: view.ox, top: view.oy, width: dw, height: dh }}
                  contentFit="fill"
                />
              ) : (
                <View style={styles.loading}><ActivityIndicator color="#22C55E" /></View>
              )}
              {/* شبكة الأثلاث + حد الإطار */}
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <View style={[styles.gridV, { left: "33.33%" }]} />
                <View style={[styles.gridV, { left: "66.66%" }]} />
                <View style={[styles.gridH, { top: "33.33%" }]} />
                <View style={[styles.gridH, { top: "66.66%" }]} />
              </View>
              <View pointerEvents="none" style={styles.frameBorder} />
            </View>
          </View>
        </View>

        {/* قياس الصورة الفعلى بعد التدوير — عنصر مخفى بيشغّل onLoad */}
        {uri && !nat && (
          <Image
            source={{ uri }}
            style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
            onLoad={(e) => setNat({ width: e.source.width, height: e.source.height })}
          />
        )}

        <View style={styles.zoomRow}>
          <Pressable style={styles.zoomBtn} onPress={() => zoomTo(viewRef.current.zoom / 1.25)} accessibilityLabel="تصغير"><Text style={styles.zoomBtnText}>−</Text></Pressable>
          <Text style={styles.zoomValue}>{Math.round(view.zoom * 100)}%</Text>
          <Pressable style={styles.zoomBtn} onPress={() => zoomTo(viewRef.current.zoom * 1.25)} accessibilityLabel="تكبير"><Text style={styles.zoomBtnText}>+</Text></Pressable>
        </View>

        <View style={styles.info}>
          <Text style={styles.infoLine}>المقاس المطلوب للمساحة الإعلانية: {specText ?? ""}</Text>
          {nat && <Text style={styles.infoLine}>الصورة الأصلية: {nat.width} × {nat.height} بكسل — المنطقة المقصوصة: {cropW} × {cropH} بكسل</Text>}
          <Text style={styles.hint}>اسحب الصورة لتحريكها، وكبّرها بإصبعين (أو + / − أو عجلة الماوس)، ثم اضغط ✅ للموافقة.</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0B0F14" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  title: { color: "white", fontSize: 15, fontWeight: "900" },
  roundBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  cancelBtn: { backgroundColor: "rgba(255,255,255,0.14)" },
  okBtn: { backgroundColor: "#22A652" },
  stage: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: { overflow: "hidden", backgroundColor: "#1F2937", borderRadius: 4 },
  frameBorder: { ...StyleSheet.absoluteFillObject, borderWidth: 2, borderColor: "rgba(255,255,255,0.9)", borderRadius: 4 },
  gridV: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(255,255,255,0.35)" },
  gridH: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "rgba(255,255,255,0.35)" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  zoomRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18, paddingVertical: 10 },
  zoomBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  zoomBtnText: { color: "white", fontSize: 24, fontWeight: "700", lineHeight: 28 },
  zoomValue: { color: "rgba(255,255,255,0.85)", fontSize: 12.5, fontWeight: "800", minWidth: 52, textAlign: "center" },
  info: { paddingHorizontal: 20, paddingBottom: 6, gap: 4 },
  infoLine: { color: "rgba(255,255,255,0.85)", fontSize: 11.5, fontWeight: "700", textAlign: "center" },
  hint: { color: "rgba(255,255,255,0.55)", fontSize: 11, textAlign: "center", marginTop: 2 },
});
