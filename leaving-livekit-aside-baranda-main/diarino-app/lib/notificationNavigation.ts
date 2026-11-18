import { isUuid } from "./demoData";
import { router } from "expo-router";
import type { NotifItem } from "../data/mock-notifications";

// ↔ مصدر واحد لوجهة فتح أى إشعار من جرس التنبيهات (كانت منسوخة فى 5 شاشات: الرئيسية/البحث/القائمة/الطلبات/الحساب).
// - إعجاب/حفظ (action = reel): بيفتح الريل نفسه شغّال (فيديو/صور) ولوحة التفاصيل مفتوحة تحته — نفس شكل الريل
//   لما تفتح التفاصيل من داخله — بدل صفحة التفاصيل اللى كان غلافها العلوى أسود من غير الريل.
// - متابعة: صفحة المعلن. شات: المحادثة. تنبيه ذكى: صفحة تفاصيل العقار.
export function openNotificationItem(item: NotifItem | undefined): void {
  const a = item?.action;
  if (!a) return;
  // ↔ K11: المعرّفات تُدمج فى مسار التنقل؛ المصدر خادمنا لكن نتحقق من UUID كتحصين (معرّف غير صالح = لا تنقّل بدل مسار مشوَّه).
  const ids = [(a as { id?: string }).id, (a as { propertyId?: string }).propertyId].filter((v): v is string => typeof v === "string");
  if (ids.some((v) => !isUuid(v))) return;
  if (a.type === "seller") router.push(`/seller/${a.id}`);
  else if (a.type === "property") router.push(`/property/${a.id}`);
  else if (a.type === "reel") router.push(`/property/${a.propertyId}/reel?${a.comments ? "comments=1" : "details=1"}`);
  else if (a.type === "chat") router.push(`/chat/${a.id}`);
  // ↔ إشعارات العروض (عرض جديد على إعلانك / رد على عرضك): صفحة العروض.
  else if (a.type === "offers") router.push("/offers");
  else if (a.type === "request") router.push(`/(tabs)/requests?comments=${a.id}`);
}
