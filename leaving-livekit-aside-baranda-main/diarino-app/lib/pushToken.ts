import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { withTimeout } from "./async";

// ↔ G7 (خصوصية الأجهزة المشتركة): توكن الإشعارات كان يظل مسجّلًا للمستخدم السابق بعد تسجيل الخروج، فيستمر الجهاز فى استلام إشعاراته
//   (نصوص محادثات وعروض) إلى أن يسجّل مستخدم آخر الدخول على نفس الجهاز. الآن نتذكّر التوكن المسجَّل على هذا الجهاز، ونُلغى تسجيله
//   (RPC unregister_push_token — migration 20261112000000) قبل signOut وقبل حذف الحساب. best-effort: فشلها لا يمنع الخروج.
const KEY = "shahir:push-token:v1";
let current: string | null = null;

export async function rememberPushToken(token: string): Promise<void> {
  current = token;
  try { await AsyncStorage.setItem(KEY, token); } catch { /* ignore */ }
}

export async function unregisterPushToken(): Promise<void> {
  let token = current;
  if (!token) {
    try { token = await AsyncStorage.getItem(KEY); } catch { token = null; }
  }
  current = null;
  try { await AsyncStorage.removeItem(KEY); } catch { /* ignore */ }
  if (!token) return;
  try {
    await withTimeout(Promise.resolve(supabase.rpc("unregister_push_token", { p_token: token })), 3000, "unregister_push_token");
  } catch (err) {
    console.warn("unregister push token failed:", err);
  }
}
