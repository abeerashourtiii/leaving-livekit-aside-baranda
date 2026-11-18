package com.diarino.app

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/**
 * ↔ استئناف التطبيق من حيث توقف *فقط* لو النظام هو اللى استعاده (فتح من قائمة التطبيقات المفتوحة / استعادة المهمة)،
 * أما بعد الإغلاق النهائي (سحب التطبيق من القائمة) وفتحه من الأيقونة فبيبدأ من الصفحة الرئيسية للريلز.
 *
 * التمييز: لما المستخدم بيسحب التطبيق من قائمة التطبيقات المفتوحة الـ task بتتحذف، فالتشغيل الجديد مفيهوش:
 *   (1) حالة محفوظة من النظام (savedInstanceState != null) — بتكون موجودة لما النظام يستعيد الـ task بعد قتل العملية لتوفير الذاكرة،
 *   (2) علامة FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY — بتتحط لما التطبيق يتفتح من قائمة التطبيقات الأخيرة.
 * القيمة بتتسجّل مرة واحدة فى بداية عملية التطبيق (MainActivity.onCreate) ويقراها JS عبر BarandaLaunchInfo.isSystemRestore().
 */
object LaunchInfo {
  @Volatile private var captured = false
  @Volatile var systemRestored = false
    private set

  @Synchronized
  fun capture(intent: Intent?, savedInstanceState: Bundle?) {
    if (captured) return // إعادة إنشاء الـ Activity (تدوير الشاشة...) ما تغيّرش القيمة الأصلية للتشغيل
    captured = true
    val fromHistory = intent != null && (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
    systemRestored = savedInstanceState != null || fromHistory
  }
}

class LaunchInfoModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "BarandaLaunchInfo"

  @ReactMethod
  fun isSystemRestore(promise: Promise) {
    promise.resolve(LaunchInfo.systemRestored)
  }
}

class LaunchInfoPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(LaunchInfoModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
