import { useRouter } from "expo-router";
import { useCurrentUser } from "./useCurrentUser";
import { useOffersUnreadCount } from "./useOffersHub";
import { promptGuestLogin } from "../guestGate";

// ↔ بيانات أيقونة «العروض» جنب جرس الإشعارات (ريلز / القائمة / الطلبات / إدارة الحساب):
//   offersBadge = فى رسائل عروض جديدة لم تُفتح (نقطة حمراء) — منفصلة عن نقطة جرس الإشعارات.
//   الضيف: الضغط بيفتح شاشة التسجيل (مفيش عروض لضيف).
export function useOffersTopBar() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const isGuest = !user || !!user.is_anonymous;
  const { data: unread = 0 } = useOffersUnreadCount(isGuest ? undefined : user?.id);
  return {
    offersBadge: !isGuest && unread > 0,
    onOpenOffers: () => {
      if (isGuest) return promptGuestLogin("generic");
      router.push("/offers");
    },
  };
}
