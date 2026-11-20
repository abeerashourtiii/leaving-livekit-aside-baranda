-- «تضييق» مُولَّد من 20261116000002_places_suggestions_hardening.sql (3 كتلة). يُطبَّق *بعد* نشر النسخة الجديدة وبعد رفع app_version_requirements.min_version
-- فوق النسخة القديمة (انظر supabase/staged/README.md). أعد تسمية هذا الملف بتاريخ التطبيق الفعلى (YYYYMMDDHHMMSS_...) ثم انقله إلى supabase/migrations.
-- يعتمد على الجزء الإضافى من الملف الأصلى (المُطبَّق قبله).

-- (من 20261116000002_places_suggestions_hardening.sql) كتلة 1
drop policy if exists "known provinces are readable once promoted (3+ searches)" on public.known_provinces;

-- (من 20261116000002_places_suggestions_hardening.sql) كتلة 2
-- القراءة: المعتمد غير المخفى للجميع، واقتراحك أنت (غير المخفى) لك، والأدمن يرى الكل.
drop policy if exists "known regions are readable by authenticated users" on public.known_regions;
drop policy if exists "known regions: promoted or own suggestion" on public.known_regions;
create policy "known regions: promoted or own suggestion"
  on public.known_regions for select
  to authenticated
  using (hidden = false and (promoted_at is not null or suggested_by = auth.uid() or public.i_voted_region(id)));

-- (من 20261116000002_places_suggestions_hardening.sql) كتلة 3
-- الإدراج المباشر مسحوب (كان with check (true)).
drop policy if exists "authenticated users can add a new region name" on public.known_regions;
revoke insert on public.known_regions from anon, authenticated;
revoke update on public.known_regions from anon, authenticated;
grant update (hidden) on public.known_regions to authenticated; -- RLS تقصره على الأدمن

notify pgrst, 'reload schema';
