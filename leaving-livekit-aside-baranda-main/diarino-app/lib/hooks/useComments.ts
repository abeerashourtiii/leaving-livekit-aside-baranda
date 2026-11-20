import { useInfiniteQuery, useMutation, useQuery, useQueryClient, QueryClient } from "@tanstack/react-query";
import { trackSignal } from "../recommendation/store";
import { supabase } from "../supabase";
import { useCurrentUser } from "./useCurrentUser";
import { patchCounters, refreshCommentCount } from "../cacheCounters";

// ↔ تعليقات الريلز — migration 20261013000000_reel_comments.sql.
//  • التعليقات الرئيسية: صفحات (PAGE_SIZE) الأحدث أولًا، مفتاح الكاش ["comments", propertyId, "top"].
//  • الردود: بتتحمّل عند الضغط على «عرض الردود» فقط (الأقدم أولًا)، مفتاح الكاش ["comments", propertyId, "replies", parentId].
//  • الإعجاب: تحديث متفائل (optimistic) فى كل الكاشات ثم تراجع لو فشل الطلب.
// ↔ نفس الهوكس تخدم تعليقات الريلز (kind = "reel") وتعليقات الطلبات (kind = "request" — migration 20261105000000):
//   الجداول وعمود الربط ومفتاح الكاش ودالة التثبيت بتتغيّر حسب النوع، والباقى مشترك (الإعجاب 👍، الرد، الحذف، التثبيت).
export type CommentKind = "reel" | "request";
const KINDS = {
  reel: { table: "reel_comments", likes: "reel_comment_likes", fk: "property_id", root: "comments", pinRpc: "pin_reel_comment" },
  request: { table: "request_comments", likes: "request_comment_likes", fk: "request_id", root: "request-comments", pinRpc: "pin_request_comment" },
} as const;
export const COMMENT_MAX_LENGTH = 500;
const PAGE_SIZE = 15;
const REPLIES_LIMIT = 100;

export type CommentAuthor = { id: string; name: string; initial: string; avatarUrl: string | null; verified: boolean };

export type ReelComment = {
  id: string;
  propertyId: string;
  userId: string;
  parentId: string | null;
  replyToUserId: string | null;
  replyToName: string | null;
  body: string;
  likeCount: number;
  replyCount: number;
  createdAt: string;
  likedByMe: boolean;
  // ↔ تثبيت صاحب الريل (تعليق رئيسى واحد فقط) و«أعجب به صاحب الريل» — 20261014000000_comment_filter_pin_owner_like.sql.
  pinned: boolean;
  ownerLiked: boolean;
  author: CommentAuthor;
};

type CommentRow = {
  id: string; property_id?: string; request_id?: string; user_id: string; parent_id: string | null; reply_to_user_id: string | null;
  body: string; like_count: number; reply_count: number; created_at: string; pinned_at: string | null; owner_liked: boolean;
  author: { id: string; full_name: string | null; avatar_url: string | null; verified: boolean | null } | null;
  reply_to: { full_name: string | null } | null;
};

// الـ embed بيستخدم أسماء FK صريحة (profiles_public!user_id) زى ما بتعمل الإشعارات — راجع 20260825000000_profile_privacy_rls.sql.
const selectFor = (kind: CommentKind) =>
  `id, ${KINDS[kind].fk}, user_id, parent_id, reply_to_user_id, body, like_count, reply_count, created_at, pinned_at, owner_liked, ` +
  "author:profiles_public!user_id(id, full_name, avatar_url, verified), reply_to:profiles_public!reply_to_user_id(full_name)";

function toComment(r: CommentRow, liked: Set<string>): ReelComment {
  const name = r.author?.full_name?.trim() || "—";
  return {
    id: r.id,
    propertyId: (r.property_id ?? r.request_id) as string, // معرّف الريل أو الطلب
    userId: r.user_id,
    parentId: r.parent_id,
    replyToUserId: r.reply_to_user_id,
    replyToName: r.reply_to?.full_name?.trim() || null,
    body: r.body,
    likeCount: r.like_count,
    replyCount: r.reply_count,
    createdAt: r.created_at,
    likedByMe: liked.has(r.id),
    pinned: r.pinned_at != null,
    ownerLiked: !!r.owner_liked,
    author: {
      id: r.user_id,
      name,
      initial: name.charAt(0) || "؟",
      avatarUrl: r.author?.avatar_url ?? null,
      verified: !!r.author?.verified,
    },
  };
}

async function fetchMyLikedIds(userId: string | undefined, ids: string[], kind: CommentKind): Promise<Set<string>> {
  if (!userId || ids.length === 0) return new Set();
  const { data, error } = await supabase.from(KINDS[kind].likes).select("comment_id").eq("user_id", userId).in("comment_id", ids);
  if (error) return new Set();
  return new Set((data ?? []).map((r) => r.comment_id));
}

type TopPage = { items: ReelComment[]; nextPage: number | null };

export function useTopComments(propertyId: string, enabled: boolean, kind: CommentKind = "reel") {
  const { user } = useCurrentUser();
  const K = KINDS[kind];
  return useInfiniteQuery({
    queryKey: [K.root, propertyId, "top"],
    enabled,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<TopPage> => {
      const from = pageParam * PAGE_SIZE;
      const commentsQuery = kind === "reel"
        ? supabase.from("reel_comments").select(selectFor(kind)).eq("property_id", propertyId)
        : supabase.from("request_comments").select(selectFor(kind)).eq("request_id", propertyId);
      const { data, error } = await commentsQuery
        .is("parent_id", null)
        // المثبّت أولًا ثم الأحدث.
        .order("pinned_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data ?? []) as unknown as CommentRow[];
      const liked = await fetchMyLikedIds(user?.id, rows.map((r) => r.id), kind);
      return { items: rows.map((r) => toComment(r, liked)), nextPage: rows.length === PAGE_SIZE ? pageParam + 1 : null };
    },
    getNextPageParam: (last) => last.nextPage,
    staleTime: 10_000,
  });
}

export function useReplies(propertyId: string, parentId: string, enabled: boolean, kind: CommentKind = "reel") {
  const { user } = useCurrentUser();
  const K = KINDS[kind];
  return useQuery({
    queryKey: [K.root, propertyId, "replies", parentId],
    enabled,
    queryFn: async (): Promise<ReelComment[]> => {
      const { data, error } = await supabase
        .from(K.table)
        .select(selectFor(kind))
        .eq("parent_id", parentId)
        .order("created_at", { ascending: true })
        .limit(REPLIES_LIMIT);
      if (error) throw error;
      const rows = (data ?? []) as unknown as CommentRow[];
      const liked = await fetchMyLikedIds(user?.id, rows.map((r) => r.id), kind);
      return rows.map((r) => toComment(r, liked));
    },
    staleTime: 10_000,
  });
}

// ───────── كتابة تعليق / رد ─────────
export function useAddComment(propertyId: string, kind: CommentKind = "reel") {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const K = KINDS[kind];
  return useMutation({
    mutationFn: async ({ body, parentId }: { body: string; parentId?: string | null }) => {
      if (!user) throw new Error("not_signed_in");
      const text = body.trim();
      if (!text) throw new Error("empty");
      const comment = {
        user_id: user.id,
        body: text.slice(0, COMMENT_MAX_LENGTH),
        parent_id: parentId ?? null,
      };
      const result = kind === "reel"
        ? await supabase.from("reel_comments").insert({ ...comment, property_id: propertyId }).select("id, parent_id").single()
        : await supabase.from("request_comments").insert({ ...comment, request_id: propertyId }).select("id, parent_id").single();
      const { data, error } = result;
      if (error) {
        if (/rate_limited/i.test(error.message)) throw new Error("rate_limited");
        // رقم هاتف/رابط/بريد/حساب تواصل (الحجب الآلى على الخادم).
        if (/blocked_contact/i.test(error.message)) throw new Error("blocked_contact");
        throw error;
      }
      return data;
    },
    onSuccess: async (row) => {
      // الرد بيحدّث قائمة ردود التعليق الأصلى (+ عدّاده)، والتعليق الرئيسى بيحدّث القائمة الرئيسية.
      const jobs: Promise<unknown>[] = [qc.invalidateQueries({ queryKey: [K.root, propertyId, "top"] })];
      if (row.parent_id) jobs.push(qc.invalidateQueries({ queryKey: [K.root, propertyId, "replies", row.parent_id] }));
      // ↔ بدل invalidateQueries(["properties"|"requests"]) (كان يعيد جلب كل صفحات الفيد بعد كل تعليق): نزيد عدّاد هذا الصف فقط
      //   فى الكاش فورًا ثم نصحّحه من الخادم بجلب عمود واحد لصف واحد (lib/cacheCounters.ts).
      const root = kind === "reel" ? "properties" : "requests";
      patchCounters(qc, root, propertyId, { comments: 1 });
      void refreshCommentCount(qc, kind, propertyId);
      // ↔ إشارة لنظام التوصية: التعليق من أقوى إشارات الاهتمام (على الريلز فقط).
      if (kind === "reel") trackSignal("comment", propertyId);
      await Promise.all(jobs);
    },
  });
}

// ───────── حذف ─────────
export function useDeleteComment(propertyId: string, kind: CommentKind = "reel") {
  const qc = useQueryClient();
  const K = KINDS[kind];
  return useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await supabase.from(K.table).delete().eq("id", commentId);
      if (error) throw error;
    },
    onSuccess: async () => {
      // ↔ حذف التعليق الرئيسى يحذف ردوده معه (عدد غير معروف هنا) فنصحّح عدّاد هذا الصف فقط من الخادم (عمود واحد لصف واحد)
      //   بدل إعادة جلب الفيد كله.
      void refreshCommentCount(qc, kind, propertyId);
      await qc.invalidateQueries({ queryKey: [K.root, propertyId] });
    },
  });
}

// ───────── إعجاب بتعليق (متفائل) ─────────
type Patch = (c: ReelComment) => ReelComment;

function patchCachedComment(qc: QueryClient, propertyId: string, commentId: string, fn: Patch, kind: CommentKind) {
  const root = KINDS[kind].root;
  qc.setQueriesData<{ pages: TopPage[]; pageParams: unknown[] } | undefined>({ queryKey: [root, propertyId, "top"] }, (old) =>
    old ? { ...old, pages: old.pages.map((pg) => ({ ...pg, items: pg.items.map((c) => (c.id === commentId ? fn(c) : c)) })) } : old
  );
  qc.setQueriesData<ReelComment[] | undefined>({ queryKey: [root, propertyId, "replies"] }, (old) =>
    old ? old.map((c) => (c.id === commentId ? fn(c) : c)) : old
  );
}

// ownerId = صاحب الريل: لو المستخدم الحالى هو صاحب الريل فإعجابه بيقلب «أعجب به صاحب الريل» فورًا (تحديث متفائل).
export function useToggleCommentLike(propertyId: string, ownerId?: string, kind: CommentKind = "reel") {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const K = KINDS[kind];
  return useMutation({
    mutationFn: async ({ commentId, liked }: { commentId: string; liked: boolean }) => {
      if (!user) throw new Error("not_signed_in");
      // liked = الحالة الحالية؛ نعكسها.
      if (liked) {
        const { error } = await supabase.from(K.likes).delete().eq("comment_id", commentId).eq("user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from(K.likes).insert({ comment_id: commentId, user_id: user.id });
        if (error && error.code !== "23505") throw error; // 23505 = معجب بالفعل
      }
    },
    onMutate: ({ commentId, liked }) => {
      patchCachedComment(qc, propertyId, commentId, (c) => ({
        ...c,
        likedByMe: !liked,
        likeCount: Math.max(0, c.likeCount + (liked ? -1 : 1)),
        ownerLiked: user?.id && user.id === ownerId ? !liked : c.ownerLiked,
      }), kind);
    },
    onError: (_e, { commentId, liked }) => {
      patchCachedComment(qc, propertyId, commentId, (c) => ({
        ...c,
        likedByMe: liked,
        likeCount: Math.max(0, c.likeCount + (liked ? 1 : -1)),
        ownerLiked: user?.id && user.id === ownerId ? liked : c.ownerLiked,
      }), kind);
    },
  });
}

// ───────── تثبيت تعليق (صاحب الريل فقط — الدالة على الخادم بتتأكد) ─────────
export function usePinComment(propertyId: string, kind: CommentKind = "reel") {
  const qc = useQueryClient();
  const K = KINDS[kind];
  return useMutation({
    mutationFn: async ({ commentId, pinned }: { commentId: string; pinned: boolean }) => {
      const { error } = await supabase.rpc(K.pinRpc, { p_comment_id: commentId, p_pinned: pinned });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [K.root, propertyId, "top"] }),
  });
}
