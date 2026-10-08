import { useState } from "react";
import { router } from "expo-router";
import { Path } from "react-native-svg";
import { ActionSheet, ActionSheetItem } from "../shared/ActionSheet";
import { ConfirmModal } from "../shared/ConfirmModal";
import { showToast } from "../shared/Toast";
import { Property } from "../../lib/types";
import { MAX_PINNED_PROPERTIES, useDeleteProperty, useTogglePinProperty } from "../../lib/hooks/useProperties";
import { useLanguage } from "../../lib/hooks/useLanguage";

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000; // ↔ EDIT_WINDOW_MS / canEdit()

function canEditAd(createdAt: number): boolean {
  return Date.now() - createdAt < EDIT_WINDOW_MS;
}

// ActionSheet بيقفل نفسه (onClose) قبل ما يشغّل إجراء الصف. على آيفون فتح Modal
// تانى فى نفس اللحظة اللى الأول بيتقفل فيها بيتتجاهل، فالإجراءات اللى بتفتح
// شاشة/نافذة بتتأخر شوية بعد القفل.
const AFTER_SHEET_CLOSE_MS = 350;

type Props = { visible: boolean; ad: Property | null; pinnedCount: number; onClose: () => void };

export function AdActionSheet({ visible, ad, pinnedCount, onClose }: Props) {
  const { t } = useLanguage();
  // ↔ إصلاح: «حذف الإعلان» ماكانش بيعمل حاجة — ConfirmModal كان بيتعرض جوه نفس
  // المكوّن اللى بيرجّع null أول ما `ad` يبقى null (الـ sheet بيقفل نفسه قبل
  // الإجراء وأمّ الشاشة بتصفّر ad)، فنافذة التأكيد ما كانتش بتظهر أبدًا.
  // دلوقتى الإعلان المطلوب حذفه محفوظ هنا ومستقل عن `ad`.
  const [pendingDelete, setPendingDelete] = useState<Property | null>(null);
  const deleteProperty = useDeleteProperty();
  const togglePin = useTogglePinProperty();

  const maxPinnedMsg = t("الحد الأقصى ٣ إعلانات مثبتة — ألغِ تثبيت إعلان آخر أولًا");

  function handlePin(target: Property) {
    // Alert.alert مبيظهرش على الويب، فكل الرسائل هنا Toast (شغال على الكل).
    if (!target.pinned && pinnedCount >= MAX_PINNED_PROPERTIES) {
      showToast(maxPinnedMsg);
      return;
    }
    togglePin.mutate(
      { id: target.id, pinned: !target.pinned },
      {
        onSuccess: () => showToast(target.pinned ? t("تم إلغاء التثبيت") : t("تم تثبيت الإعلان في صفحة المعلن")),
        onError: (err) => showToast(err instanceof Error && err.message === "max_pinned" ? maxPinnedMsg : t("تعذر تحديث التثبيت، حاول مرة أخرى")),
      }
    );
  }

  const items: ActionSheetItem[] = ad ? [
    {
      key: "edit",
      label: canEditAd(ad.createdAt) ? t("تعديل الإعلان") : t("تعديل غير متاح (انتهت المدة)"),
      disabled: !canEditAd(ad.createdAt),
      icon: (p) => <Path {...p} d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4z" />,
      onPress: () => {
        if (!canEditAd(ad.createdAt)) return;
        setTimeout(() => router.push({ pathname: "/publish/create-listing", params: { editId: ad.id } }), AFTER_SHEET_CLOSE_MS);
      },
    },
    {
      key: "pin",
      label: ad.pinned ? t("إلغاء التثبيت") : t("تثبيت في أعلى صفحة المعلن"),
      icon: (p) => <Path {...p} d="M12 17v5M9 10.76V6a2 2 0 012-2h2a2 2 0 012 2v4.76a2 2 0 00.4 1.2L18 15H6l2.6-3.04a2 2 0 00.4-1.2z" />,
      onPress: () => handlePin(ad),
    },
    {
      key: "delete",
      label: t("حذف الإعلان"),
      danger: true,
      icon: (p) => <Path {...p} d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />,
      onPress: () => setTimeout(() => setPendingDelete(ad), AFTER_SHEET_CLOSE_MS),
    },
  ] : [];

  return (
    <>
      {ad && <ActionSheet visible={visible} title={t(ad.shortTitle || ad.title)} items={items} onClose={onClose} />}
      <ConfirmModal
        visible={!!pendingDelete}
        title={t("حذف الإعلان")}
        text={pendingDelete ? `${t("هل أنت متأكد من حذف")} "${t(pendingDelete.shortTitle || pendingDelete.title)}"؟ ${t("لا يمكن التراجع عن هذا الإجراء.")}` : ""}
        confirmLabel={t("حذف")}
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (!target) return;
          deleteProperty.mutate(target.id, {
            onSuccess: () => showToast(t("تم حذف الإعلان")),
            onError: () => showToast(t("تعذر حذف الإعلان، حاول مرة أخرى")),
          });
        }}
      />
    </>
  );
}
