package com.newtspeak.desktop

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

/**
 * 系统悬浮窗：展示频道、说话人、开/闭麦状态，可拖动。
 */
class VoiceOverlayController(private val context: Context) {
  private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private var root: LinearLayout? = null
  private var titleView: TextView? = null
  private var speakersView: TextView? = null
  private var muteView: TextView? = null
  private var params: WindowManager.LayoutParams? = null

  private var downX = 0f
  private var downY = 0f
  private var paramX = 0
  private var paramY = 0

  fun show(state: HashMap<String, Any?>) {
    if (!canOverlay()) return
    if (root != null) {
      update(state)
      return
    }
    val density = context.resources.displayMetrics.density
    fun dp(v: Int) = (v * density).toInt()

    val card = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(12), dp(10), dp(12), dp(10))
      background = GradientDrawable().apply {
        cornerRadius = 16f * density
        setColor(Color.parseColor("#E6121218"))
        setStroke(dp(1), Color.parseColor("#40FFFFFF"))
      }
      elevation = 8f * density
    }

    val title = TextView(context).apply {
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      typeface = Typeface.DEFAULT_BOLD
      text = "语音频道"
    }
    val speakers = TextView(context).apply {
      setTextColor(Color.parseColor("#A7F3D0"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      setPadding(0, dp(4), 0, dp(6))
      text = "无人说话"
    }
    val row = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    val muteBtn = TextView(context).apply {
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      setPadding(dp(10), dp(6), dp(10), dp(6))
      background = GradientDrawable().apply {
        cornerRadius = 10f * density
        setColor(Color.parseColor("#22C55E"))
      }
      text = "开麦中 · 点按闭麦"
      setOnClickListener {
        val i = Intent(context, VoiceBubbleService::class.java).apply {
          action = VoiceBubbleService.ACTION_MUTE_TOGGLE
        }
        context.startService(i)
      }
    }
    val openBtn = TextView(context).apply {
      setTextColor(Color.parseColor("#E2E8F0"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
      setPadding(dp(8), dp(6), dp(8), dp(6))
      text = "回到应用"
      setOnClickListener {
        val i = Intent(context, VoiceBubbleService::class.java).apply {
          action = VoiceBubbleService.ACTION_OPEN_APP
        }
        context.startService(i)
      }
    }
    row.addView(muteBtn)
    row.addView(openBtn, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.WRAP_CONTENT,
      LinearLayout.LayoutParams.WRAP_CONTENT
    ).apply { leftMargin = dp(8) })

    card.addView(title)
    card.addView(speakers)
    card.addView(row)

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }
    val lp = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = dp(12)
      y = dp(120)
    }

    // 仅标题栏拖动，避免抢走闭麦按钮点击
    enableDrag(title, card, lp)

    try {
      wm.addView(card, lp)
      root = card
      titleView = title
      speakersView = speakers
      muteView = muteBtn
      params = lp
      update(state)
    } catch (_: Exception) {
      // 无权限或系统限制
      root = null
    }
  }

  fun update(state: HashMap<String, Any?>) {
    val channel = (state["channelName"] as? String)?.takeIf { it.isNotBlank() } ?: "语音频道"
    val selfMute = state["selfMute"] as? Boolean ?: false
    val selfDeaf = state["selfDeaf"] as? Boolean ?: false
    val speakers = (state["speakers"] as? List<*>)?.mapNotNull { it as? String } ?: emptyList()
    val count = (state["participantCount"] as? Number)?.toInt() ?: 0

    titleView?.text = if (count > 0) "$channel · ${count}人" else channel
    speakersView?.text = if (speakers.isEmpty()) {
      "无人说话"
    } else {
      "正在说：${speakers.take(4).joinToString("、")}"
    }
    speakersView?.setTextColor(
      if (speakers.isEmpty()) Color.parseColor("#94A3B8") else Color.parseColor("#A7F3D0")
    )

    val muteLabel = when {
      selfDeaf -> "已闭听 · 点按开麦"
      selfMute -> "已闭麦 · 点按开麦"
      else -> "开麦中 · 点按闭麦"
    }
    muteView?.text = muteLabel
    (muteView?.background as? GradientDrawable)?.setColor(
      when {
        selfDeaf || selfMute -> Color.parseColor("#EF4444")
        else -> Color.parseColor("#22C55E")
      }
    )
  }

  fun dismiss() {
    val v = root ?: return
    try {
      wm.removeView(v)
    } catch (_: Exception) {
    }
    root = null
    titleView = null
    speakersView = null
    muteView = null
    params = null
  }

  private fun canOverlay(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      Settings.canDrawOverlays(context)
    } else {
      true
    }
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun enableDrag(handle: View, card: View, lp: WindowManager.LayoutParams) {
    handle.setOnTouchListener { _, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          downX = event.rawX
          downY = event.rawY
          paramX = lp.x
          paramY = lp.y
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = (event.rawX - downX).toInt()
          val dy = (event.rawY - downY).toInt()
          lp.x = paramX + dx
          lp.y = paramY + dy
          try {
            wm.updateViewLayout(card, lp)
          } catch (_: Exception) {
          }
          true
        }
        else -> false
      }
    }
  }
}
