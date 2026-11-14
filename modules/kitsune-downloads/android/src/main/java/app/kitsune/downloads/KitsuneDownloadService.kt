package app.kitsune.downloads

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * A foreground service ("Downloading…" notification) that keeps Kitsune's process alive while the
 * download queue has work, and runs a Headless JS task for that whole time. React Native stops
 * JavaScript timers in a backgrounded app unless a Headless JS task is running, and the download
 * engine (src/lib/downloads/engine.ts) depends on them; the task's promise resolves when the queue
 * goes idle, and the service then stops itself. A Wi-Fi lock keeps the connection at full speed
 * with the screen off (the base class already holds a partial wake lock).
 */
class KitsuneDownloadService : HeadlessJsTaskService() {
  private var wifiLock: WifiManager.WifiLock? = null
  private var taskRunning = false

  override fun onCreate() {
    super.onCreate()
    running = true
    try {
      val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
      @Suppress("DEPRECATION")
      wifiLock = wifi?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "kitsune:downloads")
      wifiLock?.setReferenceCounted(false)
      wifiLock?.acquire()
    } catch (_: Throwable) {
      wifiLock = null
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    intent?.getStringExtra(EXTRA_TITLE)?.let { lastTitle = it }
    intent?.getStringExtra(EXTRA_TEXT)?.let { lastText = it }
    // A started foreground service must call startForeground promptly, every time.
    try {
      val notification = build(this, lastTitle, lastText, lastProgress)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (_: Throwable) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (!taskRunning) {
      taskRunning = true
      super.onStartCommand(intent, flags, startId)
    }
    // Not restarted by the system after a kill: the queue resumes when Kitsune is next opened.
    return START_NOT_STICKY
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(TASK, Arguments.createMap(), 0, true)

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    taskRunning = false
    super.onHeadlessJsTaskFinish(taskId)
  }

  // Android 15 limits data-sync services to a few hours a day; when that runs out, stop cleanly.
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  override fun onDestroy() {
    running = false
    taskRunning = false
    try {
      wifiLock?.release()
    } catch (_: Throwable) {
    }
    wifiLock = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    super.onDestroy()
  }

  companion object {
    const val TASK = "KitsuneDownloads"
    const val CHANNEL = "kitsune-downloads"
    const val NOTIFICATION_ID = 4107
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"

    @Volatile var running = false
    @Volatile var lastTitle = "Downloading"
    @Volatile var lastText = ""
    @Volatile var lastProgress = -1

    private fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL) != null) return
      val channel = NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW)
      channel.description = "Progress of episodes downloading"
      channel.setShowBadge(false)
      manager.createNotificationChannel(channel)
    }

    fun build(context: Context, title: String, text: String, progress: Int): Notification {
      ensureChannel(context)
      val builder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          Notification.Builder(context, CHANNEL)
        } else {
          @Suppress("DEPRECATION")
          Notification.Builder(context)
        }
      builder
        .setSmallIcon(android.R.drawable.stat_sys_download)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
      if (progress in 0..100) builder.setProgress(100, progress, false) else builder.setProgress(0, 0, true)
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      if (launch != null) {
        launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
        builder.setContentIntent(PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
      }
      return builder.build()
    }
  }
}
