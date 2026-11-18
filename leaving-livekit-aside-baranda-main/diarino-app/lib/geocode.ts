import { Platform } from "react-native";
import * as Location from "expo-location";

// ↔ إحداثيات الإعلان من العنوان المكتوب.
//   • أندرويد/آيفون: مُرمِّز النظام (expo-location) وده بيحتاج إذن الموقع (أندرويد) — الشاشة بتشرح السبب قبل ما تطلبه.
//   • الويب: expo-location مفيهوش ترميز عناوين فكانت الإحداثيات ما بتتحفظش أبدًا (فالإعلان ما يظهرش فى البحث بالمنطقة/الخريطة).
//     الآن: بحث عنوان من OpenStreetMap Nominatim (العنوان المكتوب فقط يُرسل — لا موقع المستخدم)، بمهلة 6 ثوانٍ وفشله لا يمنع النشر.
export type Coords = { lat: number; lng: number };

const EGYPT = { latMin: 21.5, latMax: 32.0, lngMin: 24.5, lngMax: 37.0 };
export const inEgypt = (c: Coords) => c.lat >= EGYPT.latMin && c.lat <= EGYPT.latMax && c.lng >= EGYPT.lngMin && c.lng <= EGYPT.lngMax;

export async function geocodeOnWeb(query: string): Promise<Coords | null> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=eg&accept-language=ar&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: ctrl?.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const rows = (await res.json()) as { lat?: string; lon?: string }[];
    const first = rows?.[0];
    if (!first?.lat || !first?.lon) return null;
    const c = { lat: Number(first.lat), lng: Number(first.lon) };
    return Number.isFinite(c.lat) && Number.isFinite(c.lng) && inEgypt(c) ? c : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type LocationAccess = "granted" | "undetermined" | "denied";

/** حالة إذن الموقع بدون طلبه (أندرويد/آيفون). */
export async function getLocationAccess(): Promise<LocationAccess> {
  if (Platform.OS === "web") return "granted";
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.granted) return "granted";
    return perm.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "denied";
  }
}

export async function requestLocationAccess(): Promise<boolean> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    return perm.granted;
  } catch {
    return false;
  }
}

/** ترميز العنوان: مُرمِّز النظام على الموبايل (بعد الإذن)، وNominatim على الويب. يرجّع null عند أى فشل. */
export async function geocodeAddress(query: string): Promise<Coords | null> {
  if (Platform.OS === "web") return geocodeOnWeb(query);
  try {
    const results = await Location.geocodeAsync(query);
    const r = results[0];
    if (!r) return null;
    const c = { lat: r.latitude, lng: r.longitude };
    return inEgypt(c) ? c : null;
  } catch (err) {
    console.warn("Failed to geocode listing address:", err);
    return null;
  }
}
