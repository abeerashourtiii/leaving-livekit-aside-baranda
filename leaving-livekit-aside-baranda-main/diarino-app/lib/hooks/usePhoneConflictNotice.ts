import { useEffect } from "react";
import { supabase } from "../supabase";
import { showToast } from "../../components/shared/Toast";
import { translate } from "./useLanguage";

// ↔ B3ج: لو رقم التسجيل كان مسجّلًا لحساب آخر، الخادم بيُسقطه (بدل إفشال التسجيل) ويضبط profiles.phone_conflict=true. هنا نُبلغ المستخدم مرة
//   واحدة عند أول دخول ونصفّر العلامة، بدل ما يختفى رقمه بصمت. أى فشل (العمود غير موجود لأن الـ migration لم تُطبَّق…) يُتجاهل.
export function usePhoneConflictNotice(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.from("profiles").select("phone_conflict").eq("id", userId).maybeSingle();
        if (cancelled || error || !(data as { phone_conflict?: boolean } | null)?.phone_conflict) return;
        showToast(translate("رقم الهاتف الذى سجّلت به مسجّل لحساب آخر ولم يُحفظ فى حسابك. حدّث رقمك من «تعديل الحساب»."));
        await supabase.from("profiles").update({ phone_conflict: false }).eq("id", userId);
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [userId]);
}
