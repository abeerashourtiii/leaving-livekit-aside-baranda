import { useSyncExternalStore } from "react";

// ↔ قفل تمرير قائمة الريلز الرأسية أثناء فتح لوحة التعليقات. لوحة التفاصيل بتتحكم فى القفل عبر state فى الشاشة الأب
// (detailsOpenId)، لكن لوحة التعليقات جوه ReelCard نفسه — فبنستخدم مخزن صغير مشترك (نفس فكرة lib/pipState.ts) عشان الشاشات الأب
// (app/(tabs)/index.tsx و app/property/[id]/reel.tsx) تعطّل scrollEnabled من غير ما نمرّر props جديدة لكل نقطة استخدام.
let locked = false;
const listeners = new Set<() => void>();

export function setReelSheetLocked(value: boolean): void {
  if (locked === value) return;
  locked = value;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useReelSheetLocked(): boolean {
  return useSyncExternalStore(subscribe, () => locked, () => false);
}
