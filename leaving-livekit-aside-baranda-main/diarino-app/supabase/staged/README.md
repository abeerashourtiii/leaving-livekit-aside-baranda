# نشر مرحلى للـ migrations (إضافى ثم تضييق)

**متى؟** فقط إن كانت هناك نسخ تطبيق قديمة منشورة. إن لم توجد فطبّق `supabase/migrations` كما هى (كل شيء دفعة واحدة).

## الترتيب
1. **نشر الدوال** (`livekit-recording`, `livekit-webhook`, `live-recording-url`, …). فى المرحلة الإضافية اضبط سر `LEGACY_PUBLIC_RECORDING_URL=1` للـ webhook ليستمر تخزين رابط التسجيل العام للنسخ القديمة (والحاوية تبقى عامة).
2. **مجلد additive/** بالترتيب (أو الملفات نفسها من migrations/ بعد حذف كتل التضييق عبر هذا السكربت).
3. **بناء ونشر النسخة الجديدة** (متجرا Google/Apple + الويب). لا تنتقل للتضييق قبل أن تنتشر.
4. **رفع الحد الأدنى:** `update public.app_version_requirements set min_version = '<إصدار النسخة الجديدة>' where platform in ('android','ios');` ثم راقب (شاشة «تحديث مطلوب» تظهر للنسخ الأقدم). الصفين يُنشآن فى migration 20261116100002 بقيمة 0.0.0 (خامل).
5. **بعد أن ينخفض استخدام القديم** (راجع لوحة التحليلات/تسجيل الدخول): ضع سر `LEGACY_PUBLIC_RECORDING_URL` على 0، وانقل ملفات **tightening/** (بعد إعادة تسميتها بتاريخ اليوم) إلى migrations وطبّقها بالترتيب.
6. هجّر ملفات التسجيلات القديمة (`scripts/migrate-live-recordings.mjs`) بعد التضييق (الحاوية خاصة).

## ما الذى يضيّقه كل ملف
- `20261114000000_live_rooms_private_recordings.sql`: 3 كتلة
- `20261115000000_private_recordings_signed_urls.sql`: 2 كتلة
- `20261116000002_places_suggestions_hardening.sql`: 3 كتلة
- `20261116100001_ad_orders_hide_admin_columns.sql`: 1 كتلة

المصدر الوحيد هو علامات `-- @@TIGHTEN-BEGIN/END` داخل migrations؛ أعد توليد هذا المجلد بـ `node scripts/stage-migrations.mjs` بعد أى تعديل.
