import { requestOwnMediaCleanup } from "../mediaCleanupClient";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { Property, MediaItem, Purpose } from "../types";
import { demoProperties, isUuid } from "../demoData";
import { ilikeContains, pgrstQuote } from "../postgrestFilter";
import { PROVINCES } from "../../data/locations";
import { Database, Json } from "../../src/types/supabase";

type ProfileRowPublic = { id: string; full_name: string | null; avatar_url: string | null; verified: boolean };

type PropertyRowBase = {
  id: string; seller_id: string; purpose: Purpose; type: string; title: string; short_title: string | null;
  province: string; location: string; lat: number | null; lng: number | null; price: number; area: number;
  rooms: number; baths: number; reception: number; floor: number | null; payment: string | null;
  negotiable: boolean | null; finish_type: string | null; status: string | null; delivery_date: string | null;
  features: string[]; description: string; media: MediaItem[]; cover_image: string | null; music: string | null;
  captions_ar: string | null; captions_en: string | null;
  pinned: boolean; pinned_at: string | null; moderation_status?: string | null; moderation_reason?: string | null; published_at?: string | null; rights_declared_at?: string | null; closed_type?: string | null; is_active?: boolean | null; comment_count?: number | null; likes: number; saves: number; views: number; chats: number;
  created_at: string; share_platforms: string[] | null;
};
type PropertyRow = PropertyRowBase & { profiles: ProfileRowPublic | null };

// ↔ profile هنا دايمًا من profiles_public دلوقتي (سواء الكارت أو صفحة
// التفاصيل) — من غير phone_e164/bio عن قصد (PII)، شوف الكومنت فوق
// SELECT_DETAIL. رقم الهاتف بييجي بشكل منفصل عبر useSellerContactPhone.
function rowToProperty(row: PropertyRow): Property {
  const profile = row.profiles;
  return {
    id: row.id,
    purpose: row.purpose,
    type: row.type,
    title: row.title,
    shortTitle: row.short_title ?? undefined,
    province: row.province,
    location: row.location,
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    price: Number(row.price),
    area: Number(row.area),
    rooms: row.rooms,
    baths: row.baths,
    reception: row.reception,
    floor: row.floor ?? undefined,
    payment: (row.payment as "cash" | "installment") ?? undefined,
    negotiable: row.negotiable ?? undefined,
    finishType: row.finish_type ?? undefined,
    status: (row.status as "ready" | "building") ?? undefined,
    deliveryDate: row.delivery_date ?? undefined,
    features: row.features || [],
    description: row.description || "",
    media: row.media || [],
    coverImage: row.cover_image,
    music: row.music,
    captionsAr: row.captions_ar,
    captionsEn: row.captions_en,
    pinned: row.pinned,
    pinnedAt: row.pinned_at ? new Date(row.pinned_at).getTime() : undefined,
    moderationStatus: (row.moderation_status as Property["moderationStatus"]) ?? undefined,
    moderationReason: row.moderation_reason ?? undefined,
    publishedAt: row.published_at ? new Date(row.published_at).getTime() : undefined,
    closedType: row.closed_type === "sold" || row.closed_type === "rented" ? row.closed_type : undefined,
    isActive: row.is_active === false ? false : undefined,
    rightsDeclaredAt: row.rights_declared_at ?? undefined,
    createdAtRaw: row.created_at,
    sharePlatforms: row.share_platforms || [],
    likes: row.likes, saves: row.saves, views: row.views, chats: row.chats, comments: row.comment_count ?? 0,
    createdAt: new Date(row.created_at).getTime(),
    seller: {
      id: row.seller_id,
      name: profile?.full_name || "مستخدم Shahir",
      initial: (profile?.full_name || "د").charAt(0),
      verified: profile?.verified || false,
      avatarUrl: profile?.avatar_url ?? null,
      listings: 0,
      followers: 0,
      // ↔ لا bio ولا phone_e164 فى profiles_public عن قصد (PII، شوف
      // الكومنت فوق SELECT_DETAIL) — رقم الهاتف الفعلى بييجي منفصل عبر
      // useSellerContactPhone عند الحاجة له فعليًا (شريط CTA).
      bio: "",
      phone: "",
    },
  };
}

// ↔ D4: كان `select *` (كل أعمدة الجدول) رغم أن كل الشاشات بتستهلك كائن Property الناتج من rowToProperty فقط — فالأعمدة المطلوبة هى
//   بالظبط المذكورة فى PropertyRowBase (لا أحد يقرأ صفوفًا خامًا خارج هذا الملف). نحدّدها صراحةً (بدون wa_clicks/closed_at/أعمدة داخلية…).
//   حماية: لو عمود غير موجود فى قاعدة بيانات (migration لم تُطبَّق) يرجع الاستعلام تلقائيًا إلى `*` مرة واحدة (runPropertyQuery) فلا تتعطل الشاشات.
const PROPERTY_COLUMNS =
  "id, seller_id, purpose, type, title, short_title, province, location, lat, lng, price, area, rooms, baths, reception, floor, payment, " +
  "negotiable, finish_type, status, delivery_date, features, description, media, cover_image, music, captions_ar, captions_en, " +
  "pinned, pinned_at, moderation_status, moderation_reason, published_at, rights_declared_at, closed_type, is_active, comment_count, " +
  "likes, saves, views, chats, created_at, share_platforms";
const PROFILE_JOIN = "profiles_public!seller_id(id, full_name, avatar_url, verified)";
const SELECT_NARROW = `${PROPERTY_COLUMNS}, ${PROFILE_JOIN}`;
const SELECT_ALL = `*, ${PROFILE_JOIN}`;
let propertySelect = SELECT_NARROW;

async function runPropertyQuery(
  build: (select: string) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
): Promise<{ data: unknown; error: { code?: string; message?: string } | null }> {
  let res = await build(propertySelect);
  if (res.error && propertySelect !== SELECT_ALL && (res.error.code === "42703" || /column .* does not exist/i.test(res.error.message ?? ""))) {
    console.warn("properties column list out of date for this database; falling back to select * —", res.error.message);
    propertySelect = SELECT_ALL;
    res = await build(propertySelect);
  }
  return res;
}
// ↔ BUG FIX (الشاشة البيضاء فى تفاصيل العقار): كانت هذه تقرأ من
// public.profiles مباشرة (الجدول الحقيقى المقيّد بسياسة RLS بعد
// 20260825000000_profile_privacy_rls.sql — لا يظهر إلا لصاحب الحساب
// نفسه، أو لو is_public=true، أو لطرف محادثة معه، أو للأدمن). أى زائر
// يفتح تفاصيل عقار لبائع عادى (وهو الغالبية) كانت بيانات profiles
// المرتبطة (الاسم، التوثيق...) ترجع محجوبة. كل نقاط القراءة الأخرى فى
// المشروع كانت اتصلحت لاستخدام profiles_public!fkey (الفيو العام الآمن)
// فى نفس الميجريشن، وهذه النقطة فقط كانت ناقصة. رقم الهاتف نفسه (PII)
// مش موجود أصلًا فى profiles_public عن قصد — بيتجاب دلوقتي بشكل منفصل
// وآمن عبر get_property_contact_phone() (شوف useSellerContactPhone تحت
// وميجريشن 20260901000000_property_contact_phone.sql).

// ↔ الإعلان «غير النشط» لا يظهر فى القوائم العامة (بحث/ريلز/خريطة/مفضلة...) حتى لصاحبه (الذى تسمح له RLS برؤية إعلاناته)؛ يظهر فقط فى «إعلاناتي».
//   لغير صاحبه تُخفيه سياسة RLS أصلًا — هذا الفلتر هو الطبقة الثانية (وهو الذى يعمل لو الـ migration لم تُطبَّق بعد فلا يوجد العمود).
const isListed = (p: Property) => p.isActive !== false;

async function fetchProperties(): Promise<Property[]> {
  // ↔ الإعلان المُغلق بصفقة (تم البيع / تم الإيجار) لا يظهر فى الريلز: يبقى فقط فى إدارة الحساب وصفحة المعلن.
  const { data, error } = await runPropertyQuery((sel) => supabase.from("properties").select(sel).is("closed_at", null).order("created_at", { ascending: false }).limit(300));
  if (error) throw error;
  return (data as unknown as PropertyRow[]).map(rowToProperty).filter(isListed);
}

async function fetchPropertiesBySeller(sellerId: string): Promise<Property[]> {
  if (!isUuid(sellerId)) return []; // بائعو العرض التجريبى (ids غير UUID) لا يُرسلون لعمود uuid
  const { data, error } = await runPropertyQuery((sel) => supabase.from("properties").select(sel).eq("seller_id", sellerId).order("created_at", { ascending: false }));
  if (error) throw error;
  return (data as unknown as PropertyRow[]).map(rowToProperty);
}

async function fetchPropertyDetail(id: string): Promise<Property | null> {
  if (!isUuid(id)) return null; // B5: معرّفات غير UUID (مثل p1) لا تُرسل لعمود uuid؛ الصفحة تعرض «غير متاح»
  const { data, error } = await runPropertyQuery((sel) => supabase.from("properties").select(sel).eq("id", id).maybeSingle());
  if (error) throw error;
  if (!data) return null;
  return rowToProperty(data as unknown as PropertyRow);
}

const PAGE_SIZE = 20;

export type PropertyPageFilters = {
  purpose?: Purpose | "all";
  type?: string;
  provinces?: string[];
  regions?: string[];
  priceMin?: number;
  priceMax?: number;
  areaMin?: number;
  areaMax?: number;
  minRooms?: number;
  query?: string;
};

// ↔ B10: ترقيم بمؤشر (created_at, id) بدل range(offset): إضافة إعلان جديد أثناء التمرير كانت تزيح الصفحات فتتكرر عناصر بين الصفحات.
type PageCursor = { createdAt: string; id: string } | null;

async function fetchPropertiesPage(filters: PropertyPageFilters, cursor: PageCursor): Promise<Property[]> {
  const buildPage = (sel: string) => {
  // ↔ البحث لا يُرجع الإعلانات المُغلقة بصفقة (تم البيع / تم الإيجار).
  let q = supabase.from("properties").select(sel).is("closed_at", null)
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  if (cursor) {
    const c = pgrstQuote(cursor.createdAt);
    q = q.or(`created_at.lt.${c},and(created_at.eq.${c},id.lt.${cursor.id})`);
  }

  if (filters.purpose && filters.purpose !== "all") q = q.eq("purpose", filters.purpose);
  if (filters.type && filters.type !== "all") q = q.eq("type", filters.type);
  if (filters.provinces?.length) {
    const known = filters.provinces.filter((p) => PROVINCES.includes(p));
    const custom = filters.provinces.filter((p) => !PROVINCES.includes(p));
    if (custom.length) {
      // ↔ #3: محافظة "مخصّصة" اتضافت من مودال الفلتر (لسه ماوصلتش لعتبة
      // الـ 3 محاولات أو الاسم مش مطابق حرفيًا لأي قيمة مخزّنة فى العمود)
      // — .in() المطابقة الحرفية مش هتلاقيها أبدًا. بنستخدم ilike بدل
      // كده على province/location عشان "سيتم البحث فى كل الأحوال عن
      // المنطقة المطلوبة" يتحقق فعليًا، مهما كان الاسم المخزّن مطابق
      // بالظبط ولا لأ.
      const orParts: string[] = [];
      if (known.length) orParts.push(`province.in.(${known.map(pgrstQuote).join(",")})`);
      for (const c of custom) {
        const like = ilikeContains(c);
        if (!like) continue;
        orParts.push(`province.ilike.${like}`, `location.ilike.${like}`);
      }
      if (orParts.length) q = q.or(orParts.join(","));
    } else {
      q = q.in("province", known);
    }
  }
  if (filters.regions?.length) q = q.in("location", filters.regions);
  if (filters.priceMin) q = q.gte("price", filters.priceMin);
  if (filters.priceMax != null && Number.isFinite(filters.priceMax)) q = q.lte("price", filters.priceMax);
  if (filters.areaMin) q = q.gte("area", filters.areaMin);
  if (filters.areaMax != null && Number.isFinite(filters.areaMax)) q = q.lte("area", filters.areaMax);
  if (filters.minRooms) q = q.gte("rooms", filters.minRooms);
  // ↔ B8: القيمة مقتبسة ومهرّبة (lib/postgrestFilter.ts) فالأقواس والعلامات لا تكسر الفلتر؛ وفهارس pg_trgm (migration 20261111000000) تسرّع ilike.
  const like = filters.query ? ilikeContains(filters.query) : null;
  if (like) {
    q = q.or(`title.ilike.${like},location.ilike.${like},type.ilike.${like},description.ilike.${like},province.ilike.${like}`);
  }

  return q.limit(PAGE_SIZE);
  };
  const { data, error } = await runPropertyQuery(buildPage);
  if (error) throw error;
  return (data as unknown as PropertyRow[]).map(rowToProperty).filter(isListed);
}

// ↔ إزالة التكرار بالـ id عند دمج الصفحات (حماية إضافية للمؤشر ولتحديثات الكاش المتفائلة) — يحافظ على أول ظهور وعلى شكل pages.
export function dedupePages<T extends { id: string }>(data: { pages: T[][]; pageParams: unknown[] }): { pages: T[][]; pageParams: unknown[] } {
  const seen = new Set<string>();
  return {
    ...data,
    pages: data.pages.map((page) => page.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))),
  };
}

export function usePaginatedProperties(filters: PropertyPageFilters) {
  return useInfiniteQuery({
    queryKey: ["properties", "paginated", filters],
    queryFn: ({ pageParam }) => fetchPropertiesPage(filters, pageParam as PageCursor),
    initialPageParam: null as PageCursor,
    getNextPageParam: (lastPage): PageCursor | undefined => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      const last = lastPage[lastPage.length - 1];
      return last?.createdAtRaw ? { createdAt: last.createdAtRaw, id: last.id } : undefined;
    },
    select: dedupePages,
    staleTime: 15_000,
  });
}

export function usePropertiesByIds(ids: string[]) {
  const key = [...ids].sort().join(",");
  return useQuery({
    queryKey: ["properties", "byIds", key],
    queryFn: async (): Promise<Property[]> => {
      if (!ids.length) return [];
      const { data, error } = await runPropertyQuery((sel) => supabase.from("properties").select(sel).in("id", ids));
      if (error) throw error;
      return (data as unknown as PropertyRow[]).map(rowToProperty).filter(isListed);
    },
    enabled: ids.length > 0,
    staleTime: 30_000,
  });
}

async function fetchPropertiesPreservingOrder(ids: string[]): Promise<Property[]> {
  if (!ids.length) return [];
  const { data, error } = await runPropertyQuery((sel) => supabase.from("properties").select(sel).in("id", ids));
  if (error) throw error;
  const byId = new Map((data as unknown as PropertyRow[]).map((r) => [r.id, rowToProperty(r)] as const).filter(([, p]) => isListed(p)));
  return ids.map((id) => byId.get(id)).filter((p): p is Property => !!p);
}

export type GeoFilters = Omit<PropertyPageFilters, "provinces" | "regions"> & {
  provinces?: string[]; regions?: string[];
};

function geoFilterArgs(filters: GeoFilters) {
  return {
    p_purpose: filters.purpose && filters.purpose !== "all" ? filters.purpose : undefined,
    p_type: filters.type && filters.type !== "all" ? filters.type : undefined,
    p_provinces: filters.provinces?.length ? filters.provinces : undefined,
    p_regions: filters.regions?.length ? filters.regions : undefined,
    p_price_min: filters.priceMin || undefined,
    p_price_max: filters.priceMax != null && Number.isFinite(filters.priceMax) ? filters.priceMax : undefined,
    p_area_min: filters.areaMin || undefined,
    p_area_max: filters.areaMax != null && Number.isFinite(filters.areaMax) ? filters.areaMax : undefined,
    p_min_rooms: filters.minRooms || undefined,
    // ↔ B8: الخادم يهرّب محارف LIKE بنفسه (public.escape_like — migration 20261111000000) فلا نحذف منها شيئًا من العميل (فقط حد الطول).
    p_query: filters.query?.trim() ? filters.query.trim().slice(0, 100) : undefined,
  };
}

export function usePropertiesInRadius(filters: GeoFilters, center: { lat: number; lng: number; radiusKm: number } | null) {
  return useInfiniteQuery({
    queryKey: ["properties", "radius", center, filters],
    queryFn: async ({ pageParam }): Promise<Property[]> => {
      if (!center) return [];
      const { data, error } = await supabase.rpc("properties_in_radius", {
        center_lat: center.lat, center_lng: center.lng, radius_km: center.radiusKm,
        ...geoFilterArgs(filters),
        p_limit: PAGE_SIZE, p_offset: (pageParam as number) * PAGE_SIZE,
      });
      if (error) throw error;
      const ids = (data as { id: string }[]).map((r) => r.id);
      return fetchPropertiesPreservingOrder(ids);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.length < PAGE_SIZE ? undefined : allPages.length),
    select: dedupePages,
    enabled: !!center,
    staleTime: 15_000,
  });
}

// ↔ B9: بحث المضلع كان يمرّر purpose وtype فقط (بلا سعر/مساحة/غرف/محافظات/نص) ويقطع عند 500 بصمت. الآن كل الفلاتر النشطة تُمرَّر للدالة
//   (properties_in_bounds الجديدة — migration 20261111000000)، ويُرجَّع truncated=true لو وُجد أكثر من 500 ليُنبَّه المستخدم.
export const BOUNDS_LIMIT = 500;

export function usePropertiesInBounds(
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null,
  filters: GeoFilters
) {
  return useQuery({
    queryKey: ["properties", "bounds", bounds, filters],
    queryFn: async (): Promise<{ items: Property[]; truncated: boolean }> => {
      if (!bounds) return { items: [], truncated: false };
      const { data, error } = await supabase.rpc("properties_in_bounds", {
        min_lat: bounds.minLat, max_lat: bounds.maxLat, min_lng: bounds.minLng, max_lng: bounds.maxLng,
        ...geoFilterArgs(filters),
        p_limit: BOUNDS_LIMIT + 1, // صف زيادة لنعرف هل هناك المزيد
      });
      if (error) throw error;
      const all = (data as { id: string }[]).map((r) => r.id);
      const truncated = all.length > BOUNDS_LIMIT;
      return { items: await fetchPropertiesPreservingOrder(all.slice(0, BOUNDS_LIMIT)), truncated };
    },
    enabled: !!bounds,
    staleTime: 15_000,
  });
}

// ⚠ لم يعد مستخدمًا فى أى شاشة (الريلز بتستخدم usePaginatedProperties، والمفضّلة usePropertiesByIds، والإعلان الواحد
//   usePropertyDetail). متروك للتوافق فقط — لا تستدعيه فى شاشة جديدة: بيحمّل 300 صف (select *) كل مرة.
export function useProperties() {
  const query = useQuery({ queryKey: ["properties"], queryFn: fetchProperties, staleTime: 30_000 });
  const all = [...(query.data ?? []), ...demoProperties];
  return { ...query, properties: all };
}

// ↔ كان بيحمّل أحدث 300 إعلان (select *) كلهم عشان يلاقى إعلان واحد (شاشة المحادثة + تعديل الإعلان). دلوقتى بيطلب الإعلان
//   نفسه فقط (usePropertyDetail) — ويحتفظ بنفس الشكل (Property | undefined) ونفس الرجوع لبيانات العرض التجريبى.
export function usePropertyById(id: string | undefined) {
  const { data } = usePropertyDetail(id);
  return data;
}

export function usePropertyDetail(id: string | undefined) {
  const query = useQuery({
    queryKey: ["properties", "detail", id],
    queryFn: () => fetchPropertyDetail(id!),
    enabled: !!id,
    staleTime: 15_000,
  });
  const demoFallback = query.data == null && !query.isLoading ? demoProperties.find((p) => p.id === id) : undefined;
  return { ...query, data: query.data ?? demoFallback ?? undefined };
}

// ↔ يستدعى get_property_contact_phone() (SECURITY DEFINER) بدل قراءة
// profiles.phone_e164 مباشرة، عشان يفضل بيرجع رقم البائع لأى زائر يشوف
// إعلانه — طالما فعّل show_whatsapp أو show_call_button — من غير ما
// نضطر نفتح سياسة RLS العامة لجدول profiles نفسه. يترجع null لو الرقم
// مش متاح (البائع قافل الزرين، أو مفيش رقم مسجل أصلًا) فتختفي الأزرار
// المرتبطة تلقائيًا (نفس سلوك property.seller.phone الفاضي قبل كده).
export function useSellerContactPhone(propertyId: string | undefined) {
  return useQuery({
    queryKey: ["properties", "contactPhone", propertyId],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.rpc("get_property_contact_phone", { p_property_id: propertyId! });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
    enabled: !!propertyId,
    staleTime: 60_000,
  });
}

// ↔ أقصى عدد إعلانات مثبّتة لكل معلن (بتظهر أول صفحة المعلن) — مفروض كمان على
// الخادم بـ trigger (20261007000001_limit_pinned_properties.sql).
export const MAX_PINNED_PROPERTIES = 3;

// ↔ «إعلاناتي» لازم تعكس الحالة الحقيقية فى كل مرة تتفتح: staleTime 0 +
// refetchOnMount "always" (قبل كده 10 ثوانى كاش كانت ممكن تخلّى إعلان لسه
// منشور ما يظهرش لو الشاشة اتفتحت بسرعة).
// ↔ includeInactive=false فى صفحة المعلن (لا تعرض الإعلانات «غير النشطة» حتى لصاحبها)؛ الافتراضى true لإدارة الحساب وتعديل الإعلان.
export function useMyProperties(sellerId: string | undefined, options?: { includeInactive?: boolean }) {
  const includeInactive = options?.includeInactive !== false;
  return useQuery({
    queryKey: ["properties", "bySeller", sellerId, includeInactive ? "all" : "listed"],
    queryFn: async () => {
      const all = await fetchPropertiesBySeller(sellerId!);
      return includeInactive ? all : all.filter(isListed);
    },
    enabled: !!sellerId,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export type CreatePropertyInput = Omit<Property, "id" | "createdAt" | "likes" | "saves" | "views" | "chats" | "seller" | "pinned" | "pinnedAt" | "closedType" | "comments"> & {
  sellerId: string;
  // ↔ وقت إقرار ملكية حقوق الوسائط عند النشر (properties.rights_declared_at).
  rightsDeclaredAt?: string;
};

export function useCreateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePropertyInput) => {
      const payload: Database["public"]["Tables"]["properties"]["Insert"] = {
        seller_id: input.sellerId,
        purpose: input.purpose,
        type: input.type,
        title: input.title,
        short_title: input.shortTitle,
        province: input.province,
        location: input.location,
        lat: input.lat,
        lng: input.lng,
        price: input.price,
        area: input.area,
        rooms: input.rooms,
        baths: input.baths,
        reception: input.reception,
        floor: input.floor,
        payment: input.payment,
        negotiable: input.negotiable,
        finish_type: input.finishType,
        status: input.status,
        delivery_date: input.deliveryDate,
        features: input.features,
        description: input.description,
        // ↔ #3: نفس منطق useDrafts.ts — MediaItem[] مش Json نوعيًا رغم إنها
        // JSON-safe فعليًا وقت التشغيل، فالتحويل مضبوط على الحقل ده بس.
        media: input.media as unknown as Json,
        cover_image: input.coverImage,
        music: input.music,
        share_platforms: input.sharePlatforms || [],
        // ↔ حالة الإعلان الجديد (pending/approved) بيحددها الخادم (trigger فى 20261019000000_reel_approval.sql) حسب مفتاح
        //   «اشتراط موافقة الأدمن قبل النشر»: العميل ما بيقدرش يبعت approved لنفسه. لو الـ migration لسه ما اتطبقتش الافتراضى approved.
        rights_declared_at: input.rightsDeclaredAt ?? null,
      };
      // ↔ payload معرّف فوق بنوع Insert بالظبط، فمفيش داعي لـ as any هنا.
      const { data, error } = await supabase.from("properties").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      // ↔ الإعلان الجديد بيتحط فى كاش «إعلاناتي» فورًا (قبل ما إعادة الجلب تخلص)
      // فيظهر مباشرة بعد النشر — وبعدها الجلب الحقيقى من الخادم يصحّح أى فرق.
      try {
        const created = rowToProperty({ ...(data as unknown as PropertyRowBase), profiles: null });
        qc.setQueryData<Property[]>(["properties", "bySeller", created.seller.id, "all"], (old) => [
          created,
          ...(old ?? []).filter((p) => p.id !== created.id),
        ]);
      } catch (err) {
        console.warn("Failed to seed my-ads cache:", err);
      }
      await qc.invalidateQueries({ queryKey: ["properties"] });
    },
  });
}

export function useUpdateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<CreatePropertyInput> }) => {
      // ↔ #3: كان Record<string, unknown> (نوع عام تمامًا) ثم as any وقت
      // الإرسال — استبدلته بنوع Update الحقيقى من قاعدة البيانات، فـ TS
      // بقى يتأكد فعليًا إن كل حقل بيتحط صح (اسم العمود ونوعه) من غير
      // الحاجة لـ any خالص.
      const row: Database["public"]["Tables"]["properties"]["Update"] = {};
      if (patch.purpose !== undefined) row.purpose = patch.purpose;
      if (patch.type !== undefined) row.type = patch.type;
      if (patch.title !== undefined) row.title = patch.title;
      if (patch.shortTitle !== undefined) row.short_title = patch.shortTitle;
      if (patch.province !== undefined) row.province = patch.province;
      if (patch.location !== undefined) row.location = patch.location;
      // ↔ B7: الإحداثيات كانت لا تُكتب أبدًا عند التعديل (يبقى الدبوس قديمًا بعد تغيير العنوان). شاشة النشر ترسلها فقط لو العنوان تغيّر ونجح
      //   التحديد؛ فلو لم يتغيّر العنوان أو فشل التحديد تكون undefined ولا نمسح الإحداثيات القديمة.
      if (patch.lat !== undefined) row.lat = patch.lat;
      if (patch.lng !== undefined) row.lng = patch.lng;
      if (patch.price !== undefined) row.price = patch.price;
      if (patch.area !== undefined) row.area = patch.area;
      if (patch.rooms !== undefined) row.rooms = patch.rooms;
      if (patch.baths !== undefined) row.baths = patch.baths;
      if (patch.reception !== undefined) row.reception = patch.reception;
      if (patch.floor !== undefined) row.floor = patch.floor;
      if (patch.payment !== undefined) row.payment = patch.payment;
      if (patch.negotiable !== undefined) row.negotiable = patch.negotiable;
      if (patch.finishType !== undefined) row.finish_type = patch.finishType;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.deliveryDate !== undefined) row.delivery_date = patch.deliveryDate;
      if (patch.features !== undefined) row.features = patch.features;
      if (patch.description !== undefined) row.description = patch.description;
      if (patch.media !== undefined) row.media = patch.media as unknown as Json;
      if (patch.coverImage !== undefined) row.cover_image = patch.coverImage;
      if (patch.music !== undefined) row.music = patch.music;
      if (patch.sharePlatforms !== undefined) row.share_platforms = patch.sharePlatforms;
      // ↔ إقرار ملكية الحقوق: يُرسَل فقط عند أول إقرار (إعلان قديم بلا إقرار). لو سُجّل إقرار سابقًا لا نرسل شيئًا، والخادم
      //   (trigger properties_rights_declared_once) يثبّت التاريخ الأصلى ويستبدل الوقت المرسَل بوقته — فلا يُمحى بالتعديلات.
      if (patch.rightsDeclaredAt !== undefined) row.rights_declared_at = patch.rightsDeclaredAt;
      row.updated_at = new Date().toISOString();

      const { data, error } = await supabase.from("properties").update(row).eq("id", id).select("moderation_status").maybeSingle();
      if (error) throw error;
      // بيرجّع حالة المراجعة بعد التعديل (تعديل المحتوى ممكن يعيد الإعلان «قيد المراجعة»).
      return { moderationStatus: (data?.moderation_status ?? null) as string | null };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["properties"] }),
  });
}

export function useDeleteProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // ↔ .select("id") عشان لو RLS منعت الحذف (0 صفوف) ما نعتبرهوش نجح بالغلط.
      const { data, error } = await supabase.from("properties").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("delete_not_applied");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["properties"] });
      qc.invalidateQueries({ queryKey: ["reelQuota"] }); // ↔ الحذف يحرّر مكانًا من حد الريلز فورًا
      requestOwnMediaCleanup(); // ↔ حذف صور/فيديوهات الإعلان من Cloudinary فورًا عبر الخادم (lib/mediaCleanupClient.ts)
    },
  });
}

// ↔ «غير نشط» / «تنشيط الإعلان» (من كارت الإعلان فى إدارة الحساب): يوقف نشر الإعلان فى البحث وصفحة المعلن والريلز أو يعيده.
//   التعديل مسموح لصاحب الإعلان فى أى وقت (حتى بعد نافذة الـ 24 ساعة؛ العمود مستثنى من properties_edit_window_guard — migration 20261122000000).
export function useSetPropertyActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { data, error } = await supabase.from("properties").update({ is_active: active }).eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("toggle_not_applied");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["properties"] }),
  });
}

export function useTogglePinProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const { data, error } = await supabase
        .from("properties")
        .update({ pinned, pinned_at: pinned ? new Date().toISOString() : null })
        .eq("id", id)
        .select("id");
      if (error) {
        // الخادم بيرفض التثبيت الرابع (trigger) برسالة فيها max_pinned.
        if (/max_pinned/i.test(error.message ?? "")) throw new Error("max_pinned");
        throw error;
      }
      if (!data || data.length === 0) throw new Error("pin_not_applied");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["properties"] }),
  });
}