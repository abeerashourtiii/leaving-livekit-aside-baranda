import { useEffect } from 'react';
import { Text, View, ActivityIndicator, Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { completeOAuthCallback } from '../lib/hooks/useAuth';
import { getAuthSnapshot } from '../lib/hooks/useCurrentUser';
import { showToast } from '../components/shared/Toast';
import { useLanguage } from '../lib/hooks/useLanguage';

export default function AuthCallback() {
  const router = useRouter();
  const { t } = useLanguage();

  useEffect(() => {
    let isMounted = true;

    const handleCallback = async () => {
      try {
        // OAuth is completed here exactly once. Native completes through the
        // same helper before returning from WebBrowser.
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const callbackUrl = window.location.href;
          window.history.replaceState({}, document.title, window.location.pathname);
          const callbackResult = await completeOAuthCallback(callbackUrl);
          if (callbackResult.error) throw new Error(callbackResult.error);
          if (isMounted) {
            router.replace('/(tabs)');
            return;
          }
        }

        // 2. معالجة الموبايل والـ APK (Android / iOS Handling)
        // ↔ رابط تفعيل البريد (أو أى رابط auth) بيفتح التطبيق على diarino://auth-callback#...
        // — لازم نكمّل الجلسة من الرابط نفسه (tokens/code) قبل ما نقرر نوجّه فين.
        // (completeOAuthCallback بيمنع تنفيذ نفس الرابط مرتين فمفيش تعارض مع تسجيل جوجل.)
        if (Platform.OS !== 'web') {
          const linkUrl = await Linking.getInitialURL();
          if (linkUrl && linkUrl.includes('auth-callback') && /access_token=|code=|error_description=/.test(linkUrl)) {
            const callbackResult = await completeOAuthCallback(linkUrl);
            if (callbackResult.error && !getAuthSnapshot().user) throw new Error(callbackResult.error);
          }
        }
        if (getAuthSnapshot().user && isMounted) {
          router.replace('/(tabs)');
        } else if (isMounted) {
          router.replace('/');
        }
      } catch (err) {
        console.error('Error in auth callback:', err);
        showToast(err instanceof Error ? err.message : t('تعذر إكمال تسجيل الدخول. حاول مرة أخرى.'));
        if (isMounted) router.replace('/');
      }
    };

    handleCallback();

    return () => {
      isMounted = false;
    };
  }, [router]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fdfbf7' }}>
      <ActivityIndicator size="large" color="#1a3636" />
      <Text style={{ marginTop: 12, fontSize: 14, color: '#4a5568' }}>{t('جاري إكمال تسجيل الدخول...')}</Text>
    </View>
  );
}