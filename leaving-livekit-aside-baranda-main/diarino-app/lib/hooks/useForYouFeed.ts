import { useEffect, useMemo, useRef } from "react";
import { Property } from "../types";
import { rankFeed } from "../recommendation/engine";
import {
  getProfile, getRecommendationSeed, registerProperties, usePersonalizationEnabled, useRecommendationVersion,
} from "../recommendation/store";

// ↔ ريلز «لك»: يرتّب العقارات المرشّحة للصفحة الرئيسية بحسب اهتمامات المستخدم (lib/recommendation/engine.ts).
//
// قواعد الثبات (مهمة جدًا لتجربة السحب):
//  • الريل النشط + الريلز الأربعة التالية (المُحمَّلة مسبقًا) + كل ما سبقها = «مقفول»: لا يتغيّر ترتيبه أبدًا ولا يختفى من تحت المستخدم.
//  • الباقى (الذيل) يُعاد ترتيبه كلما تغيّر الملف (بعد كل مشاهدة/إعجاب/..) أو وصلت صفحة جديدة أو انتقل المستخدم لريل آخر — فتتكيّف
//    التوصيات لحظيًا مثل تيك توك.
//  • إعلانات الافتتاحى (من لوحة الأدمن) تُوضع قبل هذه القائمة فى app/(tabs)/index.tsx ولا تتأثر بها.
//  • لو التخصيص موقوف من الإعدادات: نرجع القائمة الأصلية كما هى (الأحدث أولًا).
const LOCK_AHEAD = 4;

export function useForYouFeed(
  candidates: Property[],
  opts: { anchorId: string | null; followedIds: Set<string> }
): Property[] {
  const enabled = usePersonalizationEnabled();
  const version = useRecommendationVersion();
  const orderRef = useRef<string[]>([]);
  const lastRef = useRef<Property[]>([]);

  useEffect(() => { registerProperties(candidates); }, [candidates]);

  return useMemo(() => {
    if (!enabled) {
      orderRef.current = [];
      lastRef.current = candidates;
      return candidates;
    }
    const byId = new Map(candidates.map((p) => [p.id, p]));
    const prev = orderRef.current.filter((id) => byId.has(id));
    const pos = opts.anchorId ? prev.indexOf(opts.anchorId) : -1;
    const lockLen = prev.length === 0 ? 0 : Math.min(prev.length, Math.max(LOCK_AHEAD, pos + 1 + LOCK_AHEAD));
    const prefix = prev.slice(0, lockLen);
    const locked = new Set(prefix);
    const rest = candidates.filter((p) => !locked.has(p.id));
    const rankedRest = rankFeed(rest, getProfile(), {
      now: Date.now(),
      seed: getRecommendationSeed(),
      followedSellerIds: opts.followedIds,
    });
    const order = [...prefix, ...rankedRest.map((p) => p.id)];
    orderRef.current = order;
    const next = order.map((id) => byId.get(id)!).filter(Boolean);
    // نفس الترتيب والعناصر؟ نرجّع نفس المصفوفة (لا إعادة رسم لا لزوم لها).
    const last = lastRef.current;
    if (last.length === next.length && last.every((p, i) => p === next[i])) return last;
    lastRef.current = next;
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, enabled, version, opts.anchorId, opts.followedIds]);
}
