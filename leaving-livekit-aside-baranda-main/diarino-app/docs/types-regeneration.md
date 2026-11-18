# توليد `src/types/supabase.ts` وتصفير `tsc`

الملف الحالى كُتب يدويًا لأجزاء منه، وكل الدوال/الجداول التى أُضيفت بعد ذلك (إنشاء البث، الاقتراحات، التجاهل الناعم…) غير معرّفة فيه. التوليد من قاعدة **تجريبية/محلية** بعد تطبيق كل الـ migrations (ليس من الإنتاج).

## الخطوات
1. **قاعدة تجريبية بكل الـ migrations** (اختر واحدًا):
   - Supabase CLI المحلى: `supabase start` ثم `supabase db reset` (يطبّق كل `supabase/migrations`).
   - أو Postgres المحلى الذى شغّلتَ عليه الـ migrations، ومعه roles/extensions Supabase.
   - أو مشروع تجريبى بعيد: `supabase link --project-ref <ref-تجريبى>` ثم `supabase db push`.
2. **توليد الأنواع** (يكتب فى ملف مؤقت ولا يستبدل الأصل إلا عند النجاح):
   - `npm run types:gen -- --local`
   - أو `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run types:gen`
   - أو `SUPABASE_TEST_PROJECT_ID=<ref-تجريبى> npm run types:gen` (بعد `supabase login`).
3. `npm install` ثم **`npm run typecheck`** (و`npm run typecheck:web`).
4. أصلح الأخطاء حتى تصفر. الفئات المتوقعة:
   - استدعاءات `supabase.rpc("…")` لدوال جديدة كانت غير معرّفة: تصير مُنوَّعة الآن؛ طابِق أسماء/أنواع المعاملات (`p_*`)، وللمعاملات `jsonb` استخدم `as Json`.
   - `Functions[...]["Returns"]`: الدوال التى صارت ترجع `jsonb` (confirm_* وغيرها) تُنوَّع `Json`؛ المستدعون يتجاهلون الناتج لذا لا يتأثرون.
   - أعمدة جديدة (`dismissed_at`, `payer_note`, `suggested_by`, `hidden`…) تظهر فى `Row`؛ احذف أى `as unknown as` لم يعد لازمًا.
   - جداول/أعمدة محجوبة بصلاحيات الأعمدة (`ad_promotions`, `property_deals`, `live_recording_private`): الأنواع تعرض كل الأعمدة؛ تأكد أن الـ `select(...)` فى الكود يذكر الأعمدة المسموحة فقط.
5. راجع `git diff src/types/supabase.ts` ثم commit. أعد التوليد بعد **أى** migration جديدة.

> إن بقيت أخطاء لا تفهمها أرسل لى ناتج `npm run typecheck` كاملًا وأصلحها.
