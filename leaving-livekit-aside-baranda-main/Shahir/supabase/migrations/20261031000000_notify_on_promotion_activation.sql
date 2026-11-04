-- supabase/migrations/20261031000000_notify_on_promotion_activation.sql
--
-- إشعار صاحب الإعلان عند تفعيل المشرف لطلبه:
--   • ترويج إعلان (مميز / افتتاحي)  ← جدول ad_promotions
--   • حجز مساحة إعلانية            ← جدول ad_space_orders
-- بيوصل ضمن إشعارات الجرس (category = 'approval'، نفس إشعارات قرارات الإدارة) ومعاه إشعار Push لو متفعّل عند المستخدم.
-- Trigger على الجدولين: بيشتغل فقط لحظة التحوّل إلى status = 'active' (admin_update_promotion / admin_update_ad_space_order)،
-- فتحديث ملاحظات طلب مفعّل بالفعل ما بيكرّرش الإشعار. أى مسار آخر بيفعّل الطلب بيحصل منه نفس الإشعار.

create or replace function public.notify_payer_on_activation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_text text;
  v_prop uuid := null;
begin
  if NEW.status is distinct from 'active' then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.status is not distinct from 'active' then
    return NEW; -- كان مفعّلًا بالفعل
  end if;
  if NEW.payer_id is null then
    return NEW;
  end if;

  if TG_TABLE_NAME = 'ad_promotions' then
    v_prop := NEW.property_id;
    v_text := 'تم تفعيل ترويج إعلانك «' || left(coalesce(NEW.property_title, ''), 60) || '» ('
              || case when NEW.kind = 'intro' then 'إعلان افتتاحي' else 'إعلان مميز' end
              || ') لمدة ' || NEW.duration_days || ' يومًا.';
  else
    v_text := 'تم تفعيل إعلانك «' || left(coalesce(NEW.title, ''), 60) || '» في المساحة الإعلانية لمدة '
              || NEW.duration_days || ' يومًا.';
  end if;

  insert into public.notifications (recipient_id, actor_id, category, text, property_id)
  values (NEW.payer_id, null, 'approval', v_text, v_prop);

  return NEW;
exception when others then
  -- فشل الإشعار ما يمنعش تفعيل الطلب نفسه.
  return NEW;
end;
$$;

revoke all on function public.notify_payer_on_activation() from public;

drop trigger if exists trg_notify_promotion_activation on public.ad_promotions;
create trigger trg_notify_promotion_activation
  after insert or update of status on public.ad_promotions
  for each row execute function public.notify_payer_on_activation();

drop trigger if exists trg_notify_ad_space_activation on public.ad_space_orders;
create trigger trg_notify_ad_space_activation
  after insert or update of status on public.ad_space_orders
  for each row execute function public.notify_payer_on_activation();
