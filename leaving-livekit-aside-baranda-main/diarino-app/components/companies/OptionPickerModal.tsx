import { Modal, Text, Pressable, FlatList } from "react-native";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors } from "../../lib/hooks/useThemeColors";
import { createCompanyStyles } from "./companyStyles";

// قائمة اختيار منسدلة (Bottom sheet) بسيطة تعمل على الويب والموبايل — للمحافظة/المنطقة/النشاط فى قسم «الخدمات».
export function OptionPickerModal<T extends string>({ visible, title, options, selected, onSelect, onClose, allowClear, clearLabel, renderLabel }: {
  visible: boolean;
  title: string;
  options: { value: T; label: string }[];
  selected: T | "" | undefined;
  onSelect: (value: T | "") => void;
  onClose: () => void;
  allowClear?: boolean;
  clearLabel?: string;
  renderLabel?: (label: string) => string;
}) {
  const { t } = useLanguage();
  const colors = useThemeColors();
  const styles = createCompanyStyles(colors);
  const data: { value: T | ""; label: string }[] = allowClear ? [{ value: "", label: clearLabel ?? t("الكل") }, ...options] : options;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={() => {}}>
          <Text style={styles.modalTitle}>{title}</Text>
          <FlatList
            data={data}
            keyExtractor={(o) => o.value || "__all"}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const on = (selected ?? "") === item.value;
              return (
                <Pressable style={styles.modalItem} onPress={() => { onSelect(item.value); onClose(); }} accessibilityRole="button">
                  <Text style={[styles.modalItemText, on && styles.modalItemOn]}>{renderLabel ? renderLabel(item.label) : item.label}</Text>
                  {on && <Text style={styles.modalItemOn}>✓</Text>}
                </Pressable>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
