import { useSyncExternalStore } from "react";
import { supabase } from "../supabase";
import { queryClient } from "../queryClient";
import { withTimeout } from "../async";
import { getAuthSnapshot } from "./useCurrentUser";
import { MediaItem } from "../types";
import {
  AdminReel, AdminLive, AdminReport, AdminUser, AdminFeature, CityStat, ReelStatus, LiveStatus,
} from "../../data/mock-admin";

// ↔ replaces the local-only mock DB (seedAdminDB() + AsyncStorage
// persistence) with the real tables added in
// 20260801000000_admin_backend.sql. Same useSyncExternalStore +
// module-level store shape as before (so every admin screen that already
// calls `useAdminDB()` and the standalone setters keeps working
// unchanged) — only the fetch/mutate implementations underneath are new.

type AdminAnalyticsData = {
  totalViews: number;
  totalWaClicks: number;
  listingsThisMonth: number;
  conversionRate: string;
  dailyListings: number[]; // last 7 days, oldest first
  dailySignups: number[]; // last 7 days, oldest first
  typeDistribution: { label: string; value: number }[];
};

type AdminDB = {
  reels: AdminReel[]; lives: AdminLive[]; reports: AdminReport[];
  users: AdminUser[]; features: AdminFeature[]; cityStats: CityStat[]; analytics: AdminAnalyticsData;
};

const EMPTY_ANALYTICS: AdminAnalyticsData = {
  totalViews: 0, totalWaClicks: 0, listingsThisMonth: 0, conversionRate: "0.0%",
  dailyListings: [0, 0, 0, 0, 0, 0, 0], dailySignups: [0, 0, 0, 0, 0, 0, 0], typeDistribution: [],
};

const EMPTY_DB: AdminDB = { reels: [], lives: [], reports: [], users: [], features: [], cityStats: [], analytics: EMPTY_ANALYTICS };

let db: AdminDB = EMPTY_DB;
let snapshot = db;
let loaded = false;
let sellerAgg = new Map<string, { reels: number; views: number }>();
const listeners = new Set<() => void>();

function syncSnapshot() {
  snapshot = db;
}
function emit() {
  syncSnapshot();
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getSnapshot() {
  return snapshot;
}

export function isAdminDBLoaded() {
  return loaded;
}

// Deterministic pseudo-color per row (mock data used a random palette
// index; a hash keeps the same id always rendering the same color instead
// of reshuffling on every refetch).
const COLORS = ["#6366f1", "#ec4899", "#10b981", "#f59e0b", "#0ea5e9", "#8b5cf6", "#ef4444", "#14b8a6"];
function colorFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

// ---------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------

type PropertyRow = {
  id: string; title: string; type: string; province: string; price: number; views: number; likes: number;
  wa_clicks: number; moderation_status: ReelStatus; created_at: string; seller_id: string;
  media: MediaItem[]; cover_image: string | null; share_platforms: string[] | null;
  profiles: { full_name: string | null } | null;
};

// Last 7 calendar days (oldest first), used to bucket created_at
// timestamps into a real daily count instead of a hardcoded array.
function last7Days(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

async function fetchReelsAndCityStats(): Promise<{ reels: AdminReel[]; cityStats: CityStat[]; analyticsBase: Pick<AdminAnalyticsData, "totalViews" | "totalWaClicks" | "listingsThisMonth" | "conversionRate" | "dailyListings" | "typeDistribution"> }> {
  // ↔ الأدمن لازم يشوف كل الإعلانات (منشورة/قيد المراجعة/مرفوضة): سياسة RLS بتسمح بده لصلاحية reels. لو الـ embed بتاع اسم المالك
  //   فشل (اسم الـ FK مختلف فى قاعدة بيانات معيّنة) بنعيد الجلب من غيره بدل ما القائمة كلها تفضل فاضية.
  const COLS = "id, title, type, province, price, views, likes, wa_clicks, moderation_status, created_at, seller_id, media, cover_image, share_platforms";
  let data: unknown = null;
  const withOwner = await supabase
    .from("properties")
    .select(`${COLS}, profiles!properties_seller_profile_fkey(full_name)`)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (withOwner.error) {
    console.warn("admin reels with owner embed failed, retrying without it:", withOwner.error.message);
    const plain = await supabase.from("properties").select(COLS).order("created_at", { ascending: false }).limit(2000);
    if (plain.error) throw plain.error;
    data = plain.data;
  } else {
    data = withOwner.data;
  }
  const rows = (data as unknown as PropertyRow[]) ?? [];

  const reels: AdminReel[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    owner: r.profiles?.full_name || "مستخدم باراندا",
    views: r.views ?? 0,
    likes: r.likes ?? 0,
    wa: r.wa_clicks ?? 0,
    status: r.moderation_status,
    color: colorFor(r.id),
    price: `${Number(r.price).toLocaleString("ar-EG")} ج.م`,
    date: r.created_at.slice(0, 10),
    videoUrl: r.media?.find((m) => m.type === "video")?.url ?? null,
    coverUrl: r.cover_image ?? r.media?.find((m) => m.type === "image")?.url ?? null,
    sharePlatforms: r.share_platforms || [],
  }));

  const byCity = new Map<string, { ads: number; views: number; wa: number }>();
  const bySeller = new Map<string, { reels: number; views: number }>();
  const byType = new Map<string, number>();
  const days = last7Days();
  const dailyListingsMap = new Map(days.map((d) => [d, 0]));
  let totalViews = 0, totalWaClicks = 0, listingsThisMonth = 0;
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  for (const r of rows) {
    const c = byCity.get(r.province) || { ads: 0, views: 0, wa: 0 };
    c.ads += 1; c.views += r.views ?? 0; c.wa += r.wa_clicks ?? 0;
    byCity.set(r.province, c);

    const u = bySeller.get(r.seller_id) || { reels: 0, views: 0 };
    u.reels += 1; u.views += r.views ?? 0;
    bySeller.set(r.seller_id, u);

    totalViews += r.views ?? 0;
    totalWaClicks += r.wa_clicks ?? 0;
    byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
    const createdDay = r.created_at.slice(0, 10);
    if (createdDay >= monthStart) listingsThisMonth += 1;
    if (dailyListingsMap.has(createdDay)) dailyListingsMap.set(createdDay, (dailyListingsMap.get(createdDay) ?? 0) + 1);
  }
  sellerAgg = bySeller;

  const cityStats: CityStat[] = Array.from(byCity.entries())
    .map(([city, s]) => ({
      city, ads: s.ads, views: s.views, wa: s.wa,
      rate: s.views > 0 ? ((s.wa / s.views) * 100).toFixed(1) + "%" : "0.0%",
    }))
    .sort((a, b) => b.ads - a.ads);

  return {
    reels, cityStats,
    analyticsBase: {
      totalViews, totalWaClicks, listingsThisMonth,
      conversionRate: totalViews > 0 ? ((totalWaClicks / totalViews) * 100).toFixed(1) + "%" : "0.0%",
      dailyListings: days.map((d) => dailyListingsMap.get(d) ?? 0),
      typeDistribution: Array.from(byType.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    },
  };
}

type LiveRow = {
  id: string; title: string | null; duration_sec: number | null; status: "live" | "ended";
  viewer_peak: number; moderation_status: LiveStatus; created_at: string;
  recording_url: string | null; recording_status: "none" | "recording" | "processing" | "ready" | "failed";
  profiles: { full_name: string | null } | null;
};

// ↔ إصلاح فجوة إدارية حقيقية: الاستعلام كان بيجيب اللايفات المنتهية بس
// (status = 'ended')، يعني أي بث مباشر لسه شغال فعليًا (status = 'live')
// كان غير مرئي للأدمن خالص — مش يقدر يشوفه ولا يقدر يحذفه. دلوقتي بنجيب
// الاثنين مع بعض، وbroadcastStatus بيوضّح فى الواجهة أيهما لسه على الهواء.
//
// ↔ recording_url/recording_status: عمودين موجودين فى lives من زمان
// (20260720000000_add_recording_columns.sql) وRLS بالفعل بتسمح للأدمن
// يقراهم (20260822000000_rls_audit_fixes.sql: "... or
// public.admin_has_permission('lives')") — بس الاستعلام هنا مكانش أصلاً
// بيطلبهم من قاعدة البيانات، فمكانش فيه أي طريقة الأدمن يشوف بيها
// التسجيل حتى لو كان جاهز فعلاً. دلوقتي بيتجابوا وبينضموا للنتيجة.
async function fetchLives(): Promise<AdminLive[]> {
  const { data, error } = await supabase
    .from("lives")
    .select("id, title, duration_sec, status, viewer_peak, moderation_status, created_at, recording_url, recording_status, profiles!lives_host_profile_fkey(full_name)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data as unknown as LiveRow[]) ?? []).map((l) => ({
    id: l.id,
    title: l.title || "بث مباشر",
    host: l.profiles?.full_name || "مستخدم باراندا",
    duration: `${Math.max(1, Math.round((l.duration_sec ?? 0) / 60))} دقيقة`,
    views: l.viewer_peak ?? 0,
    status: l.moderation_status,
    broadcastStatus: l.status,
    color: colorFor(l.id),
    date: l.created_at.slice(0, 10),
    recordingUrl: l.recording_url,
    recordingStatus: l.recording_status ?? "none",
  }));
}

type ReportRow = {
  id: string; target_type: string; target_id: string; target_title: string; target_color: string;
  reason: string; created_at: string; admin_reply: string | null; replied_at: string | null;
  profiles: { full_name: string | null } | null;
};

async function fetchReports(): Promise<AdminReport[]> {
  const { data, error } = await supabase
    .from("reports")
    .select("id, target_type, target_id, target_title, target_color, reason, created_at, admin_reply, replied_at, profiles!reports_reporter_profile_fkey(full_name)")
    .order("created_at", { ascending: false });
  if (error) throw error;

  // Several reports on the same content collapse into one row with a
  // count, same shape the mock data used ("count = N بلاغ").
  const grouped = new Map<string, AdminReport>();
  for (const r of (data as unknown as ReportRow[]) ?? []) {
    const key = `${r.target_type}:${r.target_id}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      // ↔ المجموعة «اتردّ عليها» فقط لو كل بلاغاتها اتردّ عليها
      if (!r.replied_at) { existing.replied = false; existing.id = r.id; }
    } else {
      grouped.set(key, {
        id: r.id,
        target: r.target_title,
        targetId: r.target_id,
        targetColor: r.target_color,
        reason: r.reason,
        reporter: r.profiles?.full_name || "مستخدم",
        count: 1,
        date: r.created_at.slice(0, 10),
        targetType: r.target_type,
        reply: r.admin_reply,
        replied: !!r.replied_at,
      });
    }
  }
  return Array.from(grouped.values());
}

type ProfileRow = { id: string; full_name: string | null };
type PermRow = {
  user_id: string; active: boolean; publish_reels: boolean; live: boolean; paid_ads: boolean; direct_wa: boolean;
};

async function fetchUsers(): Promise<AdminUser[]> {
  const [{ data: profiles, error: pErr }, { data: perms, error: permErr }] = await Promise.all([
    supabase.from("profiles").select("id, full_name"),
    supabase.from("user_permissions").select("user_id, active, publish_reels, live, paid_ads, direct_wa"),
  ]);
  if (pErr) throw pErr;
  if (permErr) throw permErr;

  const permByUser = new Map((perms as unknown as PermRow[] ?? []).map((p) => [p.user_id, p]));

  return ((profiles as unknown as ProfileRow[]) ?? []).map((p) => {
    const perm = permByUser.get(p.id);
    const agg = sellerAgg.get(p.id) || { reels: 0, views: 0 };
    return {
      id: p.id,
      name: p.full_name || "مستخدم باراندا",
      reels: agg.reels,
      views: agg.views,
      active: perm?.active ?? true,
      perms: {
        publishReels: perm?.publish_reels ?? true,
        live: perm?.live ?? true,
        paidAds: perm?.paid_ads ?? true,
        directWa: perm?.direct_wa ?? true,
      },
    };
  });
}

type FeatureRow = { key: string; name: string; description: string; enabled: boolean };

async function fetchFeatures(): Promise<AdminFeature[]> {
  const { data, error } = await supabase.from("feature_flags").select("key, name, description, enabled").order("key");
  if (error) throw error;
  return ((data as unknown as FeatureRow[]) ?? []).map((f) => ({
    key: f.key, name: f.name, desc: f.description, on: f.enabled,
  }));
}

async function fetchDailySignups(): Promise<number[]> {
  const days = last7Days();
  const { data, error } = await supabase.from("profiles").select("created_at").gte("created_at", days[0]);
  if (error) throw error;
  const map = new Map(days.map((d) => [d, 0]));
  for (const row of (data ?? []) as { created_at: string }[]) {
    const day = row.created_at.slice(0, 10);
    if (map.has(day)) map.set(day, (map.get(day) ?? 0) + 1);
  }
  return days.map((d) => map.get(d) ?? 0);
}

// ↔ آخر خطأ تحميل (لو فى) — بيظهر للأدمن فى شاشة إدارة الريلز مع زر «إعادة المحاولة» بدل قائمة فاضية بدون تفسير.
let loadError: string | null = null;
export function getAdminLoadError(): string | null { return loadError; }

// ↔ إصلاح «بيانات لوحة التحكم مش بتظهر فى بعض الأحيان وأضطر أقفل التطبيق وأفتحه»:
//   1) سباق الطلبات: كان فى طلب بيتنفّذ وقت تحميل الملف (قبل تسجيل الدخول → نتيجته فاضية بسبب RLS)، ولو خلص *بعد* طلب الأدمن الصحيح
//      كان بيكتب فوق البيانات الصحيحة بقائمة فاضية. دلوقتي كل نداء له رقم تسلسلى (fetchSeq) والأحدث بس هو اللى يحفظ نتيجته،
//      والنداء وقت تحميل الملف اتشال خالص (اللوحة بتنده refetchAdminDB() أول ما تتفتح بجلسة الأدمن).
//   2) كل جزء بمهلة 20 ثانية بدل ما يتعلّق للأبد.
//   3) لو فشل أى جزء بنعيد المحاولة تلقائيًا (3 مرات: بعد 2.5 ثم 5 ثم 7.5 ثانية) طالما فى مستخدم مسجَّل، والشاشة بتعرض حالة
//      التحميل/الخطأ مع زر «إعادة المحاولة» (useAdminDBStatus).
const SECTION_TIMEOUT_MS = 20_000;
const MAX_AUTO_RETRIES = 3;
let fetchSeq = 0;
let retryAttempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export type AdminDBStatus = { loading: boolean; error: string | null };
let status: AdminDBStatus = { loading: false, error: null };
const statusListeners = new Set<() => void>();
function setStatus(next: AdminDBStatus) {
  if (status.loading === next.loading && status.error === next.error) return;
  status = next;
  statusListeners.forEach((l) => l());
}
function subscribeStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}
export function useAdminDBStatus(): AdminDBStatus {
  return useSyncExternalStore(subscribeStatus, () => status);
}

async function refetchAll() {
  const seq = ++fetchSeq;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  setStatus({ loading: true, error: status.error });

  // ↔ كل جزء بيتحمّل لوحده: فشل جزء (مثلًا المستخدمين أو التقارير) ما يمسحش الريلز من الشاشة. قبل كده Promise.all كان بيرمى
  //   عند أول فشل فيفضل `db` فاضي والأدمن يشوف «لا يوجد ريلز».
  const errors: string[] = [];
  const next = { ...db };
  try {
    // Runs first because it populates the module-level sellerAgg map that fetchUsers() reads from.
    const { reels, cityStats, analyticsBase } = await withTimeout(fetchReelsAndCityStats(), SECTION_TIMEOUT_MS, "admin-reels");
    next.reels = reels;
    next.cityStats = cityStats;
    next.analytics = { ...next.analytics, ...analyticsBase };
  } catch (err) {
    console.warn("Failed to load admin reels:", err);
    errors.push(`الريلز: ${err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)}`);
  }
  const [lives, reports, users, features, dailySignups] = await Promise.allSettled([
    withTimeout(fetchLives(), SECTION_TIMEOUT_MS, "admin-lives"),
    withTimeout(fetchReports(), SECTION_TIMEOUT_MS, "admin-reports"),
    withTimeout(fetchUsers(), SECTION_TIMEOUT_MS, "admin-users"),
    withTimeout(fetchFeatures(), SECTION_TIMEOUT_MS, "admin-features"),
    withTimeout(fetchDailySignups(), SECTION_TIMEOUT_MS, "admin-signups"),
  ]);

  // نداء أحدث بدأ أثناء ما كنا بنحمّل — هو اللى هيحفظ النتيجة (ونتفادى الكتابة فوقه ببيانات أقدم).
  if (seq !== fetchSeq) return;

  if (lives.status === "fulfilled") next.lives = lives.value; else errors.push("البث المباشر");
  if (reports.status === "fulfilled") next.reports = reports.value; else errors.push("البلاغات");
  if (users.status === "fulfilled") next.users = users.value; else errors.push("المستخدمون");
  if (features.status === "fulfilled") next.features = features.value; else errors.push("الميزات");
  if (dailySignups.status === "fulfilled") next.analytics = { ...next.analytics, dailySignups: dailySignups.value }; else errors.push("إحصاءات التسجيل");
  for (const r of [lives, reports, users, features, dailySignups]) {
    if (r.status === "rejected") console.warn("Failed to load an admin dashboard section:", r.reason);
  }
  db = next;
  loadError = errors.length ? errors.join(" | ") : null;
  loaded = true;
  emit();
  setStatus({ loading: false, error: loadError });

  if (errors.length && retryAttempt < MAX_AUTO_RETRIES && getAuthSnapshot().user) {
    retryAttempt += 1;
    retryTimer = setTimeout(() => { retryTimer = null; void refetchAll(); }, 2500 * retryAttempt);
  } else if (!errors.length) {
    retryAttempt = 0;
  }
}

// ↔ التحميل الأول وقت تشغيل التطبيق (فوق) بيتم قبل تسجيل الدخول غالبًا، فصفحات لوحة الأدمن كانت بتفضل فاضية
// لحد أول تعديل. لوحة الأدمن بتنده الدالة دى لما تتفتح (وهى أدمن فعلًا) فالبيانات تتحمّل بجلسة الأدمن.
export function refetchAdminDB(): Promise<void> {
  retryAttempt = 0; // محاولة يدوية/فتح اللوحة = نبدأ عدّاد إعادة المحاولة التلقائية من الأول
  return refetchAll();
}

// ↔ called from signOut() (lib/hooks/useAuth.ts) — db/sellerAgg are
// module-level, not React Query, so they survive a sign-out on their own
// otherwise (see lib/queryClient.ts's header comment for the full
// reasoning). Resetting to EMPTY_DB rather than leaving stale admin data
// resident in memory for whoever uses the app next on this device.
export function resetAdminDB() {
  fetchSeq += 1; // أى طلب لسه شغّال من الجلسة السابقة ما يكتبش نتيجته
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  retryAttempt = 0;
  loadError = null;
  setStatus({ loading: false, error: null });
  db = EMPTY_DB;
  loaded = false;
  sellerAgg = new Map();
  emit();
}

// ---------------------------------------------------------------------
// Mutations — same function signatures as the old mock-DB version, now
// backed by real writes + a full refetch so every admin screen (and every
// admin viewing at once) stays in sync.
// ---------------------------------------------------------------------

// ↔ setReel()
// ↔ قرار الأدمن على ريلز (قبول/رفض). بيرجّع نجاح/فشل فعلى (كان بيبلع الخطأ ويظهر «تم» دايمًا). triggers الخادم بتبعت إشعار للمعلن
//   (20261019000000_reel_approval.sql) والسبب (للرفض) بيظهر على كارت إعلانه.
export async function setReelStatus(id: string, status: ReelStatus, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const patch: { moderation_status: ReelStatus; moderation_reason?: string | null } = { moderation_status: status };
  if (status === "rejected") patch.moderation_reason = reason?.trim() || null;
  const { data, error } = await supabase.from("properties").update(patch).eq("id", id).select("id");
  if (error) { console.warn("setReelStatus failed:", error); return { ok: false, error: error.message }; }
  // RLS ممكن تمنع التعديل بدون خطأ (0 صف) — لو ما اتعدّلش حاجة نعتبرها فشل صلاحيات.
  if (!data || data.length === 0) return { ok: false, error: "لا تملك صلاحية تعديل هذا الإعلان (قسم إدارة الريلز)" };
  await refetchAll();
  return { ok: true };
}
// ↔ delReel()
// ↔ حذف الأدمن لريلز غير مناسب: الدالة على الخادم (admin_delete_reel) بتتحقق من صلاحية reels وبتبعت إشعارًا للمعلن بالسبب
//   قبل الحذف. بيرجّع نجاح/فشل فعلى.
export async function deleteReel(id: string, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("admin_delete_reel", { p_property_id: id, p_reason: reason?.trim() || undefined });
  if (error) { console.warn("deleteReel failed:", error); return { ok: false, error: error.message }; }
  await refetchAll();
  return { ok: true };
}
// ↔ setLive()
export async function setLiveStatus(id: string, status: LiveStatus) {
  const { error } = await supabase.from("lives").update({ moderation_status: status }).eq("id", id);
  if (error) { console.warn("setLiveStatus failed:", error); return; }
  await refetchAll();
}
// ↔ delLive()
export async function deleteLive(id: string) {
  const { error } = await supabase.from("lives").delete().eq("id", id);
  if (error) { console.warn("deleteLive failed:", error); return; }
  await refetchAll();
}
// ↔ "حذف المحتوى" in the support center's reports tab, for a
// target_type = 'request' report — requests never had an admin delete
// path before 20260815000000_support_center.sql added one.
export async function deleteRequest(id: string) {
  const { error } = await supabase.from("requests").delete().eq("id", id);
  if (error) { console.warn("deleteRequest failed:", error); return; }
}
// ↔ the reports page's implicit "resolve" action (dismiss after action taken)
// ↔ رد المشرف على بلاغ: بيوصل لكل من أبلغ عن نفس المحتوى كإشعار «رد الإدارة» (admin_reply_to_report).
export async function replyToReport(id: string, text: string): Promise<{ ok: boolean; notified?: number; error?: string }> {
  const { data, error } = await supabase.rpc("admin_reply_to_report", { p_report_id: id, p_text: text });
  if (error) { console.warn("replyToReport failed:", error); return { ok: false, error: error.message }; }
  await refetchAll();
  return { ok: true, notified: Number(data ?? 0) };
}
export async function resolveReport(id: string) {
  const { error } = await supabase.from("reports").delete().eq("id", id);
  if (error) { console.warn("resolveReport failed:", error); return; }
  await refetchAll();
}
export async function toggleUserActive(id: string) {
  const current = db.users.find((u) => u.id === id);
  const { error } = await supabase
    .from("user_permissions")
    .upsert({ user_id: id, active: !(current?.active ?? true) }, { onConflict: "user_id" });
  if (error) { console.warn("toggleUserActive failed:", error); return; }
  await refetchAll();
}
export async function toggleUserPerm(id: string, perm: keyof AdminUser["perms"]) {
  const current = db.users.find((u) => u.id === id);
  const newValue = !(current?.perms[perm] ?? true);

  const payload: {
    user_id: string;
    publish_reels?: boolean;
    live?: boolean;
    paid_ads?: boolean;
    direct_wa?: boolean;
  } = { user_id: id };

  if (perm === "publishReels") payload.publish_reels = newValue;
  if (perm === "live") payload.live = newValue;
  if (perm === "paidAds") payload.paid_ads = newValue;
  if (perm === "directWa") payload.direct_wa = newValue;

  const { error } = await supabase
    .from("user_permissions")
    .upsert(payload, { onConflict: "user_id" });

  if (error) { console.warn("toggleUserPerm failed:", error); return; }
  await refetchAll();
}
export async function toggleFeature(key: string) {
  const current = db.features.find((f) => f.key === key);
  const { error } = await supabase.from("feature_flags").update({ enabled: !(current?.on ?? true) }).eq("key", key);
  if (error) { console.warn("toggleFeature failed:", error); return; }
  // ↔ الـ flags على جهاز الأدمن نفسه متخزّنة فى كاش React Query (useFeatureFlags)
  // — من غير الـ invalidate ده الأدمن كان هيفضل شايف الأزرار (أو مش شايفها)
  // لحد 30 ثانية بعد ما يبدّل المفتاح. باقي المستخدمين بيتحدّثوا تلقائيًا
  // بالـ refetchInterval.
  queryClient.invalidateQueries({ queryKey: ["featureFlags"] });
  await refetchAll();
}

export function useAdminDB() {
  return useSyncExternalStore(subscribe, getSnapshot);
}