import { Platform } from "react-native";

// ↔ إصلاح «undefined is not a function» عند تسجيل الدخول بجوجل / إنشاء حساب بالبريد (أندرويد / آيفون / APK):
// الدخول بجوجل وإنشاء الحساب وطلب استعادة كلمة المرور كلها تعمل بتدفق PKCE فى @supabase/auth-js، ودالة توليد الـ code_verifier
// فيه تفحص فقط `typeof crypto === "undefined"` (فتستخدم بديلًا) وإلا تنادى `crypto.getRandomValues(...)` مباشرة.
// على Hermes الكائن العام `crypto` غير موجود أصلًا، لكن مكتبات WebRTC/LiveKit (registerGlobals فى index.js) قد تُعرّف `crypto`
// جزئيًا (بدون getRandomValues) — فيمرّ الفحص وتُنادى دالة غير موجودة ⇒ "undefined is not a function" ويفشل الدخول قبل أى طلب للخادم.
// الحل: نضمن قبل أى نداء auth وجود `crypto.getRandomValues` (وكذلك `crypto.subtle.digest` ليبقى PKCE بوضع S256 لا plain)
// اعتمادًا على expo-crypto (مصدر عشوائية آمن من النظام)، ولا نغيّر أى دالة موجودة وتعمل أصلًا. على الويب المتصفح يوفّرها فلا شيء يتغيّر.
// آمنة للتكرار (idempotent) وتُستدعى عند الإقلاع (index.js) وقبل كل عملية auth تعتمد PKCE (lib/hooks/useAuth.ts).

type AnyRecord = Record<string, unknown>;
type NativeCrypto = {
  getRandomValues?: (a: ArrayBufferView) => ArrayBufferView;
  getRandomBytes?: (n: number) => Uint8Array;
  randomUUID?: () => string;
  digest?: (algorithm: unknown, data: ArrayBufferView | ArrayBuffer) => Promise<ArrayBuffer>;
  CryptoDigestAlgorithm?: Record<string, unknown>;
};

let nativeCrypto: NativeCrypto | null | undefined;
function loadNativeCrypto(): NativeCrypto | null {
  if (nativeCrypto !== undefined) return nativeCrypto;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    nativeCrypto = require("expo-crypto") as NativeCrypto;
  } catch (e) {
    console.warn("[CryptoPolyfill] expo-crypto unavailable:", e);
    nativeCrypto = null;
  }
  return nativeCrypto;
}

function fillWithMathRandom(view: ArrayBufferView): void {
  // ⚠ آخر حل فقط (لو expo-crypto غير متاح فى هذا البناء): أضعف أمنيًا لكنه نفس بديل auth-js الأصلى، ويُبقى الدخول شغّالًا بدل الفشل.
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
}

function getRandomValuesImpl<T extends ArrayBufferView>(view: T): T {
  const native = loadNativeCrypto();
  if (native) {
    try {
      if (typeof native.getRandomValues === "function") {
        native.getRandomValues(view);
        return view;
      }
      if (typeof native.getRandomBytes === "function") {
        const random = native.getRandomBytes(view.byteLength);
        new Uint8Array(view.buffer, view.byteOffset, view.byteLength).set(random);
        return view;
      }
    } catch (e) {
      console.warn("[CryptoPolyfill] native getRandomValues failed, using fallback:", e);
    }
  }
  fillWithMathRandom(view);
  return view;
}

function digestImpl(algorithm: unknown, data: ArrayBufferView | ArrayBuffer): Promise<ArrayBuffer> {
  const native = loadNativeCrypto();
  const name = String(typeof algorithm === "object" && algorithm !== null ? (algorithm as { name?: unknown }).name : algorithm)
    .toUpperCase()
    .replace("-", "");
  const algo = native?.CryptoDigestAlgorithm?.[name];
  if (!native || typeof native.digest !== "function" || algo === undefined) {
    return Promise.reject(new Error(`crypto.subtle.digest(${name}) is not supported`));
  }
  return native.digest(algo, data);
}

function defineGlobalCrypto(value: unknown): void {
  try {
    Object.defineProperty(globalThis, "crypto", { value, writable: true, configurable: true });
  } catch {
    try {
      (globalThis as unknown as AnyRecord).crypto = value;
    } catch { /* لا شيء آخر نقدر نعمله */ }
  }
}

export function ensureCryptoPolyfill(): void {
  if (Platform.OS === "web") return; // المتصفح يوفّر Web Crypto
  try {
    const g = globalThis as unknown as { crypto?: AnyRecord };
    const existing = g.crypto;
    const native = loadNativeCrypto();

    const hasRandom = !!existing && typeof existing.getRandomValues === "function";
    const subtle = existing?.subtle as AnyRecord | undefined;
    const hasDigest = !!subtle && typeof subtle.digest === "function";
    const hasUUID = !!existing && typeof existing.randomUUID === "function";
    if (hasRandom && hasDigest && hasUUID) return;
    if (hasRandom && !native) return;

    // نبنى نسخة مكتملة تحافظ على أى خصائص موجودة أصلًا، ونكمّل الناقص فقط.
    const patch: AnyRecord = {};
    if (!hasRandom) patch.getRandomValues = getRandomValuesImpl;
    if (!hasDigest && native && typeof native.digest === "function") patch.subtle = { ...(subtle ?? {}), digest: digestImpl };
    if (!hasUUID && native && typeof native.randomUUID === "function") patch.randomUUID = () => native.randomUUID!();
    if (Object.keys(patch).length === 0) return;

    if (existing && typeof existing === "object") {
      try {
        Object.assign(existing, patch);
      } catch { /* كائن مُجمَّد: نستبدله أدناه */ }
      const now = (globalThis as unknown as { crypto?: AnyRecord }).crypto;
      const nowSubtle = now?.subtle as AnyRecord | undefined;
      const fixed =
        !!now &&
        typeof now.getRandomValues === "function" &&
        (!patch.subtle || typeof nowSubtle?.digest === "function") &&
        (!patch.randomUUID || typeof now.randomUUID === "function");
      if (fixed) return;
      const merged: AnyRecord = {};
      for (const key of Object.getOwnPropertyNames(existing)) {
        try { merged[key] = existing[key]; } catch { /* getter فاشل */ }
      }
      defineGlobalCrypto({ ...merged, ...patch });
      return;
    }
    defineGlobalCrypto(patch);
  } catch (e) {
    console.warn("[CryptoPolyfill] failed:", e);
  }
}
