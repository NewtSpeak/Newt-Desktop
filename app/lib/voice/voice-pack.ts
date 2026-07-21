// 入场语音包播放端（docs 12 §3.1 / §3.4）。
//
// 播放链路：VOICE_PACK_PLAY → 范围校验（FR-04）→ 视觉提示（toast，关声者也显示，
// FR-05）→ 本地过滤链（FR-03/17）→ 入队（串行、上限 3、同用户仅留最新，FR-06）→
// fetch 音频（3s 超时、重试 ≤1，FR-08）→ Web Audio 解码 + GainNode 混音播放
//（音量挂「入场音效音量」滑杆，不经任何 WebRTC 轨道）。
//
// 本地过滤链（任一不满足只显示视觉提示不出声）：
//   ① 设置「播放入场音效」开启；② 未 self_deaf；③ 触发者不在本地屏蔽名单；
//   ④ 频控通过：同一触发用户 60s 冷却 + 全局播放间隔 ≥2s。

import { toast } from "sonner"

import type { VoicePackPlayPayload } from "~/lib/gateway/events"
import { useMembersStore } from "~/stores/members"
import { useSettingsStore } from "~/stores/settings"
import { useVoiceStore } from "~/stores/voice"

const FETCH_TIMEOUT_MS = 3_000
const USER_COOLDOWN_MS = 60_000
const GLOBAL_GAP_MS = 2_000
const QUEUE_LIMIT = 3
const CACHE_LIMIT = 20
const CACHE_TTL_MS = 10 * 60 * 1000

type QueueItem = { userId: string; url: string }

// ---------------------------------------------------------------------------
// 运行时状态（模块级单例）
// ---------------------------------------------------------------------------

const cooldownByUser: Record<string, number> = {}
const queue: QueueItem[] = []
let playing = false
let lastPlayStartAt = 0

let audioContext: AudioContext | null = null
/** 已解码音频短缓存（LRU ≤20、TTL 10min；键为资源 URL，docs 12 §5.2） */
const audioCache = new Map<string, { buffer: AudioBuffer; at: number }>()

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext
  const Ctor =
    typeof window !== "undefined"
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined
  if (!Ctor) return null
  audioContext = new Ctor()
  return audioContext
}

// ---------------------------------------------------------------------------
// 音频获取与播放
// ---------------------------------------------------------------------------

async function fetchAudio(url: string): Promise<ArrayBuffer | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) return null // 404 等不重试轰炸资源服务器
      return await response.arrayBuffer()
    } catch {
      // 超时/网络失败：最多重试 1 次
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

async function decodeAudio(url: string): Promise<AudioBuffer | null> {
  const now = Date.now()
  const cached = audioCache.get(url)
  if (cached && now - cached.at < CACHE_TTL_MS) {
    // LRU：命中挪到队尾
    audioCache.delete(url)
    audioCache.set(url, { buffer: cached.buffer, at: cached.at })
    return cached.buffer
  }
  const context = getAudioContext()
  if (!context) return null
  const raw = await fetchAudio(url)
  if (!raw) return null
  try {
    const buffer = await context.decodeAudioData(raw)
    audioCache.set(url, { buffer, at: now })
    while (audioCache.size > CACHE_LIMIT) {
      const oldest = audioCache.keys().next().value
      if (oldest === undefined) break
      audioCache.delete(oldest)
    }
    return buffer
  } catch {
    return null // 损坏/格式不支持：静默放弃（docs 12 §6-2）
  }
}

function playBuffer(buffer: AudioBuffer): Promise<void> {
  return new Promise((resolve) => {
    const context = getAudioContext()
    if (!context) {
      resolve()
      return
    }
    void context.resume().catch(() => undefined)
    const source = context.createBufferSource()
    const gain = context.createGain()
    gain.gain.value = useSettingsStore.getState().voice.voicePackVolume / 100
    source.buffer = buffer
    source.connect(gain)
    gain.connect(context.destination)
    source.onended = () => resolve()
    try {
      source.start()
    } catch {
      resolve()
    }
  })
}

/** 串行消费队列（全局间隔 ≥2s，FR-17） */
async function drainQueue() {
  if (playing) return
  playing = true
  try {
    while (queue.length > 0) {
      const gap = GLOBAL_GAP_MS - (Date.now() - lastPlayStartAt)
      if (gap > 0) await new Promise((resolve) => setTimeout(resolve, gap))
      const item = queue.shift()
      if (!item) break
      // 出队时复查即时条件（排队期间可能闭听/被屏蔽）
      if (!soundAllowed(item.userId)) continue
      lastPlayStartAt = Date.now()
      cooldownByUser[item.userId] = lastPlayStartAt
      const buffer = await decodeAudio(item.url)
      if (buffer) await playBuffer(buffer)
    }
  } finally {
    playing = false
  }
}

// ---------------------------------------------------------------------------
// 过滤链
// ---------------------------------------------------------------------------

/** 即时出声条件（①②③；频控在入队/出队时单独判） */
function soundAllowed(userId: string): boolean {
  const voice = useSettingsStore.getState().voice
  if (!voice.voicePackEnabled) return false
  if (voice.voicePackMutedUsers.includes(userId)) return false
  if (useVoiceStore.getState().session?.selfDeaf) return false
  return true
}

/** Gateway VOICE_PACK_PLAY handler */
export function handleVoicePackPlay(payload: VoicePackPlayPayload) {
  if (!payload.audio_url || !payload.user_id) return

  // 范围校验（FR-04）：同频道范围下自己必须仍在该语音频道，否则丢弃（不越范围）
  if (payload.scope !== "GUILD_ONLINE") {
    const session = useVoiceStore.getState().session
    if (!session || session.channelId !== payload.channel_id) return
  }

  // 视觉提示：关声者 / 被频控者也显示（声画分离，FR-05）
  const member = useMembersStore
    .getState()
    .byGuild[payload.guild_id]?.find((item) => item.user_id === payload.user_id)
  const name =
    member?.nickname?.trim() ||
    member?.display_name?.trim() ||
    member?.username ||
    `用户${payload.user_id.slice(0, 6)}`
  toast(`🔊 ${name} 使用了入场语音`, { duration: 4_000 })

  // 本地过滤链：①②③
  if (!soundAllowed(payload.user_id)) return
  // ④ 同一触发用户 60s 冷却（重复事件去抖，FR-17/18）
  if (Date.now() - (cooldownByUser[payload.user_id] ?? 0) < USER_COOLDOWN_MS) return

  // 入队：同用户仅留最新；超上限丢最旧未播条目（FR-06）
  const existing = queue.findIndex((item) => item.userId === payload.user_id)
  if (existing !== -1) queue.splice(existing, 1)
  queue.push({ userId: payload.user_id, url: payload.audio_url })
  while (queue.length > QUEUE_LIMIT) queue.shift()

  void drainQueue()
}
