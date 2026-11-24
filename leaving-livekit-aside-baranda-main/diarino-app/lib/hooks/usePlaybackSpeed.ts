import { useSyncExternalStore } from "react";

// ↔ سرعة تشغيل الريلز التى يختارها المستخدم من قائمة خيارات الريل (••• / الضغط المطوّل): 0.75x إلى 2x (الافتراضى 1x).
//   مخزن واحد مشترك (مثل usePiPPreference) فتنعكس السرعة فورًا على مشغل الريل الحالى (expo-video playbackRate) وعلى عرض الصور المتحرك (slideshow)،
//   وتبقى للريلز التالية فى نفس الجلسة، وتعود إلى 1x عند إعادة فتح التطبيق (لا تُحفظ بين الجلسات عمدًا كى لا يعلق المستخدم على سرعة بالخطأ).
//   الضغط المطوّل على الفيديو (تسريع مؤقت 2x أثناء الإمساك) يبقى كما هو ويعود بعده إلى السرعة المختارة.
export const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

let current: PlaybackSpeed = 1;
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
const getSnapshot = () => current;

export function setPlaybackSpeed(next: PlaybackSpeed) {
  if (!PLAYBACK_SPEEDS.includes(next) || next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

export function formatSpeed(v: number): string {
  return `${v}x`;
}

export function usePlaybackSpeed() {
  const speed = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { speed, setSpeed: setPlaybackSpeed };
}
