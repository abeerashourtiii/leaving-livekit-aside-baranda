// lib/reelPaging.ts
//
// ↔ التنقل بين الريلز: السحب لأعلى/أسفل لازم ينقل للريل اللى بعده/قبله مباشرة،
// ومايتخطّاش ريل حتى لو السحبة سريعة. السبب القديم للتخطّى: القائمة كانت
// بتجمع pagingEnabled مع snapToInterval + decelerationRate="fast" من غير
// disableIntervalMomentum — على آيفون/أندرويد زخم السحبة السريعة كان بيعدّى
// أكتر من نقطة تثبيت (snap)، وعلى الويب مفيش أى تثبيت لكل عنصر أصلًا
// (RN-web بيطبّق scroll-snap على الحاوية بس، مش على كل خلية).
//
// الحل بحسب المنصة:
//   • أندرويد/آيفون/APK: snapToInterval = ارتفاع الريل + disableIntervalMomentum
//     (السحبة بتقف على الريل التالى/السابق فقط مهما كانت السرعة). pagingEnabled
//     بنشيله على الموبايل لأنه بيتعارض مع snapToInterval على iOS.
//   • الويب: CSS scroll-snap إلزامى على الحاوية + scroll-snap-align/stop على كل
//     خلية (components/reel/SnapCell.tsx) — scroll-snap-stop: always هو اللى
//     بيمنع المتصفح من تخطّى نقاط التثبيت مع عجلة الماوس/التراكباد.
import { Platform } from "react-native";

// الأنماط دى CSS للويب بس — RN's StyleSheet types مبتعرفهاش.
export const WEB_SCROLL_SNAP_STYLE = { scrollSnapType: "y mandatory" } as object;
export const WEB_SNAP_CELL_STYLE = { scrollSnapAlign: "start", scrollSnapStop: "always" } as object;

export function reelPagingProps(itemHeight: number) {
  return {
    snapToInterval: itemHeight,
    snapToAlignment: "start" as const,
    decelerationRate: "fast" as const,
    disableIntervalMomentum: true,
    ...(Platform.OS === "web"
      ? { pagingEnabled: true, style: WEB_SCROLL_SNAP_STYLE }
      : {}),
  };
}
