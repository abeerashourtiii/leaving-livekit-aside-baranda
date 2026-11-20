-- «تضييق» مُولَّد من 20261116100001_ad_orders_hide_admin_columns.sql (1 كتلة). يُطبَّق *بعد* نشر النسخة الجديدة وبعد رفع app_version_requirements.min_version
-- فوق النسخة القديمة (انظر supabase/staged/README.md). أعد تسمية هذا الملف بتاريخ التطبيق الفعلى (YYYYMMDDHHMMSS_...) ثم انقله إلى supabase/migrations.
-- يعتمد على الجزء الإضافى من الملف الأصلى (المُطبَّق قبله).

-- (من 20261116100001_ad_orders_hide_admin_columns.sql) كتلة 1
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

notify pgrst, 'reload schema';
