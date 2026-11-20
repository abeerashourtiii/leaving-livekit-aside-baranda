const path = require("node:path");

// ↔ dotenv اختيارى: لو الحزمة مش موجودة وقت البناء (EAS) ما نفشلش قراءة الإعدادات — لأن فشل app.config.js كان يخلّى
// الإعدادات المضمّنة فى التطبيق فاضية (بدون scheme) فيظهر خطأ "no custom scheme defined" عند تسجيل الدخول.
try {
	require("dotenv").config({ path: path.resolve(__dirname, ".env") });
} catch (_e) {
	// متغيرات البيئة تأتى من eas.json / البيئة مباشرة.
}

module.exports = ({ config }) => ({
	...config,
	// ↔ نضمن وجود scheme دائمًا (لازم يطابق Info.plist و AndroidManifest.xml و lib/hooks/useAuth.ts → APP_SCHEME).
	scheme: config.scheme || "diarino",
	extra: {
		...config.extra,
		supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
		supabaseAnonKey:
			process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
			process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
	},
});
