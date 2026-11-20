-- L8) إنشاء عنصر قائمة فى موضعه المطلوب فى معاملة واحدة (كان: إدراج ثم نقل فى طلبين منفصلين، وفشل الثانى يترك العنصر فى مكان خاطئ).
--     + التحقق من أن روابط action_type='url' تبدأ بـ https:// (G5) على الخادم أيضًا.
-- قابل لإعادة التشغيل. لا يعدّل أى migration قديم.
create or replace function public.admin_create_menu_item_at(p_row jsonb, p_position integer default null)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  r public.menu_items;
  v_id uuid;
  v_ids uuid[];
  v_n integer;
  v_pos integer;
begin
  if not public.admin_has_permission('menuItems') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  r := jsonb_populate_record(null::public.menu_items, coalesce(p_row, '{}'::jsonb));
  if r.title is null or btrim(r.title) = '' then
    raise exception 'title_required' using errcode = '22023';
  end if;
  if r.action_type is null or coalesce(btrim(r.action_value), '') = '' then
    raise exception 'action_required' using errcode = '22023';
  end if;
  if r.action_type = 'url' and r.action_value !~* '^https://' then
    raise exception 'invalid_url' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('menu_items_order'));

  insert into public.menu_items (
    title, subtitle, color, icon_key, size, action_type, action_value, sort_order, cta_label,
    image_url, image_size, image_fit, text_layout, image_side, font_size, font_bold, font_color,
    text_valign, text_halign, image_pad_h, image_pad_v, font_style, color_end, badge_label
  ) values (
    r.title, r.subtitle, coalesce(r.color, '#22A652'), coalesce(r.icon_key, 'star'), coalesce(r.size, 'half'),
    r.action_type, r.action_value, (select coalesce(max(sort_order), -1) + 1 from public.menu_items), r.cta_label,
    r.image_url, coalesce(r.image_size, 'medium'), coalesce(r.image_fit, 'contain'), coalesce(r.text_layout, 'below'),
    coalesce(r.image_side, 'right'), r.font_size, coalesce(r.font_bold, false), r.font_color,
    coalesce(r.text_valign, 'middle'), coalesce(r.text_halign, 'center'), r.image_pad_h, r.image_pad_v,
    coalesce(r.font_style, 'normal'), r.color_end, r.badge_label
  ) returning id into v_id;

  if p_position is not null and p_position > 0 then
    select coalesce(array_agg(id order by sort_order, created_at, id), '{}'::uuid[])
      into v_ids from public.menu_items where id <> v_id;
    v_n := coalesce(array_length(v_ids, 1), 0);
    v_pos := least(p_position, v_n + 1);
    v_ids := v_ids[1:v_pos - 1] || v_id || v_ids[v_pos:v_n];
    update public.menu_items m
       set sort_order = o.ord - 1
      from unnest(v_ids) with ordinality as o(id, ord)
     where m.id = o.id;
  end if;

  return v_id;
end;
$$;
revoke all on function public.admin_create_menu_item_at(jsonb, integer) from public, anon;
grant execute on function public.admin_create_menu_item_at(jsonb, integer) to authenticated;

notify pgrst, 'reload schema';
