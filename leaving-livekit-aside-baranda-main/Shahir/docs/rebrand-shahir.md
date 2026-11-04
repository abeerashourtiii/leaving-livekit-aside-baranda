# تقرير إعادة التسمية: Baranda ← Shahir ودومين `baranda.shop` ← `shahir.site`

## المبدأ
تعديل كل نتيجة حسب وظيفتها (لا استبدال أعمى): النصوص الظاهرة والدومين والروابط فقط. **لم يتغير**: Supabase Project URL / API keys، package name (`com.diarino.app`) وbundle id، `slug` الخاص بـ Expo/EAS، الـ URL scheme (`diarino://`)، مفاتيح التخزين المحلى، أسماء مشروع iOS الداخلية، حساب InstaPay، قاعدة البيانات وبيانات المستخدمين (باستثناء نص رسائل واتساب فى القائمة، انظر ٣).

## ١) الملفات المعدّلة
* **الإعدادات:** `app.json` (name=Shahir، `web.name/shortName`، أذونات iOS/Android، `associatedDomains`، `intentFilters` ← `shahir.site`)، `android/.../strings.xml` (`app_name`)، `AndroidManifest.xml` (App Links)، `ios/Baranda/Info.plist` (CFBundleDisplayName + أذونات)، `ios/Baranda/Baranda.entitlements` (`applinks:shahir.site`)، `CNAME` (جذر).
* **الكود/النصوص:** `lib/shareLinks.ts` (`APP_LINK_ORIGIN`)، `lib/appLinks.ts`، `lib/terms.ts`، `components/shared/OpenInAppBanner.web.tsx`، `PolicyConsent.tsx`، `DeepLinkSessionGate.tsx`، رسائل المشاركة (`app/compare.tsx`، `app/settings.tsx`، `app/live/[id].tsx`)، أسماء افتراضية للمستخدم (`مستخدم Shahir`) فى hooks وAdmin، `SocialShareSection.tsx`، `AdminReels/AdminFeatures`، إشعار الأمان `send-push` (عنوان افتراضى)، `data/mock-notifications.ts`، `data/i18n-dict.ts` (مفاتيح وقيم متسقة)، `data/policies.ts` (إصدار **20**)، `scripts/generate-terms-page.mjs` + صفحة `/terms` المولّدة، `account.tsx` (`@user_shahir`).
* **الاستضافة:** `docs/` (بناء ويب جديد: العنوان Shahir)، `docs/cloudflare-setup.md`، `docs/deep-links-setup.md`، `docs/email-signup-setup.md`، `README.md` وبقية ملفات `docs/*.md`.
* **قاعدة البيانات:** migration `20261030000000_rebrand_shahir_texts.sql` — يستبدل «باراندا»← «Shahir» فقط فى نص رسائل واتساب بجدول `menu_items` (اختُبر محليًا؛ لا يمس أى صف آخر).

## ٢) إعدادات خارجية مطلوب منك (لا أستطيع تنفيذها من هنا)
1. **Cloudflare:** إضافة `shahir.site` لمشروع Pages، www redirect، تحويل `baranda.shop` ← `shahir.site` (301)، SSL Full (strict) — التفاصيل: `docs/cloudflare-setup.md` §٧.
2. **Supabase** (Authentication ← URL Configuration): `Site URL = https://shahir.site`، Redirect URLs: `https://shahir.site/**`، `https://shahir.site/auth-callback`، `diarino://auth-callback` (أبقِ مؤقتًا `https://baranda.shop/**` حتى يمرّ وقت كافٍ). تأكد من **قوالب البريد** (Authentication ← Email Templates): استبدل اسم/روابط Baranda بـ Shahir وSender name = Shahir (إعدادات SMTP). مفاتيح/روابط المشروع **لا تتغير**.
3. **Google OAuth** (Google Cloud ← Credentials ← OAuth client): Authorized JavaScript origins `https://shahir.site` وRedirect URIs كما فى Supabase؛ شاشة الموافقة OAuth consent: اسم التطبيق Shahir والدومين المعتمد.
4. **Deep links:** عبّئ `public/.well-known/assetlinks.json` (SHA-256) و`apple-app-site-association` (Team ID) ثم ابنِ الويب وانشره.
5. **المتاجر:** اسم التطبيق (Display name) وصور المتجر والأيقونة فى Google Play Console وApp Store Connect = Shahir. **لا تغيّر package/bundle id.**
6. **EAS:** ابنِ إصدارات جديدة (الاسم والـ App Links تعديلات native). `slug` لم يتغير ليبقى ربط EAS/التحديثات سليمًا؛ يمكن تغيير **اسم المشروع** من لوحة Expo فقط.
7. **Cloudinary/LiveKit/حسابات التواصل:** لا تعتمد على الدومين القديم؛ راجع أسماء قنوات السوشيال (يوتيوب/فيسبوك…) وروابطها فى لوحة الأدمن ← «تواصل».

## ٣) ما زال يحمل الاسم/الدومين القديم (مقصود أو يحتاج منك)
* **أصول بصرية بها كلمة Baranda — تحتاج تصميمك أنت (لا أستطيع إنتاج الشعار):** `assets/icon.png`، `adaptive-icon.png`، `splash.png`، `splash-transparent.png`، `logo-mark.png`، `favicon.png`، **فيديو الإقلاع**: ✅ **تم** استبداله بـ `assets/splash/shahir_splash.mp4` (الشعار الجديد + Shahir + القوس بنفس أسلوب الحركة)، وصور الإقلاع native: `android/app/src/main/res/drawable-*/splashscreen_logo.png` و`ios/Baranda/Images.xcassets/SplashScreenLogo.imageset` وأيقونات `mipmap-*`/`AppIcon`.
* **معرّفات داخلية تُركت عمدًا (لا تظهر للمستخدم ولا يجوز تغييرها الآن):** `slug: baranda-beruflich` + scheme `exp+baranda-beruflich`، مجلد/هدف iOS `Baranda`، `BarandaLaunchInfo` (وحدة native)، مفاتيح `baranda:resume:*` و`baranda:web_continue_until`، وسم `baranda-reel-*`، `rootProject.name`، اسم مشروع Cloudflare فى `wrangler.toml` (`baranda-shop`) — غيّره فقط لو أنشأت مشروع Pages جديدًا.
* **حساب InstaPay:** اسم المستلم `baranda` فى `lib/paymentInfo.ts` وفى بند الرسوم بالسياسات هو **اسم الحساب البنكى الفعلى** لاستلام الرسوم؛ لم أغيّره. غيّره يدويًا (مع صورة `assets/instapay-recipient.jpg`) فقط لو غيّرت الحساب فعليًا.
* **تاريخ migrations** القديمة وسجل `CHANGES_AND_TODO.md` يذكران الاسم القديم (تاريخ).
* الروابط القديمة المشاركة `baranda.shop/...` تعمل فقط عبر تحويل 301 تضبطه على Cloudflare (§٢-١).

## ٤) الاختبارات المنفّذة هنا ونتائجها
* فحص الأنواع TypeScript للنسخة native والويب: **نجح**. بناء الويب (production) بنجاح، وتأكيد أن عنوان الصفحة = Shahir وأن الروابط داخل الحزمة على `shahir.site` وأن إعدادات Supabase مضمّنة.
* اختبار migration إعادة التسمية على Postgres تجريبى: استبدل نص واتساب فقط ولم يمس صفوف URL.
* **لم يُنفَّذ (يحتاج بيئتك/أجهزة وحساباتك):** تسجيل الدخول (بريد/Google)، تأكيد البريد واستعادة كلمة المرور، نشر عقار/رفع وسائط، الإشعارات الفعلية، الشات، الطلبات، وفتح الروابط على أندرويد/آيفون، وفحص Console/Network على الدومين الحى. بعد النشر شغّل قائمة اختبار خاصة بك (انظر الأسفل).

## ٥) تأكيد سلامة البيانات
لا تغييرات على بنية أى جدول ولا على `auth.users` ولا بيانات المستخدمين؛ migration واحد نصّى لرسائل واتساب فى `menu_items` فقط. لم يتغير Supabase URL أو المفاتيح أو package/bundle id.

## ٦) قائمة اختبار بعد النشر (مختصرة)
تسجيل جديد + تأكيد بريد (الرابط يفتح `shahir.site`) ← استعادة كلمة مرور ← دخول Google ← نشر إعلان بصور/فيديو ← بحث وفلترة ← مشاركة ريل/بروفايل/مقارنة وفتح الرابط على الأندرويد والآيفون والويب ← رسالة دردشة وإشعار ← تقديم عرض/طلب ← فتح `/terms`.
