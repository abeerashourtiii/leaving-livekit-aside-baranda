# اقتراح: Cloudflare Pages يبنى الويب بنفسه (بدل حفظ `docs/` فى المستودع)

**الفكرة:** المستودع يحوى المصدر فقط؛ كل push إلى `main` يشغّل على Cloudflare: `npm ci` ← `npm run build:web` ← نشر `diarino-app/dist`. لا يوجد ناتج مبنى معدَّل يدويًا، ولا مجلد `docs/` متضخّم (≈ 60MB) فى Git، ولا خطر نشر حزمة قديمة.

## الإعداد فى لوحة Cloudflare (Workers & Pages ← مشروعك ← Settings ← Builds)
| الحقل | القيمة |
|---|---|
| Production branch | `main` |
| Root directory | `/` (جذر المستودع — ليبقى `functions/` فى مكانه: معاينة روابط المشاركة) |
| Framework preset | None |
| Build command | `cd diarino-app && npm ci && npm run build:web` |
| Build output directory | `diarino-app/dist` |
| Build watch paths (Include) | `diarino-app/**`, `functions/**`, `wrangler.toml` (Exclude: `docs/**`, `**/*.md`) |
| Environment variables (Production **و** Preview) | `NODE_VERSION=20`، وكل `EXPO_PUBLIC_*` من `eas.json` (SUPABASE_URL، SUPABASE_ANON_KEY، LIVEKIT_URL، CLOUDINARY_*)، و`SUPABASE_ANON_KEY` لدالة `functions/property` |

> **لا تضع** مفتاح الخدمة (`service_role`) أو أى سر خادم هنا؛ متغيرات `EXPO_PUBLIC_*` تُدمَج فى حزمة الويب العامة.

## `wrangler.toml` (جذر المستودع) — يتغيّر عند الانتقال فقط
```toml
name = "baranda-shop"
pages_build_output_dir = "diarino-app/dist"
compatibility_date = "2026-10-01"
```
(الملف الحالى يشير إلى `docs`. **لا تغيّره قبل** أن ينجح أول بناء على Cloudflare، وإلا انكسر النشر الحالى.)

## خطوات الانتقال الآمنة
1. أنشئ **مشروعًا جديدًا** (أو فرع Preview) بالإعدادات أعلاه وأوقف الدومين الرئيسى عنه؛ شغّل بناءً وتحقق على رابط `*.pages.dev`: الصفحة الرئيسية، `/terms`، `/property/<id>/reel`، `/.well-known/assetlinks.json` (200 JSON)، الخريطة، الدخول، رفع الوسائط، وCSP (Report-Only) فى Console.
2. بعد النجاح: انقل الدومين `shahir.site` إلى المشروع الجديد (Custom domains) — الرجوع فورى بإعادة الربط أو بـ Rollback لنشر سابق.
3. ثم فقط: غيّر `wrangler.toml` كما فوق، واحذف المجلد المبنى من Git:
   ```bash
   git rm -r --cached docs && echo "docs/" >> .gitignore && echo "diarino-app/dist/" >> .gitignore
   ```
   (أبقِ نسخة `docs/` محليًا حتى تتأكد.) وحدّث `docs/cloudflare-setup.md` ليعتمد «الخيار ب».

## تنبيهات
- **الذاكرة/الزمن:** `expo export --platform web` يستهلك ذاكرة؛ إن فشل البناء بـ OOM جرّب `NODE_OPTIONS=--max-old-space-size=4096` كمتغير بيئة. حد البناء 20 دقيقة.
- **`postinstall`:** `patch-package` + `check-expo-video-patch.mjs` يعملان أثناء `npm ci` (الـ patch موجود فى `patches/`) — لو فشلا يتوقف البناء بوضوح.
- **`_headers` وSPA:** يأتيان من `public/` إلى `dist/` تلقائيًا؛ لا تُنشئ `404.html` ولا `_redirects` (راجع `cloudflare-setup.md` §٣).
- **حتى ينتقل البناء إلى Cloudflare:** **لا تدفع `docs/` إلى Git قبل إعادة بناء الحزمة** (`npm run build:web` ثم `rm -rf ../docs/* && cp -r dist/. ../docs/`)، وإلا تُنشر حزمة قديمة بلا إصلاحات هذا المستودع.
