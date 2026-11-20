package com.diarino.app

import android.content.Context
import android.media.MediaScannerConnection
import android.os.Build
import android.provider.MediaStore
import java.io.File

/**
 * التطبيق ما بيحفظ أى صورة/فيديو فى معرض الصور (الاستوديو) خالص. دى طبقة الحماية الأصلية (native) لو أى مكتبة/نظام كتب ملفات
 * وسائط (كاش صور/فيديو، ملفات مؤقتة، ناتج ضغط...) فى مكان بيفهرسه المعرض:
 *  1) `.nomedia` فى كل مجلدات التطبيق (داخلية + خارجية + Android/media) *وفى كل مجلد فرعى منها* (حتى عمق 4) — بعض المعارض
 *     (شاومى/أوبو/سامسونج...) بتفحص المجلد نفسه بس ومش بترث `.nomedia` من الأب، فنحطه فى كل مستوى.
 *  2) حذف الملفات الفارغة (0 بايت ← تظهر كفيديو 0:00 أسود) والوسائط المؤقتة القديمة (أقدم من 24 ساعة) من كاش التطبيق
 *     (cacheDir/externalCacheDir/externalFilesDirs) — *مش* من filesDir (فيه مسودات المستخدم) ومش من كاش Glide/ExoPlayer الداخلى.
 *  3) طلب إعادة فحص من النظام فتختفى الإدخالات القديمة من المعرض.
 *  4) حذف أى إدخال فى MediaStore مملوك للتطبيق نفسه (أندرويد 10+) أو مساره داخل مجلدات التطبيق — ملفات التطبيق نفسه بيقدر يحذفها من غير إذن.
 * بيشتغل على thread خلفى عند كل إقلاع وكل رجوع للمقدمة (مع حد أدنى 10 دقائق بين مرتين) ومش بيأخر الفتح، وأى خطأ بيتتجاهل.
 *
 * ⚠ تحذير لأى مطوّر قادم (H7): الخطوة 4 تحذف أى إدخال فى MediaStore مملوك لحزمة التطبيق. لو أُضيفت يومًا ميزة تحفظ صورة/فيديو
 *   فى المعرض عمدًا (expo-media-library / saveToLibrary / MediaStore.insert…) فستُحذف نتائجها بصمت. قبل إضافة مثل هذه الميزة:
 *   عطّل الخطوة 4 (أو اقصرها على مسارات الكاش فقط) واستثنِ مجلد الحفظ من `.nomedia` (الخطوة 1).
 */
object MediaHygiene {
  private const val MAX_DEPTH = 4
  private const val MAX_FILES = 5000
  private const val MIN_INTERVAL_MS = 10 * 60 * 1000L
  private const val EMPTY_MIN_AGE_MS = 10 * 60 * 1000L // ملف فارغ أحدث من 10 دقائق قد يكون قيد الكتابة الآن
  private const val STALE_MEDIA_AGE_MS = 24 * 60 * 60 * 1000L
  // كاش المكتبات الداخلى: بتديره مكتباتها (فهرس داخلى) فمنلمسوش.
  private val LIBRARY_CACHE_DIRS = setOf("image_manager_disk_cache", "expo_video_cache")
  private val MEDIA_EXT = Regex(".*\\.(jpe?g|png|gif|webp|heic|heif|bmp|mp4|m4v|mov|3gp|mkv|webm|avi|mp3|m4a|aac|wav|ogg)$", RegexOption.IGNORE_CASE)

  @Volatile private var lastRun = 0L

  fun apply(context: Context) {
    val now = System.currentTimeMillis()
    if (now - lastRun < MIN_INTERVAL_MS) return
    lastRun = now
    val app = context.applicationContext
    Thread {
      try {
        // (أ) المجلدات اللى ممكن المعارض تشوفها + مجلدات الكاش.
        val roots = linkedSetOf<File>()
        fun add(f: File?) { if (f != null) roots.add(f) }
        add(app.cacheDir); add(app.filesDir); add(app.codeCacheDir)
        add(app.externalCacheDir)
        try { app.getExternalFilesDirs(null)?.forEach { add(it) } } catch (_: Throwable) {}
        try { app.externalMediaDirs?.forEach { add(it) } } catch (_: Throwable) {}
        // مجلدات الكاش فقط (مسموح نحذف منها): ماشيين عليها بالتنضيف. filesDir ما بنحذفش منه.
        val cleanable = linkedSetOf<File>()
        app.cacheDir?.let { cleanable.add(it) }
        app.externalCacheDir?.let { cleanable.add(it) }
        try { app.getExternalFilesDirs(null)?.forEach { if (it != null) cleanable.add(it) } } catch (_: Throwable) {}

        val toScan = ArrayList<String>()
        val budget = intArrayOf(MAX_FILES)
        for (root in roots) {
          try { markNoMedia(root, 0, toScan, budget) } catch (_: Throwable) {}
        }
        val nowMs = System.currentTimeMillis()
        val cleanBudget = intArrayOf(MAX_FILES)
        for (root in cleanable) {
          try { cleanDir(root, 0, nowMs, cleanBudget) } catch (_: Throwable) {}
        }
        if (toScan.isNotEmpty()) {
          try { MediaScannerConnection.scanFile(app, toScan.toTypedArray(), null, null) } catch (_: Throwable) {}
        }

        // (ب) إدخالات MediaStore الخاصة بالتطبيق.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          try {
            app.contentResolver.delete(
              MediaStore.Files.getContentUri("external"),
              "${MediaStore.MediaColumns.OWNER_PACKAGE_NAME} = ?",
              arrayOf(app.packageName)
            )
          } catch (_: Throwable) {}
          try {
            // إدخالات غير مملوكة لكن مسارها داخل مجلدات التطبيق (Android/data|media/<package>/...).
            val like1 = "%/Android/data/${app.packageName}/%"
            val like2 = "%/Android/media/${app.packageName}/%"
            app.contentResolver.delete(
              MediaStore.Files.getContentUri("external"),
              "${MediaStore.MediaColumns.DATA} LIKE ? OR ${MediaStore.MediaColumns.DATA} LIKE ?",
              arrayOf(like1, like2)
            )
          } catch (_: Throwable) {}
        }
      } catch (_: Throwable) {}
    }.apply { name = "media-hygiene"; isDaemon = true; priority = Thread.MIN_PRIORITY }.start()
  }

  /** `.nomedia` فى المجلد وكل مجلداته الفرعية (حتى MAX_DEPTH). */
  private fun markNoMedia(dir: File, depth: Int, toScan: ArrayList<String>, budget: IntArray) {
    if (budget[0] <= 0 || !dir.isDirectory) return
    budget[0]--
    val marker = File(dir, ".nomedia")
    try { if (!marker.exists() && marker.createNewFile()) toScan.add(marker.absolutePath) } catch (_: Throwable) {}
    if (depth >= MAX_DEPTH) return
    val children = dir.listFiles() ?: return
    for (c in children) {
      if (c.isDirectory && c.name !in LIBRARY_CACHE_DIRS) markNoMedia(c, depth + 1, toScan, budget)
    }
  }

  /** حذف الملفات الفارغة (0 بايت) والوسائط المؤقتة القديمة. */
  private fun cleanDir(dir: File, depth: Int, nowMs: Long, budget: IntArray) {
    if (budget[0] <= 0 || !dir.isDirectory) return
    val children = dir.listFiles() ?: return
    for (c in children) {
      if (budget[0]-- <= 0) return
      try {
        if (c.isDirectory) {
          if (c.name in LIBRARY_CACHE_DIRS || depth >= MAX_DEPTH) continue
          cleanDir(c, depth + 1, nowMs, budget)
        } else if (c.isFile && c.name != ".nomedia") {
          val age = nowMs - c.lastModified()
          val empty = c.length() == 0L && age > EMPTY_MIN_AGE_MS
          val staleMedia = MEDIA_EXT.matches(c.name) && age > STALE_MEDIA_AGE_MS
          if (empty || staleMedia) c.delete()
        }
      } catch (_: Throwable) {}
    }
  }
}
