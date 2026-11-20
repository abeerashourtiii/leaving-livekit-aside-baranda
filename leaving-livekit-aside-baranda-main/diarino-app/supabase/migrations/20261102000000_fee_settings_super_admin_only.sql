-- تعديل رسوم الخدمة وأسعار الترويج/المساحة الإعلانية للمشرف الرئيسي فقط (is_super_admin).
-- السبب: أى تغيير فيها يستلزم إعادة ضبط السياسات وإخطار الناشرين قبلها بـ 30 يومًا، فلا يجوز لمشرف عادى
-- (حتى لو لديه صلاحية 'deals') تغييرها؛ يبقى له الاطلاع عليها (سياسات القراءة select لم تتغير).
-- الواجهة (components/admin/AdminDeals.tsx و AdminPromotions.tsx) تخفى الحفظ عن غير المشرف الرئيسي، وهذه السياسات هى الإنفاذ الفعلى.
drop policy if exists "admins can update deal settings" on public.deal_settings;
create policy "super admin can update deal settings"
  on public.deal_settings for update
  to authenticated
  using (public.is_super_admin_user())
  with check (public.is_super_admin_user());

drop policy if exists "admins can update promo settings" on public.promo_settings;
create policy "super admin can update promo settings"
  on public.promo_settings for update
  to authenticated
  using (public.is_super_admin_user())
  with check (public.is_super_admin_user());
