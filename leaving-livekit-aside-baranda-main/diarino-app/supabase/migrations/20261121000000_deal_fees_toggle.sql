-- supabase/migrations/20261121000000_deal_fees_toggle.sql
--
-- مفتاح تشغيل/إيقاف «رسوم تم البيع / تم الإيجار» من لوحة الأدمن (قسم «الصفقات والرسوم»):
--   • الخدمة مجانية حاليًا: deal_settings.fees_enabled = false (الافتراضى).
--   • الخاصية باقية: «تم البيع / تم الإيجار» ما زالت تُغلق الإعلان وتضع الشارة على كارته وتُسجّل الصفقة، لكن بدون رسم ولا فاتورة:
--     تُسجَّل الصفقة بحالة 'waived' ورسم 0 وملاحظة إدارية 'free_period' (فلا تظهر فى فواتير الناشر ولا تُحتسب مستحقات).
--   • عند التفعيل (fees_enabled = true) يعود السلوك السابق كما هو: رسم البيع/الإيجار من الإعدادات + مهلة السداد + الفاتورة.
--   • التعديل للمشرف الرئيسى فقط (سياسة deal_settings "super admin can update deal settings" من 20261102000000)؛ تفعيل الرسوم يستلزم
--     إخطار الناشرين قبلها بـ 30 يومًا (سياسة البيع والرسوم) — التطبيق يعرض هذا التنبيه عند التفعيل.
--   • الصفقات المُسجَّلة سابقًا بالرسوم لا تتأثر (تبقى مستحقة/مسدَّدة كما هى).

alter table public.deal_settings
  add column if not exists fees_enabled boolean not null default false;

comment on column public.deal_settings.fees_enabled is
  'هل تُحتسب رسوم عند تسجيل «تم البيع / تم الإيجار»؟ false = الخدمة مجانية (تُغلق الإعلان بدون فاتورة)، true = الرسم + الفاتورة.';

create or replace function public.report_property_deal(
  p_property_id uuid,
  p_deal_type text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prop public.properties%rowtype;
  v_set public.deal_settings%rowtype;
  v_type text;
  v_name text;
  v_phone text;
  v_email text;
  v_fee numeric;
  v_fees_on boolean;
  v_row public.property_deals%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_prop from public.properties where id = p_property_id for update;
  if not found or v_prop.seller_id <> v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  if p_deal_type not in ('sale', 'rent') or p_deal_type <> v_prop.purpose then
    raise exception 'type_mismatch';
  end if;

  -- إعلان أُغلق بصفقة من قبل لا يُبلَّغ عنه ثانيةً (الصفقات المجانية 'waived' لا تدخل فى الفهرس الفريد فنمنعها هنا).
  if v_prop.closed_at is not null or exists (
    select 1 from public.property_deals
    where property_id = p_property_id and status <> 'waived'
  ) then
    raise exception 'already_reported';
  end if;

  select * into v_set from public.deal_settings where id = true;
  v_fees_on := coalesce(v_set.fees_enabled, false);
  v_fee := case
    when not v_fees_on then 0
    when p_deal_type = 'rent' then coalesce(v_set.fee_rent_egp, 500)
    else coalesce(v_set.fee_egp, 1000)
  end;

  select p.account_type, p.full_name, p.phone_e164, u.email::text
    into v_type, v_name, v_phone, v_email
    from public.profiles p
    left join auth.users u on u.id = p.id
   where p.id = v_uid;

  insert into public.property_deals (
    property_id, property_title, property_province, payer_id, payer_account_type,
    payer_name, payer_phone, payer_email,
    deal_type, fee_egp, status, due_at, note, admin_note, handled_at
  )
  values (
    p_property_id, coalesce(v_prop.short_title, v_prop.title, ''), v_prop.province, v_uid, v_type,
    v_name, v_phone, v_email,
    p_deal_type, v_fee,
    case when v_fees_on then 'reported' else 'waived' end,
    case when v_fees_on then now() + make_interval(days => coalesce(v_set.pay_days, 7)) else null end,
    nullif(left(coalesce(p_note, ''), 500), ''),
    case when v_fees_on then null else 'free_period' end,
    case when v_fees_on then null else now() end
  )
  returning * into v_row;

  perform set_config('app.deal_rpc', 'on', true);
  update public.properties
     set closed_at = now(),
         closed_type = case when p_deal_type = 'sale' then 'sold' else 'rented' end,
         pinned = false,
         pinned_at = null
   where id = p_property_id;

  return jsonb_build_object(
    'id', v_row.id, 'property_id', v_row.property_id, 'deal_type', v_row.deal_type,
    'fee_egp', v_row.fee_egp, 'status', v_row.status,
    'reported_at', v_row.reported_at, 'due_at', v_row.due_at,
    'fees_enabled', v_fees_on
  );
end;
$$;
revoke all on function public.report_property_deal(uuid, text, text) from public, anon;
grant execute on function public.report_property_deal(uuid, text, text) to authenticated;
