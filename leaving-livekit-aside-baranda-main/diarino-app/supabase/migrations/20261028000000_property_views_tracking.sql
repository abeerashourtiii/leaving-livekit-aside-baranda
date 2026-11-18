-- supabase/migrations/20261028000000_property_views_tracking.sql
--
-- «إجمالي المشاهدات» فى النظرة العامة للأدمن كان ثابتًا على صفر: عمود properties.views موجود لكن *لا شىء فى التطبيق كان يزوّده*.
-- الآن: increment_property_views(p_property_id) يزوّد مشاهدة واحدة لكل (مستخدم/ضيف، إعلان، يوم) — بدون احتساب صاحب الإعلان —
-- والتطبيق يستدعيه بعد ثانيتين ونصف من ظهور الريل نشطًا (components/reel/ReelCard.tsx ← lib/hooks/usePropertyViews.ts).
-- كمان بنعيد تعريف increment_wa_clicks (idempotent) لضمان وجودها وصلاحيتها فى كل بيئة (عدّاد «تحويلات واتساب»).

create table if not exists public.property_view_log (
  property_id uuid not null references public.properties(id) on delete cascade,
  viewer_id uuid not null,
  day date not null default ((now() at time zone 'utc')::date),
  primary key (property_id, viewer_id, day)
);
alter table public.property_view_log enable row level security;
-- بدون سياسات عمدًا: الكتابة فقط من الدالة SECURITY DEFINER أدناه.
revoke all on public.property_view_log from anon, authenticated;

create or replace function public.increment_property_views(p_property_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new integer;
begin
  if v_uid is null or p_property_id is null then
    return;
  end if;
  -- مشاهدة صاحب الإعلان لإعلانه لا تُحتسب.
  if exists (select 1 from public.properties p where p.id = p_property_id and p.seller_id = v_uid) then
    return;
  end if;
  insert into public.property_view_log (property_id, viewer_id)
  values (p_property_id, v_uid)
  on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new > 0 then
    update public.properties p set views = p.views + 1 where p.id = p_property_id;
  end if;
exception when foreign_key_violation then
  return; -- الإعلان اتحذف
end;
$$;

revoke all on function public.increment_property_views(uuid) from public;
grant execute on function public.increment_property_views(uuid) to authenticated;

-- عدّاد تحويلات واتساب (نفس تعريف 20260801000000_admin_backend.sql) — إعادة إنشاء آمنة.
create or replace function public.increment_wa_clicks(property_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.properties set wa_clicks = wa_clicks + 1 where id = property_id;
$$;
revoke all on function public.increment_wa_clicks(uuid) from public;
grant execute on function public.increment_wa_clicks(uuid) to authenticated;

notify pgrst, 'reload schema';
