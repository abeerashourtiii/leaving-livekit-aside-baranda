-- supabase/migrations/20261122000000_property_active_toggle.sql
--
-- «غير نشط» / «تنشيط الإعلان»: يوقف المعلن نشر إعلانه مؤقتًا من كارت الإعلان فى إدارة الحساب (بجوار تعديل/حذف/ترويج) ويعيده متى شاء.
--   • properties.is_active (الافتراضى true). false = لا يظهر فى البحث ولا صفحة المعلن ولا الريلز ولا الخريطة ولا المفضلة لأى مستخدم آخر.
--   • التنفيذ على مستوى RLS (سياسة القراءة): الإعلان غير النشط يقرؤه صاحبه والأدمن فقط. دوال البحث الجغرافى (properties_in_radius/bounds) تعمل
--     بصلاحية المستدعى (language sql بلا security definer) فتتبع نفس السياسة تلقائيًا؛ والعميل يخفيه أيضًا من القوائم العامة لصاحبه.
--   • يبقى فى «إعلاناتي» لصاحبه (بعلامة «غير نشط») ويمكنه تعديله/حذفه/تنشيطه، ويظل محسوبًا ضمن حد الريلز.
--   • التبديل متاح للمعلن فى أى وقت: العمود مستثنى من حارس نافذة التعديل (24 ساعة) ولا يُعيد الإعلان لمراجعة الأدمن.
-- قابل لإعادة التشغيل.

alter table public.properties add column if not exists is_active boolean not null default true;

comment on column public.properties.is_active is
  'false = الإعلان غير نشط (أوقفه صاحبه مؤقتًا): لا يظهر لغير صاحبه فى البحث/صفحة المعلن/الريلز، ويبقى فى إعلاناتي ليُنشَّط ثانيةً.';

-- سياسة القراءة: المنشور (approved) والنشط للجميع، وإعلانات الشخص نفسه دائمًا، والأدمن (reels/deals) دائمًا.
drop policy if exists "approved properties are public, own listings always visible" on public.properties;
create policy "approved properties are public, own listings always visible"
  on public.properties for select
  to authenticated
  using (
    (moderation_status = 'approved' and is_active)
    or seller_id = auth.uid()
    or public.admin_has_permission('reels')
    or public.admin_has_permission('deals')
  );

-- حارس نافذة التعديل: نفس منطق 20261021000000 مع إضافة is_active إلى الأعمدة «النظامية» التى لا يقيّدها الحارس (فيُبدَّل الإعلان بعد 24 ساعة).
create or replace function public.properties_edit_window_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_system text[] := array[
    'id', 'seller_id', 'created_at', 'updated_at', 'published_at',
    'moderation_status', 'moderation_reason', 'moderated_at', 'moderated_by',
    'pinned', 'pinned_at', 'likes', 'saves', 'views', 'chats', 'wa_clicks', 'comment_count',
    'closed_at', 'closed_type', 'rights_declared_at', 'captions_ar', 'captions_en',
    'is_active'
  ];
begin
  if auth.uid() is not null
     and auth.uid() = old.seller_id
     and not public.admin_has_permission('reels')
     and old.published_at is not null
     and now() > old.published_at + public.owner_window()
     and (to_jsonb(new) - v_system) is distinct from (to_jsonb(old) - v_system) then
    raise exception 'edit_window_closed' using errcode = '42501';
  end if;
  return new;
end;
$$;
