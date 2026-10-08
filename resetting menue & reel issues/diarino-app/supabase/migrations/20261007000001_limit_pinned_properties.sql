-- supabase/migrations/20261007000001_limit_pinned_properties.sql
--
-- أقصى عدد إعلانات مثبّتة لكل معلن = 3 (بتظهر أول صفحة المعلن). الواجهة
-- (components/account/AdActionSheet.tsx) بتمنع التثبيت الرابع وبتعرض رسالة،
-- وهنا الحماية الفعلية على الخادم: أى محاولة تثبيت رابعة (حتى من عميل معدّل
-- أو من جهازين فى نفس اللحظة) بترجع خطأ برسالة max_pinned.
--
-- المعلنين اللى عندهم أكتر من 3 مثبّتة قبل الـ migration دى بيفضلوا زى ما
-- هم (الشرط بيتشيك على التثبيت الجديد بس) — وصفحة المعلن بتعرض أحدث 3 فقط.

create or replace function public.enforce_max_pinned_properties()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pinned is true and (tg_op = 'INSERT' or old.pinned is distinct from true) then
    if (
      select count(*) from public.properties p
      where p.seller_id = new.seller_id and p.pinned = true and p.id <> new.id
    ) >= 3 then
      raise exception 'max_pinned: a seller can pin at most 3 listings' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists properties_max_pinned on public.properties;
create trigger properties_max_pinned
  before insert or update of pinned on public.properties
  for each row execute function public.enforce_max_pinned_properties();
