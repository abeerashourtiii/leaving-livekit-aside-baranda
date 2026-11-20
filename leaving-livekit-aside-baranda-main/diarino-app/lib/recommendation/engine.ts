// lib/recommendation/engine.ts
//
// ↔ خوارزمية التوصية («لك» / For You) لريلز الصفحة الرئيسية — منطق نقي (بدون React/RN) فيمكن اختباره ويعمل بنفس الشكل
//   على أندرويد وآيفون والويب وAPK. التخزين والتتبع والمزامنة فى lib/recommendation/store.ts، والربط بالقائمة فى
//   lib/hooks/useForYouFeed.ts.
//
// الفكرة (مثل تيك توك): كل ريل له «خصائص» (النوع، الغرض بيع/إيجار، المحافظة، المعلن، شريحة السعر، الغرف، المميزات).
// كل تفاعل من المستخدم يرفع/يخفض وزن خصائص ذلك الريل فى «ملف اهتمامات» خاص به. ثم نرتّب الريلز المرشّحة بدرجة تجمع:
//   اهتمامات المستخدم + حداثة الإعلان + شعبيته + متابعة المعلن + تنويع + استكشاف، ونُنزل ما شاهده مؤخرًا.
//
// الإشارات (بالترتيب من الأقوى للأضعف): مشاركة، تعليق، حفظ/مفضلة، متابعة معلن، إعجاب، إعادة مشاهدة، فتح التفاصيل،
// مشاهدة كاملة، نسبة المشاهدة، البحث؛ والتخطّى السريع إشارة سلبية.

export const PROFILE_VERSION = 1;

/** أقل مجموعة حقول من العقار يحتاجها المحرك (Property الكامل يطابقها). */
export type RecoProperty = {
  id: string;
  purpose: string;
  type: string;
  province?: string | null;
  price?: number | null;
  rooms?: number | null;
  features?: string[] | null;
  seller: { id: string };
  likes?: number | null;
  saves?: number | null;
  views?: number | null;
  chats?: number | null;
  comments?: number | null;
  createdAt?: number | null;
  publishedAt?: number | null;
  pinned?: boolean | null;
};

export type SeenEntry = { t: number; c: number; done?: boolean };

export type InterestProfile = {
  v: number;
  /** وزن كل خاصية (type:شقة، province:القاهرة، seller:<id>...) — موجب = اهتمام، سالب = عدم اهتمام. */
  w: Record<string, number>;
  /** آخر مرة شاهد فيها كل ريل: لتنزيل المكرر. */
  seen: Record<string, SeenEntry>;
  /** عدد التفاعلات المسجّلة (لتقدير «ثقة» الملف). */
  n: number;
  /** وقت آخر تطبيق للتضاؤل (ms). */
  decayedAt: number;
  updatedAt: number;
};

export type SignalKind =
  | "like" | "unlike" | "comment" | "share" | "save" | "unsave" | "follow" | "unfollow" | "detail";

export type WatchInfo = {
  /** مدة المشاهدة الفعلية (النشط وغير الموقوف) بالمللى ثانية. */
  dwellMs: number;
  /** مدة الفيديو/السلايدشو بالمللى ثانية (0 لو غير معروفة). */
  durationMs: number;
  /** عدد مرات إعادة التشغيل (لفّات كاملة بعد الأولى). */
  loops: number;
};

// ───────────── الثوابت (عدّلها من هنا) ─────────────
export const RECO = {
  HALF_LIFE_DAYS: 14,          // نصف عمر الاهتمام: بعد أسبوعين يقلّ الوزن للنصف
  WEIGHT_CAP: 30,              // أقصى وزن لخاصية واحدة (±)
  MAX_FEATURES: 400,           // أقصى عدد خصائص محفوظة (يُحذف الأضعف)
  MAX_SEEN: 400,
  FEATURE_WEIGHT: { type: 1.0, purpose: 0.7, province: 0.9, seller: 1.3, price: 0.6, rooms: 0.4, feat: 0.25 } as Record<string, number>,
  SIGNAL: { share: 6, comment: 5, save: 5, follow: 8, like: 4, detail: 2, search: 3 } as Record<string, number>,
  SKIP_MS: 1500,               // أقل من هذا = تخطّى فورًا
  QUICK_SKIP_MS: 3000,
  COMPLETE_RATIO: 0.9,
  SCORE: { interest: 1.9, fresh: 0.9, pop: 0.6, follow: 0.55, pinned: 0.25, seenPenalty: 1.3, explore: 0.22 },
  FRESH_HALF_DAYS: 10,
  SEEN_RECOVER_HOURS: 72,      // ما شاهده يعود تدريجيًا خلال ~3 أيام
  DIVERSITY: { sameSellerRecent: 0.55, sameTypeRecent: 0.18 },
  EXPLORE_EVERY: 5,            // كل خامس ريل استكشافى (خارج اهتمامات المستخدم)
};

export function emptyProfile(now: number): InterestProfile {
  return { v: PROFILE_VERSION, w: {}, seen: {}, n: 0, decayedAt: now, updatedAt: now };
}

// ───────────── الخصائص ─────────────
function priceBucket(p: RecoProperty): string | null {
  const price = Number(p.price);
  if (!isFinite(price) || price <= 0) return null;
  // شرائح لوغاريتمية (بيع بالملايين، إيجار بالآلاف) — الغرض جزء من المفتاح فلا تختلط شريحتا البيع والإيجار.
  const b = Math.round(Math.log10(price) * 2) / 2; // نصف درجة لوغاريتمية ≈ ×3.16
  return `price:${p.purpose}:${b}`;
}

export function featuresOf(p: RecoProperty): { key: string; w: number }[] {
  const out: { key: string; w: number }[] = [];
  const fw = RECO.FEATURE_WEIGHT;
  if (p.type) out.push({ key: `type:${p.type}`, w: fw.type });
  if (p.purpose) out.push({ key: `purpose:${p.purpose}`, w: fw.purpose });
  if (p.province) out.push({ key: `province:${p.province}`, w: fw.province });
  if (p.seller?.id) out.push({ key: `seller:${p.seller.id}`, w: fw.seller });
  const pb = priceBucket(p);
  if (pb) out.push({ key: pb, w: fw.price });
  if (p.rooms != null && p.rooms >= 0) out.push({ key: `rooms:${Math.min(5, Math.round(p.rooms))}`, w: fw.rooms });
  for (const f of (p.features ?? []).slice(0, 6)) if (f) out.push({ key: `feat:${f}`, w: fw.feat });
  return out;
}

// ───────────── تحديث الملف ─────────────
function decayFactor(dtMs: number): number {
  if (dtMs <= 0) return 1;
  return Math.pow(0.5, dtMs / (RECO.HALF_LIFE_DAYS * 86_400_000));
}

/** يطبّق التضاؤل الزمنى على كل الأوزان (يُستدعى قبل أى تحديث/تقييم). يعدّل الملف فى مكانه ويرجعه. */
export function decayProfile(profile: InterestProfile, now: number): InterestProfile {
  const f = decayFactor(now - profile.decayedAt);
  if (f < 0.999) {
    for (const k of Object.keys(profile.w)) {
      const v = profile.w[k] * f;
      if (Math.abs(v) < 0.05) delete profile.w[k];
      else profile.w[k] = v;
    }
    profile.decayedAt = now;
  }
  return profile;
}

function bump(profile: InterestProfile, features: { key: string; w: number }[], amount: number) {
  if (!amount) return;
  for (const f of features) {
    const next = (profile.w[f.key] ?? 0) + amount * f.w;
    profile.w[f.key] = Math.max(-RECO.WEIGHT_CAP, Math.min(RECO.WEIGHT_CAP, next));
  }
}

function prune(profile: InterestProfile) {
  const keys = Object.keys(profile.w);
  if (keys.length > RECO.MAX_FEATURES) {
    keys.sort((a, b) => Math.abs(profile.w[b]) - Math.abs(profile.w[a]));
    for (const k of keys.slice(RECO.MAX_FEATURES)) delete profile.w[k];
  }
  const ids = Object.keys(profile.seen);
  if (ids.length > RECO.MAX_SEEN) {
    ids.sort((a, b) => profile.seen[b].t - profile.seen[a].t);
    for (const id of ids.slice(RECO.MAX_SEEN)) delete profile.seen[id];
  }
}

/** درجة المشاهدة (قد تكون سالبة) من مدة المشاهدة ونسبة الإكمال وإعادة التشغيل. */
export function watchScore(w: WatchInfo): number {
  const dwell = Math.max(0, w.dwellMs);
  if (dwell < RECO.SKIP_MS) return -1.0;                       // تخطّى فورًا
  const hasDur = w.durationMs > 1000;
  const ratio = hasDur ? Math.min(1, dwell / w.durationMs) : Math.min(1, dwell / 12_000); // بلا مدة معروفة: 12ث = «كامل»
  const loops = Math.max(0, Math.min(3, Math.floor(w.loops)));
  let s = ratio * 1.6;                                          // نسبة المشاهدة
  if (ratio >= RECO.COMPLETE_RATIO) s += 1.0;                   // شاهده كاملًا
  s += loops * 1.7;                                             // أعاد المشاهدة
  if (dwell < RECO.QUICK_SKIP_MS && loops === 0) s = Math.min(s, -0.35);
  return s;
}

export function applyWatch(profile: InterestProfile, p: RecoProperty, w: WatchInfo, now: number): InterestProfile {
  decayProfile(profile, now);
  const s = watchScore(w);
  bump(profile, featuresOf(p), s);
  const prev = profile.seen[p.id];
  const done = (w.dwellMs >= RECO.SKIP_MS) && (w.loops > 0 || (w.durationMs > 1000 ? w.dwellMs / w.durationMs >= RECO.COMPLETE_RATIO : w.dwellMs >= 12_000));
  // لا نعدّ المرور اللحظى «مشاهدة» (لا يُنزل الريل من القائمة)، لكن أى مشاهدة ≥ 1.5ث تُعدّ.
  if (w.dwellMs >= RECO.SKIP_MS) profile.seen[p.id] = { t: now, c: (prev?.c ?? 0) + 1, done: !!(prev?.done || done) };
  profile.n += 1;
  profile.updatedAt = now;
  prune(profile);
  return profile;
}

export function applySignal(profile: InterestProfile, p: RecoProperty, kind: SignalKind, now: number): InterestProfile {
  decayProfile(profile, now);
  const S = RECO.SIGNAL;
  const feats = featuresOf(p);
  switch (kind) {
    case "share": bump(profile, feats, S.share); break;
    case "comment": bump(profile, feats, S.comment); break;
    case "save": bump(profile, feats, S.save); break;
    case "unsave": bump(profile, feats, -S.save); break;
    case "like": bump(profile, feats, S.like); break;
    case "unlike": bump(profile, feats, -S.like); break;
    case "detail": bump(profile, feats, S.detail); break;
    case "follow":
      // المتابعة: ارتباط قوى بالمعلن + دفعة أخف لخصائص هذا الريل.
      bump(profile, feats.filter((f) => f.key.startsWith("seller:")), S.follow);
      bump(profile, feats.filter((f) => !f.key.startsWith("seller:")), S.follow * 0.25);
      break;
    case "unfollow":
      bump(profile, feats.filter((f) => f.key.startsWith("seller:")), -S.follow);
      break;
  }
  profile.n += 1;
  profile.updatedAt = now;
  prune(profile);
  return profile;
}

/** متابعة معلن بدون ريل بعينه (من صفحة المعلن مثلًا). */
export function applySellerFollow(profile: InterestProfile, sellerId: string, following: boolean, now: number): InterestProfile {
  decayProfile(profile, now);
  bump(profile, [{ key: `seller:${sellerId}`, w: RECO.FEATURE_WEIGHT.seller }], following ? RECO.SIGNAL.follow : -RECO.SIGNAL.follow);
  profile.n += 1;
  profile.updatedAt = now;
  prune(profile);
  return profile;
}

export type SearchHint = { query?: string; type?: string; purpose?: string; provinces?: string[] };

/** البحث يؤثر فى التوصيات: نوع/غرض/محافظة صريحة من الفلتر، أو كلمات من نص البحث تطابق أنواعًا/محافظات معروفة. */
export function applySearch(
  profile: InterestProfile,
  hint: SearchHint,
  vocab: { types: string[]; provinces: string[] },
  now: number
): InterestProfile {
  decayProfile(profile, now);
  const amount = RECO.SIGNAL.search;
  const feats: { key: string; w: number }[] = [];
  const fw = RECO.FEATURE_WEIGHT;
  if (hint.type && hint.type !== "all") feats.push({ key: `type:${hint.type}`, w: fw.type });
  if (hint.purpose && hint.purpose !== "all") feats.push({ key: `purpose:${hint.purpose}`, w: fw.purpose });
  for (const pr of hint.provinces ?? []) feats.push({ key: `province:${pr}`, w: fw.province });
  const q = (hint.query ?? "").trim();
  if (q.length >= 2) {
    const nq = normalizeAr(q);
    for (const t of vocab.types) if (t && nq.includes(normalizeAr(t))) feats.push({ key: `type:${t}`, w: fw.type });
    for (const pr of vocab.provinces) if (pr && nq.includes(normalizeAr(pr))) feats.push({ key: `province:${pr}`, w: fw.province });
    if (/(للبيع|تمليك|شراء|اشتري)/.test(nq)) feats.push({ key: "purpose:sale", w: fw.purpose });
    if (/(للايجار|ايجار|استاجر|اجار)/.test(nq)) feats.push({ key: "purpose:rent", w: fw.purpose });
  }
  if (!feats.length) return profile;
  bump(profile, feats, amount);
  profile.n += 1;
  profile.updatedAt = now;
  prune(profile);
  return profile;
}

export function normalizeAr(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")   // تشكيل وتطويل
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

// ───────────── التقييم والترتيب ─────────────
export type RankContext = {
  now: number;
  followedSellerIds?: Set<string>;
  /** بذرة ثابتة طوال الجلسة: تجعل الاستكشاف عشوائيًا لكنه مستقر (لا يتغيّر عند كل إعادة ترتيب). */
  seed: number;
  /** الملفات الشخصية صفر = مستخدم جديد؛ نعتمد على الحداثة والشعبية. */
  exploreEnabled?: boolean;
};

function hash01(seed: number, id: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function popularityRaw(p: RecoProperty): number {
  return (p.likes ?? 0) * 3 + (p.comments ?? 0) * 4 + (p.saves ?? 0) * 4 + (p.chats ?? 0) * 5 + (p.views ?? 0) * 0.2;
}

export type ScoreParts = { interest: number; fresh: number; pop: number; follow: number; seen: number; total: number };

export function scoreProperty(
  profile: InterestProfile,
  p: RecoProperty,
  ctx: RankContext,
  maxPopLog: number
): ScoreParts {
  const S = RECO.SCORE;
  let sum = 0;
  for (const f of featuresOf(p)) sum += (profile.w[f.key] ?? 0) * f.w;
  const interest = Math.tanh(sum / 10);                                  // (-1, 1)

  const created = p.publishedAt ?? p.createdAt ?? ctx.now;
  const ageDays = Math.max(0, (ctx.now - created) / 86_400_000);
  const fresh = Math.pow(0.5, ageDays / RECO.FRESH_HALF_DAYS);           // (0, 1]

  const pop = maxPopLog > 0 ? Math.log1p(popularityRaw(p)) / maxPopLog : 0;

  const follow = ctx.followedSellerIds?.has(p.seller.id) ? 1 : 0;

  let seen = 0;
  const s = profile.seen[p.id];
  if (s) {
    const hours = Math.max(0, (ctx.now - s.t) / 3_600_000);
    seen = Math.exp(-hours / RECO.SEEN_RECOVER_HOURS) * (s.done ? 1 : 0.7);
  }

  const total =
    S.interest * interest +
    S.fresh * fresh +
    S.pop * pop +
    S.follow * follow +
    (p.pinned ? S.pinned : 0) -
    S.seenPenalty * seen +
    S.explore * hash01(ctx.seed, p.id);
  return { interest, fresh, pop, follow, seen, total };
}

/**
 * يرتّب الريلز المرشّحة لمستخدم معيّن.
 *  1) درجة لكل ريل. 2) اختيار جشع مع تنويع (لا يتتالى نفس المعلن/النوع). 3) كل خامس موضع استكشافى
 *  (أعلى درجة بدون اعتبار الاهتمامات) حتى لا يعلق المستخدم فى فقاعة اهتمام واحدة.
 */
export function rankFeed<T extends RecoProperty>(
  candidates: T[],
  profile: InterestProfile,
  ctx: RankContext
): T[] {
  if (candidates.length <= 1) return candidates.slice();
  decayProfile(profile, ctx.now);
  let maxPopLog = 0;
  for (const c of candidates) maxPopLog = Math.max(maxPopLog, Math.log1p(popularityRaw(c)));
  const scored = candidates.map((p) => ({ p, parts: scoreProperty(profile, p, ctx, maxPopLog) }));
  const explore = (e: { p: T; parts: ScoreParts }) =>
    RECO.SCORE.fresh * e.parts.fresh + RECO.SCORE.pop * e.parts.pop - RECO.SCORE.seenPenalty * e.parts.seen + RECO.SCORE.explore * hash01(ctx.seed + 7, e.p.id);

  const remaining = scored.slice();
  const out: T[] = [];
  const recent: T[] = [];
  const exploreEnabled = ctx.exploreEnabled !== false && profile.n >= 6; // مستخدم جديد: الترتيب الأساسى كافٍ
  while (remaining.length) {
    const pos = out.length;
    const isExplorePos = exploreEnabled && pos > 0 && (pos + 1) % RECO.EXPLORE_EVERY === 0;
    let bestIdx = 0;
    let best = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const e = remaining[i];
      let v = isExplorePos
        ? explore(e) - Math.max(0, e.parts.interest) * 0.9                // استكشاف: نفضّل ما لا يطابق اهتماماته بقوة
        : e.parts.total;
      // تنويع: نفس المعلن فى آخر 2، ونفس النوع فى آخر 3.
      for (let r = Math.max(0, recent.length - 2); r < recent.length; r++) if (recent[r].seller.id === e.p.seller.id) v -= RECO.DIVERSITY.sameSellerRecent;
      for (let r = Math.max(0, recent.length - 3); r < recent.length; r++) if (recent[r].type === e.p.type) v -= RECO.DIVERSITY.sameTypeRecent;
      if (v > best) { best = v; bestIdx = i; }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    out.push(picked.p);
    recent.push(picked.p);
    if (recent.length > 3) recent.shift();
  }
  return out;
}

// ───────────── التسلسل والدمج ─────────────
export function parseProfile(raw: unknown, now: number): InterestProfile {
  try {
    const o = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<InterestProfile> | null;
    if (!o || typeof o !== "object" || o.v !== PROFILE_VERSION || typeof o.w !== "object") return emptyProfile(now);
    const w: Record<string, number> = {};
    for (const [k, v] of Object.entries(o.w ?? {})) if (typeof v === "number" && isFinite(v)) w[k] = Math.max(-RECO.WEIGHT_CAP, Math.min(RECO.WEIGHT_CAP, v));
    const seen: Record<string, SeenEntry> = {};
    for (const [k, v] of Object.entries(o.seen ?? {})) if (v && typeof v.t === "number") seen[k] = { t: v.t, c: Number(v.c) || 1, done: !!v.done };
    return { v: PROFILE_VERSION, w, seen, n: Number(o.n) || 0, decayedAt: Number(o.decayedAt) || now, updatedAt: Number(o.updatedAt) || now };
  } catch {
    return emptyProfile(now);
  }
}

/** يختار الأحدث (آخر كاتب يفوز) — يُستخدم عند مقارنة الملف المحلى بالمحفوظ على الحساب. */
export function pickNewer(a: InterestProfile, b: InterestProfile): InterestProfile {
  return a.updatedAt >= b.updatedAt ? a : b;
}
