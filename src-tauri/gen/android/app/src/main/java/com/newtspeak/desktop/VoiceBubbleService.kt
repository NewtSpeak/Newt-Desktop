package com.newtspeak.desktop

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat

/**
 * 语音前台服务：维持后台存活，并托管悬浮窗。
 */
class VoiceBubbleService : Service() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var overlay: VoiceOverlayController? = null
  private var latestState: HashMap<String, Any?> = defaultState()

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureChannel()
    startAsForeground(defaultNotifText())
    mainHandler.post {
      if (overlay == null) {
        overlay = VoiceOverlayController(this)
        overlay?.show(latestState)
      }
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_UPDATE -> {
        @Suppress("UNCHECKED_CAST")
        val state = intent.getSerializableExtra(EXTRA_STATE) as? HashMap<String, Any?>
        if (state != null) {
          latestState = state
          updateNotification(state)
          mainHandler.post { overlay?.update(state) }
        }
      }
      ACTION_MUTE_TOGGLE -> {
        VoiceOverlayPlugin.instance?.emitMuteToggle()
      }
      ACTION_OPEN_APP -> {
        bringAppToFront()
        VoiceOverlayPlugin.instance?.emitOpenApp()
      }
      else -> {
        @Suppress("UNCHECKED_CAST")
        val state = intent?.getSerializableExtra(EXTRA_STATE) as? HashMap<String, Any?>
        if (state != null) {
          latestState = state
          updateNotification(state)
          mainHandler.post {
            if (overlay == null) {
              overlay = VoiceOverlayController(this)
              overlay?.show(state)
            } else {
              overlay?.update(state)
            }
          }
        }
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    mainHandler.post {
      overlay?.dismiss()
      overlay = null
    }
    super.onDestroy()
  }

  private fun bringAppToFront() {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    startActivity(launch)
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = getSystemService(NotificationManager::class.java) ?: return
    val ch = NotificationChannel(
      CHANNEL_ID,
      "语音通话",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "语音频道后台运行与悬浮窗"
      setShowBadge(false)
    }
    mgr.createNotificationChannel(ch)
  }

  private fun startAsForeground(text: String) {
    val notif = buildNotification(text)
    if (Build.VERSION.SDK_INT >= 34) {
      val types =
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      try {
        startForeground(NOTIF_ID, notif, types)
      } catch (_: Exception) {
        // 麦克风类型失败时退回 mediaPlayback，避免直接崩
        startForeground(
          NOTIF_ID,
          notif,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        )
      }
    } else {
      startForeground(NOTIF_ID, notif)
    }
  }

  private fun updateNotification(state: HashMap<String, Any?>) {
    val mgr = getSystemService(NotificationManager::class.java) ?: return
    mgr.notify(NOTIF_ID, buildNotification(notifText(state)))
  }

  private fun buildNotification(text: String): Notification {
    val openIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val openPi = PendingIntent.getActivity(
      this,
      0,
      openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val muteIntent = Intent(this, VoiceBubbleService::class.java).apply {
      action = ACTION_MUTE_TOGGLE
    }
    val mutePi = PendingIntent.getService(
      this,
      1,
      muteIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val stopIntent = Intent(this, VoiceBubbleService::class.java).apply {
      action = ACTION_STOP
    }
    val stopPi = PendingIntent.getService(
      this,
      2,
      stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("NewtSpeak 语音中")
      .setContentText(text)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentIntent(openPi)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .addAction(0, "开/闭麦", mutePi)
      .addAction(0, "结束悬浮", stopPi)
      .build()
  }

  private fun defaultNotifText(): String = "正在语音频道"
  private fun notifText(state: HashMap<String, Any?>): String {
    val channel = (state["channelName"] as? String)?.takeIf { it.isNotBlank() } ?: "语音频道"
    val mute = state["selfMute"] as? Boolean ?: false
    val speakers = (state["speakers"] as? List<*>)?.mapNotNull { it as? String } ?: emptyList()
    val speakPart = if (speakers.isEmpty()) "无人说话" else "说话: ${speakers.take(3).joinToString("、")}"
    val mutePart = if (mute) "已闭麦" else "开麦中"
    return "$channel · $mutePart · $speakPart"
  }

  companion object {
    const val CHANNEL_ID = "newt_voice_overlay"
    const val NOTIF_ID = 7101
    const val ACTION_UPDATE = "com.newtspeak.desktop.VOICE_OVERLAY_UPDATE"
    const val ACTION_STOP = "com.newtspeak.desktop.VOICE_OVERLAY_STOP"
    const val ACTION_MUTE_TOGGLE = "com.newtspeak.desktop.VOICE_OVERLAY_MUTE"
    const val ACTION_OPEN_APP = "com.newtspeak.desktop.VOICE_OVERLAY_OPEN"
    const val EXTRA_STATE = "state"

    fun defaultState(): HashMap<String, Any?> {
      val m = HashMap<String, Any?>()
      m["active"] = true
      m["channelName"] = ""
      m["selfMute"] = false
      m["selfDeaf"] = false
      m["speakers"] = ArrayList<String>()
      m["participantCount"] = 0
      return m
    }

    fun start(ctx: Context, state: HashMap<String, Any?>) {
      val i = Intent(ctx, VoiceBubbleService::class.java).apply {
        putExtra(EXTRA_STATE, state)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(i)
      } else {
        ctx.startService(i)
      }
    }

    fun update(ctx: Context, state: HashMap<String, Any?>) {
      val i = Intent(ctx, VoiceBubbleService::class.java).apply {
        action = ACTION_UPDATE
        putExtra(EXTRA_STATE, state)
      }
      // 服务未起时 start 等价
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        try {
          ctx.startForegroundService(i)
        } catch (_: Exception) {
          ctx.startService(i)
        }
      } else {
        ctx.startService(i)
      }
    }

    fun stop(ctx: Context) {
      val i = Intent(ctx, VoiceBubbleService::class.java).apply {
        action = ACTION_STOP
      }
      ctx.startService(i)
      ctx.stopService(Intent(ctx, VoiceBubbleService::class.java))
    }
  }
}
