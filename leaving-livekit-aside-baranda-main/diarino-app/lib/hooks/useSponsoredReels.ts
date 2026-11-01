import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { useProfile } from "./useProfile";

export type SponsoredReel = {
  id: string;
  propertyId: string;
  placement: "intro" | "in_feed";
  reachGoal: number | null;
  currentReach: number;
  ageMin: number | null;
  ageMax: number | null;
  genderTarget: "all" | "male" | "female";
  active: boolean;
  startDate: string;
  endDate: string | null;
  createdAt: string;
};

type Row = {
  id: string; property_id: string; placement: "intro" | "in_feed"; reach_goal: number | null; current_reach: number;
  age_min: number | null; age_max: number | null; gender_target: "all" | "male" | "female";
  active: boolean; start_date: string; end_date: string | null; created_at?: string;
};

function rowToSponsored(r: Row): SponsoredReel {
  return {
    id: r.id, propertyId: r.property_id, placement: r.placement, reachGoal: r.reach_goal, currentReach: r.current_reach,
    ageMin: r.age_min, ageMax: r.age_max, genderTarget: r.gender_target, active: r.active,
    startDate: r.start_date, endDate: r.end_date, createdAt: r.created_at ?? r.start_date,
  };
}

// ↔ العمر من تاريخ الميلاد المسجَّل فى الحساب (YYYY-MM-DD)؛ null لو غير معروف (ضيف أو ما كتبش تاريخ ميلاد).
export function ageFromBirthDate(birth: string | null | undefined, now: Date = new Date()): number | null {
  if (!birth) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birth);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age -= 1;
  return age >= 0 && age < 120 ? age : null;
}

// ↔ هل الإعلان الممول مناسب للمشاهد؟
//  • لو بلغ هدف الوصول (reach_goal) يتوقف عن الظهور.
//  • الاستهداف بالفئة العمرية بقى مُفعَّلًا فعليًا (تاريخ الميلاد بيتجمع فى الحساب): الإعلان المستهدف يظهر فقط لمن عمره داخل الفئة،
//    ومن ليس لديه تاريخ ميلاد (ضيف) يشاهد الإعلانات غير المستهدفة (كل الأعمار) فقط.
export function isSponsorEligible(s: SponsoredReel, viewerAge: number | null): boolean {
  if (s.reachGoal != null && s.currentReach >= s.reachGoal) return false;
  if (s.ageMin == null && s.ageMax == null) return true;
  if (viewerAge == null) return false;
  if (s.ageMin != null && viewerAge < s.ageMin) return false;
  if (s.ageMax != null && viewerAge > s.ageMax) return false;
  return true;
}

// ↔ the reels feed's intro reel + periodic featured insertion (+ كارت «مميز» فى صفحة البحث).
export function useActiveSponsoredReels() {
  const { profile } = useProfile();
  const viewerAge = ageFromBirthDate(profile?.birthDate);
  // الأحدث أولًا (وقت إنشاء الإعلان الممول = وقت تفعيل الترويج): لو فى أكتر من إعلان من نفس النوع يظهر الأحدث فى الأعلى.
  const select = useCallback(
    (rows: SponsoredReel[]) =>
      rows
        .filter((s) => isSponsorEligible(s, viewerAge))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
    [viewerAge],
  );
  return useQuery({
    select,
    queryKey: ["sponsoredReels", "active"],
    queryFn: async (): Promise<SponsoredReel[]> => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("sponsored_reels")
        .select("id, property_id, placement, reach_goal, current_reach, age_min, age_max, gender_target, active, start_date, end_date, created_at")
        .eq("active", true)
        .lte("start_date", today)
        .or(`end_date.is.null,end_date.gte.${today}`);
      if (error) throw error;
      return ((data ?? []) as Row[]).map(rowToSponsored);
    },
    staleTime: 60_000,
  });
}

// ↔ خريطة «العقار ← إعلانه الممول الأحدث» لكل الإعلانات الممولة المفعّلة (افتتاحي ومميز): بتتستخدم فى «إعلاناتي» وصفحة المعلن
//   لعرض شارة «ممول» وتقديمها فى أعلى القائمة (الأحدث تفعيلًا أولًا). مرتبة من الأحدث فأول عنصر لكل عقار هو الأحدث.
export function useSponsorMap(): Map<string, { reelId: string; rank: number }> {
  const { data } = useActiveSponsoredReels();
  return useMemo(() => {
    const m = new Map<string, { reelId: string; rank: number }>();
    for (const s of data ?? []) {
      if (m.has(s.propertyId)) continue;
      const rank = Date.parse(s.createdAt);
      m.set(s.propertyId, { reelId: s.id, rank: Number.isFinite(rank) ? rank : 0 });
    }
    return m;
  }, [data]);
}

export function useIncrementSponsoredReach() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("increment_sponsored_reach", { sponsored_id: id });
      if (error) throw error;
    },
  });
}

// ↔ the admin "الريلز المميزة" tab.
export function useAllSponsoredReels() {
  return useQuery({
    queryKey: ["sponsoredReels", "all"],
    queryFn: async (): Promise<SponsoredReel[]> => {
      const { data, error } = await supabase.from("sponsored_reels")
        .select("id, property_id, placement, reach_goal, current_reach, age_min, age_max, gender_target, active, start_date, end_date, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as Row[]).map(rowToSponsored);
    },
    staleTime: 15_000,
  });
}

export function useSponsoredReelMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["sponsoredReels"] });

  const create = useMutation({
    mutationFn: async (input: {
      propertyId: string; placement: "intro" | "in_feed"; reachGoal?: number;
      ageMin?: number; ageMax?: number; genderTarget?: "all" | "male" | "female"; endDate?: string;
    }) => {
      const { error } = await supabase.from("sponsored_reels").insert({
        property_id: input.propertyId, placement: input.placement, reach_goal: input.reachGoal ?? null,
        age_min: input.ageMin ?? null, age_max: input.ageMax ?? null,
        gender_target: input.genderTarget ?? "all", end_date: input.endDate ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("sponsored_reels").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sponsored_reels").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { create, toggleActive, remove };
}
