-- supabase/migrations/20260929010000_menu_reference_layout.sql
--
-- إعادة بناء صفحة "القائمة" لتطابق التصميم المرجعي المعتمد:
--   [بانر إعلاني]
--   [انشر عقارك / اطلب عقارك (مكدّسين)] + [ابحث عن عقار (طويل)]
--   [وكيلك القانوني] + [إدارة الحساب (دائرة بصورة المستخدم)]
--   [Repoo (طويل)] + [الإعدادات / ونش ونقل أثاث (مكدّسين)]
--   [لوازم السباكة والكهرباء (بانر كامل)]
--
-- ترتيب الصفوف بيتحدد من sort_order + size (راجع buildRows فى
-- app/(tabs)/menu.tsx):
--   half + half + tall  -> نصفين مكدّسين على جنب + كارت طويل على الجنب التاني
--   tall + half + half  -> كارت طويل + نصفين مكدّسين
--   half + round        -> كارت عريض + دائرة صغيرة
--
-- ملاحظات:
--  * الـ migration ده بيعيد ضبط الشكل (اللون/الحجم/الـ layout/الصورة) للكروت
--    المعروفة بالعنوان، وبيمسح image_url المرفوعة عليها (عشان الرسومات
--    المرجعية المضمّنة فى التطبيق هى اللى تظهر). الأكشن (الرابط/الواتساب)
--    بتاع كل كارت موجود بيفضل زي ما هو.
--  * كارت "اطلع اللايف" بيتحط فى آخر الترتيب (وبيفضل مخفي طالما ميزة
--    البث المباشر معطّلة من لوحة الأدمن).

-- ---------------------------------------------------------------------
-- 1. أعمدة جديدة
-- ---------------------------------------------------------------------
alter table public.menu_items
  add column if not exists color_end text
    check (color_end is null or color_end ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists badge_label text;

comment on column public.menu_items.color_end is
  'لون نهاية التدرّج (Hex). NULL = لون خلفية ثابت (color). لو موجود الكارت بيتدرّج من color لـ color_end.';
comment on column public.menu_items.badge_label is
  'سطر/شارة إضافية: فى الكارت الكامل بجانب زرار CTA بتظهر كشارة صفراء بأيقونة توصيل (مثال: ومن غير تعب التوصيل)، وفى الكارت الطويل بتظهر كسطر نص عادي تحت الوصف (مثال: أكثر من 1K منزل تم تسليمهم).';

-- ---------------------------------------------------------------------
-- 2. إنشاء الكروت الناقصة (لو الأدمن كان حذف أي كارت منهم)
-- ---------------------------------------------------------------------
insert into public.menu_items (title, subtitle, color, icon_key, size, action_type, action_value, sort_order)
select v.title, v.subtitle, v.color, v.icon_key, v.size, v.action_type, v.action_value, v.sort_order
from (values
  ('انشر عقارك',              'بدون أي رسوم',                     '#6B6F3A', 'plus',              'half',  'route',    '/publish/create-listing',    0),
  ('اطلب عقارك',              'والعروض توصلك',                     '#55787C', 'chat',              'half',  'route',    '/publish/create-request',    1),
  ('ابحث عن عقار',            'اشتري واستأجر بسهولة سكني وتجاري',  '#304546', 'search_building',   'tall',  'route',    '/(tabs)/search',             2),
  ('وكيلك القانوني',          'استشارات قانونية عقارية متخصصة',    '#DEA671', 'scale',             'half',  'whatsapp', 'مرحباً، أرغب في الاستفسار عن خدمة الاستشارات القانونية للعقارات (وكيلك القانوني) من تطبيق باراندا', 3),
  ('إدارة الحساب',            null,                                '#EAD6AC', 'account_circle',    'round', 'route',    '/(tabs)/account',            4),
  ('Repoo',                   'للتشطيبات المتكاملة والديكور',      '#342F2B', 'building',          'tall',  'whatsapp', 'مرحباً، أرغب في الاستفسار عن خدمات التشطيب والديكور (Repoo) من تطبيق باراندا', 5),
  ('الإعدادات',               null,                                '#C87A02', 'settings',          'half',  'route',    '/settings',                  6),
  ('ونش ونقل أثاث',           'عرض سعر فوري',                      '#3F0B60', 'crane_truck',       'half',  'whatsapp', 'مرحباً، أرغب في طلب خدمة ونش ونقل الأثاث من تطبيق باراندا', 7),
  ('لوازم السباكة والكهرباء', 'أعلى جودة .. أفضل الأسعار',         '#127D78', 'plumbing_electric', 'full',  'whatsapp', 'مرحباً، أرغب في طلب لوازم سباكة/كهرباء من تطبيق باراندا. سأرسل صورة الطلب الآن.', 8)
) as v(title, subtitle, color, icon_key, size, action_type, action_value, sort_order)
where not exists (select 1 from public.menu_items m where m.title = v.title);

-- ---------------------------------------------------------------------
-- 3. ضبط الشكل بالكامل لكل كارت (نفس الأرقام/الألوان المأخوذة من المرجع)
-- ---------------------------------------------------------------------
update public.menu_items m set
  subtitle     = v.subtitle,
  color        = v.color,
  color_end    = v.color_end,
  icon_key     = v.icon_key,
  size         = v.size,
  sort_order   = v.sort_order,
  text_layout  = v.text_layout,
  image_side   = v.image_side,
  text_halign  = v.text_halign,
  text_valign  = 'middle',
  image_url    = null,
  image_size   = v.image_size,
  image_fit    = v.image_fit,
  image_pad_h  = v.image_pad,
  image_pad_v  = v.image_pad,
  font_size    = v.font_size,
  font_bold    = true,
  font_style   = 'normal',
  font_color   = v.font_color,
  cta_label    = v.cta_label,
  badge_label  = v.badge_label,
  active       = true
from (values
  -- title, subtitle, color, color_end, icon_key, size, sort, text_layout, image_side, text_halign, image_size, image_fit, image_pad, font_size, font_color, cta_label, badge_label
  ('انشر عقارك',    'بدون أي رسوم',                    '#6B6F3A', null,      'plus',            'half',  0, 'beside', 'left',  'right',  'medium', 'contain', null, 20,   null,      null, null),
  ('اطلب عقارك',    'والعروض توصلك',                    '#55787C', null,      'chat',            'half',  1, 'beside', 'left',  'right',  'medium', 'contain', null, 20,   null,      null, null),
  ('ابحث عن عقار',  'اشتري واستأجر بسهولة سكني وتجاري', '#304546', null,      'search_building', 'tall',  2, 'above',  'right', 'center', 'full',   'cover',   0,    24,   null,      null, null),
  ('وكيلك القانوني','استشارات قانونية عقارية متخصصة',   '#DEA671', '#FFFDF8', 'scale',           'half',  3, 'beside', 'left',  'right',  'medium', 'contain', null, 22,   '#1E1712', null, null),
  ('إدارة الحساب',  null,                               '#EAD6AC', '#C9A574', 'account_circle',  'round', 4, 'below',  'right', 'center', 'medium', 'contain', null, null, '#4A3427', null, null),
  ('Repoo',         'للتشطيبات المتكاملة والديكور',     '#342F2B', null,      'building',        'tall',  5, 'below',  'right', 'center', 'medium', 'contain', null, 34,   '#B99B7C', 'اطلب عرض سعر', 'أكثر من 1K منزل تم تسليمهم'),
  ('الإعدادات',     null,                               '#C87A02', '#A24F00', 'settings',        'half',  6, 'below',  'right', 'center', 'medium', 'contain', null, 19,   null,      null, null),
  ('ونش ونقل أثاث', 'عرض سعر فوري',                     '#3F0B60', '#33024C', 'crane_truck',     'half',  7, 'below',  'right', 'center', 'medium', 'contain', null, 19,   null,      null, null),
  ('لوازم السباكة والكهرباء', 'أعلى جودة .. أفضل الأسعار', '#127D78', '#2D8B78', 'plumbing_electric', 'full', 8, 'beside', 'left', 'right', 'medium', 'contain', null, 22, null, 'أطلب الآن', 'ومن غير تعب التوصيل')
) as v(title, subtitle, color, color_end, icon_key, size, sort_order, text_layout, image_side, text_halign, image_size, image_fit, image_pad, font_size, font_color, cta_label, badge_label)
where m.title = v.title;

-- كارت "اطلع اللايف": آخر الترتيب، عرض كامل (مخفي طالما feature_flags.live = false).
update public.menu_items
set sort_order = 99, size = 'full'
where action_type = 'route' and action_value like '/live%';
