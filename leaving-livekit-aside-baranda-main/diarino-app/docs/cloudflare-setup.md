# استضافة shahir.site على Cloudflare Pages (بدل GitHub Pages)

**الهدف:** الدومين `shahir.site` يخدم (1) نسخة الويب من التطبيق (2) صفحة `/terms` (3) روابط المشاركة (`/property/<id>/reel`، `/seller/<id>`، `/compare?ids=…`) التى تفتح التطبيق مباشرة على الموبايل، أو الويب مع رسالة اختيار.

## لماذا ظهر 404؟
GitHub Pages لم يعد يخدم الدومين (الدومين اتنقل لـ Cloudflare)، فبقى أى مسار غير الصفحة الرئيسية بيرجّع 404 من GitHub ("There isn't a GitHub Pages site here"). لازم Cloudflare Pages يستضيف المجلد المبنى ويخدم **أى مسار** بصفحة التطبيق (SPA).

## ١) إنشاء مشروع Pages (مرة واحدة)
Cloudflare Dashboard ← **Workers & Pages** ← **Create** ← **Pages** ← **Connect to Git** ← اختر الـ repository ← Production branch = `main`.

### الخيار أ (الموصى به — بدون build على Cloudflare): ننشر المجلد الجاهز `docs/`
| الحقل | القيمة |
|---|---|
| Framework preset | None |
| Build command | *(فاضى)* |
| Build output directory | `docs` |
| Root directory | `/` (الجذر) |

سير العمل عند كل تحديث للويب: على جهازك/Codespace:
```bash
cd diarino-app
# متغيرات البيئة (مرة): نفس قيم eas.json ← build.production.env (EXPO_PUBLIC_SUPABASE_URL ...)
npm run build:web                 # يولّد dist/ وينقل الصور/الصوت إلى /media ويضيف معاينة الروابط (postbuild-web.mjs) (ويضيف _headers و .well-known تلقائيًا من public/)
rm -rf ../docs/* ../docs/.well-known && cp -r dist/. ../docs/
git add -A && git commit -m "web build" && git push   # Cloudflare ينشر تلقائيًا
```
### الخيار ب (Cloudflare يبنى بنفسه)
| الحقل | القيمة |
|---|---|
| Build command | `cd diarino-app && npm ci && npm run build:web` |
| Build output directory | `diarino-app/dist` |
| Environment variables (Production) | `NODE_VERSION=20` + كل `EXPO_PUBLIC_*` من `eas.json` (SUPABASE_URL، SUPABASE_ANON_KEY، LIVEKIT_URL، CLOUDINARY_*) |

## ٢) ربط الدومين
Pages ← مشروعك ← **Custom domains** ← `shahir.site` (و`shahir.site` اختياري مع redirect إلى الأساسى). بما إن الدومين على Cloudflare DNS فالربط تلقائى (سجل CNAME بيتضاف لوحده). احذف أى سجلات DNS قديمة تشاور على `github.io` (A لـ 185.199.x.x أو CNAME إلى `*.github.io`). ثم عطّل GitHub Pages من Settings ← Pages (اختيارى لكن أفضل).

## ٣) لماذا الروابط الآن تشتغل (SPA fallback)
* **لا يوجد `404.html` فى المجلد المنشور** ← Cloudflare Pages يعتبر الموقع SPA ويرجّع `index.html` لأى مسار (مثل `/property/123/reel`)، فيفتح التطبيق على الويب على نفس الصفحة (وبعدها رسالة «هل تريد المتابعة من خلال التطبيق؟» على الموبايل). **ما ترجّعش `404.html` ولا ملف `_redirects` بقاعدة `/* /index.html`**.
* `/terms` صفحة ثابتة (`terms/index.html`) بتتخدم كما هى.
* ملف `_headers` (من `diarino-app/public/_headers`) يضبط: JSON لملفات `.well-known`، وكاش طويل لملفات `_expo`/`assets`، وعدم كاش `index.html`.

## ٤) فتح التطبيق مباشرة (Deep Links) — لازم ملفين على `.well-known`
`diarino-app/public/.well-known/` فيه **قوالب** (تُنسخ تلقائيًا للـ build) ولازم تعبّى فيها قيمتين قبل ما تشتغل:
* `assetlinks.json` ← بصمات **SHA-256** (Play Console ← App integrity ← App signing certificate، ومن `eas credentials` للـ APK).
* `apple-app-site-association` ← **Team ID** من Apple Developer (استبدل `REPLACE_WITH_APPLE_TEAM_ID`).
بعد التعبئة: أعد build الويب وانشره، وتأكد: `https://shahir.site/.well-known/assetlinks.json` يرجّع JSON (200، بدون redirect). تفاصيل أكثر: `docs/deep-links-setup.md`.

## ٥) رسالة «هل تريد المتابعة من خلال التطبيق؟» (متصفح الموبايل)
`components/shared/OpenInAppBanner.web.tsx` (ويب فقط): تظهر لمن يفتح رابط مشاركة من متصفح أندرويد/آيفون وفيها:
* **فتح في التطبيق** — أندرويد: `intent://` / آيفون: `diarino://`. لو التطبيق مش مثبّت: رسالة + زر المتجر.
* **المتابعة على الويب** — بيكمّل على الموقع وبيتفتكر 24 ساعة على نفس المتصفح.
**لما التطبيق يتنشر:** حطّ روابط المتاجر فى `lib/appLinks.ts` (`PLAY_STORE_URL`، `APP_STORE_URL`) ثم أعد build الويب؛ ولآيفون كمان ممكن تضيف `<meta name="apple-itunes-app" content="app-id=XXXXXXXXXX">` (Smart App Banner).

## ٦) اختبار
```bash
curl -I https://shahir.site/property/123/reel     # لازم 200 (مش 404)
curl -I https://shahir.site/terms/                # 200
curl -I https://shahir.site/.well-known/assetlinks.json   # 200 + application/json
```


## ) معاينة روابط المشاركة (صورة الفيديو فى واتساب/فيسبوك/تليجرام/iMessage)
**المشكلة:** الموقع SPA ثابت، وزواحف تطبيقات المراسلة لا تشغّل JavaScript، فكان رابط `https://shahir.site/property/<id>/reel` يظهر بلا صورة. **الحل:** Cloudflare Pages Function فى `functions/property/[[path]].js` (فى جذر المستودع بجوار `wrangler.toml`) تحقن وسوم `og:*` و`twitter:*` و`description` و`title` فى `<head>` لكل رابط `/property/<id>` و`/property/<id>/reel` قبل إرجاع الصفحة، وبيانات الإعلان تأتى من دالة Supabase العامة `get_share_preview` (migration `20261101000000_share_preview.sql`) التى تُرجع الإعلان **المنشور فقط** وبدون أى بيانات للبائع.
* **الصورة:** الغلاف المختار ← أول صورة ← إطار من أول فيديو (1200×630 JPEG عبر Cloudinary). وإن لم يوجد شىء أو فشل الاستعلام يرجع الرابط للصفحة الأصلية بالمعاينة الافتراضية `og-default.jpg` (لا يحدث خطأ أبدًا).
* **الإعداد المطلوب مرة واحدة:**
  1. `supabase db push` (على مشروع الإنتاج) لتطبيق دالة `get_share_preview`.
  2. Cloudflare ← Workers & Pages ← مشروعك ← Settings ← **Variables and Secrets** (Production وPreview): أضف `SUPABASE_ANON_KEY` = مفتاح anon/publishable العام لمشروع الإنتاج (وليس service_role). `SUPABASE_URL` اختيارى (الافتراضى مشروع الإنتاج `nwbtzchtwyhqktoerbap`).
  3. انشر بطريقة **Git integration** (أو `npx wrangler pages deploy docs` من جذر المستودع) حتى تُنشر مجلد `functions/` — **الرفع اليدوى بالسحب والإفلات (Direct Upload) لا يدعم Functions**.
* **ما لا يحتاج build جديد:** لا تغيير فى التطبيق نفسه؛ المعاينة تصنعها تطبيقات المراسلة من الرابط، فتعمل مع كل المشاركات من أندرويد وآيفون والويب وAPK.
* **اختبار:** `curl -A "facebookexternalhit/1.1" https://shahir.site/property/<id>/reel | grep og:image` ثم افحص الرابط فى https://developers.facebook.com/tools/debug/ واضغط «Scrape Again». واتساب/تليجرام يخزّنان المعاينة القديمة لروابط سبق مشاركتها؛ جرّب رابطًا جديدًا أو أضف `?v=2` للاختبار.
* **عند `npm run build:web`:** يضيف `scripts/postbuild-web.mjs` المعاينة الافتراضية لباقى الروابط (الرئيسية وغيرها) تلقائيًا؛ و`public/og-default.jpg` يُنسخ مع البناء.

## ٧) الدومين الجديد `shahir.site` وتحويل الدومين القديم `baranda.shop`
* أضف `shahir.site` فى Pages ← Custom domains (يكتمل DNS/SSL تلقائيًا). اختر النسخة الأساسية **بدون www** وأضف تحويل `www.shahir.site` ← `https://shahir.site` (Rules ← Redirect Rules، أو Bulk Redirects).
* **تحويل الدومين القديم** (لو لسه عندك `baranda.shop` على Cloudflare): Rules ← Redirect Rules ← Single redirect: *When* Hostname **equals** `baranda.shop` أو `www.baranda.shop` ← *Then* Dynamic: `concat("https://shahir.site", http.request.uri.path)` + (احتفظ بـ query string) ← Status **301**. بكده الروابط القديمة المشاركة (`baranda.shop/property/…`) تفتح الصفحة المطلوبة على الدومين الجديد، ثم تظهر رسالة «المتابعة من خلال التطبيق».
* ملاحظة: **تطبيقات أندرويد/آيفون المثبّتة** من نسخ قديمة مسجَّل فيها `baranda.shop` فقط كرابط تطبيق؛ بعد بناء الإصدار الجديد (المسجَّل فيه `shahir.site`) تُفتح الروابط الجديدة مباشرة فى التطبيق، أما الروابط القديمة فتمر عبر المتصفح (تحويل 301) ثم الرسالة.
* SSL/TLS: الوضع **Full (strict)** ثم Edge Certificates ← Always Use HTTPS = On (مع Pages لا يسبب حلقة).
