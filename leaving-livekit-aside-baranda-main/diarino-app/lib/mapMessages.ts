import { DEMO_DATA_ENABLED, isUuid } from "./demoData";
// Message shapes posted from the Leaflet page running inside the native
// WebView (see lib/leafletHtml.ts) back to React Native via
// `window.ReactNativeWebView.postMessage(JSON.stringify(...))`.
// Kept as a discriminated union + a safe parser so the native map
// components never need to reach for `any` when reading WebView events.

export type MapPressMessage = { type: "mapPress"; lat: number; lng: number };
export type PointChangeMessage = { type: "pointChange"; lat: number; lng: number };
export type RegionChangeMessage = {
  type: "regionChange";
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};
export type MarkerPressMessage = { type: "markerPress"; id: string };
export type MapReadyMessage = { type: "mapReady" };

export type LeafletBridgeMessage =
  | MapPressMessage
  | PointChangeMessage
  | RegionChangeMessage
  | MarkerPressMessage
  | MapReadyMessage;

// ↔ K6: كان يتحقق من حقل type فقط فتمرّ قيم lat/lng/id كما هى (NaN، نص، خارج النطاق) للمكوّنات. الآن كل حقل يُفحص نوعه ونطاقه؛ ورسالة غير مطابقة تُهمَل.
const isLat = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= -90 && v <= 90;
const isLng = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= -180 && v <= 180;
const isDelta = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 360;
// معرّف الإعلان: UUID من قاعدة البيانات (وفى وضع التطوير فقط معرّفات العرض التجريبى p1…).
const isMarkerId = (v: unknown): v is string => typeof v === "string" && (isUuid(v) || (DEMO_DATA_ENABLED && /^p\d{1,3}$/.test(v)));

function isLeafletBridgeMessage(value: unknown): value is LeafletBridgeMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const m = value as Record<string, unknown>;
  switch (m.type) {
    case "mapPress":
    case "pointChange":
      return isLat(m.lat) && isLng(m.lng);
    case "regionChange":
      return isLat(m.latitude) && isLng(m.longitude) && isDelta(m.latitudeDelta) && isDelta(m.longitudeDelta);
    case "markerPress":
      return isMarkerId(m.id);
    case "mapReady":
      return true;
    default:
      return false;
  }
}

export function parseLeafletMessage(raw: string): LeafletBridgeMessage | null {
  try {
    const data: unknown = JSON.parse(raw);
    return isLeafletBridgeMessage(data) ? data : null;
  } catch {
    return null;
  }
}
