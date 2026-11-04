// lib/linking.ts
//
// ↔ components/ audit (lib/whatsapp.ts follow-up) — Linking.openURL()
// rejects if nothing on the device can handle the URL (WhatsApp not
// installed, no phone-dialer capability on a tablet/emulator, a
// malformed or unreachable scheme). Most call sites across the app
// called it bare, with no .catch() at all — meaning a real, everyday
// scenario (a user without WhatsApp tapping a WhatsApp button) produced
// an unhandled promise rejection: a scary red-screen warning in dev, and
// in prod, silent nothing — the user taps a button and nothing visibly
// happens, with zero feedback that anything went wrong.
//
// ملاحظة: مشاركة البروفايل (الإعدادات) بتستخدم lib/shareLinks.ts (شيت المشاركة
// الأصلي للنظام) مش openURL.
import { Linking } from "react-native";
import { showToast } from "../components/shared/Toast";

export function openExternalUrl(url: string, failureMessage = "تعذر فتح الرابط"): void {
  Linking.openURL(url).catch(() => {
    showToast(failureMessage);
  });
}
