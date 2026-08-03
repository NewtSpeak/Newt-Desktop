// Android 语音悬浮窗 / 后台前台服务桥接。
// 仅在 Tauri Android 运行时生效；桌面与浏览器 no-op。
//
// 插件：plugin:voice-overlay（src-tauri VoiceOverlayPlugin.kt）
// - start / update / stop
// - canDrawOverlays / requestOverlayPermission
// - 事件 muteToggle / openApp

import {
  addPluginListener,
  invoke,
  type PluginListener,
} from "@tauri-apps/api/core"

import { voiceParticipantDisplayName } from "~/lib/user-display"
import { isTauriRuntime } from "~/lib/secure-storage"
import { voiceConnection } from "~/lib/voice/connection"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import { useGuildsStore } from "~/stores/guilds"
import { useMembersStore } from "~/stores/members"
import { useVoiceStore } from "~/stores/voice"

const PLUGIN = "voice-overlay"

export type AndroidOverlayState = {
  active: boolean
  channelName: string
  selfMute: boolean
  selfDeaf: boolean
  speakers: string[]
  participantCount: number
}

function isAndroidTauri(): boolean {
  if (!isTauriRuntime()) return false
  if (typeof navigator === "undefined") return false
  return /Android/i.test(navigator.userAgent)
}

async function pluginInvoke<T = void>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  if (!isAndroidTauri()) return null
  try {
    return await invoke<T>(`plugin:${PLUGIN}|${cmd}`, args ?? {})
  } catch (error) {
    console.warn(`[android-overlay] ${cmd} 失败`, error)
    return null
  }
}

/** 是否已授予悬浮窗权限 */
export async function canDrawOverlays(): Promise<boolean> {
  const ret = await pluginInvoke<{ granted?: boolean }>("canDrawOverlays")
  return Boolean(ret?.granted)
}

/** 跳转系统「显示在其他应用上层」设置页 */
export async function requestOverlayPermission(): Promise<void> {
  await pluginInvoke("requestOverlayPermission")
}

function resolveChannelName(channelId: string, guildId: string): string {
  const channels = useChannelsStore.getState().byGuild[guildId] ?? []
  const ch = channels.find((c) => c.id === channelId)
  if (ch?.name?.trim()) return ch.name.trim()
  const guild = useGuildsStore.getState().guilds.find((g) => g.id === guildId)
  return guild?.name ? `${guild.name} · 语音` : "语音频道"
}

function inVoiceSession(session: ReturnType<typeof useVoiceStore.getState>["session"]): boolean {
  if (!session) return false
  return session.phase !== "idle" && session.phase !== "joining"
}

function buildState(): AndroidOverlayState | null {
  const session = useVoiceStore.getState().session
  if (!inVoiceSession(session) || !session) return null

  const self = useAuthStore.getState().user
  const members = useMembersStore.getState().byGuild[session.guildId] ?? []
  const memberMap = new Map(members.map((m) => [m.user_id, m]))
  const states = useVoiceStore.getState().byChannel[session.channelId] ?? []
  const speaking = useVoiceStore.getState().speakingUserIds
  const selfSpeaking = useVoiceStore.getState().selfSpeaking

  const speakerNames: string[] = []
  for (const st of states) {
    const isSelf = self?.id === st.user_id
    const remote = Boolean(speaking[st.user_id])
    const local = isSelf && selfSpeaking
    if (!remote && !local) continue
    const member = memberMap.get(st.user_id)
    speakerNames.push(voiceParticipantDisplayName(st, member, self))
  }

  return {
    active: true,
    channelName: resolveChannelName(session.channelId, session.guildId),
    selfMute: session.selfMute,
    selfDeaf: session.selfDeaf,
    speakers: speakerNames,
    participantCount: states.length,
  }
}

let started = false
let unsubStore: (() => void) | null = null
let listeners: PluginListener[] = []
let lastPayload = ""
let pendingTimer: ReturnType<typeof setTimeout> | null = null

async function pushUpdate(force = false) {
  if (!isAndroidTauri()) return
  const state = buildState()
  if (!state) {
    if (started) await stopAndroidVoiceOverlay()
    return
  }
  const payload = JSON.stringify(state)
  if (!force && payload === lastPayload) return
  lastPayload = payload
  if (!started) {
    const ok = await canDrawOverlays()
    if (!ok) {
      await requestOverlayPermission()
    }
    await pluginInvoke("start", state)
    started = true
  } else {
    await pluginInvoke("update", state)
  }
}

function schedulePush() {
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => {
    pendingTimer = null
    void pushUpdate()
  }, 120)
}

/** 进语音后调用：启动前台服务 + 悬浮窗，并订阅状态 */
export async function startAndroidVoiceOverlay(): Promise<void> {
  if (!isAndroidTauri()) return
  await ensureListeners()
  await pushUpdate(true)
}

/** 退语音时调用 */
export async function stopAndroidVoiceOverlay(): Promise<void> {
  if (!isAndroidTauri()) return
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  lastPayload = ""
  if (started) {
    await pluginInvoke("stop")
    started = false
  }
}

async function ensureListeners() {
  if (!isAndroidTauri() || listeners.length > 0) return
  try {
    const muteL = await addPluginListener(PLUGIN, "muteToggle", () => {
      voiceConnection.toggleMute()
      schedulePush()
    })
    const openL = await addPluginListener(PLUGIN, "openApp", () => {
      // 原生侧已拉起 Activity
    })
    listeners = [muteL, openL]
  } catch (error) {
    console.warn("[android-overlay] 监听插件事件失败", error)
  }
}

/** 应用壳挂载时调用一次（幂等） */
export function initAndroidVoiceOverlayBridge(): void {
  if (!isAndroidTauri()) return
  if (unsubStore) return

  let prevInVoice = inVoiceSession(useVoiceStore.getState().session)

  unsubStore = useVoiceStore.subscribe((state) => {
    const nowIn = inVoiceSession(state.session)
    if (nowIn && !prevInVoice) {
      prevInVoice = true
      void startAndroidVoiceOverlay()
      return
    }
    if (!nowIn && prevInVoice) {
      prevInVoice = false
      void stopAndroidVoiceOverlay()
      return
    }
    prevInVoice = nowIn
    if (nowIn) schedulePush()
  })

  if (prevInVoice) {
    void startAndroidVoiceOverlay()
  }
}
