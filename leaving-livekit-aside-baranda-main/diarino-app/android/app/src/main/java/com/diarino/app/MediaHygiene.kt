package com.diarino.app

import android.content.Context
import android.media.MediaScannerConnection
import android.os.Build
import android.provider.MediaStore
import java.io.File

/**
 * التطبيق ما بيحفظ أى صورة/فيديو فى معرض الصور (الاستوديو) خالص. ده الحماية الأخيرة لو أى مكتبة/نظام كتب ملفات وسائط
 * (كاش صور/فيديو، ملفات مؤقتة...) فى مكان بيفهرسه المعرض:
 *  1) بنحط ملف `.nomedia` فى كل مجلدات التطبيق (داخلية + خارجية + Android/media) — MediaScanner والمعارض بتتجاهل أى وسائط جواها.
 *  2) بنطلب من النظام يعيد فحص المجلدات دى فتختفى الإدخالات القديمة من المعرض.
 *  3) بنحذف أى إدخال فى MediaStore مملوك للتطبيق نفسه (أندرويد 10+) — ملفات التطبيق نفسه بيقدر يحذفها من غير إذن.
 * بيشتغل على thread خلفى عند كل إقلاع ومش بيأخر الفتح، وأى خطأ بيتتجاهل (مفيش تأثير على التطبيق).
 */
object MediaHygiene {
  fun apply(context: Context) {
    val app = context.applicationContext
    Thread {
      try {
        val dirs = linkedSetOf<File>()
        fun add(f: File?) { if (f != null) dirs.add(f) }
        add(app.cacheDir); add(app.filesDir); add(app.codeCacheDir)
        add(app.externalCacheDir)
        try { app.getExternalFilesDirs(null)?.forEach { add(it) } } catch (_: Throwable) {}
        try { app.externalMediaDirs?.forEach { add(it) } } catch (_: Throwable) {}

        val toScan = ArrayList<String>()
        for (dir in dirs) {
          try {
            if (!dir.exists()) continue
            val marker = File(dir, ".nomedia")
            if (!marker.exists() && marker.createNewFile()) toScan.add(marker.absolutePath)
          } catch (_: Throwable) {}
        }
        if (toScan.isNotEmpty()) {
          MediaScannerConnection.scanFile(app, toScan.toTypedArray(), null, null)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          try {
            app.contentResolver.delete(
              MediaStore.Files.getContentUri("external"),
              "${MediaStore.MediaColumns.OWNER_PACKAGE_NAME} = ?",
              arrayOf(app.packageName)
            )
          } catch (_: Throwable) {}
        }
      } catch (_: Throwable) {}
    }.apply { name = "media-hygiene"; isDaemon = true; priority = Thread.MIN_PRIORITY }.start()
  }
}
