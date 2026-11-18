import { Modal, View, Pressable, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PropertyRequest } from "../../data/mock-requests";
import { ReelCommentsPanel } from "../reel/ReelCommentsPanel";
import { KeyboardAvoid } from "../shared/KeyboardAvoid";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { useLanguage } from "../../lib/hooks/useLanguage";

// ↔ تعليقات الطلب: نافذة سفلية فيها نفس لوحة تعليقات الريلز (ReelCommentsPanel) بنوع "request" — تعليق، رد، إعجاب 👍،
//   تثبيت (لصاحب الطلب)، إبلاغ/حذف، والضغط على صورة/اسم صاحب التعليق يفتح صفحة المعلن. شغّالة بنفس الكود على أندرويد/آيفون/الويب/APK.
export function RequestCommentsModal({ request, onClose }: { request: PropertyRequest | null; onClose: () => void }) {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!request} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoid style={{ flex: 1 }} mode="sheet">
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t("إغلاق")} />
        <View style={styles.sheet}>
          <View style={styles.handleRow}>
            <View style={styles.handle} />
            <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("إغلاق")}>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={themeColors.text} strokeWidth={2.5}>
                <Path d="M6 6l12 12M18 6L6 18" />
              </Svg>
            </Pressable>
          </View>
          {request ? (
            <ReelCommentsPanel
              target={{ id: request.id, ownerId: request.requesterId, count: request.comments, kind: "request" }}
              bottomInset={insets.bottom}
            />
          ) : null}
        </View>
      </KeyboardAvoid>
    </Modal>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
    sheet: {
      position: "absolute", left: 0, right: 0, bottom: 0, height: "78%", backgroundColor: themeColors.card,
      borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8, overflow: "hidden",
    },
    handleRow: { alignItems: "center", justifyContent: "center", paddingBottom: 10, minHeight: 22 },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: themeColors.border },
    closeBtn: { position: "absolute", end: 12, top: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: themeColors.surface, alignItems: "center", justifyContent: "center" },
  });
}
