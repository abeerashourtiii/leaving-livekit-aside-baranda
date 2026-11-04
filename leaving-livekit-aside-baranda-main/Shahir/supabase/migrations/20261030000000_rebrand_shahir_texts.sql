-- supabase/migrations/20261030000000_rebrand_shahir_texts.sql
--
-- إعادة تسمية التطبيق Baranda ← Shahir: تحديث *نصوص رسائل واتساب الجاهزة* المخزّنة فى جدول القائمة (menu_items.action_value)
-- والتى كانت تحتوى «من تطبيق باراندا». فقط استبدال نصّى لكلمة الاسم داخل رسائل واتساب — لا تغيير فى أى بنية جداول أو معرّفات أو بيانات مستخدمين.
-- (idempotent: لو لا يوجد نص قديم لا يتغير شىء.)
update public.menu_items
   set action_value = replace(action_value, 'باراندا', 'Shahir')
 where action_type = 'whatsapp'
   and action_value like '%باراندا%';
