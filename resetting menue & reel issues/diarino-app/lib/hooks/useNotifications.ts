import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { NotifCategory, NotifItem } from "../../data/mock-notifications";
import { useCurrentUser } from "./useCurrentUser";

// ↔ replaces the local-only NOTIF_DATA store with the real
// `notifications` table from 20260802000000_notifications_backend.sql —
// rows there are created entirely by DB triggers on likes/favorites/
// follows/chat_messages, so this hook only ever reads + marks-read.

export type NotifFilter = "all" | "read" | "unread";

const CATS: NotifCategory[] = ["like", "save", "follow", "chat", "alert"];

function relativeTimeAr(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `قبل ${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `قبل ${hours} س`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "أمس";
  if (days < 7) return `قبل ${days} يوم`;
  return new Date(iso).toLocaleDateString("ar-EG");
}

type DbCategory = "like" | "save" | "follow" | "chat" | "new_match" | "price_drop" | "comment" | "offer" | "approval";
// ↔ 'new_match' and 'price_drop' (20260820000000_smart_alerts.sql) are
// two distinct triggers/DB categories but share one UI tab ("التنبيهات")
// instead of getting a 5th and 6th tab each — dbCatToUiCat below is the
// only place that mapping happens.
function dbCatToUiCat(c: DbCategory): NotifCategory {
  // ↔ 'comment' (تعليق/رد على ريلك أو تعليقك — 20261013000000_reel_comments.sql) بيظهر مع إشعارات المحادثة (أيقونة الفقاعة).
  // 'approval' = قرار الأدمن على إعلانك (موافقة/رفض/حذف) — بيظهر فى الجرس مع «التنبيهات».
  if (c === "approval") return "alert";
  if (c === "comment" || c === "offer") return "chat"; // 'offer' = عرض جديد/رد على عرض (20261016000000_property_offers.sql)
  return c === "new_match" || c === "price_drop" ? "alert" : c;
}

type NotifRow = {
  id: string;
  category: DbCategory;
  text: string;
  read: boolean;
  created_at: string;
  property_id: string | null;
  chat_id: string | null;
  actor: { id: string; full_name: string | null } | null;
  // the property this notification points to — only fetched to know its
  // seller (for the `reel` action's sellerId), the property's own row
  // already carries seller_id.
  properties: { seller_id: string } | null;
};

async function fetchNotifications(userId: string): Promise<Record<NotifCategory, NotifItem[]>> {
  const { data, error } = await supabase
    .from("notifications")
    // ↔ profiles_public, not profiles — the actor (who liked/followed/
    // saved) can be any user regardless of their own privacy setting;
    // this only ever renders their name in the notification text. See
    // 20260825000000_profile_privacy_rls.sql.
    .select("id, category, text, read, created_at, property_id, chat_id, actor:profiles_public!actor_id(id, full_name), properties(seller_id)")
    .eq("recipient_id", userId)
    // ↔ إشعارات المحادثات/العروض (category = chat | offer) منفصلة عن الجرس: بتظهر كنقطة حمراء على أيقونة «العروض» وفى صفحة
    // العروض (lib/hooks/useOffersHub.ts). الجرس فيه الإعجابات والحفظ والمتابعة والتعليقات والردود وتنبيهات البحث.
    .not("category", "in", "(chat,offer)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const grouped: Record<NotifCategory, NotifItem[]> = { like: [], save: [], follow: [], chat: [], alert: [] };
  const rows = (data ?? []) as NotifRow[];

  for (const r of rows) {
    const name = r.actor?.full_name || "باراندا";
    const item: NotifItem = {
      id: r.id,
      name,
      initial: name.charAt(0),
      text: r.text,
      time: relativeTimeAr(r.created_at),
      createdAt: r.created_at,
      category: dbCatToUiCat(r.category),
      read: r.read,
      action:
        r.category === "chat" && r.chat_id
          ? { type: "chat", id: r.chat_id }
          : (r.category === "like" || r.category === "save") && r.property_id
          ? { type: "reel", sellerId: r.properties?.seller_id ?? "", propertyId: r.property_id }
          : r.category === "approval" && r.property_id
          ? { type: "reel", sellerId: r.properties?.seller_id ?? "", propertyId: r.property_id }
          : r.category === "offer"
          ? { type: "offers" }
          : r.category === "comment" && r.property_id
          ? { type: "reel", sellerId: r.properties?.seller_id ?? "", propertyId: r.property_id, comments: true }
          : r.category === "follow" && r.actor?.id
          ? { type: "seller", id: r.actor.id }
          : (r.category === "new_match" || r.category === "price_drop") && r.property_id
          ? { type: "property", id: r.property_id }
          : undefined,
    };
    grouped[dbCatToUiCat(r.category)].push(item);
  }
  return grouped;
}

export function useNotifications() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const queryKey = useMemo(() => ["notifications", user?.id], [user?.id]);

  const query = useQuery({
    queryKey,
    queryFn: () => {
      if (!user?.id) {
        return Promise.resolve({ like: [], save: [], follow: [], chat: [], alert: [] });
      }
      return fetchNotifications(user.id);
    },
    enabled: !!user?.id,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!user?.id) return;
    // ↔ Supabase's client keeps realtime channels in an internal registry
    // keyed by topic name. removeChannel() unsubscribes over the socket
    // *asynchronously* and only drops the registry entry once that
    // completes — so in React 18 dev/StrictMode (which deliberately does
    // mount → cleanup → mount again) and in any fast remount in
    // production (e.g. navigating away and back quickly), the next
    // mount's `supabase.channel(sameName)` can be handed the still-
    // registered previous channel — which is already subscribed —
    // before its teardown finished. Calling `.on()` on that channel then
    // throws exactly "cannot add postgres_changes callbacks ... after
    // subscribe()". A unique topic per effect run sidesteps the race
    // entirely; the `filter` below (not the channel name) is what scopes
    // this subscription to the current user's rows.
    const channelName = `notifications:${user.id}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${user.id}` },
        (payload) => {
          void qc.invalidateQueries({ queryKey });
          // ↔ قرار الأدمن على إعلانى (موافقة/رفض): نحدّث «إعلاناتي» فورًا فتختفى كلمة «قيد المراجعة» من الكارت من غير إعادة فتح الصفحة.
          if ((payload.new as { category?: string } | undefined)?.category === "approval") {
            void qc.invalidateQueries({ queryKey: ["properties"] });
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, qc, queryKey]);

  // ↔ فتح إشعار = تسجيله مقروء. الكتابة المباشرة على الجدول ما بقتش مسموحة (RLS: 20260822000000 شالت سياسة
  // UPDATE)، فبننده الدالة mark_notification_read (20261008000001) — بتغيّر read لإشعار المستخدم نفسه بس.
  // التحديث متفائل: النقطة الخضرا والعدّاد يختفوا فورًا، وبعدها إعادة الجلب بتأكّد من الخادم.
  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
      if (error) throw error;
    },
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<Record<NotifCategory, NotifItem[]>>(queryKey);
      if (previous) {
        const next = { ...previous };
        for (const cat of CATS) next[cat] = previous[cat].map((n) => (n.id === id ? { ...n, read: true } : n));
        qc.setQueryData(queryKey, next);
      }
      return { previous };
    },
    onError: (err) => {
      console.warn("mark notification read failed:", err);
    },
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: async (_: { userId: string }) => {
      // ↔ القائمة موحّدة (كل الفئات فى صفحة واحدة)، فـ«تحديد الكل» بيشمل كل الفئات.
      // ↔ بدون chat/offer: دول بتخص صفحة العروض ومش بيتعلّموا مقروءين من الجرس.
      const dbCategories: DbCategory[] = ["like", "save", "follow", "new_match", "price_drop", "comment", "approval"];
      const { error } = await supabase.rpc("mark_notifications_read", { p_categories: dbCategories });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  // ---- local UI-only state (which tab/filter is showing) ----
  const uiState = useNotifUiState();

  const data = query.data ?? { like: [], save: [], follow: [], chat: [], alert: [] };
  const badges: Record<NotifCategory, number> = {
    like: data.like.filter((n) => !n.read).length,
    save: data.save.filter((n) => !n.read).length,
    follow: data.follow.filter((n) => !n.read).length,
    chat: data.chat.filter((n) => !n.read).length,
    alert: data.alert.filter((n) => !n.read).length,
  };
  const totalUnread = CATS.reduce((sum, c) => sum + badges[c], 0);
  // ↔ قائمة موحّدة: كل الإشعارات (إعجاب/حفظ/متابعة/شات/تنبيهات) فى قائمة واحدة، الأحدث فى الأعلى.
  // التجميع بالتاريخ (اليوم / أمس / التاريخ) بيتم فى NotificationsDropdown من createdAt.
  const allItems = useMemo(() => {
    const merged = CATS.flatMap((c) => data[c]);
    const ts = (n: NotifItem) => (n.createdAt ? new Date(n.createdAt).getTime() : Date.now());
    return merged.sort((a, b) => ts(b) - ts(a));
  }, [data]);

  const visibleItems = allItems.filter((n) => {
    if (uiState.filter === "unread") return !n.read;
    if (uiState.filter === "read") return n.read;
    return true;
  });

  function markItemRead(_cat: NotifCategory, index: number) {
    const item = visibleItems[index];
    if (!item || item.read || !item.id) return;
    markReadMutation.mutate(item.id);
  }

  function markAllRead() {
    if (!user?.id) return;
    markAllReadMutation.mutate({ userId: user.id });
  }

  return {
    activeCat: uiState.activeCat,
    setActiveCat: uiState.setActiveCat,
    filter: uiState.filter,
    setFilter: uiState.setFilter,
    badges,
    totalUnread,
    visibleItems,
    markItemRead,
    markAllRead,
  };
}

// ---------------------------------------------------------------------
// Module-level UI state storage with explicit interface definition
// ---------------------------------------------------------------------
interface NotifUiSnapshot {
  activeCat: NotifCategory;
  filter: NotifFilter;
}

let activeCat: NotifCategory = "like";
let filter: NotifFilter = "all";
let uiSnapshot: NotifUiSnapshot = { activeCat, filter };
const uiListeners = new Set<() => void>();

function emitUi() {
  uiSnapshot = { activeCat, filter };
  uiListeners.forEach((l) => l());
}

function subscribeUi(listener: () => void) {
  uiListeners.add(listener);
  return () => {
    uiListeners.delete(listener);
  };
}

function getUiSnapshot(): NotifUiSnapshot {
  return uiSnapshot;
}

function useNotifUiState() {
  const snap = useSyncExternalStore(subscribeUi, getUiSnapshot);
  return {
    activeCat: snap.activeCat,
    filter: snap.filter,
    setActiveCat: (cat: NotifCategory) => {
      activeCat = cat;
      emitUi();
    },
    setFilter: (f: NotifFilter) => {
      filter = f;
      emitUi();
    },
  };
}