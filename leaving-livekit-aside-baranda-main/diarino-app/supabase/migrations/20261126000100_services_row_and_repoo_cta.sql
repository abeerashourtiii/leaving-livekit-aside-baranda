-- supabase/migrations/20261126000100_services_row_and_repoo_cta.sql
-- ↔ تصحيحان على صفحة القائمة (idempotent):
--   ١) صف «الخدمات» فى menu_items = حاوية قسم «الخدمات» الفعلية (شريط كروت الشركات + «أضف شركتك»)، وليس كارتًا مستقلًا. التطبيق (الإصدار الحالى)
--      يعرف الصف بـ action_type='route' و action_value='/services' فيرسم الحاوية نفسها فى موضعه (بين صف «انشر/اطلب/ابحث» وصف «احمي استثمارك/الإعدادات»)
--      ولا يرسم أى بطاقة. هنا نتأكد أن الصف بهذه العلامة بالظبط (لو الأدمن عدّلها بالخطأ) وأن حجمه عرض كامل.
--      ⚠ نسخ التطبيق/الويب القديمة (قبل هذا الإصدار) لا تعرف هذه العلامة فتعرض الصف كبطاقة زرقاء بنجمة — الحل تحديث/نشر الإصدار الجديد.
--   ٢) نص زر كارت Repoo: «اطلب عرض سعر» ← «للتواصل» (الحقل cta_label القديم فقط؛ لو عدّله الأدمن لنص آخر لا يُمَس).
update public.menu_items
   set action_type = 'route', action_value = '/services', size = 'full'
 where btrim(action_value) = '/services'
   and (action_type <> 'route' or action_value <> '/services' or size <> 'full');

update public.menu_items
   set cta_label = 'للتواصل'
 where btrim(coalesce(cta_label, '')) = 'اطلب عرض سعر';

notify pgrst, 'reload schema';
