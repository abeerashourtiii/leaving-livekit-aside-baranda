-- A8) cancel_ad_promotion / cancel_ad_space_order ترفضان الجلسات المجهولة (الضيف) صراحةً (كانتا تكتفيان بـ auth.uid() is null).
-- A4) قيود خادم على الريلز المميزة (sponsored_reels): العمر ≥ 18 والأدنى ≤ الأقصى وهدف الوصول > 0 — NOT VALID حتى لا تفشل الصفوف القديمة،
--     وتُطبَّق على كل إدراج/تعديل جديد (تتوافق مع قيد ad_promotions الذى يُنشئ هذه الصفوف عند التفعيل).
-- إضافى (لا يمسّ نسخ التطبيق القديمة إلا لو أرسل الأدمن قيمًا خاطئة). قابل لإعادة التشغيل.
create or replace function public.cancel_ad_promotion(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  update public.ad_promotions
     set status = 'cancelled'
   where id = p_id and payer_id = v_uid and status = 'pending_payment';
  if not found then
    raise exception 'cannot_cancel';
  end if;
end;
$$;

create or replace function public.cancel_ad_space_order(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  update public.ad_space_orders set status = 'cancelled'
   where id = p_id and payer_id = v_uid and status = 'pending_payment';
  if not found then
    raise exception 'cannot_cancel';
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sponsored_reels_targeting_check') then
    alter table public.sponsored_reels
      add constraint sponsored_reels_targeting_check check (
        (age_min is null or age_min >= 18)
        and (age_max is null or (age_max >= 18 and age_max <= 100))
        and (age_min is null or age_max is null or age_max >= age_min)
        and (reach_goal is null or reach_goal > 0)
      ) not valid;
  end if;
end $$;

notify pgrst, 'reload schema';
