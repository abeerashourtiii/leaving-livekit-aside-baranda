import { useSyncExternalStore } from "react";
import type { Property } from "./types";

// ↔ قائمة تشغيل الريلز لتصفّح ريل بريل من شاشة معيّنة (مثلًا نتائج البحث). الرابط (route) ما ينفعش يشيل
// قائمة عقارات كاملة، فالشاشة المصدر (البحث) بتحط نتائجها هنا وشاشة الريل (property/[id]/reel?list=<key>)
// بتقراها. الشاشة المصدر بتفضل شغّالة تحت شاشة الريل، فأى صفحة نتائج جديدة بتتحمّل (loadMore) بتوصل للريل لحظيًا.
export type ReelPlaylist = {
  items: Property[];
  hasMore: boolean;
  loadMore: (() => void) | null;
};

const EMPTY: ReelPlaylist = { items: [], hasMore: false, loadMore: null };
const lists = new Map<string, ReelPlaylist>();
const listeners = new Set<() => void>();

export function setReelPlaylist(key: string, next: ReelPlaylist): void {
  lists.set(key, next);
  listeners.forEach((l) => l());
}

export function getReelPlaylist(key: string): ReelPlaylist {
  return lists.get(key) ?? EMPTY;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReelPlaylist(key: string): ReelPlaylist {
  return useSyncExternalStore(subscribe, () => getReelPlaylist(key), () => EMPTY);
}
