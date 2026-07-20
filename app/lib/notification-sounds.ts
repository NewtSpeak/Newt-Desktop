// 通知提示音（docs 15 FR-16/17）：Web Audio 合成短促“叮”，不引入音频文件资源。
//   - 新消息：A5（880Hz）单音；@提及：E6（1318.5Hz）更高音高，听感可区分；
//   - 正弦波 + 快攻缓释包络（约 0.35s），音量由设置（0-100）映射为增益；
//   - AudioContext 惰性创建并复用；被浏览器策略挂起时先 resume。
//
// 播放条件（勿扰 / 静音 / 层级 / self_deaf 抑制）由调用方（lib/notifications.ts
// 七步管线）裁决，本模块只负责发声。

export type NotifySoundKind = "message" | "mention"

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (!audioContext) {
    try {
      audioContext = new AudioContext()
    } catch {
      return null
    }
  }
  return audioContext
}

/** 播放提示音；volume 0-100（0 静音）。失败静默（音频设备/策略问题不影响通知） */
export function playNotifySound(kind: NotifySoundKind, volume: number) {
  if (volume <= 0) return
  const context = getAudioContext()
  if (!context) return
  try {
    if (context.state === "suspended") void context.resume()
    const now = context.currentTime
    const frequency = kind === "mention" ? 1318.5 : 880
    // 0-100 → 0-0.4 增益（合成正弦波满增益过响，压到舒适区间）
    const peak = (Math.min(Math.max(volume, 0), 100) / 100) * 0.4

    const oscillator = context.createOscillator()
    oscillator.type = "sine"
    oscillator.frequency.value = frequency

    const gain = context.createGain()
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(peak, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)

    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.4)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
    }
  } catch {
    // 播放失败静默
  }
}
