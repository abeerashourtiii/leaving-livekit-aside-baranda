-- supabase/migrations/20261008000001_mark_single_notification_read.sql
--
-- المشكلة: فتح إشعار من جرس التنبيهات ما كانش بيتسجّل «مقروء». 20260822000000_rls_audit_fixes.sql
-- شالت سياسة UPDATE على notifications وسابت بس الدالة mark_notifications_read (تحديد الكل لفئة)،
-- فطلب `update({read:true}).eq('id', ...)` من التطبيق بيرجع نجاح صامت بصفر صفوف متأثرة.
--
-- الحل: دالة security definer لإشعار واحد، بنفس نمط الدالة الجماعية: تغيّر read فقط وفقط
-- لإشعارات المستخدم نفسه (recipient_id = auth.uid())، فمفيش توسيع لصلاحيات الجدول.

create or replace function public.mark_notification_read(p_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.notifications set read = true
  where id = p_id and recipient_id = auth.uid() and read = false;
$$;

revoke all on function public.mark_notification_read(uuid) from public;
grant execute on function public.mark_notification_read(uuid) to authenticated;
