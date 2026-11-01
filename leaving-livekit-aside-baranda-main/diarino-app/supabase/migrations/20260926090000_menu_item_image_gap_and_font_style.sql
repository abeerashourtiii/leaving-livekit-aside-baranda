-- supabase/migrations/20260926090000_menu_item_image_gap_and_font_style.sql
--
-- لوحة تحكم الأدمن (أيقونات القائمة) — طلبات إضافية:
-- 1) تحكم دقيق (بالبكسل، مش 4 أحجام جاهزة بس) فى الفراغ بين حواف أي
--    صورة مرفقة وحواف كارت الأيقونة، أفقيًا ورأسيًا كل واحد لوحده.
-- 2) دعم فعلي لصورة شفافة الخلفية تطابق لون خلفية الكارت (كانت الصورة
--    بتتحوّل لـJPEG بدون شفافية عند القص أثناء الاختيار من الجهاز —
--    انظر التعديل فى AdminMenuItems.tsx).
-- 3) "شكل" إضافي للخط غير الحجم/اللون/Bold الموجودين بالفعل: مائل
--    (italic) أو عادي — بدون الحاجة لملفات خطوط جديدة (النظام يعرض
--    الخط المائل تلقائيًا من نفس ملف الخط الأساسي).

alter table public.menu_items
  add column if not exists image_pad_h integer,
  add column if not exists image_pad_v integer,
  add column if not exists font_style text not null default 'normal'
    check (font_style in ('normal', 'italic'));

comment on column public.menu_items.image_pad_h is
  'الفراغ الأفقي (بكسل) بين حافة الصورة المرفقة وحافة الكارت — يمين وشمال. NULL = القيمة التلقائية القديمة المشتقة من image_size (نفس السلوك قبل الميزة دي). يُطبَّق فى تخطيطات hidden/overlay/above.';
comment on column public.menu_items.image_pad_v is
  'الفراغ الرأسي (بكسل) بين حافة الصورة المرفقة وحافة الكارت — فوق وتحت. نفس قاعدة NULL بتاعة image_pad_h.';
comment on column public.menu_items.font_style is
  'normal (الافتراضي) أو italic (خط مائل) لعنوان/وصف الكارت — تحكم إضافي فى "شكل" الخط غير الحجم/اللون/Bold الموجودين بالفعل.';
