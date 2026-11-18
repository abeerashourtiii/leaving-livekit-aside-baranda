import { useEffect, useRef } from "react";
import { Modal, View, Text, Pressable, FlatList, StyleSheet, useWindowDimensions, Platform } from "react-native";
import { Image } from "expo-image";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState } from "react";
import { cldOptimized } from "../../lib/cloudinary";

// ↔ عارض صور ملء الشاشة (شات): تمرير أفقى بين كل صور الرسالة + عدّاد + زر إغلاق (و Escape على الويب).
//   مودال عادى من react-native فيشتغل بنفس الشكل على أندرويد وآيفون والويب وAPK.
type Props = { images: string[]; initialIndex: number; visible: boolean; onClose: () => void };

export function ImageViewerModal({ images, initialIndex, visible, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);
  const listRef = useRef<FlatList<string>>(null);

  useEffect(() => {
    if (visible) setIndex(initialIndex);
  }, [visible, initialIndex]);

  useEffect(() => {
    if (!visible || Platform.OS !== "web" || typeof document === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index < images.length - 1) listRef.current?.scrollToIndex({ index: index + 1, animated: true });
      else if (e.key === "ArrowRight" && index > 0) listRef.current?.scrollToIndex({ index: index - 1, animated: true });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, index, images.length, onClose]);

  if (!visible || images.length === 0) return null;
  const safeStart = Math.min(Math.max(initialIndex, 0), images.length - 1);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <FlatList
          ref={listRef}
          data={images}
          keyExtractor={(u, i) => `${i}-${u}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={safeStart}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => (
            <Pressable style={{ width, height }} onPress={onClose}>
              <Image source={{ uri: cldOptimized(item, "w_1600,q_auto,f_auto") }} style={{ width, height }} contentFit="contain" transition={120} />
            </Pressable>
          )}
        />
        <Pressable style={[styles.closeBtn, { top: insets.top + 12 }]} onPress={onClose} hitSlop={10} accessibilityRole="button">
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.4}><Path d="M18 6L6 18M6 6l12 12" /></Svg>
        </Pressable>
        {images.length > 1 && (
          <View style={[styles.counter, { top: insets.top + 16 }]} pointerEvents="none">
            <Text style={styles.counterText}>{index + 1} / {images.length}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)" },
  closeBtn: { position: "absolute", left: 14, width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  counter: { position: "absolute", alignSelf: "center", left: 0, right: 0, alignItems: "center" },
  counterText: { color: "white", fontSize: 13, fontWeight: "800", backgroundColor: "rgba(0,0,0,0.4)", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
});
