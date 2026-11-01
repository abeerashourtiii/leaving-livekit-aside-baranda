import { memo } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import Svg, { Path } from "react-native-svg";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { ReelComment, useReplies } from "../../lib/hooks/useComments";
import { cldThumbnail } from "../../lib/cloudinary";
import { timeAgo } from "../../lib/timeAgo";
import { usePublicProfile } from "../../lib/hooks/usePublicProfile";

// ↔ عنصر تعليق/رد واحد + «سلسلة الردود» (مخفية لحد ما حد يضغط «عرض الردود»).
// تمييز صاحب الريل: اسمه بلون أزرق + خلفية زرقاء خفيفة وشريط جانبى (بدون شارة نصية) — بتنطبق على تعليقه وعلى ردوده.
// إعجاب صاحب الريل بتعليق: شارة صورته الصغيرة بقلب أحمر (زى يوتيوب) بدل جملة «أعجب به صاحب الريل».
const GREEN = "#22A652";
const OWNER_BLUE = "#2563EB";

export type CommentActions = {
  onLike: (c: ReelComment) => void;
  onReply: (c: ReelComment) => void;
  onReport: (c: ReelComment) => void;
  onDelete: (c: ReelComment) => void;
  onPin: (c: ReelComment) => void;
};

type ItemProps = CommentActions & {
  comment: ReelComment;
  isReply?: boolean;
  ownerId: string; // صاحب الريل
  currentUserId: string | undefined;
  rootAuthorId: string; // صاحب التعليق الأصلى (عشان نعرض «ردًا على فلان» لما الرد على شخص تانى)
};

function HeartGlyph({ filled, color }: { filled: boolean; color: string }) {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill={filled ? "#ef4444" : "none"} stroke={filled ? "#ef4444" : color} strokeWidth={2}>
      <Path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z" />
    </Svg>
  );
}

const CommentRow = memo(function CommentRow({
  comment, isReply, ownerId, currentUserId, rootAuthorId, onLike, onReply, onReport, onDelete, onPin,
}: ItemProps) {
  const { t, language } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const isOwner = comment.userId === ownerId;
  const isMine = comment.userId === currentUserId;
  const viewerIsOwner = !!currentUserId && currentUserId === ownerId;
  const canDelete = isMine || viewerIsOwner; // صاحب الريل يدير تعليقات ريله
  const canPin = viewerIsOwner && !isReply; // التثبيت لتعليق رئيسى فقط
  const size = isReply ? 28 : 34;
  const showReplyTo = isReply && !!comment.replyToName && comment.replyToUserId !== rootAuthorId;

  return (
    <View style={[styles.row, isReply && styles.replyRow, isOwner && styles.ownerRow]}>
      <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }, isOwner && styles.avatarOwner]}>
        {comment.author.avatarUrl ? (
          <Image source={{ uri: cldThumbnail(comment.author.avatarUrl) }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
        ) : (
          <Text style={[styles.avatarText, { fontSize: Math.floor(size * 0.45) }]}>{comment.author.initial}</Text>
        )}
      </View>

      <View style={styles.body}>
        {comment.pinned && (
          <Text style={styles.pinned}>{`📌 ${t("مثبّت")}`}</Text>
        )}
        <View style={styles.metaRow}>
          {/* ↔ تعليق صاحب الريل: اسمه بأزرق مميز (بدل شارة «صاحب الريل»). */}
          <Text style={[styles.name, isOwner && styles.ownerName]} numberOfLines={1}>{comment.author.name}</Text>
          {comment.author.verified && <Text style={styles.verified}>✓</Text>}
          <Text style={styles.time}>{timeAgo(comment.createdAt, language)}</Text>
        </View>

        <Text style={styles.text}>
          {showReplyTo ? <Text style={styles.mention}>{`@${comment.replyToName} `}</Text> : null}
          {comment.body}
        </Text>

        <View style={styles.actions}>
          <Pressable style={styles.actionBtn} onPress={() => onLike(comment)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("إعجاب")}>
            <HeartGlyph filled={comment.likedByMe} color={themeColors.textSubtle} />
            {comment.likeCount > 0 && <Text style={[styles.actionText, comment.likedByMe && { color: "#ef4444" }]}>{comment.likeCount}</Text>}
          </Pressable>
          {/* ↔ إعجاب صاحب الريل (زى يوتيوب): صورته الصغيرة بقلب أحمر صغير، منفصلة وبدون أى كتابة. */}
          {comment.ownerLiked && !isOwner && <OwnerLikeBadge ownerId={ownerId} />}
          <Pressable onPress={() => onReply(comment)} hitSlop={8}>
            <Text style={styles.actionText}>{t("رد")}</Text>
          </Pressable>
          {canPin && (
            <Pressable onPress={() => onPin(comment)} hitSlop={8}>
              <Text style={styles.actionText}>{comment.pinned ? t("إلغاء التثبيت") : t("تثبيت")}</Text>
            </Pressable>
          )}
          {canDelete ? (
            <Pressable onPress={() => onDelete(comment)} hitSlop={8}>
              <Text style={[styles.actionText, { color: "#DC2626" }]}>{t("حذف")}</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => onReport(comment)} hitSlop={8}>
              <Text style={styles.actionText}>{t("إبلاغ")}</Text>
            </Pressable>
          )}
        </View>

      </View>
    </View>
  );
});

// ↔ شارة «إعجاب صاحب الريل»: صورة صاحب الريل (أو أول حرف من اسمه) دايرة صغيرة + قلب أحمر فى الركن. بتقرا البروفايل العام
// (React Query بيعمل cache بالـ id فمفيش طلبات متكررة لكل تعليق).
function OwnerLikeBadge({ ownerId }: { ownerId: string }) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { data: owner } = usePublicProfile(ownerId);
  const initial = (owner?.name?.trim()?.[0] ?? "").toUpperCase();
  return (
    <View style={styles.ownerLikeBadge} accessibilityLabel={t("أعجب به صاحب الريل")}>
      <View style={styles.ownerLikeAvatar}>
        {owner?.avatarUrl ? (
          <Image source={{ uri: cldThumbnail(owner.avatarUrl) }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
        ) : (
          <Text style={styles.ownerLikeInitial}>{initial}</Text>
        )}
      </View>
      <View style={styles.ownerLikeHeart}>
        <Svg width={8} height={8} viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth={2}>
          <Path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z" />
        </Svg>
      </View>
    </View>
  );
}

type ThreadProps = CommentActions & {
  comment: ReelComment;
  propertyId: string;
  ownerId: string;
  currentUserId: string | undefined;
  expanded: boolean;
  onToggleExpanded: (rootId: string) => void;
};

// ↔ تعليق رئيسى + (لو عنده ردود) زرار «عرض N ردود» — الردود نفسها ما بتتحمّلش إلا بعد الضغط (useReplies enabled=expanded).
export function CommentThread({ comment, propertyId, ownerId, currentUserId, expanded, onToggleExpanded, ...actions }: ThreadProps) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const replies = useReplies(propertyId, comment.id, expanded && comment.replyCount > 0);

  return (
    <View>
      <CommentRow comment={comment} ownerId={ownerId} currentUserId={currentUserId} rootAuthorId={comment.userId} {...actions} />

      {comment.replyCount > 0 && (
        <Pressable style={styles.toggleRow} onPress={() => onToggleExpanded(comment.id)} hitSlop={6} accessibilityRole="button">
          <View style={styles.toggleLine} />
          <Text style={styles.toggleText}>
            {expanded
              ? t("إخفاء الردود")
              : `${t("عرض الردود")} (${comment.replyCount})`}
          </Text>
        </Pressable>
      )}

      {expanded && comment.replyCount > 0 && (
        <View>
          {replies.isLoading && <ActivityIndicator size="small" color={GREEN} style={{ marginVertical: 8 }} />}
          {replies.isError && <Text style={styles.errorText}>{t("تعذر تحميل الردود")}</Text>}
          {(replies.data ?? []).map((r) => (
            <CommentRow
              key={r.id}
              comment={r}
              isReply
              ownerId={ownerId}
              currentUserId={currentUserId}
              rootAuthorId={comment.userId}
              {...actions}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    row: { flexDirection: "row", gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12 },
    replyRow: { marginStart: 44 },
    // تمييز صاحب الريل
    ownerRow: { backgroundColor: themeColors.isDark ? "rgba(37,99,235,0.16)" : "rgba(37,99,235,0.08)", borderStartWidth: 3, borderStartColor: OWNER_BLUE },
    avatar: { backgroundColor: GREEN, alignItems: "center", justifyContent: "center", overflow: "hidden" },
    avatarOwner: { borderWidth: 2, borderColor: OWNER_BLUE, backgroundColor: GREEN },
    avatarText: { color: "white", fontWeight: "900" },
    body: { flex: 1, gap: 3 },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
    name: { fontSize: 12.5, fontWeight: "800", color: themeColors.text, maxWidth: "55%" },
    verified: { color: "#2563EB", fontSize: 11, fontWeight: "900" },
    ownerName: { color: OWNER_BLUE },
    time: { fontSize: 11, color: themeColors.textSubtle },
    text: { fontSize: 13.5, lineHeight: 21, color: themeColors.text },
    mention: { color: GREEN, fontWeight: "800" },
    pinned: { fontSize: 10.5, fontWeight: "900", color: themeColors.textSubtle },
    ownerLikeBadge: { width: 24, height: 22, justifyContent: "center" },
    ownerLikeAvatar: { width: 20, height: 20, borderRadius: 10, backgroundColor: GREEN, alignItems: "center", justifyContent: "center", overflow: "hidden" },
    ownerLikeInitial: { color: "white", fontSize: 10, fontWeight: "900" },
    ownerLikeHeart: { position: "absolute", end: 0, bottom: 0, width: 13, height: 13, borderRadius: 7, backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: themeColors.card },
    actions: { flexDirection: "row", alignItems: "center", gap: 18, marginTop: 2 },
    actionBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
    actionText: { fontSize: 11.5, fontWeight: "800", color: themeColors.textSubtle },
    toggleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginStart: 56, paddingVertical: 4 },
    toggleLine: { width: 22, height: 1, backgroundColor: themeColors.border },
    toggleText: { fontSize: 12, fontWeight: "800", color: themeColors.textSubtle },
    errorText: { fontSize: 12, color: "#DC2626", marginStart: 56, marginVertical: 6 },
  });
}
