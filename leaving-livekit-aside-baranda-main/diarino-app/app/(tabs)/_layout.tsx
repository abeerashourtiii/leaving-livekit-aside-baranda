import { Tabs } from "expo-router";
import { View } from "react-native";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { FloatingTabBar } from "./_floating-tab-bar";
import { CompareBar } from "../../components/shared/CompareBar";
import { useAccountTypeGate } from "../../lib/hooks/useAccountTypeGate";
import { useMenuPrewarm } from "../../lib/hooks/useMenuPrewarm";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { useOffersRealtimeSync } from "../../lib/hooks/useOffersHub";

// Bottom nav is now a fully custom floating bar (see ./_floating-tab-bar)
// instead of the default full-width <Tabs> bar — a dark pill holding
// طلبات/قائمة/رئيسية plus a separate raised circular زر للبحث, both
// floating above the screen content instead of docking to the bottom.
//
// "account" is still a real screen (reachable via router.push from the
// menu page's "إدارة الحساب" card) but it no longer gets its own button
// in the bottom bar, so it's marked href: null to keep it out of any
// default tab-bar affordances while staying fully navigable.
export default function TabsLayout() {
  const { t } = useLanguage();
  // ↔ جوجل بدون نوع حساب → شاشة إكمال البيانات الإجبارية (app/edit-profile.tsx?onboarding=1).
  useAccountTypeGate();
  // ↔ جلب كروت القائمة والبانرات مسبقًا + عرض آخر نسخة محفوظة لحظيًا (صفحة القائمة بتفتح فورًا من أول مرة).
  useMenuPrewarm();
  // ↔ اشتراك Realtime واحد لرسائل/عروض المحادثات: يحدّث النقطة الحمراء على أيقونة «العروض» وقائمة العروض فورًا (مستخدم مسجَّل فقط).
  const { user: authUser } = useCurrentUser();
  useOffersRealtimeSync(authUser && !authUser.is_anonymous ? authUser.id : undefined);
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="index" options={{ title: t("الرئيسية") }} />
        <Tabs.Screen name="search" options={{ title: t("البحث") }} />
        {/* lazy:false → تبويب القائمة بيتركّب مع بدء التطبيق، فالانتقال إليه لحظى بدل ما يتركّب وقت الضغط. */}
        <Tabs.Screen name="menu" options={{ title: t("القائمة"), lazy: false }} />
        <Tabs.Screen name="requests" options={{ title: t("الطلبات") }} />
        <Tabs.Screen name="account" options={{ title: t("الحساب"), href: null }} />
      </Tabs>
      {/* ↔ floats above the tab bar on every tab — see CompareBar.tsx */}
      <CompareBar />
    </View>
  );
}
