import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { usePathname } from "expo-router";
import {
  ANDROID_PACKAGE, APP_URL_SCHEME, PLAY_STORE_URL, APP_STORE_URL, OPEN_IN_APP_PATHS, WEB_CHOICE_HOURS,
} from "../../lib/appLinks";

// ↔ رسالة «هل تريد المتابعة من خلال التطبيق؟» (نسخة الويب على متصفح الموبايل فقط).
// لما حد يفتح رابط مشاركة (ريل/بروفايل/مقارنة) من متصفح موبايل:
//   • «فتح فى التطبيق»: أندرويد ← intent:// (يفتح التطبيق لو مثبّت)، آيفون ← diarino://. لو التطبيق ما اتفتحش (مش مثبّت) نعرض رابط المتجر
//     لتثبيته (أو «سيتوفر قريبًا» لحد ما ينزل المتجر — lib/appLinks.ts).
//   • «المتابعة على الويب»: بيكمّل على الموقع وبنتذكّر الاختيار 24 ساعة على نفس المتصفح (تخزين محلى فقط).
// لا تظهر على الكمبيوتر، ولا لو الموقع مفتوح كتطبيق (standalone)، ولا لغير مسارات المشاركة.
const CHOICE_KEY = "baranda:web_continue_until";

function mobileKind(): "android" | "ios" | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent || "";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  return null;
}

function isStandalone(): boolean {
  try {
    return window.matchMedia?.("(display-mode: standalone)")?.matches === true || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch { return false; }
}

export function OpenInAppBanner() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [tried, setTried] = useState(false); // ضغط «فتح فى التطبيق» ولم يُفتح التطبيق
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!OPEN_IN_APP_PATHS.test(pathname)) { setVisible(false); return; }
    if (!mobileKind() || isStandalone()) return;
    try {
      const until = Number(window.localStorage.getItem(CHOICE_KEY) ?? 0);
      if (until > Date.now()) return;
    } catch { /* تجاهل */ }
    setVisible(true);
    setTried(false);
  }, [pathname]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!visible) return null;

  const kind = mobileKind();
  const storeUrl = kind === "ios" ? APP_STORE_URL : PLAY_STORE_URL;

  function openApp() {
    const path = `${window.location.pathname}${window.location.search}`;
    setTried(true);
    // لو التطبيق اتفتح الصفحة بتبقى hidden؛ لو لسه ظاهرة بعد ثانية ونص يبقى التطبيق مش مثبّت.
    timer.current = setTimeout(() => { /* نفضل على الرسالة مع رابط المتجر */ }, 1600);
    if (kind === "android") {
      window.location.href = `intent://baranda.shop${path}#Intent;scheme=https;package=${ANDROID_PACKAGE};end`;
    } else {
      window.location.href = `${APP_URL_SCHEME}:/${path}`;
    }
  }

  function continueOnWeb() {
    try { window.localStorage.setItem(CHOICE_KEY, String(Date.now() + WEB_CHOICE_HOURS * 3600 * 1000)); } catch { /* تجاهل */ }
    setVisible(false);
  }

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card} accessibilityRole="alert">
        <Text style={styles.title}>هل تريد المتابعة من خلال التطبيق؟</Text>
        <Text style={styles.sub}>افتح هذه الصفحة مباشرة في تطبيق باراندا للحصول على أفضل تجربة، أو تابع هنا على الويب.</Text>
        {tried && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              {storeUrl ? "لم يُفتح التطبيق؟ ثبّته من المتجر ثم افتح الرابط مرة أخرى." : "إن لم يُفتح التطبيق فهو غير مثبّت أو غير متاح بعد، وسيتوفر قريبًا على المتاجر. يمكنك المتابعة على الويب الآن."}
            </Text>
            {!!storeUrl && (
              <Pressable style={styles.storeBtn} onPress={() => { window.location.href = storeUrl; }}>
                <Text style={styles.storeBtnText}>{kind === "ios" ? "تثبيت من App Store" : "تثبيت من Google Play"}</Text>
              </Pressable>
            )}
          </View>
        )}
        <View style={styles.row}>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={openApp} accessibilityRole="button">
            <Text style={styles.btnPrimaryText}>فتح في التطبيق</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={continueOnWeb} accessibilityRole="button">
            <Text style={styles.btnGhostText}>المتابعة على الويب</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, top: 0, justifyContent: "flex-end", zIndex: 9999 },
  card: { backgroundColor: "#ffffff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 24, gap: 10, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 16, elevation: 12 },
  title: { fontSize: 16, fontWeight: "900", color: "#111827", textAlign: "right" },
  sub: { fontSize: 13, lineHeight: 20, color: "#4b5563", textAlign: "right" },
  notice: { backgroundColor: "#fff7ed", borderRadius: 12, padding: 10, gap: 8 },
  noticeText: { fontSize: 12.5, lineHeight: 19, color: "#9a3412", textAlign: "right" },
  storeBtn: { backgroundColor: "#111827", borderRadius: 999, paddingVertical: 10, alignItems: "center" },
  storeBtnText: { color: "white", fontWeight: "900", fontSize: 13 },
  row: { flexDirection: "row", gap: 10, marginTop: 4 },
  btn: { flex: 1, borderRadius: 999, paddingVertical: 13, alignItems: "center" },
  btnPrimary: { backgroundColor: "#22A652" },
  btnPrimaryText: { color: "white", fontWeight: "900", fontSize: 14 },
  btnGhost: { backgroundColor: "#f3f4f6" },
  btnGhostText: { color: "#111827", fontWeight: "900", fontSize: 14 },
});
