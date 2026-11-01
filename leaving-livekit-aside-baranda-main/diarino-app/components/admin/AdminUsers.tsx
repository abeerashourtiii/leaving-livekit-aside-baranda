import { useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ScrollView, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useIsAdmin } from "../../lib/hooks/useIsAdmin";
import { supabase } from "../../lib/supabase";
import { setAdminRole, adminRoleErrorMessage } from "../../lib/adminRoles";
import { logAndGetSafeMessage } from "../../lib/errors";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { cldThumbnail } from "../../lib/cloudinary";
import { COUNTRIES } from "../../lib/countries";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, AccountType, isAccountType } from "../../lib/accountTypes";

// ↔ شاشة «المستخدمون» فى لوحة الأدمن: قائمة كاملة بكل المستخدمين (مش بس الاسم) مع بحث وفلاتر وتفاصيل كل مستخدم
// + التحكم فى الصلاحيات (نفس تبديلات user_permissions) وترقية/إلغاء المشرف.
// المصدر: الدالة admin_list_users() (migration 20261009000000: البريد وطريقة التسجيل وآخر دخول + إحصائيات).
// قبل تطبيق الـ migration بيشتغل بقراءة بديلة من profiles/properties (من غير البريد وآخر دخول) مع تنبيه.
// البيانات بتتحمّل عند فتح الشاشة (React Query) — مش مرة واحدة وقت تشغيل التطبيق زى المخزن القديم useAdminDB.

type Perms = { publishReels: boolean; live: boolean; paidAds: boolean; directWa: boolean };
type Provider = "google" | "email" | "guest" | "other";

type AdminUserRow = {
  id: string;
  email: string | null;
  provider: Provider;
  createdAt: string | null;
  lastSignInAt: string | null;
  fullName: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  birthDate: string | null;
  gender: string | null;
  nationality: string | null;
  residence: string | null;
  accountType: AccountType | null;
  verified: boolean;
  isPublic: boolean;
  bio: string | null;
  listings: number;
  requests: number | null;
  views: number;
  likes: number;
  followers: number | null;
  isAdminFromRpc: boolean | null;
  active: boolean;
  perms: Perms;
};

type RpcRow = {
  id: string; email: string | null; provider: string | null; is_anonymous: boolean | null;
  created_at: string | null; last_sign_in_at: string | null; full_name: string | null; username: string | null;
  first_name: string | null; last_name: string | null; avatar_url: string | null; phone_e164: string | null;
  birth_date: string | null; gender: string | null; nationality: string | null; residence: string | null;
  account_type: string | null; verified: boolean | null; is_public: boolean | null; bio: string | null;
  listings_count: number | string | null; requests_count: number | string | null; total_views: number | string | null;
  total_likes: number | string | null; followers_count: number | string | null; is_admin: boolean | null;
};

type FallbackProfile = {
  id: string; full_name: string | null; username: string | null; first_name: string | null; last_name: string | null;
  avatar_url: string | null; phone_e164: string | null; birth_date: string | null; gender: string | null;
  nationality: string | null; residence: string | null; verified: boolean | null; is_public: boolean | null;
  bio: string | null; created_at: string | null; account_type?: string | null;
};

type PermRow = { user_id: string; active: boolean | null; publish_reels: boolean | null; live: boolean | null; paid_ads: boolean | null; direct_wa: boolean | null };

const PERM_LABELS: { key: keyof Perms; label: string }[] = [
  { key: "publishReels", label: "نشر ريلز" },
  { key: "live", label: "بث مباشر" },
  { key: "paidAds", label: "إعلانات مدفوعة" },
  { key: "directWa", label: "واتساب مباشر" },
];
const PAGE_SIZE = 30;

function toProvider(p: string | null | undefined, isAnonymous: boolean): Provider {
  if (isAnonymous) return "guest";
  if (p === "google") return "google";
  if (p === "email") return "email";
  return "other";
}
const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v) || 0);

async function fetchPerms(): Promise<Map<string, PermRow>> {
  const { data, error } = await supabase.from("user_permissions").select("user_id, active, publish_reels, live, paid_ads, direct_wa");
  if (error) throw error;
  return new Map(((data ?? []) as unknown as PermRow[]).map((p) => [p.user_id, p]));
}

function applyPerms(row: Omit<AdminUserRow, "active" | "perms">, perm: PermRow | undefined): AdminUserRow {
  return {
    ...row,
    active: perm?.active ?? true,
    perms: {
      publishReels: perm?.publish_reels ?? true,
      live: perm?.live ?? true,
      paidAds: perm?.paid_ads ?? true,
      directWa: perm?.direct_wa ?? true,
    },
  };
}

async function fetchUsersFallback(perms: Map<string, PermRow>): Promise<AdminUserRow[]> {
  const cols = "id, full_name, username, first_name, last_name, avatar_url, phone_e164, birth_date, gender, nationality, residence, verified, is_public, bio, created_at";
  const [{ data: profiles, error: pErr }, { data: props }] = await Promise.all([
    supabase.from("profiles").select(cols),
    supabase.from("properties").select("seller_id, views, likes"),
  ]);
  if (pErr) throw pErr;
  const agg = new Map<string, { n: number; views: number; likes: number }>();
  for (const p of (props ?? []) as unknown as { seller_id: string; views: number | null; likes: number | null }[]) {
    const a = agg.get(p.seller_id) ?? { n: 0, views: 0, likes: 0 };
    a.n += 1; a.views += p.views ?? 0; a.likes += p.likes ?? 0;
    agg.set(p.seller_id, a);
  }
  return ((profiles ?? []) as unknown as FallbackProfile[]).map((p) => {
    const a = agg.get(p.id) ?? { n: 0, views: 0, likes: 0 };
    return applyPerms({
      id: p.id, email: null, provider: "other", createdAt: p.created_at, lastSignInAt: null,
      fullName: p.full_name, username: p.username, firstName: p.first_name, lastName: p.last_name,
      avatarUrl: p.avatar_url, phone: p.phone_e164, birthDate: p.birth_date, gender: p.gender,
      nationality: p.nationality, residence: p.residence, accountType: isAccountType(p.account_type) ? p.account_type : null,
      verified: !!p.verified, isPublic: p.is_public ?? true, bio: p.bio,
      listings: a.n, requests: null, views: a.views, likes: a.likes, followers: null, isAdminFromRpc: null,
    }, perms.get(p.id));
  });
}

function useAdminUsers() {
  return useQuery({
    queryKey: ["adminUsers"],
    queryFn: async (): Promise<{ users: AdminUserRow[]; detailed: boolean }> => {
      const perms = await fetchPerms();
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) {
        console.warn("admin_list_users unavailable, using fallback:", error.message);
        return { users: await fetchUsersFallback(perms), detailed: false };
      }
      const users = ((data ?? []) as unknown as RpcRow[]).map((r) =>
        applyPerms({
          id: r.id, email: r.email, provider: toProvider(r.provider, !!r.is_anonymous),
          createdAt: r.created_at, lastSignInAt: r.last_sign_in_at,
          fullName: r.full_name, username: r.username, firstName: r.first_name, lastName: r.last_name,
          avatarUrl: r.avatar_url, phone: r.phone_e164, birthDate: r.birth_date, gender: r.gender,
          nationality: r.nationality, residence: r.residence, accountType: isAccountType(r.account_type) ? r.account_type : null,
          verified: !!r.verified, isPublic: r.is_public ?? true, bio: r.bio,
          listings: num(r.listings_count), requests: num(r.requests_count), views: num(r.total_views),
          likes: num(r.total_likes), followers: num(r.followers_count), isAdminFromRpc: !!r.is_admin,
        }, perms.get(r.id)),
      );
      return { users, detailed: true };
    },
    staleTime: 15_000,
  });
}

function useAdminIds() {
  return useQuery({
    queryKey: ["adminUserIds"],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      if (error) throw error;
      return new Set((data ?? []).map((r: { user_id: string }) => r.user_id));
    },
    staleTime: 15_000,
  });
}

function useRoleToggle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, makeAdmin }: { userId: string; makeAdmin: boolean }) => {
      // ↔ عبر دالة الخادم admin_set_admin_role (للمشرف الأعلى) بدل كتابة مباشرة على user_roles اللى كانت بتفشل بدون سبب واضح.
      await setAdminRole({ userId, makeAdmin, fullAccess: true });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["adminUserIds"] });
      qc.invalidateQueries({ queryKey: ["adminUsers"] });
      qc.invalidateQueries({ queryKey: ["adminList"] });
    },
    onError: (err: unknown) =>
      Alert.alert("تعذر تغيير الدور", adminRoleErrorMessage(err, logAndGetSafeMessage("roleMutation failed", err, "برجاء المحاولة مرة أخرى."))),
  });
}

// ↔ نفس أعمدة user_permissions اللى كانت بتكتبها toggleUserActive/toggleUserPerm فى useAdminDB.
function usePermToggle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, patch }: { userId: string; patch: Partial<{ active: boolean; publish_reels: boolean; live: boolean; paid_ads: boolean; direct_wa: boolean }> }) => {
      const { error } = await supabase.from("user_permissions").upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminUsers"] }),
    onError: (err: unknown) =>
      Alert.alert("تعذر حفظ الصلاحية", logAndGetSafeMessage("permToggle failed", err, "برجاء المحاولة مرة أخرى.")),
  });
}

const PERM_COLUMN: Record<keyof Perms, "publish_reels" | "live" | "paid_ads" | "direct_wa"> = {
  publishReels: "publish_reels", live: "live", paidAds: "paid_ads", directWa: "direct_wa",
};

function displayName(u: AdminUserRow) {
  return u.fullName || [u.firstName, u.lastName].filter(Boolean).join(" ") || "مستخدم باراندا";
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
}
function fmtDateTime(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleString("ar-EG", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
const PROVIDER_LABEL: Record<Provider, string> = { google: "جوجل", email: "بريد إلكتروني", guest: "ضيف", other: "غير معروف" };

type TypeFilter = "all" | AccountType | "none";
type StatusFilter = "all" | "active" | "suspended";
type ProviderFilter = "all" | Provider;
type RoleFilter = "all" | "admin" | "user";
type ListingsFilter = "all" | "with" | "without";
type SortKey = "newest" | "oldest" | "listings" | "views" | "name";

export function AdminUsers() {
  const { isSuperAdmin } = useIsAdmin();
  const { data, isLoading, isError, refetch, isFetching } = useAdminUsers();
  const { data: adminIds } = useAdminIds();
  const roleToggle = useRoleToggle();
  const permToggle = usePermToggle();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [listingsFilter, setListingsFilter] = useState<ListingsFilter>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const users = data?.users ?? [];
  const isAdminUser = (u: AdminUserRow) => adminIds?.has(u.id) ?? u.isAdminFromRpc ?? false;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = q.replace(/[^\d]/g, "");
    const list = users.filter((u) => {
      if (q) {
        const hay = [displayName(u), u.firstName, u.lastName, u.username, u.email, u.residence, u.id].filter(Boolean).join(" ").toLowerCase();
        const phoneHit = qDigits.length >= 3 && !!u.phone && u.phone.replace(/[^\d]/g, "").includes(qDigits);
        if (!hay.includes(q) && !phoneHit) return false;
      }
      if (typeFilter === "none" ? u.accountType !== null : typeFilter !== "all" && u.accountType !== typeFilter) return false;
      if (statusFilter === "active" && !u.active) return false;
      if (statusFilter === "suspended" && u.active) return false;
      if (providerFilter !== "all" && u.provider !== providerFilter) return false;
      if (roleFilter === "admin" && !isAdminUser(u)) return false;
      if (roleFilter === "user" && isAdminUser(u)) return false;
      if (listingsFilter === "with" && u.listings === 0) return false;
      if (listingsFilter === "without" && u.listings > 0) return false;
      return true;
    });
    const ts = (u: AdminUserRow) => (u.createdAt ? new Date(u.createdAt).getTime() : 0);
    list.sort((a, b) => {
      if (sort === "newest") return ts(b) - ts(a);
      if (sort === "oldest") return ts(a) - ts(b);
      if (sort === "listings") return b.listings - a.listings;
      if (sort === "views") return b.views - a.views;
      return displayName(a).localeCompare(displayName(b), "ar");
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, query, typeFilter, statusFilter, providerFilter, roleFilter, listingsFilter, sort, adminIds]);

  const activeFilterCount =
    (typeFilter !== "all" ? 1 : 0) + (statusFilter !== "all" ? 1 : 0) + (providerFilter !== "all" ? 1 : 0) +
    (roleFilter !== "all" ? 1 : 0) + (listingsFilter !== "all" ? 1 : 0);

  function resetFilters() {
    setTypeFilter("all"); setStatusFilter("all"); setProviderFilter("all"); setRoleFilter("all"); setListingsFilter("all");
  }

  const visible = filtered.slice(0, limit);

  if (isLoading) {
    return <View style={styles.center}><ActivityIndicator color="#6366f1" /></View>;
  }
  if (isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>تعذر تحميل المستخدمين</Text>
        <Pressable style={styles.retryBtn} onPress={() => refetch()}><Text style={styles.retryText}>إعادة المحاولة</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {data && !data.detailed && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            البريد الإلكتروني وطريقة التسجيل وآخر دخول وعدد الطلبات والمتابعين غير متاحة بعد: طبّق ملف قاعدة البيانات 20261009000000_account_type_and_admin_users.sql على Supabase.
          </Text>
        </View>
      )}

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={(v) => { setQuery(v); setLimit(PAGE_SIZE); }}
        placeholder="🔍 ابحث بالاسم أو البريد أو الهاتف أو اسم المستخدم..."
        placeholderTextColor={themeColors.textSubtle}
      />

      <View style={styles.toolbar}>
        <Pressable style={[styles.toolBtn, (showFilters || activeFilterCount > 0) && styles.toolBtnActive]} onPress={() => setShowFilters((v) => !v)}>
          <Text style={[styles.toolBtnText, (showFilters || activeFilterCount > 0) && styles.toolBtnTextActive]}>
            الفلاتر{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""} {showFilters ? "▴" : "▾"}
          </Text>
        </Pressable>
        {activeFilterCount > 0 && (
          <Pressable style={styles.toolBtn} onPress={resetFilters}><Text style={styles.toolBtnText}>مسح الفلاتر</Text></Pressable>
        )}
        <Pressable style={styles.toolBtn} onPress={() => refetch()}>
          <Text style={styles.toolBtnText}>{isFetching ? "جارٍ التحديث..." : "تحديث ⟳"}</Text>
        </Pressable>
        <Text style={styles.count}>{filtered.length} من {users.length}</Text>
      </View>

      {showFilters && (
        <View style={styles.filtersBox}>
          <FilterGroup label="نوع الحساب" value={typeFilter} onChange={(v) => { setTypeFilter(v as TypeFilter); setLimit(PAGE_SIZE); }}
            options={[{ key: "all", label: "الكل" }, ...ACCOUNT_TYPES.map((k) => ({ key: k, label: ACCOUNT_TYPE_LABELS[k] })), { key: "none", label: "غير محدد" }]} />
          <FilterGroup label="الحالة" value={statusFilter} onChange={(v) => { setStatusFilter(v as StatusFilter); setLimit(PAGE_SIZE); }}
            options={[{ key: "all", label: "الكل" }, { key: "active", label: "نشط" }, { key: "suspended", label: "موقوف" }]} />
          <FilterGroup label="طريقة التسجيل" value={providerFilter} onChange={(v) => { setProviderFilter(v as ProviderFilter); setLimit(PAGE_SIZE); }}
            options={[{ key: "all", label: "الكل" }, { key: "google", label: "جوجل" }, { key: "email", label: "بريد" }, { key: "guest", label: "ضيف" }]} />
          <FilterGroup label="الدور" value={roleFilter} onChange={(v) => { setRoleFilter(v as RoleFilter); setLimit(PAGE_SIZE); }}
            options={[{ key: "all", label: "الكل" }, { key: "admin", label: "مشرف" }, { key: "user", label: "مستخدم" }]} />
          <FilterGroup label="الإعلانات" value={listingsFilter} onChange={(v) => { setListingsFilter(v as ListingsFilter); setLimit(PAGE_SIZE); }}
            options={[{ key: "all", label: "الكل" }, { key: "with", label: "لديه إعلانات" }, { key: "without", label: "بدون إعلانات" }]} />
          <FilterGroup label="الترتيب" value={sort} onChange={(v) => setSort(v as SortKey)}
            options={[{ key: "newest", label: "الأحدث" }, { key: "oldest", label: "الأقدم" }, { key: "listings", label: "الأكثر إعلانات" }, { key: "views", label: "الأكثر مشاهدة" }, { key: "name", label: "الاسم" }]} />
        </View>
      )}

      {filtered.length === 0 && <Text style={styles.emptyText}>لا يوجد مستخدمون مطابقون</Text>}

      {visible.map((u) => {
        const isAdmin = isAdminUser(u);
        const expanded = expandedId === u.id;
        const name = displayName(u);
        const country = u.nationality ? COUNTRIES.find((c) => c.code === u.nationality) : undefined;
        return (
          <View key={u.id} style={styles.card}>
            <Pressable style={styles.header} onPress={() => setExpandedId(expanded ? null : u.id)}>
              <View style={styles.avatar}>
                {u.avatarUrl ? (
                  <Image source={{ uri: cldThumbnail(u.avatarUrl) }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                ) : (
                  <Text style={styles.avatarText}>{name.charAt(0)}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{name} {isAdmin ? "🛡️" : ""}{u.verified ? " ✓" : ""}</Text>
                <Text style={styles.sub} numberOfLines={1}>{u.email ?? u.phone ?? u.username ?? "—"}</Text>
                <View style={styles.badges}>
                  <Badge text={u.accountType ? ACCOUNT_TYPE_LABELS[u.accountType] : "نوع الحساب غير محدد"} tone={u.accountType ? "green" : "gray"} />
                  {data?.detailed && <Badge text={PROVIDER_LABEL[u.provider]} tone="blue" />}
                  {!u.active && <Badge text="موقوف" tone="red" />}
                </View>
              </View>
              <Text style={styles.chevron}>{expanded ? "▴" : "▾"}</Text>
            </Pressable>

            <Text style={styles.statsLine}>
              {u.listings} إعلان · {u.views.toLocaleString("ar-EG")} مشاهدة · {u.likes.toLocaleString("ar-EG")} إعجاب · انضم {fmtDate(u.createdAt)}
            </Text>

            {expanded && (
              <View style={styles.details}>
                <DetailRow label="الاسم الأول" value={u.firstName} />
                <DetailRow label="الاسم الثاني" value={u.lastName} />
                <DetailRow label="اسم المستخدم" value={u.username} />
                <DetailRow label="البريد الإلكتروني" value={u.email} />
                <DetailRow label="الهاتف" value={u.phone} />
                <DetailRow label="تاريخ الميلاد" value={u.birthDate ? fmtDate(u.birthDate) : null} />
                <DetailRow label="الجنس" value={u.gender === "male" ? "ذكر" : u.gender === "female" ? "أنثى" : null} />
                <DetailRow label="الجنسية" value={country ? country.nameAr : u.nationality} />
                <DetailRow label="الإقامة" value={u.residence} />
                <DetailRow label="نوع الحساب" value={u.accountType ? ACCOUNT_TYPE_LABELS[u.accountType] : null} />
                <DetailRow label="طريقة التسجيل" value={data?.detailed ? PROVIDER_LABEL[u.provider] : null} />
                <DetailRow label="حساب خاص" value={u.isPublic ? "لا (عام)" : "نعم"} />
                <DetailRow label="تاريخ التسجيل" value={fmtDateTime(u.createdAt)} />
                <DetailRow label="آخر دخول" value={data?.detailed ? fmtDateTime(u.lastSignInAt) : null} />
                <DetailRow label="النبذة" value={u.bio} />
                <DetailRow label="الإعلانات" value={String(u.listings)} />
                <DetailRow label="الطلبات" value={u.requests == null ? null : String(u.requests)} />
                <DetailRow label="المتابعون" value={u.followers == null ? null : String(u.followers)} />
                <DetailRow label="المعرّف" value={u.id} mono />
              </View>
            )}

            <View style={styles.permsGrid}>
              <View style={styles.permRow}>
                <Text style={styles.permLabel}>الحساب نشط</Text>
                <Toggle value={u.active} onPress={() => permToggle.mutate({ userId: u.id, patch: { active: !u.active } })} />
              </View>
              {PERM_LABELS.map((p) => (
                <View key={p.key} style={styles.permRow}>
                  <Text style={styles.permLabel}>{p.label}</Text>
                  <Toggle small value={u.perms[p.key]} onPress={() => permToggle.mutate({ userId: u.id, patch: { [PERM_COLUMN[p.key]]: !u.perms[p.key] } })} />
                </View>
              ))}
            </View>

            {isSuperAdmin && (
              <Pressable
                style={[styles.roleBtn, isAdmin && styles.roleBtnRevoke]}
                onPress={() => Alert.alert(
                  isAdmin ? "إلغاء صلاحية الأدمن؟" : "منح صلاحية أدمن كاملة؟",
                  name,
                  [
                    { text: "إلغاء", style: "cancel" },
                    { text: "تأكيد", onPress: () => roleToggle.mutate({ userId: u.id, makeAdmin: !isAdmin }) },
                  ]
                )}
              >
                <Text style={[styles.roleBtnText, isAdmin && styles.roleBtnRevokeText]}>
                  {isAdmin ? "إلغاء صلاحية الأدمن" : "ترقية إلى أدمن"}
                </Text>
              </Pressable>
            )}
          </View>
        );
      })}

      {filtered.length > limit && (
        <Pressable style={styles.moreBtn} onPress={() => setLimit((l) => l + PAGE_SIZE)}>
          <Text style={styles.moreText}>عرض المزيد ({filtered.length - limit})</Text>
        </Pressable>
      )}
    </View>
  );
}

function FilterGroup({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { key: string; label: string }[] }) {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.filterLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {options.map((o) => (
          <Pressable key={o.key} style={[styles.fChip, value === o.key && styles.fChipActive]} onPress={() => onChange(o.key)}>
            <Text style={[styles.fChipText, value === o.key && styles.fChipTextActive]}>{o.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function Badge({ text, tone }: { text: string; tone: "green" | "blue" | "red" | "gray" }) {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const map = {
    green: { bg: themeColors.isDark ? "rgba(16,185,129,0.18)" : "#ecfdf5", fg: "#059669" },
    blue: { bg: themeColors.isDark ? "rgba(99,102,241,0.18)" : "#eef2ff", fg: "#6366f1" },
    red: { bg: themeColors.isDark ? "rgba(239,68,68,0.15)" : "#FEF2F2", fg: "#B91C1C" },
    gray: { bg: themeColors.isDark ? "rgba(255,255,255,0.08)" : "#f1f5f9", fg: themeColors.textMuted },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: map.bg }]}>
      <Text style={[styles.badgeText, { color: map.fg }]}>{text}</Text>
    </View>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && { fontSize: 10.5 }]} selectable>{value && String(value).trim() ? value : "—"}</Text>
    </View>
  );
}

function Toggle({ value, onPress, small }: { value: boolean; onPress: () => void; small?: boolean }) {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  return (
    <Pressable
      style={[small ? styles.toggleSmall : styles.toggle, value && styles.toggleOn]}
      onPress={onPress}
    >
      <View style={[small ? styles.toggleThumbSmall : styles.toggleThumb, value && (small ? styles.toggleThumbOnSmall : styles.toggleThumbOn)]} />
    </Pressable>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    center: { paddingVertical: 40, alignItems: "center", gap: 12 },
    emptyText: { textAlign: "center", color: themeColors.textSubtle, fontSize: 13, fontWeight: "700", paddingVertical: 20 },
    retryBtn: { backgroundColor: "#6366f1", borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9 },
    retryText: { color: "white", fontWeight: "900", fontSize: 12 },
    notice: { backgroundColor: themeColors.isDark ? "rgba(245,158,11,0.15)" : "#FFFBEB", borderRadius: 12, padding: 12 },
    noticeText: { color: themeColors.isDark ? "#FCD34D" : "#92400E", fontSize: 11.5, fontWeight: "700", lineHeight: 18 },
    search: { backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.border, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14, fontSize: 13, color: themeColors.text },
    toolbar: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
    toolBtn: { backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    toolBtnActive: { backgroundColor: themeColors.isDark ? "rgba(99,102,241,0.18)" : "#eef2ff", borderColor: "#6366f1" },
    toolBtnText: { color: themeColors.textMuted, fontSize: 11.5, fontWeight: "800" },
    toolBtnTextActive: { color: "#6366f1" },
    count: { color: themeColors.textSubtle, fontSize: 11.5, fontWeight: "700", marginStart: "auto" },
    filtersBox: { backgroundColor: themeColors.card, borderRadius: 16, padding: 14, gap: 12, borderWidth: 1, borderColor: themeColors.border },
    filterLabel: { color: themeColors.textMuted, fontSize: 11.5, fontWeight: "900" },
    fChip: { backgroundColor: themeColors.surface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: themeColors.border },
    fChipActive: { backgroundColor: "#6366f1", borderColor: "#6366f1" },
    fChipText: { color: themeColors.textMuted, fontSize: 11.5, fontWeight: "800" },
    fChipTextActive: { color: "white" },
    card: { backgroundColor: themeColors.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: themeColors.border },
    header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
    avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#6366f1", alignItems: "center", justifyContent: "center", overflow: "hidden" },
    avatarText: { color: "white", fontWeight: "900", fontSize: 18 },
    name: { fontSize: 13.5, fontWeight: "900", color: themeColors.text },
    sub: { fontSize: 11, color: themeColors.textSubtle, marginTop: 2 },
    badges: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 5 },
    badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    badgeText: { fontSize: 10, fontWeight: "900" },
    chevron: { color: themeColors.textSubtle, fontSize: 14 },
    statsLine: { fontSize: 11, color: themeColors.textSubtle, marginBottom: 10 },
    details: { backgroundColor: themeColors.surface, borderRadius: 12, padding: 12, gap: 7, marginBottom: 12 },
    detailRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    detailLabel: { width: 96, color: themeColors.textSubtle, fontSize: 11.5, fontWeight: "800" },
    detailValue: { flex: 1, color: themeColors.text, fontSize: 12, fontWeight: "700" },
    permsGrid: { gap: 8, borderTopWidth: 1, borderTopColor: themeColors.border, paddingTop: 10 },
    permRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    permLabel: { fontSize: 12, color: themeColors.textMuted, fontWeight: "700" },
    toggle: { width: 44, height: 24, borderRadius: 999, backgroundColor: themeColors.isDark ? "#3f3f46" : "#cbd5e1", padding: 2, justifyContent: "center" },
    toggleOn: { backgroundColor: "#10b981" },
    toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: "white", alignSelf: "flex-start" },
    toggleThumbOn: { alignSelf: "flex-end" },
    toggleSmall: { width: 36, height: 20, borderRadius: 999, backgroundColor: themeColors.isDark ? "#3f3f46" : "#cbd5e1", padding: 2, justifyContent: "center" },
    toggleThumbSmall: { width: 16, height: 16, borderRadius: 8, backgroundColor: "white", alignSelf: "flex-start" },
    toggleThumbOnSmall: { alignSelf: "flex-end" },
    roleBtn: { marginTop: 10, backgroundColor: themeColors.isDark ? "rgba(99,102,241,0.18)" : "#eef2ff", borderRadius: 999, paddingVertical: 9, alignItems: "center" },
    roleBtnText: { color: "#6366f1", fontWeight: "900", fontSize: 11.5 },
    roleBtnRevoke: { backgroundColor: themeColors.isDark ? "rgba(239,68,68,0.15)" : "#FEF2F2" },
    roleBtnRevokeText: { color: "#991B1B" },
    moreBtn: { backgroundColor: themeColors.surface, borderRadius: 999, paddingVertical: 11, alignItems: "center", borderWidth: 1, borderColor: themeColors.border },
    moreText: { color: "#6366f1", fontWeight: "900", fontSize: 12.5 },
  });
}
