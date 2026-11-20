# سياسة كلمة المرور القوية

**الشروط:** 8 أحرف على الأقل + أرقام + حروف إنجليزية صغيرة + حرف إنجليزي كبير (Capital) واحد على الأقل.

## أين تُطبَّق
- إنشاء حساب بالبريد (`app/auth-email.tsx`) وتعيين كلمة مرور جديدة بعد «نسيت كلمة المرور» (`app/reset-password.tsx`).
- التحقق فى `lib/password.ts` (`isStrongPassword`) وقائمة الشروط الحيّة تحت الحقل (`PasswordRules` فى `components/publish/FormControls.tsx`)
  تتلوّن بالأخضر مع تحقق كل شرط، وبالأحمر عند محاولة الإرسال بدونه. نفس الكود على أندرويد وآيفون والويب وAPK.
- **تسجيل الدخول لا يطبّق الشروط** عن قصد حتى لا نمنع أصحاب كلمات المرور القديمة الأضعف من الدخول (يُطلب منهم التقوية عند تغيير كلمة المرور).
- الدخول بحساب جوجل لا يستخدم كلمة مرور.

## الخادم (حماية إضافية — مطلوب منك مرة واحدة)
- Supabase Dashboard ← Authentication ← Sign In / Providers ← Email:
  `Minimum password length = 8` و `Password requirements = Lowercase, uppercase letters and digits`.
- `supabase/config.toml` فيه نفس الإعداد للبيئة المحلية (`[auth]`). رسالة خطأ الخادم (weak_password) تُترجم تلقائيًا
  فى `translateEmailAuthError` (`lib/hooks/useAuth.ts`).
