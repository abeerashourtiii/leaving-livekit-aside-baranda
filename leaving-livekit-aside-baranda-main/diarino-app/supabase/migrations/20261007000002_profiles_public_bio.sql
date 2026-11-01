-- supabase/migrations/20261007000002_profiles_public_bio.sql
--
-- النبذة (bio) اللى المستخدم بيكتبها فى «حسابي» لازم تظهر فى صفحة المعلن
-- (app/seller/[id].tsx) لأى زائر. الفيو public.profiles_public كان بيستبعد
-- bio عمدًا (20260825000000_profile_privacy_rls.sql) مع الهاتف باعتبارها PII،
-- لكن النبذة نص عام بيكتبه المستخدم بنفسه عشان يتعرض على بروفايله — فبنضيفها
-- للفيو (آخر عمود، عشان CREATE OR REPLACE VIEW يقبلها) وبنسيب الهاتف
-- والبيانات الشخصية الباقية (تاريخ الميلاد، الجنسية... ) خارج الفيو زى ما هى.
-- حسابات «الحساب الخاص» (is_public=false) صفحتها بتتخفى أصلًا عن الغرباء فى التطبيق.

create or replace view public.profiles_public as
  select
    id, full_name, avatar_url, verified, is_public,
    chat_on_properties, chat_on_requests, show_whatsapp, show_call_button,
    bio
  from public.profiles;

grant select on public.profiles_public to authenticated;
