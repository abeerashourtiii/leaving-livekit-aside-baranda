import { useCallback, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, ActivityIndicator, Platform, type GestureResponderHandlers } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Property } from "../../lib/types";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import {
  COMMENT_MAX_LENGTH, ReelComment, useAddComment, useDeleteComment, usePinComment, useToggleCommentLike, useTopComments,
} from "../../lib/hooks/useComments";
import { promptGuestLogin } from "../../lib/guestGate";
import { blockedCommentReason } from "../../lib/commentGuard";
import { showToast } from "../shared/Toast";
import { ReportModal } from "../shared/ReportModal";
import { ConfirmModal } from "../shared/ConfirmModal";
import { CommentThread } from "./ReelCommentItem";

// ↔ لوحة تعليقات الريل — بتتعرض جوه نفس «اللوحة السفلية» اللى بتفتح بيها تفاصيل العقار (ReelCard.tsx): الريل بيتصغّر فوق
// وبيفضل شغّال، والتعليقات تحته. شغالة بنفس الكود على أندرويد/آيفون/الويب/APK.
//  • التعليقات الرئيسية الأحدث أولًا + «عرض المزيد».
//  • الردود مخفية لحد ما حد يضغط «عرض الردود».
//  • أى مستخدم مسجَّل (مش ضيف) يقدر يعجب أو يرد؛ الضيف بيتحوّل لشاشة التسجيل.
//  • تعليقات وردود صاحب الريل متميّزة (شارة + خلفية خضراء).
const GREEN = "#22A652";
// ↔ الإعلانات التجريبية (data/mock-properties) ids بتاعتها مش UUID فمفيش تعليقات حقيقية ليها.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = {
  property: Property;
  // ↔ بتتمرّر من ReelCard عشان سحب اللوحة لأسفل لإغلاقها يشتغل من أول القائمة (نفس سلوك لوحة التفاصيل).
  scrollAreaProps?: GestureResponderHandlers;
  onScrollY?: (y: number) => void;
  bottomInset?: number;
};

type ReplyTarget = { comment: ReelComment; rootId: string };

export function ReelCommentsPanel({ property, scrollAreaProps, onScrollY, bottomInset = 0 }: Props) {
  const { t, language } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { user } = useCurrentUser();
  const isGuest = !user || !!user.is_anonymous;
  const ownerId = property.seller.id;

  const isReal = UUID_RE.test(property.id);
  const top = useTopComments(property.id, isReal);
  const add = useAddComment(property.id);
  const del = useDeleteComment(property.id);
  const like = useToggleCommentLike(property.id, ownerId);
  const pin = usePinComment(property.id);

  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reportTarget, setReportTarget] = useState<ReelComment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReelComment | null>(null);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);

  const comments = useMemo(() => top.data?.pages.flatMap((p) => p.items) ?? [], [top.data]);
  const total = property.comments ?? comments.length;

  const toggleExpanded = useCallback((rootId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId);
      else next.add(rootId);
      return next;
    });
  }, []);

  const handleLike = useCallback((c: ReelComment) => {
    if (isGuest) return promptGuestLogin("generic");
    like.mutate({ commentId: c.id, liked: c.likedByMe }, { onError: () => showToast(t("تعذر تنفيذ الإعجاب، حاول مرة أخرى")) });
  }, [isGuest, like, t]);

  const handleReply = useCallback((c: ReelComment) => {
    if (isGuest) return promptGuestLogin("generic");
    setReplyTo({ comment: c, rootId: c.parentId ?? c.id });
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [isGuest]);

  const handleReport = useCallback((c: ReelComment) => {
    if (isGuest) return promptGuestLogin("generic");
    setReportTarget(c);
  }, [isGuest]);

  const handleDelete = useCallback((c: ReelComment) => setDeleteTarget(c), []);

  const handlePin = useCallback((c: ReelComment) => {
    pin.mutate(
      { commentId: c.id, pinned: !c.pinned },
      {
        onSuccess: () => { showToast(c.pinned ? t("تم إلغاء تثبيت التعليق") : t("تم تثبيت التعليق")); scrollRef.current?.scrollTo({ y: 0, animated: true }); },
        onError: () => showToast(t("تعذر تثبيت التعليق")),
      }
    );
  }, [pin, t]);

  function submit() {
    if (isGuest) return promptGuestLogin("generic");
    const body = draft.trim();
    if (!body || add.isPending) return;
    // ↔ حجب الأرقام والروابط وحسابات التواصل (نفس قاعدة الخادم) — تنبيه فورى قبل الإرسال.
    if (blockedCommentReason(body)) {
      showToast(t("لا يمكن نشر أرقام هواتف أو روابط أو حسابات تواصل في التعليقات"));
      return;
    }
    const target = replyTo;
    add.mutate(
      { body, parentId: target?.comment.id ?? null },
      {
        onSuccess: () => {
          setDraft("");
          setReplyTo(null);
          if (target) {
            // ردّى يظهر فورًا: نفتح سلسلة الردود للتعليق الأصلى.
            setExpanded((prev) => new Set(prev).add(target.rootId));
          } else {
            scrollRef.current?.scrollTo({ y: 0, animated: true });
          }
        },
        onError: (err) => {
          const code = err instanceof Error ? err.message : "";
          if (code === "rate_limited") showToast(t("أرسلت تعليقات كثيرة، انتظر قليلًا ثم حاول مرة أخرى"));
          else if (code === "blocked_contact") showToast(t("لا يمكن نشر أرقام هواتف أو روابط أو حسابات تواصل في التعليقات"));
          else showToast(t("تعذر إرسال التعليق، حاول مرة أخرى"));
        },
      }
    );
  }

  function confirmDelete() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    del.mutate(target.id, {
      onSuccess: () => showToast(t("تم حذف التعليق")),
      onError: () => showToast(t("تعذر حذف التعليق")),
    });
  }

  if (!isReal) {
    return (
      <View style={[styles.stateBox, { flex: 1, justifyContent: "center" }]}>
        <Text style={styles.emptyEmoji}>💬</Text>
        <Text style={styles.stateText}>{t("التعليقات غير متاحة على الإعلانات التجريبية")}</Text>
      </View>
    );
  }

  const actions = { onLike: handleLike, onReply: handleReply, onReport: handleReport, onDelete: handleDelete, onPin: handlePin };
  const remaining = COMMENT_MAX_LENGTH - draft.length;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("التعليقات")}</Text>
        <Text style={styles.count}>{total.toLocaleString(language === "en" ? "en-US" : "ar-EG")}</Text>
      </View>

      <View style={{ flex: 1 }} {...(scrollAreaProps ?? {})}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScroll={(e) => onScrollY?.(e.nativeEvent.contentOffset.y)}
          scrollEventThrottle={16}
        >
          {top.isLoading && <ActivityIndicator color={GREEN} style={{ marginVertical: 24 }} />}

          {top.isError && (
            <View style={styles.stateBox}>
              <Text style={styles.stateText}>{t("تعذر تحميل التعليقات")}</Text>
              <Pressable style={styles.retryBtn} onPress={() => top.refetch()}>
                <Text style={styles.retryText}>{t("إعادة المحاولة")}</Text>
              </Pressable>
            </View>
          )}

          {!top.isLoading && !top.isError && comments.length === 0 && (
            <View style={styles.stateBox}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.stateText}>{t("لا توجد تعليقات بعد. كن أول من يعلّق!")}</Text>
            </View>
          )}

          {comments.map((c) => (
            <CommentThread
              key={c.id}
              comment={c}
              propertyId={property.id}
              ownerId={ownerId}
              currentUserId={user?.id}
              expanded={expanded.has(c.id)}
              onToggleExpanded={toggleExpanded}
              {...actions}
            />
          ))}

          {top.hasNextPage && (
            <Pressable style={styles.moreBtn} onPress={() => top.fetchNextPage()} disabled={top.isFetchingNextPage}>
              {top.isFetchingNextPage ? <ActivityIndicator size="small" color={GREEN} /> : <Text style={styles.moreText}>{t("عرض المزيد من التعليقات")}</Text>}
            </Pressable>
          )}
        </ScrollView>
      </View>

      {/* ───────── شريط الكتابة ───────── */}
      <View style={[styles.composer, { paddingBottom: Math.max(bottomInset, 8) }]}>
        {replyTo && (
          <View style={styles.replyChip}>
            <Text style={styles.replyChipText} numberOfLines={1}>{`${t("الرد على")} ${replyTo.comment.author.name}`}</Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={10} accessibilityLabel={t("إلغاء الرد")}>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={themeColors.textSubtle} strokeWidth={2.5}>
                <Path d="M6 6l12 12M18 6L6 18" />
              </Svg>
            </Pressable>
          </View>
        )}

        {isGuest ? (
          <Pressable style={styles.guestBar} onPress={() => promptGuestLogin("generic")}>
            <Text style={styles.guestText}>{t("سجّل الدخول لإضافة تعليق")}</Text>
          </Pressable>
        ) : (
          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={replyTo ? t("اكتب ردك...") : t("أضف تعليقًا...")}
              placeholderTextColor={themeColors.textSubtle}
              multiline
              maxLength={COMMENT_MAX_LENGTH}
              // على الويب Enter بيضيف سطر جديد (الإرسال بالزر)، زى باقى الحقول متعددة الأسطر فى التطبيق.
              textAlignVertical={Platform.OS === "android" ? "top" : undefined}
            />
            <Pressable
              style={[styles.sendBtn, (!draft.trim() || add.isPending) && styles.sendBtnDisabled]}
              onPress={submit}
              disabled={!draft.trim() || add.isPending}
              accessibilityRole="button"
              accessibilityLabel={t("إرسال")}
            >
              {add.isPending ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </Svg>
              )}
            </Pressable>
          </View>
        )}
        {!isGuest && remaining <= 80 && <Text style={[styles.counter, remaining <= 20 && { color: "#DC2626" }]}>{remaining}</Text>}
      </View>

      <ReportModal
        visible={!!reportTarget}
        onClose={() => setReportTarget(null)}
        quickMode
        targetType="comment"
        targetId={reportTarget?.id ?? ""}
        targetTitle={reportTarget ? reportTarget.body.slice(0, 120) : ""}
      />
      <ConfirmModal
        visible={!!deleteTarget}
        title={t("حذف التعليق")}
        text={deleteTarget && deleteTarget.replyCount > 0 ? t("سيُحذف التعليق وكل الردود عليه. هل تريد المتابعة؟") : t("هل تريد حذف هذا التعليق؟")}
        confirmLabel={t("حذف")}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingBottom: 8, paddingHorizontal: 44 },
    title: { fontSize: 14.5, fontWeight: "900", color: themeColors.text },
    count: { fontSize: 12.5, fontWeight: "800", color: themeColors.textSubtle },
    listContent: { paddingBottom: 12 },
    stateBox: { alignItems: "center", gap: 10, paddingVertical: 28, paddingHorizontal: 20 },
    emptyEmoji: { fontSize: 30 },
    stateText: { fontSize: 13, color: themeColors.textSubtle, textAlign: "center", lineHeight: 20 },
    retryBtn: { backgroundColor: themeColors.surface, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
    retryText: { fontSize: 12.5, fontWeight: "800", color: GREEN },
    moreBtn: { alignSelf: "center", paddingHorizontal: 18, paddingVertical: 9, marginTop: 6, borderRadius: 999, backgroundColor: themeColors.surface, minWidth: 140, alignItems: "center" },
    moreText: { fontSize: 12.5, fontWeight: "800", color: themeColors.textMuted },
    composer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: themeColors.border, paddingTop: 8, paddingHorizontal: 12, gap: 6, backgroundColor: themeColors.card },
    replyChip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, backgroundColor: themeColors.surface, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
    replyChipText: { flex: 1, fontSize: 12, fontWeight: "700", color: themeColors.textMuted },
    inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
    input: {
      flex: 1, maxHeight: 96, minHeight: 40, backgroundColor: themeColors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9,
      fontSize: 14, color: themeColors.text,
    },
    sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
    sendBtnDisabled: { opacity: 0.45 },
    counter: { fontSize: 11, color: themeColors.textSubtle, alignSelf: "flex-end" },
    guestBar: { backgroundColor: themeColors.surface, borderRadius: 20, paddingVertical: 11, alignItems: "center" },
    guestText: { fontSize: 13, fontWeight: "800", color: GREEN },
  });
}
