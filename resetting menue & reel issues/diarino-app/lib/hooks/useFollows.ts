import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { useCurrentUser } from "./useCurrentUser";
import { showToast } from "../../components/shared/Toast";

// ↔ replaces two independent, restart-losing local states that were
// never synced with each other: app/(tabs)/index.tsx's `followedSellers`
// Set and app/seller/[id].tsx's own `following` useState. Both now read
// the same real `follows` table, so following a seller from the reels
// feed shows up as followed on their profile page too, and vice versa.

async function fetchFollowedIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("follows").select("followee_id").eq("follower_id", userId);
  if (error) throw error;
  return new Set(((data ?? []) as { followee_id: string }[]).map((r) => r.followee_id));
}

// ↔ powers the 🔔 bell (seller page + "الذين تتابعهم" list): which sellers the current user turned new-listing
// notifications on for. It is a SEPARATE table from `follows` (20261005000000_seller_notification_subscriptions.sql):
// the bell works with or without following, and following never touches it.
async function fetchNotifyIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("seller_notification_subscriptions").select("seller_id").eq("user_id", userId);
  if (error) {
    // الجدول لسه مش موجود (الـ migration ما اتطبّقتش) — الجرس يبان مطفى بدل ما الصفحة تقع.
    if ((error as { code?: string }).code === "42P01" || /seller_notification_subscriptions/.test(error.message ?? "")) return new Set<string>();
    throw error;
  }
  return new Set(((data ?? []) as { seller_id: string }[]).map((r) => r.seller_id));
}

// ↔ powers the "المتابعون"/"الذين تتابعهم" lists in the settings menu.
export type FollowListItem = { id: string; name: string; avatarUrl: string | null };

export function useFollowersList() {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: ["followersList", user?.id],
    queryFn: async (): Promise<FollowListItem[]> => {
      const { data, error } = await supabase
        .from("follows")
        // ↔ profiles_public, not profiles — followers/following can be
        // anyone regardless of their own is_public setting (that flag
        // governs their profile PAGE, not whether they show up in your
        // own followers list), and this only ever needs name/avatar. See
        // 20260825000000_profile_privacy_rls.sql.
        .select("follower_id, profiles_public!follower_id(id, full_name, avatar_url)")
        .eq("followee_id", user!.id);
      if (error) throw error;
      return ((data ?? []) as unknown as { profiles_public: { id: string; full_name: string | null; avatar_url: string | null } | null }[])
        .filter((r) => r.profiles_public)
        .map((r) => ({ id: r.profiles_public!.id, name: r.profiles_public!.full_name || "مستخدم باراندا", avatarUrl: r.profiles_public!.avatar_url }));
    },
    enabled: !!user,
    staleTime: 15_000,
  });
}

export function useFollowingList() {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: ["followingList", user?.id],
    queryFn: async (): Promise<FollowListItem[]> => {
      const { data, error } = await supabase
        .from("follows")
        .select("followee_id, profiles_public!followee_id(id, full_name, avatar_url)")
        .eq("follower_id", user!.id);
      if (error) throw error;
      return ((data ?? []) as unknown as { profiles_public: { id: string; full_name: string | null; avatar_url: string | null } | null }[])
        .filter((r) => r.profiles_public)
        .map((r) => ({ id: r.profiles_public!.id, name: r.profiles_public!.full_name || "مستخدم باراندا", avatarUrl: r.profiles_public!.avatar_url }));
    },
    enabled: !!user,
    staleTime: 15_000,
  });
}

export function useFollows() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const queryKey = ["follows", user?.id];
  const notifyQueryKey = ["followNotify", user?.id];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchFollowedIds(user!.id),
    enabled: !!user,
    staleTime: 15_000,
  });

  const notifyQuery = useQuery({
    queryKey: notifyQueryKey,
    queryFn: () => fetchNotifyIds(user!.id),
    enabled: !!user,
    staleTime: 15_000,
  });

  const toggle = useMutation({
    mutationFn: async (sellerId: string) => {
      if (!user) throw new Error("Not signed in");
      if (user.id === sellerId) return; // ↔ follows_no_self_follow — nothing to toggle on your own profile
      const current = query.data ?? new Set<string>();
      if (current.has(sellerId)) {
        const { error } = await supabase.from("follows").delete().eq("follower_id", user.id).eq("followee_id", sellerId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("follows").insert({ follower_id: user.id, followee_id: sellerId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      // ↔ المتابعة مالهاش علاقة بالجرس: منحدّثش notifyQueryKey هنا.
      qc.invalidateQueries({ queryKey });
    },
  });

  // ↔ the 🔔 bell — مستقل عن المتابعة: بيضيف/يشيل صف فى seller_notification_subscriptions بس (مفيش upsert
  // على follows). تحديث متفائل (الجرس بيتغيّر فورًا) مع رجوع للحالة السابقة لو فشل الحفظ.
  const toggleNotify = useMutation({
    mutationFn: async (sellerId: string) => {
      if (!user || user.id === sellerId) return;
      const currentlyNotifying = qc.getQueryData<Set<string>>(notifyQueryKey)?.has(sellerId) ?? false;
      if (currentlyNotifying) {
        const { error } = await supabase.from("seller_notification_subscriptions").delete().eq("user_id", user.id).eq("seller_id", sellerId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("seller_notification_subscriptions").upsert({ user_id: user.id, seller_id: sellerId }, { onConflict: "user_id,seller_id" });
        if (error) throw error;
      }
    },
    onMutate: async (sellerId: string) => {
      await qc.cancelQueries({ queryKey: notifyQueryKey });
      const previous = qc.getQueryData<Set<string>>(notifyQueryKey);
      const next = new Set(previous ?? []);
      if (next.has(sellerId)) next.delete(sellerId);
      else next.add(sellerId);
      qc.setQueryData(notifyQueryKey, next);
      return { previous };
    },
    onError: (_err, _sellerId, ctx) => {
      if (ctx?.previous) qc.setQueryData(notifyQueryKey, ctx.previous);
      showToast("تعذر حفظ إعداد الإشعارات، حاول مرة أخرى");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: notifyQueryKey });
    },
  });

  return {
    followedIds: query.data ?? new Set<string>(),
    toggleFollow: (sellerId: string) => toggle.mutate(sellerId),
    notifyIds: notifyQuery.data ?? new Set<string>(),
    toggleNotify: (sellerId: string) => toggleNotify.mutate(sellerId),
  };
}

// ↔ the follower COUNT shown on a seller's profile (Seller.followers,
// currently always 0 — lib/hooks/useProperties.ts's own comment flags
// this: "followers: 0, // no followers table yet"). Fetched separately
// rather than per-row in the properties query to avoid an aggregate
// subquery on every single reel/listing fetch.
export function useFollowerCount(sellerId: string | undefined) {
  return useQuery({
    queryKey: ["followerCount", sellerId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("follows")
        .select("id", { count: "exact", head: true })
        .eq("followee_id", sellerId!);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!sellerId,
    staleTime: 15_000,
  });
}
