import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../supabase";
import { ServiceCategory, setServiceCategoriesRegistry, staticServiceCategories } from "../companies";

// ↔ تصنيفات قسم «الخدمات» (الكروت فى صفحة القائمة + نشاط الشركة) — جدول public.service_categories
//   (migration 20261125000000_services_admin.sql). الكل يقرأه، والأدمن (صلاحية menuItems) يديره من تبويب «إدارة قسم الخدمات».
//   الـ client غير مُنمَّط لأن ملف الأنواع المُولَّد لا يحتوى الجدول الجديد (نفس أسلوب useCompanies.ts).
//   لو الجدول لم يُنشأ بعد (migration لسه ما اتطبّقتش) أو فشل الجلب: نرجع للقائمة الثابتة الاحتياطية فلا يفرغ القسم ولا تتعطل الشاشات.
const db = supabase as unknown as SupabaseClient;

type Row = {
  id: string; key: string; label: string; image_url: string | null; sort_order: number; active: boolean; uses_property_photos: boolean;
};

function rowTo(r: Row): ServiceCategory {
  return {
    id: String(r.id), key: String(r.key), label: String(r.label), imageUrl: r.image_url ?? null,
    sortOrder: Number(r.sort_order) || 0, active: r.active !== false, usesPropertyPhotos: r.uses_property_photos === true,
  };
}

type Fetched = { list: ServiceCategory[]; fromServer: boolean };

async function fetchServiceCategories(): Promise<Fetched> {
  const { data, error } = await db
    .from("service_categories")
    .select("id, key, label, image_url, sort_order, active, uses_property_photos")
    .order("sort_order", { ascending: true });
  if (error || !Array.isArray(data) || data.length === 0) return { list: staticServiceCategories(), fromServer: !error && Array.isArray(data) };
  return { list: (data as Row[]).map(rowTo), fromServer: true };
}

export function useServiceCategories() {
  const q = useQuery({
    queryKey: ["serviceCategories"],
    queryFn: async (): Promise<Fetched> => {
      const res = await fetchServiceCategories();
      setServiceCategoriesRegistry(res.list);
      return res;
    },
    staleTime: 60_000,
  });
  const all = useMemo(() => q.data?.list ?? staticServiceCategories(), [q.data]);
  const active = useMemo(() => all.filter((c) => c.active), [all]);
  return { all, active, isLoading: q.isLoading, fromServer: q.data?.fromServer ?? false };
}

// مفتاح تقنى ثابت لتصنيف جديد (لا يتغيّر بعد الإنشاء لأن الشركات مرتبطة به): svc_ + 8 أحرف عشوائية.
function newCategoryKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "svc_";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export type ServiceCategoryInput = { label: string; imageUrl: string | null; usesPropertyPhotos: boolean };

export function useServiceCategoryMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["serviceCategories"] });

  const create = useMutation({
    mutationFn: async ({ input, sortOrder }: { input: ServiceCategoryInput; sortOrder: number }) => {
      const { error } = await db.from("service_categories").insert({
        key: newCategoryKey(), label: input.label, image_url: input.imageUrl, sort_order: sortOrder, active: true,
        uses_property_photos: input.usesPropertyPhotos,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<ServiceCategoryInput> & { active?: boolean } }) => {
      const row: Record<string, unknown> = {};
      if (patch.label !== undefined) row.label = patch.label;
      if ("imageUrl" in patch) row.image_url = patch.imageUrl ?? null;
      if (patch.usesPropertyPhotos !== undefined) row.uses_property_photos = patch.usesPropertyPhotos;
      if (patch.active !== undefined) row.active = patch.active;
      const { error } = await db.from("service_categories").update(row).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // حذف نهائى: يرفضه الخادم لو عليه شركات (مفتاح أجنبى) — الأدمن يخفيه بدل الحذف.
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("service_categories").delete().eq("id", id);
      if (error) {
        if (error.code === "23503") throw new Error("لا يمكن حذف تصنيف مسجّلة عليه شركات — أخفِه بدل الحذف.");
        throw error;
      }
    },
    onSuccess: invalidate,
  });

  // إعادة ترقيم كل التصنيفات بترتيبها الجديد فى معاملة واحدة.
  const reorder = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await db.rpc("admin_reorder_service_categories", { p_ids: ids });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { create, update, remove, reorder };
}
