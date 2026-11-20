// اختبار ذاتى لمحرك التوصية (بدون مكتبات): node --experimental-strip-types scripts/test-recommendation.mjs
import assert from "node:assert/strict";
import {
  emptyProfile, applyWatch, applySignal, applySearch, applySellerFollow, rankFeed, watchScore, decayProfile, parseProfile, RECO,
} from "../lib/recommendation/engine.ts";

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 6);
let n = 0;
const mk = (id, o = {}) => ({
  id, purpose: "sale", type: "شقة", province: "القاهرة", price: 2_000_000, rooms: 3, features: [],
  seller: { id: `s-${id}` }, likes: 0, saves: 0, views: 0, chats: 0, comments: 0, createdAt: now - 2 * DAY, ...o,
});
const ctx = (extra = {}) => ({ now, seed: 42, ...extra });
const idx = (list, id) => list.findIndex((p) => p.id === id);
const t = (name, fn) => { fn(); n++; console.log("✓", name); };

t("مستخدم جديد: الأحدث والأشهر أولًا", () => {
  const list = [mk("old", { createdAt: now - 60 * DAY }), mk("fresh", { createdAt: now - 1 * DAY }), mk("pop", { createdAt: now - 3 * DAY, likes: 200, views: 5000 })];
  const r = rankFeed(list, emptyProfile(now), ctx());
  assert.equal(r[2].id, "old");
});

t("مشاهدة كاملة + إعادة + إعجاب لفيلات الجيزة ترفعها فوق شقق القاهرة", () => {
  const p = emptyProfile(now);
  const villa = mk("v0", { type: "فيلا", province: "الجيزة", price: 9_000_000, rooms: 5 });
  applyWatch(p, villa, { dwellMs: 30_000, durationMs: 20_000, loops: 1 }, now);
  applySignal(p, villa, "like", now);
  applySignal(p, villa, "comment", now);
  const list = [
    ...Array.from({ length: 6 }, (_, i) => mk(`a${i}`, { seller: { id: `sa${i}` }, createdAt: now - 1 * DAY })),
    mk("v1", { type: "فيلا", province: "الجيزة", price: 8_500_000, rooms: 5, createdAt: now - 20 * DAY }),
  ];
  const r = rankFeed(list, p, ctx());
  assert.ok(idx(r, "v1") <= 1, `v1 at ${idx(r, "v1")}`);
});

t("التخطّى السريع إشارة سلبية", () => {
  assert.ok(watchScore({ dwellMs: 400, durationMs: 20_000, loops: 0 }) < 0);
  const p = emptyProfile(now);
  const rent = mk("r0", { purpose: "rent", type: "شقة", province: "الإسكندرية", price: 8000 });
  for (let i = 0; i < 4; i++) applyWatch(p, rent, { dwellMs: 500, durationMs: 15_000, loops: 0 }, now);
  const list = [mk("r1", { purpose: "rent", province: "الإسكندرية", price: 7500, createdAt: now - 1 * DAY }), mk("b1", { type: "محل", province: "الجيزة", createdAt: now - 4 * DAY })];
  assert.equal(rankFeed(list, p, ctx())[0].id, "b1");
});

t("إعادة المشاهدة أقوى من مشاهدة كاملة واحدة، وكاملة أقوى من جزئية", () => {
  const one = watchScore({ dwellMs: 20_000, durationMs: 20_000, loops: 0 });
  const replay = watchScore({ dwellMs: 40_000, durationMs: 20_000, loops: 1 });
  const partial = watchScore({ dwellMs: 6_000, durationMs: 20_000, loops: 0 });
  assert.ok(replay > one && one > partial && partial > 0, JSON.stringify({ replay, one, partial }));
});

t("المشاركة والتعليق والحفظ أقوى من الإعجاب", () => {
  const S = RECO.SIGNAL;
  assert.ok(S.share > S.comment && S.comment >= S.save && S.save > S.like && S.like > S.detail);
});

t("متابعة معلن ترفع كل ريلاته", () => {
  const p = emptyProfile(now);
  applySellerFollow(p, "star", true, now);
  const list = [...Array.from({ length: 5 }, (_, i) => mk(`x${i}`, { createdAt: now - 1 * DAY })), mk("st", { seller: { id: "star" }, createdAt: now - 25 * DAY, type: "أرض" })];
  const r = rankFeed(list, p, ctx({ followedSellerIds: new Set(["star"]) }));
  assert.ok(idx(r, "st") <= 1);
});

t("البحث عن «فيلا في الجيزة للبيع» يؤثر", () => {
  const p = emptyProfile(now);
  applySearch(p, { query: "فيلا في الجيزة للبيع" }, { types: ["شقة", "فيلا", "أرض"], provinces: ["القاهرة", "الجيزة"] }, now);
  assert.ok((p.w["type:فيلا"] ?? 0) > 0 && (p.w["province:الجيزة"] ?? 0) > 0 && (p.w["purpose:sale"] ?? 0) > 0);
  assert.equal(p.w["province:القاهرة"], undefined);
});

t("التضاؤل الزمنى: النصف بعد 14 يومًا", () => {
  const p = emptyProfile(now);
  applySignal(p, mk("d"), "like", now);
  const before = p.w["type:شقة"];
  decayProfile(p, now + 14 * DAY);
  assert.ok(Math.abs(p.w["type:شقة"] - before / 2) < 0.01);
});

t("ما شاهده المستخدم للتو ينزل ثم يعود تدريجيًا", () => {
  const p = emptyProfile(now);
  const a = mk("seen", { createdAt: now - 1 * DAY }), b = mk("new", { createdAt: now - 1 * DAY, seller: { id: "other" }, type: "محل" });
  applyWatch(p, a, { dwellMs: 20_000, durationMs: 20_000, loops: 0 }, now);
  assert.equal(rankFeed([a, b], p, ctx())[1].id, "seen");
});

t("تنويع: لا يتتالى معلن واحد إذا وُجد غيره", () => {
  const p = emptyProfile(now);
  const list = [
    ...Array.from({ length: 4 }, (_, i) => mk(`m${i}`, { seller: { id: "same" }, createdAt: now - (1 + i * 0.01) * DAY, likes: 50 })),
    ...Array.from({ length: 4 }, (_, i) => mk(`o${i}`, { seller: { id: `o${i}` }, createdAt: now - 3 * DAY })),
  ];
  const r = rankFeed(list, p, ctx());
  for (let i = 2; i < r.length; i++) assert.ok(!(r[i].seller.id === "same" && r[i - 1].seller.id === "same" && r[i - 2].seller.id === "same"));
});

t("ثبات الترتيب لنفس البذرة، واختلافه ببذرة أخرى", () => {
  const list = Array.from({ length: 12 }, (_, i) => mk(`z${i}`, { seller: { id: `z${i}` }, createdAt: now - 2 * DAY }));
  const p = emptyProfile(now);
  const a = rankFeed(list, p, ctx()).map((x) => x.id).join();
  assert.equal(a, rankFeed(list, p, ctx()).map((x) => x.id).join());
  assert.notEqual(a, rankFeed(list, p, ctx({ seed: 7 })).map((x) => x.id).join());
});

t("تسلسل/استعادة الملف", () => {
  const p = emptyProfile(now);
  applySignal(p, mk("q"), "share", now);
  const back = parseProfile(JSON.stringify(p), now);
  assert.deepEqual(back.w, p.w);
  assert.equal(parseProfile("garbage", now).n, 0);
});

console.log(`\nكل الاختبارات نجحت (${n}).`);
