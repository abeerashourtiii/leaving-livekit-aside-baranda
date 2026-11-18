import { properties } from "../data/mock-properties";
import type { Property } from "./types";

// ↔ B5: الإعلانات التجريبية (data/mock-properties.ts: 12 إعلانًا وهميًا ببائعين وأرقام وهمية) كانت تُدمج مع الحقيقية فى نسخة الإنتاج
//   (وكان رابط /property/p1 يعرض إعلانًا وهميًا بهاتف وهمى). الآن تُحصر فى وضع التطوير (__DEV__) أو بعلم صريح
//   EXPO_PUBLIC_ENABLE_DEMO_DATA=1 — وفى الإنتاج القائمة فارغة، والمعرّفات غير الـ UUID تُعرض «غير متاح».
export const DEMO_DATA_ENABLED =
  (typeof __DEV__ !== "undefined" && __DEV__) || process.env.EXPO_PUBLIC_ENABLE_DEMO_DATA === "1";

export const demoProperties: Property[] = DEMO_DATA_ENABLED ? properties : [];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | null | undefined): v is string => !!v && UUID_RE.test(v);
