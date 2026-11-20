-- ترتيب الإعلانات الممولة (الافتتاحى/المميز) حسب «وقت التفعيل» الفعلى، لا وقت إنشاء الصف.
-- المشكلة: لو أُعيد تفعيل طلب ترويج قديم (مرفوض/ملغى ثم مفعّل) أو أعاد الأدمن تفعيل ريل ممول، يبقى created_at القديم،
-- فلا يظهر «الأحدث تفعيلًا أولًا» كما تنص السياسة. الحل: عمود activated_at يُحدَّث عند كل تفعيل، والتطبيق يرتّب به.
alter table public.sponsored_reels add column if not exists activated_at timestamptz;

update public.sponsored_reels sr
   set activated_at = coalesce(
     (select max(ap.starts_at) from public.ad_promotions ap where ap.sponsored_reel_id = sr.id),
     sr.created_at
   )
 where sr.activated_at is null;

alter table public.sponsored_reels alter column activated_at set default now();
alter table public.sponsored_reels alter column activated_at set not null;

-- أى انتقال من غير مفعّل إلى مفعّل (من لوحة «الريلز المميزة» أو من أى مسار) يجعله «الأحدث تفعيلًا».
create or replace function public.sponsored_reels_touch_activated()
returns trigger
language plpgsql
as $$
begin
  if NEW.active and not coalesce(OLD.active, false) then
    NEW.activated_at := now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_sponsored_reels_touch_activated on public.sponsored_reels;
create trigger trg_sponsored_reels_touch_activated
  before update of active on public.sponsored_reels
  for each row execute function public.sponsored_reels_touch_activated();

-- نفس admin_update_promotion (20261023) مع تحديث activated_at عند التفعيل (حتى لو الصف الممول كان فعّالًا بالفعل).
create or replace function public.admin_update_promotion(
  p_id uuid,
  p_status text,
  p_payment_ref text default null,
  p_admin_note text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_order public.ad_promotions%rowtype;
  v_prop public.properties%rowtype;
  v_reel uuid;
  v_start date := current_date;
  v_end date;
begin
  if not public.admin_has_permission('deals') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('pending_payment', 'submitted', 'active', 'rejected', 'cancelled') then
    raise exception 'bad_status';
  end if;

  select * into v_order from public.ad_promotions where id = p_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;

  if p_status = 'active' then
    if v_order.property_id is null then
      raise exception 'property_unavailable';
    end if;
    select * into v_prop from public.properties where id = v_order.property_id;
    if not found or v_prop.closed_at is not null then
      raise exception 'property_unavailable';
    end if;

    if v_order.status = 'active' then
      -- مفعّل بالفعل: نحدّث الملاحظات فقط ولا نمدّد المدة.
      update public.ad_promotions
         set payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
             admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
             handled_by = auth.uid(), handled_at = now()
       where id = p_id;
      return;
    end if;

    v_end := v_start + (v_order.duration_days - 1);
    v_reel := v_order.sponsored_reel_id;
    if v_reel is not null and exists (select 1 from public.sponsored_reels where id = v_reel) then
      update public.sponsored_reels
         set active = true, start_date = v_start, end_date = v_end,
             reach_goal = v_order.reach_goal, current_reach = 0,
             age_min = v_order.age_min, age_max = v_order.age_max,
             activated_at = now()
       where id = v_reel;
    else
      insert into public.sponsored_reels (property_id, placement, reach_goal, age_min, age_max, gender_target, active, start_date, end_date, activated_at)
      values (v_order.property_id, case when v_order.kind = 'intro' then 'intro' else 'in_feed' end,
              v_order.reach_goal, v_order.age_min, v_order.age_max, 'all', true, v_start, v_end, now())
      returning id into v_reel;
    end if;

    update public.ad_promotions
       set status = 'active', paid_at = coalesce(paid_at, now()),
           starts_at = now(), ends_at = now() + make_interval(days => v_order.duration_days),
           sponsored_reel_id = v_reel,
           payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
           admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
           handled_by = auth.uid(), handled_at = now()
     where id = p_id;
  else
    if v_order.sponsored_reel_id is not null then
      update public.sponsored_reels set active = false where id = v_order.sponsored_reel_id;
    end if;
    update public.ad_promotions
       set status = p_status,
           payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
           admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
           handled_by = auth.uid(), handled_at = now()
     where id = p_id;
  end if;
end;
$$;
