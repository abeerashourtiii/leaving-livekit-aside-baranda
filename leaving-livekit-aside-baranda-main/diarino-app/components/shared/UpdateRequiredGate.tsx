import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { useAppUpdateRequired } from "../../lib/hooks/useAppUpdateRequired";
import { openExternalUrl } from "../../lib/linking";
import { useLanguage } from "../../lib/hooks/useLanguage";

// ↔ شاشة «تحديث مطلوب» غير قابلة للإغلاق: تظهر فقط إن كان إصدار التطبيق أقل من الحد الأدنى فى app_version_requirements.
// تُستخدم بعد تطبيق migrations «التضييق» التى تكسر النسخ القديمة. بلا صف/قيمة 0.0.0 ⇒ لا تظهر أبدًا.
export function UpdateRequiredGate() {
  const { t } = useLanguage();
  const { required, storeUrl, message } = useAppUpdateRequired();
  if (!required) return null;
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={() => {}}>
      <View style={styles.wrap}>
        <Text style={styles.title}>{t("تحديث مطلوب")}</Text>
        <Text style={styles.body}>{message || t("هذه النسخة من التطبيق لم تعد مدعومة. حدّث التطبيق للاستمرار.")}</Text>
        {!!storeUrl && (
          <Pressable style={styles.btn} onPress={() => openExternalUrl(storeUrl)}>
            <Text style={styles.btnText}>{t("تحديث التطبيق")}</Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: "#ffffff" },
  title: { fontSize: 22, fontWeight: "900", color: "#111", marginBottom: 12, textAlign: "center" },
  body: { fontSize: 15, lineHeight: 24, color: "#444", textAlign: "center", marginBottom: 24 },
  btn: { backgroundColor: "#72904A", paddingVertical: 13, paddingHorizontal: 32, borderRadius: 12 },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
