// ↔ H2: Subresource Integrity لملفات Leaflet المحمّلة من unpkg (كانت بلا integrity: اختراق/تلاعب بالحزمة = تنفيذ كود فى أصل موقعك).
//   القيم تُحسب من الملفات الفعلية بالأمر: `node scripts/compute-leaflet-sri.mjs` (يحتاج إنترنت؛ يكتب هذا الملف). لا تكتب قيمًا يدويًا/من الذاكرة.
//   لو القيم null أو النسخة لا تطابق LEAFLET_VERSION فى leafletWebLoader.web.ts يحمّل المحمّل Leaflet كما كان (بتحذير فى console) فلا ينكسر شيء.
//   الأفضل (قرار H2): تضمين leaflet كحزمة npm محددة النسخة وتقديمها من نفس الموقع فلا حاجة لـ unpkg ولا لـ SRI.
export const LEAFLET_SRI: { version: string | null; css: string | null; js: string | null } = {
  version: null,
  css: null,
  js: null,
};
