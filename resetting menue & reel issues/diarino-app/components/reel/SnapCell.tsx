import { ReactNode } from "react";
import { Platform, View } from "react-native";
import { WEB_SNAP_CELL_STYLE } from "../../lib/reelPaging";

// ↔ على الويب كل ريل لازم يبقى نقطة تثبيت (scroll-snap) مستقلة بحيث السحبة
// الواحدة تنقل ريل واحد بس (شوف lib/reelPaging.ts). على الموبايل مفيش حاجة
// بتتضاف (نفس العنصر زى ما هو، من غير View زيادة).
export function SnapCell({ height, children }: { height: number; children: ReactNode }) {
  if (Platform.OS !== "web") return <>{children}</>;
  return <View style={[{ height }, WEB_SNAP_CELL_STYLE]}>{children}</View>;
}
