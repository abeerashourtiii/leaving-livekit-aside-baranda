# روابط المشاركة والروابط العميقة (Deep Links) — دومين `shahir.site`

كل روابط المشاركة على **https://shahir.site** (المصدر الوحيد: `lib/shareLinks.ts` ← `APP_LINK_ORIGIN`):

| ما يُشارَك | الرابط | يفتح داخل التطبيق |
|---|---|---|
| الريل (الإعلان) | `https://shahir.site/property/<id>/reel` | الريل نفسه شغّال (`app/property/[id]/reel.tsx`) |
| البروفايل | `https://shahir.site/seller/<user-id>` | صفحة المعلن (`app/seller/[id].tsx`) |
| المقارنة | `https://shahir.site/compare?ids=a,b,c` | صفحة المقارنة (`app/compare.tsx`) |
| الشروط والأحكام | `https://shahir.site/terms` | **لا يفتح التطبيق عمدًا** — صفحة ويب ثابتة تُفتح فى المتصفح |
| تفعيل البريد / استعادة كلمة المرور | `https://shahir.site/auth-callback` | شاشة `auth-callback` |

الكود جاهز (intent-filters أندرويد فى `AndroidManifest.xml` وapp.json، وassociatedDomains آيفون فى app.json والـ entitlements،
وجلسة ضيف تلقائية للرابط `components/shared/DeepLinkSessionGate.tsx`). الباقى **نشر ملفين على الدومين** + **build جديد**.

## 1) أندرويد — `assetlinks.json`
انشر الملف على: `https://shahir.site/.well-known/assetlinks.json` (بدون redirect، `Content-Type: application/json`).
القالب جاهز: `docs/well-known/assetlinks.json` — **استبدل قيم `REPLACE_…` بـ SHA-256 الحقيقية**:
- Play Console ← Setup ← App integrity ← App signing key certificate (للنسخة المنشورة على المتجر).
- للـ APK الداخلى (preview/production من EAS): `eas credentials` ← Android ← Keystore.
ضع الاتنين فى المصفوفة. التحقق بعد التثبيت: `adb shell pm get-app-links com.diarino.app` (لازم `shahir.site: verified`).

## 2) آيفون — `apple-app-site-association`
انشره على: `https://shahir.site/.well-known/apple-app-site-association` (بدون امتداد، `application/json`).
القالب: `docs/well-known/apple-app-site-association` — **استبدل `REPLACE_WITH_APPLE_TEAM_ID`** بـ Team ID من حساب Apple Developer.
المسارات المسجّلة فقط (`/seller` `/property` `/compare` `/auth-callback`)، فـ `/terms` يفتح فى سفارى كصفحة ويب.

## 3) الاستضافة: Cloudflare Pages (مش GitHub Pages)
الدومين على Cloudflare ومشروع Pages بيخدم مجلد `docs/` — **الخطوات الكاملة فى `docs/cloudflare-setup.md`** (إعداد المشروع، SPA fallback بدون `404.html`، ملف `_headers`، رسالة «المتابعة من التطبيق»).
- ملفا التحقق (`assetlinks.json` و`apple-app-site-association`) فى `diarino-app/public/.well-known/` وبيتنسخوا تلقائيًا لـ `docs/.well-known/` عند `npm run build:web`؛ عبّي القيم (SHA-256 / Team ID) هناك.
- بعد تغيير الدومين تأكد فى Supabase (Authentication ← URL Configuration): `Site URL = https://shahir.site`، وRedirect URLs تحتوى `https://shahir.site/**` و`https://shahir.site/auth-callback` و`diarino://auth-callback`. وفى Google Cloud OAuth أضف `https://shahir.site` لـ Authorized origins.

## 4) Build جديد
تعديل `AndroidManifest.xml` وapp.json والـ entitlements تعديل native: يحتاج APK/AAB جديد وبناء iOS جديد (لا يصل بـ OTA).
الروابط القديمة `diarino.app/...` لم تعد تفتح التطبيق.

## سلوك الرابط داخل التطبيق
- التطبيق مفتوح/مغلق ← يفتح نفس الصفحة مباشرة (الريل/المعلن/المقارنة).
- لو مفيش جلسة (جهاز جديد) ← جلسة ضيف تلقائية؛ تحتاج Anonymous Sign-Ins مفعّلة فى Supabase.
- حساب خاص ← رسالة "هذا الحساب خاص". زر الإغلاق/الرجوع يعود للرئيسية لو لا توجد شاشة سابقة.
- بديل بدون دومين: `diarino://seller/<id>` و`diarino://property/<id>/reel` يعملان أيضًا (scheme مسجّل).
