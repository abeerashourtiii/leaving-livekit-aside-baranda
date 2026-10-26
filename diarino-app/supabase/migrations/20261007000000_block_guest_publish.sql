-- supabase/migrations/20261007000000_block_guest_publish.sql
--
-- الضيف ("المتابعة كضيف" = Supabase anonymous sign-in) يتصفح فقط: ممنوع
-- ينشر عقار (properties) أو يطلب عقار (requests). الواجهة بتحوّله لصفحة
-- التسجيل (app/publish/_layout.tsx + app/(tabs)/menu.tsx) — وهنا الحماية
-- الفعلية اللى عميل معدّل مايقدرش يتخطّاها، بنفس نمط سياسة `lives`
-- (20260825000000_profile_privacy_rls.sql): Supabase بيضيف claim اسمه
-- is_anonymous فى الـ JWT، و coalesce(...) بتعامل غيابه كـ "مش مجهول".
--
-- الإعلانات/الطلبات القديمة اللى نشرها ضيوف قبل كده تفضل زى ما هى (التعديل
-- على سياسة الـ INSERT فقط).

drop policy if exists "users can create their own properties" on public.properties;
create policy "users can create their own properties"
  on public.properties for insert
  to authenticated
  with check (
    seller_id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );

drop policy if exists "users can create their own requests" on public.requests;
create policy "users can create their own requests"
  on public.requests for insert
  to authenticated
  with check (
    requester_id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );
