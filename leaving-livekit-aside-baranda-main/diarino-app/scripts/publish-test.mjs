// اختبار نشر إعلان على مشروع Supabase *تجريبى*. ⚠ ينشئ مستخدمًا وإعلانًا حقيقيين.
// ↔ H4: كان يشتغل على أى مشروع يشير إليه .env.local (بما فيه الإنتاج) ويسجّل مستخدمًا ببريد dev+tester@example.com (رسائل تفعيل ترتد وتضر بسمعة
//   المرسل) ويترك الإعلان بلا تنظيف (قد يكون approved فيظهر للجمهور). الآن:
//   • يرفض التشغيل إلا على Supabase المحلى (localhost/127.0.0.1)، أو مع ALLOW_TEST_PROJECT=1 *و* ALLOWED_TEST_PROJECT_REF=<ref> مطابق لمشروع الرابط؛
//   • يرفض نهائيًا مشروع الإنتاج المعروف (nwbtzchtwyhqktoerbap) مهما كانت المتغيّرات؛
//   • خارج المحلى يلزم TEST_EMAIL_DOMAIN (دومين صندوق اختبار/catch-all تتحكم به) حتى لا تُرسل رسائل لعناوين حقيقية؛ محليًا الرسائل تذهب إلى Inbucket؛
//   • يحذف الإعلان ثم الحساب (delete_my_account) فى النهاية حتى لو فشل أى خطوة.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const PRODUCTION_REFS = ['nwbtzchtwyhqktoerbap'];
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in environment');
  process.exit(1);
}

const host = new URL(SUPABASE_URL).hostname;
const isLocal = host === 'localhost' || host === '127.0.0.1';
const ref = host.endsWith('.supabase.co') ? host.split('.')[0] : null;

if (ref && PRODUCTION_REFS.includes(ref)) {
  console.error(`✗ Refusing to run: ${ref} is the PRODUCTION project. This script creates real users/listings.`);
  process.exit(1);
}
if (!isLocal) {
  if (process.env.ALLOW_TEST_PROJECT !== '1' || !ref || process.env.ALLOWED_TEST_PROJECT_REF !== ref) {
    console.error('✗ Refusing to run against a remote project. Set ALLOW_TEST_PROJECT=1 and ALLOWED_TEST_PROJECT_REF=<ref of the TEST project> (must match the URL).');
    process.exit(1);
  }
  if (!process.env.TEST_EMAIL_DOMAIN) {
    console.error('✗ Set TEST_EMAIL_DOMAIN to a test mailbox domain you control (no real emails must be sent to third parties).');
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  let propertyId = null;
  let signedIn = false;
  try {
    const domain = isLocal ? 'example.com' : process.env.TEST_EMAIL_DOMAIN;
    const email = `dev+tester+${Date.now()}@${domain}`;
    const password = 'Pass1234!';
    console.log('Signing up test user:', email);
    const { data: signData, error: signError } = await supabase.auth.signUp({ email, password });
    if (signError) {
      console.error('signUp error:', signError.message || signError);
    }

    // Try to sign in (some Supabase projects require confirm; this will show outcome)
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      console.error('signIn error:', signInError.message || signInError);
    } else {
      signedIn = !!signInData.session;
      console.log('signIn success, session exists:', signedIn);
    }

    const user = signInData?.user ?? signData?.user;
    if (!user) {
      console.error('No authenticated user available - cannot insert row under RLS policies.');
      process.exitCode = 1;
      return;
    }

    console.log('Attempting to insert test property as user', user.id);
    const { data: insertData, error: insertError } = await supabase.from('properties').insert([
      {
        seller_id: user.id,
        purpose: 'sale',
        type: 'شقة',
        title: 'إعلان اختبار (سكربت) — يُحذف تلقائيًا',
        short_title: 'اختبار',
        province: 'القاهرة',
        location: 'منطقة اختبار',
        price: 1000,
        area: 100,
        rooms: 1,
        baths: 1,
        reception: 1,
        features: [],
        description: 'وصف اختبار من السكربت',
        media: [],
        music: null,
      },
    ]).select().single();

    if (insertError) {
      console.error('Insert error:', insertError.message || insertError);
    } else {
      propertyId = insertData.id;
      console.log('Insert success:', insertData);
    }
  } catch (e) {
    console.error('Unexpected error:', e);
    process.exitCode = 1;
  } finally {
    // تنظيف: الإعلان ثم الحساب (delete_my_account تحذف المستخدم وبياناته). فشل التنظيف يُبلَّغ به صراحةً.
    if (propertyId) {
      const { error } = await supabase.from('properties').delete().eq('id', propertyId);
      console.log(error ? `⚠ cleanup: failed to delete test property ${propertyId}: ${error.message}` : 'cleanup: test property deleted');
    }
    if (signedIn) {
      const { error } = await supabase.rpc('delete_my_account');
      console.log(error ? `⚠ cleanup: failed to delete test account: ${error.message} (delete it manually)` : 'cleanup: test account deleted');
    }
    await supabase.auth.signOut().catch(() => {});
  }
}

run();
