package app.kitsune.downloads

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Starts, updates and stops KitsuneDownloadService for src/lib/downloads/background.ts. */
class KitsuneDownloadsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KitsuneDownloads")

    Function("start") { title: String, text: String ->
      val context = appContext.reactContext
      if (context == null) {
        false
      } else {
        KitsuneDownloadService.lastTitle = title
        KitsuneDownloadService.lastText = text
        try {
          val intent =
            Intent(context, KitsuneDownloadService::class.java)
              .putExtra(KitsuneDownloadService.EXTRA_TITLE, title)
              .putExtra(KitsuneDownloadService.EXTRA_TEXT, text)
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
          true
        } catch (_: Throwable) {
          // e.g. Android 12+ refusing a start from the background; the queue still runs while open.
          false
        }
      }
    }

    Function("update") { title: String, text: String, progress: Int ->
      KitsuneDownloadService.lastTitle = title
      KitsuneDownloadService.lastText = text
      KitsuneDownloadService.lastProgress = progress
      val context = appContext.reactContext
      if (context == null || !KitsuneDownloadService.running) {
        false
      } else {
        try {
          val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
          manager.notify(KitsuneDownloadService.NOTIFICATION_ID, KitsuneDownloadService.build(context, title, text, progress))
          true
        } catch (_: Throwable) {
          false
        }
      }
    }

    Function("stop") {
      val context = appContext.reactContext
      if (context != null) {
        try {
          context.stopService(Intent(context, KitsuneDownloadService::class.java))
        } catch (_: Throwable) {
        }
      }
      true
    }

    Function("isRunning") { KitsuneDownloadService.running }
  }
}
