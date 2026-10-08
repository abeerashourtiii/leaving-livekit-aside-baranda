# روابط مشاركة البروفايل (Deep Links) — خطوات الإعداد

رابط المشاركة: `https://diarino.app/seller/<user-id>`

الكود جاهز فى التطبيق (intent-filter أندرويد + associatedDomains آيفون + صفحة المعلن + نسخة الويب).
الجزء الوحيد الخارج عن الكود هو **نشر ملفين على الدومين** + **build جديد**.

## 1) أندرويد — `assetlinks.json`
انشر الملف على: `https://diarino.app/.well-known/assetlinks.json` (بدون redirect، `Content-Type: application/json`):

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.diarino.app",
    "sha256_cert_fingerprints": ["<SHA-256 لشهادة التوقيع>"]
  }
}]
```
الـ SHA-256: Play Console ← Setup ← App integrity ← App signing key certificate،
وللـ APK الداخلى (preview): `eas credentials` ← Android ← Keystore. ضع الاتنين فى المصفوفة.
التحقق: `adb shell pm get-app-links com.diarino.app` (لازم تظهر `verified`).

## 2) آيفون — `apple-app-site-association`
انشره على: `https://diarino.app/.well-known/apple-app-site-association` (بدون امتداد، `application/json`):

```json
{
  "applinks": {
    "details": [{
      "appIDs": ["<TEAM_ID>.com.diarino.app"],
      "components": [{ "/": "/seller/*" }, { "/": "/auth-callback*" }]
    }]
  }
}
```
(`associatedDomains: applinks:diarino.app` موجود بالفعل فى app.json وملف الـ entitlements.)

## 3) الويب
الدومين لازم يقدّم نسخة الويب (`npx expo export --platform web`) مع **SPA fallback**:
أى مسار غير موجود (مثل `/seller/<id>`) يرجّع `index.html` (Netlify: `/* /index.html 200`، Vercel: rewrite `/(.*)` → `/index.html`).
هذا هو ما يفتح الرابط لمن لم يثبّت التطبيق.

## 4) Build جديد
تعديل `AndroidManifest.xml` تعديل native: يحتاج APK/AAB جديد (لا يصل بـ OTA). آيفون: build جديد بعد نشر الـ AASA.

## سلوك الرابط داخل التطبيق
- التطبيق مفتوح/مغلق ← يفتح `app/seller/[id].tsx` مباشرة.
- لو مفيش جلسة (جهاز جديد) ← جلسة ضيف تلقائية (`lib/hooks/useEnsureSession.ts`)؛ تحتاج Anonymous Sign-Ins مفعّلة فى Supabase.
- حساب خاص ← رسالة "هذا الحساب خاص". زر الإغلاق/الرجوع يعود للرئيسية لو لا توجد شاشة سابقة.
- بديل بدون دومين: `diarino://seller/<id>` يعمل أيضًا (scheme مسجّل).
