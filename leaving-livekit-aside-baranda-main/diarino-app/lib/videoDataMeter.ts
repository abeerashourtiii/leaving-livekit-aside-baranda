import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ↔ D3: عدّاد تقديرى لاستهلاك بيانات الفيديو (للأدمن فقط) — لقياس قبل/بعد تعديلات التحميل المسبق (D2).
//   expo-video 2.0.6 لا يعطى عدد البايتات المحمّلة، فالتقدير = ثوانى الفيديو المحمّلة (أكبر من bufferedPosition وcurrentTime لكل ريل)
//   × bitrate افتراضى (ASSUMED_MBPS). الرقم للمقارنة النسبية بين نسختين وليس فاتورة دقيقة (الجودة الحقيقية تختلف من فيديو لآخر).
//   خامل تمامًا (صفر تكلفة) إلا لو الأدمن فعّله من الإعدادات. لا يُرسل شيئًا لأى خادم (فى الذاكرة فقط).
export const ASSUMED_MBPS = 1;
const KEY = "shahir:videoMeter:v1";

let enabled = false;
const secByUri = new Map<string, number>();
let snapshot = { enabled, reels: 0, estMB: 0, version: 0 };
const listeners = new Set<() => void>();
let lastEmit = 0;

function compute() {
  let sec = 0;
  secByUri.forEach((v) => { sec += v; });
  return { enabled, reels: secByUri.size, estMB: (sec * ASSUMED_MBPS) / 8, version: snapshot.version + 1 };
}
function emit(force = false) {
  const now = Date.now();
  if (!force && now - lastEmit < 1000) return; // لا نُعيد رسم الشارة أكتر من مرة فى الثانية
  lastEmit = now;
  snapshot = compute();
  listeners.forEach((l) => l());
}

AsyncStorage.getItem(KEY).then((v) => { if (v === "1") { enabled = true; emit(true); } }).catch(() => {});

export function isVideoMeterEnabled() { return enabled; }

export function setVideoMeterEnabled(on: boolean) {
  enabled = on;
  if (!on) secByUri.clear();
  AsyncStorage.setItem(KEY, on ? "1" : "0").catch(() => {});
  emit(true);
}

export function recordVideoSeconds(uri: string, seconds: number) {
  if (!enabled || !uri || !(seconds > 0)) return;
  if (seconds > (secByUri.get(uri) ?? 0)) { secByUri.set(uri, seconds); emit(); }
}

export function resetVideoMeter() { secByUri.clear(); emit(true); }

export function getVideoMeterReport(limit = 15): { uri: string; sec: number; mb: number }[] {
  return [...secByUri.entries()]
    .map(([uri, sec]) => ({ uri, sec, mb: (sec * ASSUMED_MBPS) / 8 }))
    .sort((a, b) => b.mb - a.mb)
    .slice(0, limit);
}

export function useVideoMeter() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => snapshot,
    () => snapshot,
  );
}
