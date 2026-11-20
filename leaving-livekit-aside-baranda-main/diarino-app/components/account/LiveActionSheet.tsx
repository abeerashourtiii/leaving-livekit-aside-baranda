import { useState } from "react";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Path, Rect, Circle } from "react-native-svg";
import { ActionSheet, ActionSheetItem } from "../shared/ActionSheet";
import { ConfirmModal } from "../shared/ConfirmModal";
import { SavedLive } from "../../data/saved-live-types";
import { useMyContent } from "../../lib/hooks/useMyContent";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { uploadToCloudinary } from "../../lib/cloudinary";
import { useLogMedia } from "../../lib/hooks/useMedia";
import { showToast } from "../shared/Toast";

type Props = { visible: boolean; live: SavedLive | null; onClose: () => void };

// ActionSheet بيقفل نفسه (onClose) قبل ما يشغّل إجراء الصف، وأمّ الشاشة بتصفّر `live`
// أول ما يتقفل. فنافذتا التأكيد (حذف اللايف / إخفاء التعليقات) لازم تعيشوا خارج الـ sheet
// ومعاهم اللايف المستهدف محفوظ فى state — قبل كده كانوا جوه نفس المكوّن اللى بيرجّع null
// لما `live` يبقى null، فنافذة التأكيد ما كانتش بتظهر أبدًا. وعلى آيفون فتح Modal فى نفس
// لحظة قفل التانى بيتتجاهل، فبنتأخر شوية بعد القفل.
const AFTER_SHEET_CLOSE_MS = 350;

export function LiveActionSheet({ visible, live, onClose }: Props) {
  const { t } = useLanguage();
  const { toggleSavedLiveComments, removeSavedLive } = useMyContent();
  const [deleteTarget, setDeleteTarget] = useState<SavedLive | null>(null);
  const [commentsTarget, setCommentsTarget] = useState<SavedLive | null>(null);
  const willHideComments = commentsTarget ? !commentsTarget.commentsHidden : true;

  return (
    <>
      {live && (
        <LiveActionSheetInner
          visible={visible}
          live={live}
          onClose={onClose}
          onRequestDelete={(l) => setTimeout(() => setDeleteTarget(l), AFTER_SHEET_CLOSE_MS)}
          onRequestComments={(l) => setTimeout(() => setCommentsTarget(l), AFTER_SHEET_CLOSE_MS)}
        />
      )}

      <ConfirmModal
        visible={!!commentsTarget}
        title={willHideComments ? t("إخفاء التعليقات والتفاعلات؟") : t("إظهار التعليقات والتفاعلات؟")}
        text={
          commentsTarget
            ? willHideComments
              ? `${t("عند إخفاء التعليقات لن تظهر التعليقات ولا التفاعلات في إعادة بث")} "${t(commentsTarget.title)}".`
              : `${t("عند إظهار التعليقات ستُعرض التعليقات في إعادة بث")} "${t(commentsTarget.title)}".`
            : ""
        }
        confirmLabel={willHideComments ? t("تأكيد الإخفاء") : t("تأكيد الإظهار")}
        onCancel={() => setCommentsTarget(null)}
        onConfirm={() => {
          if (commentsTarget) toggleSavedLiveComments(commentsTarget.id);
          setCommentsTarget(null);
        }}
      />

      <ConfirmModal
        visible={!!deleteTarget}
        title={t("حذف اللايف")}
        text={deleteTarget ? `${t("هل أنت متأكد من حذف")} "${t(deleteTarget.title)}"؟ ${t("سيتم حذفه نهائياً من حسابك ومن صفحة المعلن إن كان منشوراً.")}` : ""}
        confirmLabel={t("حذف")}
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            removeSavedLive(deleteTarget.id);
            showToast(t("تم حذف اللايف"));
          }
          setDeleteTarget(null);
        }}
      />
    </>
  );
}

type InnerProps = {
  visible: boolean;
  live: SavedLive;
  onClose: () => void;
  onRequestDelete: (live: SavedLive) => void;
  onRequestComments: (live: SavedLive) => void;
};

function LiveActionSheetInner({ visible, live, onClose, onRequestDelete, onRequestComments }: InnerProps) {
  const { t } = useLanguage();
  const { user } = useCurrentUser();
  const logMedia = useLogMedia();
  const { togglePinLive, toggleSavedLivePublic, updateSavedLive } = useMyContent();

  async function pickPoster() {
    if (!user?.id) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [9, 16],
      quality: 0.8,
    });
    if (result.canceled) return;

    const uri = result.assets[0].uri;
    try {
      const uploadResult = await uploadToCloudinary(uri, "image");
      logMedia.mutate({ ownerId: user.id, type: "image", context: "live_poster", contextId: live!.id, result: uploadResult });
      updateSavedLive(live!.id, { posterUrl: uploadResult.url });
    } catch {
      showToast(`${t("تعذر رفع الصورة")} — ${t("حاول مرة أخرى.")}`);
    }
  }

  const handleWatchReplay = () => {
    onClose(); // إغلاق الـ Sheet أولاً قبل الانتقال
    router.push({
      pathname: "/live/replay/[id]",
      params: { id: live.id },
    });
  };

  const items: ActionSheetItem[] = [
    {
      key: "watch",
      label:
        live.recordingStatus === "ready" ? t("مشاهدة التسجيل")
        : live.recordingStatus === "processing" ? t("جارٍ معالجة التسجيل...")
        : t("فشل التسجيل"),
      disabled: live.recordingStatus !== "ready",
      icon: (p) => <Path {...p} d="M8 5v14l11-7z" />,
      onPress: handleWatchReplay,
    },
    {
      key: "poster",
      label: t("تغيير صورة اللايف"),
      icon: (p) => <><Rect {...p} x={3} y={3} width={18} height={18} rx={2} fill="none" /><Circle cx={8.5} cy={8.5} r={1.5} fill={p.stroke as string} /><Path {...p} d="M21 15l-5-5L5 21" /></>,
      onPress: pickPoster,
    },
    {
      key: "publish",
      label: live.publishedPublic ? t("تحويل لخاص (رفع من المعلن)") : t("نشر للعام (إضافة لصفحة المعلن)"),
      icon: (p) => live.publishedPublic
        ? <Path {...p} d="M17.94 17.94A10.94 10.94 0 0112 20c-7 0-11-8-11-8a20.5 20.5 0 015.06-5.94M9.9 4.24A9.94 9.94 0 0112 4c7 0 11 8 11 8a20.53 20.53 0 01-3.16 4.19M1 1l22 22" />
        : <><Path {...p} d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><Circle {...p} cx={12} cy={12} r={3} /></>,
      onPress: () => toggleSavedLivePublic(live.id),
    },
    {
      key: "pin",
      label: live.pinned ? t("إلغاء التثبيت") : t("تثبيت في أعلى صفحة المعلن"),
      icon: (p) => <Path {...p} d="M12 17v5M9 10.76V6a2 2 0 012-2h2a2 2 0 012 2v4.76a2 2 0 00.4 1.2L18 15H6l2.6-3.04a2 2 0 00.4-1.2z" />,
      onPress: () => {
        const result = togglePinLive(live.id);
        // Alert.alert مبيظهرش على الويب — Toast بيشتغل على كل المنصات.
        if (result === "limit") showToast(t("الحد الأقصى ٣ لايفات مثبتة"));
      },
    },
    {
      key: "comments",
      label: live.commentsHidden ? t("إظهار التعليقات والتفاعلات") : t("إخفاء التعليقات والتفاعلات"),
      icon: (p) => live.commentsHidden
        ? <Path {...p} d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        : <Path {...p} d="M17.94 17.94A10.94 10.94 0 0112 20c-7 0-11-8-11-8a20.5 20.5 0 015.06-5.94M9.9 4.24A9.94 9.94 0 0112 4c7 0 11 8 11 8a20.53 20.53 0 01-3.16 4.19M1 1l22 22" />,
      onPress: () => onRequestComments(live),
    },
    {
      key: "delete",
      label: t("حذف اللايف"),
      danger: true,
      icon: (p) => <Path {...p} d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />,
      onPress: () => onRequestDelete(live),
    },
  ];

  return <ActionSheet visible={visible} title={t(live.title)} items={items} onClose={onClose} />;
}
