#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <React/RCTLinkingManager.h>
#import <React/RCTBridgeModule.h>

// ↔ استئناف التطبيق من حيث توقف *فقط* لو النظام هو اللى استعاده (OS state restoration)، أما بعد الإغلاق النهائي بالسحب من قائمة
// التطبيقات فآيفون بيمسح الحالة المحفوظة (حسب توثيق أبل) فبيبدأ التطبيق من الرئيسية. JS بيقرا القيمة من BarandaLaunchInfo.isSystemRestore().
// ملاحظة: التحقق الفعلى على جهاز آيفون لازم — لو الاستئناف ما اشتغلش على iOS غيّر IOS_USE_RESTORE_SIGNAL إلى false فى lib/launchInfo.ts.
static BOOL gBarandaSystemRestored = NO;

@interface BarandaLaunchInfo : NSObject <RCTBridgeModule>
@end

@implementation BarandaLaunchInfo
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup { return NO; }
RCT_EXPORT_METHOD(isSystemRestore:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@(gBarandaSystemRestored));
}
@end

@implementation AppDelegate

// ---- OS state restoration: بنطلب من النظام يحفظ/يستعيد حالة (فاضية) عشان نعرف إنه استعاد التطبيق ولم يُغلق نهائيًا ----
- (BOOL)application:(UIApplication *)application shouldSaveSecureApplicationState:(NSCoder *)coder { return YES; }
- (BOOL)application:(UIApplication *)application shouldRestoreSecureApplicationState:(NSCoder *)coder { return YES; }
- (BOOL)application:(UIApplication *)application shouldSaveApplicationState:(NSCoder *)coder { return YES; }
- (BOOL)application:(UIApplication *)application shouldRestoreApplicationState:(NSCoder *)coder { return YES; }
- (void)application:(UIApplication *)application willEncodeRestorableStateWithCoder:(NSCoder *)coder
{
  [coder encodeBool:YES forKey:@"baranda.resume"];
}
- (void)application:(UIApplication *)application didDecodeRestorableStateWithCoder:(NSCoder *)coder
{
  if ([coder decodeBoolForKey:@"baranda.resume"]) {
    gBarandaSystemRestored = YES;
  }
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"main";

  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@".expo/.virtual-metro-entry"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

// Linking API
- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options {
  return [super application:application openURL:url options:options] || [RCTLinkingManager application:application openURL:url options:options];
}

// Universal Links
- (BOOL)application:(UIApplication *)application continueUserActivity:(nonnull NSUserActivity *)userActivity restorationHandler:(nonnull void (^)(NSArray<id<UIUserActivityRestoring>> * _Nullable))restorationHandler {
  BOOL result = [RCTLinkingManager application:application continueUserActivity:userActivity restorationHandler:restorationHandler];
  return [super application:application continueUserActivity:userActivity restorationHandler:restorationHandler] || result;
}

// Explicitly define remote notification delegates to ensure compatibility with some third-party libraries
- (void)application:(UIApplication *)application didRegisterForRemoteNotificationsWithDeviceToken:(NSData *)deviceToken
{
  return [super application:application didRegisterForRemoteNotificationsWithDeviceToken:deviceToken];
}

// Explicitly define remote notification delegates to ensure compatibility with some third-party libraries
- (void)application:(UIApplication *)application didFailToRegisterForRemoteNotificationsWithError:(NSError *)error
{
  return [super application:application didFailToRegisterForRemoteNotificationsWithError:error];
}

// Explicitly define remote notification delegates to ensure compatibility with some third-party libraries
- (void)application:(UIApplication *)application didReceiveRemoteNotification:(NSDictionary *)userInfo fetchCompletionHandler:(void (^)(UIBackgroundFetchResult))completionHandler
{
  return [super application:application didReceiveRemoteNotification:userInfo fetchCompletionHandler:completionHandler];
}

@end
