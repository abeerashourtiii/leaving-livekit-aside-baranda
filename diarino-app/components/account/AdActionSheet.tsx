import { useState } from "react";
import { router, type Href } from "expo-router";
import { Path } from "react-native-svg";
import { ActionSheet, ActionSheetItem } from "../shared/ActionSheet";
import { ConfirmModal } from "../shared/ConfirmModal";
import { showToast } from "../shared/Toast";
import { Property } from "../../lib/types";
import { MAX_PINNED_PROPERTIES, useDeleteProperty, useTogglePinProperty } from "../../lib/hooks/useProperties";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { useMyDeals, DEAL_STATUS_LABELS } from "../../lib/hooks/useDeals";
import { DealReportModal } from "./DealReportModal";
import { PromoteAdModal } from "./PromoteAdModal";
import { useMyPromotions, livePromotionsFor, PROMO_STATUS_LABELS } from "../../lib/hooks/usePromotions";
import { adWindow, formatRemaining } from "../../lib/adWindow";

// ActionSheet بيقفل نفسه (onClose) قبل ما يشغّل إجراء الصف. على آيفون فتح Modal
// تانى فى نفس اللحظة اللى الأول بيتقفل فيها بيتتجاهل، فالإجراءات اللى بتفتح
// شاشة/نافذة بتتأخر شوية بعد القفل.
const AFTER_SHEET_CLOSE_MS = 350;

type Props = { visible: boolean; ad: Property | null; pinnedCount: number; onClose: () => void };

export function AdActionSheet({ visible, ad, pinnedCount, onClose }: Props) {
  const { t, language } = useLanguage();
  const { user } = useCurrentUser();
  const { data: myDeals } = useMyDeals(user?.id);
  const { data: myPromos } = useMyPromotions(user?.id);
  // ↔ «اجعل الإعلان افتتاحي / مميز»: الإعلان المطلوب ترويجه محفوظ هنا ومستقل عن `ad` (نفس سبب pendingDeal).
  const [pendingPromote, setPendingPromote] = useState<Property | null>(null);
  // ↔ «تم البيع / تم الإيجار»: الإعلان المطلوب تسجيل صفقته محفوظ هنا ومستقل عن `ad` (نفس سبب pendingDelete تحت).
  const [pendingDeal, setPendingDeal] = useState<Property | null>(null);
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

  const deleteItem = (target: Property): ActionSheetItem => ({
    key: "delete",
    label: t("حذف الإعلان"),
    danger: true,
    icon: (p) => <Path {...p} d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />,
    onPress: () => setTimeout(() => setPendingDelete(target), AFTER_SHEET_CLOSE_MS),
  });

  // ↔ نافذة الـ 24 ساعة من أول نشر (lib/adWindow.ts + migration 20261021000000): بعدها الحذف زر مختفى (للمشرفين فقط) والتعديل مقفول.
  const lockedItem = (): ActionSheetItem => ({
    key: "locked",
    label: t("انتهت مدة التعديل والحذف (24 ساعة من النشر). الحذف من حق المشرفين."),
    disabled: true,
    icon: (p) => <Path {...p} d="M5 11h14v10H5zM8 11V7a4 4 0 018 0v4" />,
  });

  const closedItems = (target: Property): ActionSheetItem[] => {
    const deal = myDeals?.get(target.id);
    const closedWin = adWindow(target);
    const closedLabel = target.closedType === "rented" ? t("تم الإيجار") : t("تم البيع");
    // ↔ الفاتورة وتأكيد السداد (رسوم الخدمة عبر إنستاباي) — تظهر طالما الصفقة غير مسدَّدة.
    const invoiceItem: ActionSheetItem[] =
      deal && deal.status !== "paid"
        ? [{
            key: "invoice",
            label: deal.status === "submitted" ? t("الفاتورة — بانتظار مراجعة السداد") : t("الفاتورة وتأكيد السداد"),
            icon: (p) => <Path {...p} d="M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6" />,
            onPress: () => setTimeout(() => router.push({ pathname: "/invoice", params: { propertyId: target.id } } as Href), AFTER_SHEET_CLOSE_MS),
          }]
        : [];
    return [
      {
        key: "closed",
        label: deal ? `${closedLabel} — ${t(DEAL_STATUS_LABELS[deal.status])}` : closedLabel,
        disabled: true,
        icon: (p) => <Path {...p} d="M20 6L9 17l-5-5" />,
      },
      ...invoiceItem,
      closedWin.deletable ? deleteItem(target) : lockedItem(),
    ];
  };

  const win = ad ? adWindow(ad) : null;
  const editable = !!win && win.editable;
  const items: ActionSheetItem[] = !ad ? [] : ad.closedType ? closedItems(ad) : [
    {
      key: "edit",
      // ↔ الإعلان المرفوض يقبل التعديل دائمًا (حتى بعد انتهاء مدة التعديل) عشان المعلن يصلّحه ويعيد إرساله للمراجعة.
      // التعديل متاح 24 ساعة من النشر (مع عدّاد الوقت المتبقى). الإعلان قيد المراجعة/المرفوض بلا مدة.
      label: editable
        ? win?.published && win.remainingMs != null
          ? `${t("تعديل الإعلان")} (${t("متبقي")} ${formatRemaining(win.remainingMs, language)})`
          : t("تعديل الإعلان")
        : t("تعديل غير متاح (انتهت مدة الـ 24 ساعة)"),
      disabled: !editable,
      icon: (p) => <Path {...p} d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4z" />,
      onPress: () => {
        if (!editable) return;
        setTimeout(() => router.push({ pathname: "/publish/create-listing", params: { editId: ad.id } }), AFTER_SHEET_CLOSE_MS);
      },
    },
    {
      key: "pin",
      label: ad.pinned ? t("إلغاء التثبيت") : t("تثبيت في أعلى صفحة المعلن"),
      icon: (p) => <Path {...p} d="M12 17v5M9 10.76V6a2 2 0 012-2h2a2 2 0 012 2v4.76a2 2 0 00.4 1.2L18 15H6l2.6-3.04a2 2 0 00.4-1.2z" />,
      onPress: () => handlePin(ad),
    },
    // ↔ ترويج مدفوع 7 أيام: افتتاحي (الصفحة الرئيسية) أو مميز (أثناء التصفح وفى البحث) — متاح للإعلان المنشور فقط.
    (() => {
      const published = !ad.moderationStatus || ad.moderationStatus === "approved";
      const live = livePromotionsFor(myPromos, ad.id)[0];
      return {
        key: "promote",
        label: !published
          ? t("الترويج متاح بعد موافقة الإدارة على الإعلان")
          : live
          ? `${t("اجعل الإعلان افتتاحي أو مميز")} — ${t(PROMO_STATUS_LABELS[live.status])}`
          : t("اجعل الإعلان افتتاحي أو مميز"),
        disabled: !published,
        icon: (p: Parameters<NonNullable<ActionSheetItem["icon"]>>[0]) => <Path {...p} d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />,
        onPress: () => { if (published) setTimeout(() => setPendingPromote(ad), AFTER_SHEET_CLOSE_MS); },
      } as ActionSheetItem;
    })(),
    {
      key: "deal",
      // ↔ «تم البيع» للإعلان البيع و«تم الإيجار» للإعلان الإيجار (حسب غرض الإعلان).
      label: ad.purpose === "rent" ? t("تم الإيجار — تسجيل الصفقة") : t("تم البيع — تسجيل الصفقة"),
      icon: (p) => <Path {...p} d="M20 6L9 17l-5-5" />,
      onPress: () => setTimeout(() => setPendingDeal(ad), AFTER_SHEET_CLOSE_MS),
    },
    win?.deletable ? deleteItem(ad) : lockedItem(),
  ];

  return (
    <>
      {ad && <ActionSheet visible={visible} title={t(ad.shortTitle || ad.title)} items={items} onClose={onClose} />}
      <DealReportModal visible={!!pendingDeal} ad={pendingDeal} onClose={() => setPendingDeal(null)} />
      <PromoteAdModal visible={!!pendingPromote} ad={pendingPromote} onClose={() => setPendingPromote(null)} />
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
