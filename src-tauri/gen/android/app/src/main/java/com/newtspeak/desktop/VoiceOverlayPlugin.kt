package com.newtspeak.desktop

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class VoiceOverlayStateArgs {
  var active: Boolean = false
  var channelName: String? = null
  var selfMute: Boolean = false
  var selfDeaf: Boolean = false
  var speakers: List<String>? = null
  var participantCount: Int = 0
}

/**
 * 语音悬浮窗插件：前台服务保活 + 系统悬浮窗展示说话人 / 开麦闭麦。
 * 由前端在进语音后 start/update，退语音 stop。
 */
@TauriPlugin
class VoiceOverlayPlugin(private val activity: Activity) : Plugin(activity) {
  companion object {
    @Volatile
    var instance: VoiceOverlayPlugin? = null
  }

  override fun load(webView: WebView) {
    super.load(webView)
    instance = this
  }

  @Command
  fun canDrawOverlays(invoke: Invoke) {
    val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      Settings.canDrawOverlays(activity)
    } else {
      true
    }
    val ret = JSObject()
    ret.put("granted", ok)
    invoke.resolve(ret)
  }

  @Command
  fun requestOverlayPermission(invoke: Invoke) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(activity)) {
      try {
        val intent = Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${activity.packageName}")
        )
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)
      } catch (e: Exception) {
        invoke.reject("无法打开悬浮窗权限设置: ${e.message}")
        return
      }
    }
    val ret = JSObject()
    ret.put("opened", true)
    invoke.resolve(ret)
  }

  @Command
  fun start(invoke: Invoke) {
    val args = invoke.parseArgs(VoiceOverlayStateArgs::class.java)
    VoiceBubbleService.start(activity.applicationContext, argsToMap(args))
    invoke.resolve()
  }

  @Command
  fun update(invoke: Invoke) {
    val args = invoke.parseArgs(VoiceOverlayStateArgs::class.java)
    VoiceBubbleService.update(activity.applicationContext, argsToMap(args))
    invoke.resolve()
  }

  @Command
  fun stop(invoke: Invoke) {
    VoiceBubbleService.stop(activity.applicationContext)
    invoke.resolve()
  }

  /** 悬浮窗「开/闭麦」按钮回调 → 前端 addPluginListener('voice-overlay','muteToggle') */
  fun emitMuteToggle() {
    try {
      trigger("muteToggle", JSObject())
    } catch (_: Exception) {
      // WebView 可能已销毁
    }
  }

  /** 点击悬浮窗回前台 */
  fun emitOpenApp() {
    try {
      trigger("openApp", JSObject())
    } catch (_: Exception) {
    }
  }

  private fun argsToMap(args: VoiceOverlayStateArgs): HashMap<String, Any?> {
    val map = HashMap<String, Any?>()
    map["active"] = args.active
    map["channelName"] = args.channelName ?: ""
    map["selfMute"] = args.selfMute
    map["selfDeaf"] = args.selfDeaf
    map["speakers"] = ArrayList(args.speakers ?: emptyList())
    map["participantCount"] = args.participantCount
    return map
  }
}
