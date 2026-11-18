import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { useSyncExternalStore } from "react";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { getCurrentDialog, subscribeDialogs, resolveDialog } from "../../lib/dialogStore";

// ↔ يعرض حوارات Alert.alert على الويب (شوف lib/installWebAlert.ts). بيتركّب مرة واحدة فى app/_layout.tsx.
//   على أندرويد/آيفون ما فيش حوارات فى المخزن (Alert الأصلى بيتولّاها) فالمكوّن بيرجّع null.
export function AlertHost() {
  const dialog = useSyncExternalStore(subscribeDialogs, getCurrentDialog, getCurrentDialog);
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  if (!dialog) return null;

  const cancelable = dialog.options?.cancelable !== false;
  const buttons = dialog.buttons;
  const stacked = buttons.length > 2;
  const dismiss = () => { if (cancelable) resolveDialog(dialog.id); };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={dismiss} />
        <View style={styles.card} accessibilityRole="alert">
          {!!dialog.title && <Text style={styles.title}>{dialog.title}</Text>}
          {!!dialog.message && (
            <ScrollView style={styles.messageBox}>
              <Text style={styles.text}>{dialog.message}</Text>
            </ScrollView>
          )}
          <View style={[styles.actions, stacked && styles.actionsStacked]}>
            {buttons.map((b, i) => {
              const isCancel = b.style === "cancel";
              const isDanger = b.style === "destructive";
              return (
                <Pressable
                  key={`${dialog.id}-${i}`}
                  style={[styles.btn, stacked ? styles.btnStacked : styles.btnRow, isCancel ? styles.btnCancel : isDanger ? styles.btnDanger : styles.btnPrimary]}
                  onPress={() => resolveDialog(dialog.id, b)}
                >
                  <Text style={[styles.btnText, isCancel && styles.btnCancelText]}>{b.text ?? t("حسنًا")}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
    card: { width: "100%", maxWidth: 420, backgroundColor: c.card, borderRadius: 18, padding: 20 },
    title: { fontSize: 16, fontWeight: "900", color: c.text, marginBottom: 8, textAlign: "center" },
    messageBox: { maxHeight: 260, marginBottom: 16 },
    text: { fontSize: 13, color: c.textSubtle, lineHeight: 20, textAlign: "center" },
    actions: { flexDirection: "row", gap: 10 },
    actionsStacked: { flexDirection: "column" },
    btn: { borderRadius: 999, paddingVertical: 12, paddingHorizontal: 14, alignItems: "center" },
    btnRow: { flex: 1 },
    btnStacked: { alignSelf: "stretch" },
    btnPrimary: { backgroundColor: "#22A652" },
    btnDanger: { backgroundColor: "#ef4444" },
    btnCancel: { backgroundColor: "transparent", borderWidth: 1, borderColor: c.border },
    btnText: { fontSize: 13, fontWeight: "900", color: "white" },
    btnCancelText: { color: c.textMuted },
  });
}
