import { useSyncExternalStore } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ نافذة تنبيه الضيف (انشر عقارك / اطلب عقارك): بتظهر فوق أى شاشة من أى مكان فى التطبيق عن طريق
// promptGuestLogin() (lib/guestGate.ts) — Modal أصلى من React Native فبيشتغل على أندرويد/آيفون/الويب/APK
// بنفس الشكل (Alert.alert مبيشتغلش على الويب). الضيف مبيتسجّلش خروج إلا لو ضغط «تسجيل الدخول»؛
// «ليس الآن» بيقفل النافذة ويكمل تصفّحه فى التطبيق زى ما هو.
export type GuestPromptKind = "listing" | "request" | "generic";
type PromptState = { visible: boolean; kind: GuestPromptKind; onConfirm: (() => void) | null };

let state: PromptState = { visible: false, kind: "generic", onConfirm: null };
const listeners = new Set<() => void>();

function emit(next: PromptState) {
  state = next;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function showGuestLoginPrompt(kind: GuestPromptKind, onConfirm: () => void): void {
  if (state.visible) return;
  emit({ visible: true, kind, onConfirm });
}

function hide() {
  emit({ visible: false, kind: state.kind, onConfirm: null });
}

export function GuestLoginPromptHost() {
  const snap = useSyncExternalStore(subscribe, () => state, () => state);
  const { t } = useLanguage();
  const themeColors = useThemeColors();

  const message =
    snap.kind === "listing"
      ? t("يجب تسجيل الدخول أولًا قبل نشر عقار.")
      : snap.kind === "request"
        ? t("يجب تسجيل الدخول أولًا قبل طلب عقار.")
        : t("يجب تسجيل الدخول أولًا قبل نشر عقار أو طلب عقار.");

  function confirm() {
    const cb = snap.onConfirm;
    hide();
    cb?.();
  }

  return (
    <Modal visible={snap.visible} transparent animationType="fade" onRequestClose={hide} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={hide} accessibilityLabel={t("ليس الآن")} />
        <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
          <Text style={[styles.title, { color: themeColors.text }]}>{t("تسجيل الدخول مطلوب")}</Text>
          <Text style={[styles.message, { color: themeColors.textMuted }]}>
            {message} {t("هل تريد الانتقال إلى صفحة تسجيل الدخول؟")}
          </Text>
          <Pressable style={styles.primaryBtn} onPress={confirm} accessibilityRole="button">
            <Text style={styles.primaryText}>{t("تسجيل الدخول")}</Text>
          </Pressable>
          <Pressable style={[styles.secondaryBtn, { borderColor: themeColors.border }]} onPress={hide} accessibilityRole="button">
            <Text style={[styles.secondaryText, { color: themeColors.textMuted }]}>{t("ليس الآن")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 380, borderRadius: 22, padding: 22, gap: 12 },
  title: { fontSize: 18, fontWeight: "900", textAlign: "center" },
  message: { fontSize: 14, fontWeight: "600", lineHeight: 22, textAlign: "center", marginBottom: 6 },
  primaryBtn: { backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 14, alignItems: "center" },
  primaryText: { color: "white", fontSize: 15, fontWeight: "900" },
  secondaryBtn: { borderRadius: 999, paddingVertical: 13, alignItems: "center", borderWidth: 1.5 },
  secondaryText: { fontSize: 15, fontWeight: "800" },
});
