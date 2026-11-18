-- A2) الترويج المدفوع (ad_promotions) والمساحة الإعلانية (ad_space_orders): المعلن لا يقرأ أعمدة إدارية من طلباته (كما فُعل فى property_deals).
--  قبلها: سياسة RLS على مستوى الصف فقط، فكان المعلن يطلب مباشرة admin_note وpayment_ref وhandled_by وhandled_at وبيانات payer_*، ودالتا
--  confirm_promotion_payment / confirm_ad_space_payment كانتا ترجعان الصف كاملًا (بما فى ذلك ما أدخله الأدمن من قبل).
--  الآن: (1) صلاحيات على مستوى العمود (الأعمدة التى تعرضها الشاشات فقط)، (2) الدالتان ترجعان jsonb بحقول المعلن فقط،
--        (3) عمود payer_note: ملاحظة الرفض التى كانت تُعرض للمعلن من admin_note (الحقل «ملاحظة للمعلن (تظهر عند الرفض)» فى لوحة الأدمن)؛
--            تُنسخ تلقائيًا من admin_note عند الرفض فقط وتُمسح عند مغادرة حالة الرفض، فلا تتسرّب ملاحظات الأدمن الداخلية فى الحالات الأخرى.
--  الأدمن يقرأ عبر admin_list_promotions / admin_list_ad_space_orders (security definer) فلا يتأثر.
-- ⚠ نسخ التطبيق القديمة تقرأ select("*") فتفشل قوائم الترويج/المساحة الإعلانية عندها (تعرض فارغة)؛ السداد/الإلغاء/الإنشاء عبر RPC لا يتأثر.
-- قابل لإعادة التشغيل. لا يعدّل أى migration قديم.

alter table public.ad_promotions add column if not exists payer_note text;
alter table public.ad_space_orders add column if not exists payer_note text;

-- نقل ملاحظة الرفض الحالية.
update public.ad_promotions set payer_note = nullif(btrim(admin_note), '')
 where status = 'rejected' and payer_note is null and admin_note is not null;
update public.ad_space_orders set payer_note = nullif(btrim(admin_note), '')
 where status = 'rejected' and payer_note is null and admin_note is not null;

create or replace function public.ad_orders_sync_payer_note()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'rejected' then
    new.payer_note := nullif(btrim(coalesce(new.admin_note, '')), '');
  elsif new.status is distinct from old.status then
    new.payer_note := null;
  end if;
  return new;
end;
$$;

drop trigger if exists ad_promotions_sync_payer_note on public.ad_promotions;
create trigger ad_promotions_sync_payer_note
  before update on public.ad_promotions
  for each row execute function public.ad_orders_sync_payer_note();

drop trigger if exists ad_space_orders_sync_payer_note on public.ad_space_orders;
create trigger ad_space_orders_sync_payer_note
  before update on public.ad_space_orders
  for each row execute function public.ad_orders_sync_payer_note();

-- @@TIGHTEN-BEGIN
-- صلاحيات الأعمدة (المحجوب: payer_name/phone/email وpayment_ref وadmin_note وhandled_by وhandled_at).
revoke select on public.ad_promotions from anon, authenticated;
grant select (
  id, property_id, property_title, payer_id, kind, reach_goal, age_min, age_max, duration_days, price_egp, status,
  payment_method, payment_sender_name, payment_contact_phone, payment_submitted_at, paid_at,
  starts_at, ends_at, sponsored_reel_id, created_at, payer_note
) on public.ad_promotions to authenticated;

revoke select on public.ad_space_orders from anon, authenticated;
grant select (
  id, payer_id, title, image_url, duration_days, price_egp, status,
  payment_method, payment_sender_name, payment_contact_phone, payment_submitted_at, paid_at,
  starts_at, ends_at, banner_id, created_at, payer_note
) on public.ad_space_orders to authenticated;
-- @@TIGHTEN-END

-- الدالتان ترجعان حقول المعلن فقط.
drop function if exists public.confirm_promotion_payment(uuid, text, text, text);
create or replace function public.confirm_promotion_payment(
  p_id uuid,
  p_method text,
  p_sender_name text,
  p_contact_phone text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.ad_promotions%rowtype;
  v_name text := regexp_replace(btrim(coalesce(p_sender_name, '')), '\s+', ' ', 'g');
  v_phone text := btrim(coalesce(p_contact_phone, ''));
  v_row public.ad_promotions%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_order from public.ad_promotions where id = p_id for update;
  if not found or v_order.payer_id is distinct from v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if v_order.status not in ('pending_payment', 'submitted', 'rejected') then
    raise exception 'order_closed';
  end if;
  if p_method not in ('vodafone_cash', 'etisalat_cash', 'instapay') then
    raise exception 'bad_method';
  end if;
  if char_length(v_name) > 120 or coalesce(array_length(regexp_split_to_array(v_name, ' '), 1), 0) < 3 then
    raise exception 'bad_sender_name';
  end if;
  if char_length(regexp_replace(v_phone, '\D', '', 'g')) not between 7 and 15 or char_length(v_phone) > 30 then
    raise exception 'bad_contact_phone';
  end if;

  update public.ad_promotions
     set status = 'submitted',
         payment_method = p_method,
         payment_sender_name = v_name,
         payment_contact_phone = v_phone,
         payment_submitted_at = now()
   where id = p_id
   returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id, 'status', v_row.status, 'price_egp', v_row.price_egp,
    'payment_method', v_row.payment_method, 'payment_submitted_at', v_row.payment_submitted_at
  );
end;
$$;
revoke all on function public.confirm_promotion_payment(uuid, text, text, text) from public;
grant execute on function public.confirm_promotion_payment(uuid, text, text, text) to authenticated;

drop function if exists public.confirm_ad_space_payment(uuid, text, text, text);
create or replace function public.confirm_ad_space_payment(
  p_id uuid,
  p_method text,
  p_sender_name text,
  p_contact_phone text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.ad_space_orders%rowtype;
  v_name text := regexp_replace(btrim(coalesce(p_sender_name, '')), '\s+', ' ', 'g');
  v_phone text := btrim(coalesce(p_contact_phone, ''));
  v_row public.ad_space_orders%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_order from public.ad_space_orders where id = p_id for update;
  if not found or v_order.payer_id is distinct from v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if v_order.status not in ('pending_payment', 'submitted', 'rejected') then
    raise exception 'order_closed';
  end if;
  if p_method not in ('vodafone_cash', 'etisalat_cash', 'instapay') then
    raise exception 'bad_method';
  end if;
  if char_length(v_name) > 120 or coalesce(array_length(regexp_split_to_array(v_name, ' '), 1), 0) < 3 then
    raise exception 'bad_sender_name';
  end if;
  if char_length(regexp_replace(v_phone, '\D', '', 'g')) not between 7 and 15 or char_length(v_phone) > 30 then
    raise exception 'bad_contact_phone';
  end if;

  update public.ad_space_orders
     set status = 'submitted', payment_method = p_method, payment_sender_name = v_name,
         payment_contact_phone = v_phone, payment_submitted_at = now()
   where id = p_id
   returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id, 'status', v_row.status, 'price_egp', v_row.price_egp,
    'payment_method', v_row.payment_method, 'payment_submitted_at', v_row.payment_submitted_at
  );
end;
$$;
revoke all on function public.confirm_ad_space_payment(uuid, text, text, text) from public;
grant execute on function public.confirm_ad_space_payment(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
