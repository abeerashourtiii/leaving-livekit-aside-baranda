import Svg, { Path } from "react-native-svg";

// ↔ أيقونة «العروض» (علامة سعر) — نفس أيقونة «تقديم عرض» فى تفاصيل العقار، فبتكون مألوفة.
export function OffersIcon({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z" />
      <Path d="M7.5 7.5h.01" />
    </Svg>
  );
}
