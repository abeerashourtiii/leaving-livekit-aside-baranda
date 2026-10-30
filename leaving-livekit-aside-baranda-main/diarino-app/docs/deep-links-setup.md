# روابط المشاركة والروابط العميقة (Deep Links) — دومين `baranda.shop`

كل روابط المشاركة على **https://baranda.shop** (المصدر الوحيد: `lib/shareLinks.ts` ← `APP_LINK_ORIGIN`):

| ما يُشارَك | الرابط | يفتح داخل التطبيق |
|---|---|---|
| الريل (الإعلان) | `https://baranda.shop/property/<id>/reel` | الريل نفسه شغّال (`app/property/[id]/reel.tsx`) |
| البروفايل | `https://baranda.shop/seller/<user-id>` | صفحة المعلن (`app/seller/[id].tsx`) |
| المقارنة | `https://baranda.shop/compare?ids=a,b,c` | صفحة المقارنة (`app/compare.tsx`) |
| الشروط والأحكام | `https://baranda.shop/terms` | **لا يفتح التطبيق عمدًا** — صفحة ويب ثابتة تُفتح فى المتصفح |
| تفعيل البريد / استعادة كلمة المرور | `https://baranda.shop/auth-callback` | شاشة `auth-callback` |

## اختبار أثناء التطوير (من دون متجر أو ملفات إثبات النطاق)

- **الويب محليًا:** شغّل `npx expo start --web` وافتح عنوان التطوير الظاهر في الطرفية مع المسار المطلوب، مثل `/seller/2073` أو `/property/123/reel` أو `/compare?ids=123,456`. لا حاجة إلى `assetlinks.json` أو Apple App Site Association لاختبار توجيه صفحات الويب.
- **Android:** بعد تثبيت نسخة تطوير محلية، اختبر المخطط المخصص مباشرةً:
  `adb shell am start -a android.intent.action.VIEW -d "diarino://seller/2073" com.diarino.app`
  ويمكن استبدال الرابط بـ `diarino://property/123/reel` أو `diarino://compare?ids=123,456`.
- **iOS Simulator:** بعد تثبيت نسخة تطوير محلية، شغّل:
  `xcrun simctl openurl booted "diarino://seller/2073"`
  واستبدل المسار لاختبار الريل أو المقارنة.

تفتح هذه الاختبارات التطبيق عبر مخطط `diarino` ولا تختبر التحقق من روابط HTTPS العامة. ربط نطاق HTTPS بالتطبيق على الأجهزة يحتاج ملفات إثبات النطاق، ويُضبط عند تجهيز إصدار التوزيع.

الكود جاهز (intent-filters أندرويد فى `AndroidManifest.xml` وapp.json، وassociatedDomains آيفون فى app.json والـ entitlements،
وجلسة ضيف تلقائية للرابط `components/shared/DeepLinkSessionGate.tsx`). الباقى **نشر ملفين على الدومين** + **build جديد**.

## 1) أندرويد — `assetlinks.json`
انشر الملف على: `https://baranda.shop/.well-known/assetlinks.json` (بدون redirect، `Content-Type: application/json`).
القالب جاهز: `docs/well-known/assetlinks.json` — **استبدل قيم `REPLACE_…` بـ SHA-256 الحقيقية**:
- Play Console ← Setup ← App integrity ← App signing key certificate (للنسخة المنشورة على المتجر).
- للـ APK الداخلى (preview/production من EAS): `eas credentials` ← Android ← Keystore.
ضع الاتنين فى المصفوفة. التحقق بعد التثبيت: `adb shell pm get-app-links com.diarino.app` (لازم `baranda.shop: verified`).

## 2) آيفون — `apple-app-site-association`
انشره على: `https://baranda.shop/.well-known/apple-app-site-association` (بدون امتداد، `application/json`).
القالب: `docs/well-known/apple-app-site-association` — **استبدل `REPLACE_WITH_APPLE_TEAM_ID`** بـ Team ID من حساب Apple Developer.
المسارات المسجّلة فقط (`/seller` `/property` `/compare` `/auth-callback`)، فـ `/terms` يفتح فى سفارى كصفحة ويب.

## 3) الاستضافة (GitHub Pages — مجلد `docs/` بجذر المستودع)
- GitHub Pages ينشر مجلد `docs/` الموجود بجذر المستودع، وليس `leaving-livekit-aside-baranda-main/docs/` داخل مجلد التطبيق المتداخل. يجب أن يحتوي مجلد النشر على `index.html` و`404.html` و`_expo/` و`assets/` و`terms/` و`CNAME`.
- ملف `docs/CNAME` بجذر المستودع = `baranda.shop` (موجود). فعّل HTTPS من إعدادات Pages ← Enforce HTTPS.
- شغّل `npm run build:web` من `leaving-livekit-aside-baranda-main/diarino-app`؛ الأمر يبني نسخة الويب وينسخها تلقائيًا إلى مجلد النشر الصحيح `docs/` بجذر المستودع مع الحفاظ على `CNAME`.
- انسخ ملفات إثبات النطاق بعد تعبئتها إلى `docs/.well-known/` بجذر المستودع (`.nojekyll` يُنشأ مع تصدير الويب حتى تُقدَّم المجلدات التى تبدأ بنقطة أو `_`).
- `docs/404.html` يجب أن يطابق هيكل `index.html` الخاص بالتطبيق (SPA fallback)، وليس تحويلًا إلى الصفحة الرئيسية؛ GitHub Pages يعرض هذا الملف للمسارات مثل `/property/<id>/reel`، ويجب أن يصل المسار ومعلمات الاستعلام كما هي إلى Expo Router.
- ملاحظة: GitHub Pages يردّ `404` على هذه المسارات مع عرض التطبيق (يعمل للمستخدم؛ لا يؤثر على الروابط العميقة).
- بعد تغيير الدومين تأكد فى Supabase (Authentication ← URL Configuration): `Site URL = https://baranda.shop`، وRedirect URLs تحتوى
  `https://baranda.shop/**` و`https://baranda.shop/auth-callback` و`diarino://auth-callback`. وفى Google Cloud OAuth أضف `https://baranda.shop` لـ Authorized origins.

## 4) Build جديد
تعديل `AndroidManifest.xml` وapp.json والـ entitlements تعديل native: يحتاج APK/AAB جديد وبناء iOS جديد (لا يصل بـ OTA).
الروابط القديمة `diarino.app/...` لم تعد تفتح التطبيق.

## سلوك الرابط داخل التطبيق
- التطبيق مفتوح/مغلق ← يفتح نفس الصفحة مباشرة (الريل/المعلن/المقارنة).
- لو مفيش جلسة (جهاز جديد) ← جلسة ضيف تلقائية؛ تحتاج Anonymous Sign-Ins مفعّلة فى Supabase.
- حساب خاص ← رسالة "هذا الحساب خاص". زر الإغلاق/الرجوع يعود للرئيسية لو لا توجد شاشة سابقة.
- بديل بدون دومين: `diarino://seller/<id>` و`diarino://property/<id>/reel` يعملان أيضًا (scheme مسجّل).
