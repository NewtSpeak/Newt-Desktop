// 语音状态 store（docs 09）：
//   - byChannel：per-channel 参与者 VoiceState 映射（Gateway VOICE_STATE_UPDATE 增量
//     维护 + listVoiceStates 快照）；VOICE_STATE_UPDATE 的两种形态（voice 全字段 /
//     stage 增量）按 user_id 合并；
//   - session：当前语音会话（频道、状态机阶段、caps、self_mute/self_deaf、错误）；
//   - speaking：SFU speaking 事件驱动的说话人集合 + 本地检测的自我说话指示；
//   - localMuted：每用户本地静音集合（= 真实退订），持久化 localStorage，重连后重放；
//   - userVolumes：每用户本地音量（0–500%），持久化 localStorage，重连/迁移后重放（FR-21）。
//
// 连接编排（进出房、信令、重连）在 app/lib/voice/connection.ts；本 store 只存状态。

import { create } from "zustand"

import { listVoiceStates } from "~/lib/api/voice"
import type { VoiceState } from "~/lib/api/types"
import type { VoiceStateUpdatePayload } from "~/lib/gateway/events"
import { USER_VOLUME_MAX } from "~/lib/moderation"
import { useStageStore } from "~/stores/stage"

const LOCAL_MUTES_KEY = "owl.voice.local_mutes"
const USER_VOLUMES_KEY = "owl.voice.user_volumes"

/** 语音连接状态机阶段（docs 09 §3.2 / docs 13 §3.1） */
export type VoicePhase =
  | "idle"
  | "joining"
  | "signaling"
  | "negotiating"
  | "connected"
  | "recovering"
  /** 本机完全断网，重试挂起等待 online 事件（docs 13 FR-01/FR-20） */
  | "suspended"

export type VoiceSession = {
  guildId: string
  channelId: string
  /** voice_session_id（join/ready 下发） */
  sessionId: string | null
  phase: VoicePhase
  /** Media Token caps（如 ["join","publish_audio","subscribe_audio"]） */
  caps: string[]
  selfMute: boolean
  selfDeaf: boolean
  serverMute: boolean
  serverDeaf: boolean
  /** 「线路优化中…」细条提示（VOICE_MIGRATING / 双 PC 热切期间） */
  migrating: boolean
  /** 未获麦克风权限时的仅听模式 */
  listenOnly: boolean
  /** 进入 recovering/suspended 的时刻（epoch ms）；>30s 时 UI 升级文案（UX-05） */
  recoveringSince: number | null
  /** 自动恢复循环耗尽后的可重试错误文案 */
  error: string | null
}

/** 恢复说话三条件（FR-20）：self_mute=false ∧ server_mute=false ∧ caps 含 publish_audio */
export function canPublishAudio(session: VoiceSession): boolean {
  return (
    !session.selfMute &&
    !session.serverMute &&
    session.caps.includes("publish_audio") &&
    !session.listenOnly
  )
}

function loadLocalMutes(): Record<string, true> {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(LOCAL_MUTES_KEY)
    if (!raw) return {}
    const list = JSON.parse(raw) as unknown
    if (!Array.isArray(list)) return {}
    const map: Record<string, true> = {}
    for (const id of list) if (typeof id === "string") map[id] = true
    return map
  } catch {
    return {}
  }
}

function saveLocalMutes(map: Record<string, true>) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(LOCAL_MUTES_KEY, JSON.stringify(Object.keys(map)))
  } catch {
    // 持久化失败不影响会话内行为
  }
}

/** 每用户音量（百分比 0–500，100 = 原音量） */
function loadUserVolumes(): Record<string, number> {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(USER_VOLUMES_KEY)
    if (!raw) return {}
    const map = JSON.parse(raw) as unknown
    if (!map || typeof map !== "object" || Array.isArray(map)) return {}
    const result: Record<string, number> = {}
    for (const [id, value] of Object.entries(map as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        result[id] = Math.min(USER_VOLUME_MAX, Math.max(0, Math.round(value)))
      }
    }
    return result
  } catch {
    return {}
  }
}

function saveUserVolumes(map: Record<string, number>) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(USER_VOLUMES_KEY, JSON.stringify(map))
  } catch {
    // 持久化失败不影响会话内行为
  }
}

/** 区分 VOICE_STATE_UPDATE 两种形态：voice 全字段 vs stage 增量 */
function isFullVoiceStateUpdate(payload: VoiceStateUpdatePayload): boolean {
  return (
    Object.prototype.hasOwnProperty.call(payload, "channel_id") ||
    Object.prototype.hasOwnProperty.call(payload, "connected") ||
    Object.prototype.hasOwnProperty.call(payload, "self_mute")
  )
}

type VoiceStoreState = {
  /** channelId → 该频道内的语音状态列表 */
  byChannel: Record<string, VoiceState[]>
  /** 当前语音会话；null = 不在语音中 */
  session: VoiceSession | null
  /** SFU speaking 事件驱动的说话人集合（含熄灭防闪延迟，由连接层节流写入） */
  speakingUserIds: Record<string, true>
  /** 本地采集侧检测的自我说话指示 */
  selfSpeaking: boolean
  /** 每用户本地静音集合（= 已退订），持久化 */
  localMuted: Record<string, true>
  /** 每用户本地音量（百分比 0–500，缺省 100），持久化 */
  userVolumes: Record<string, number>
  /**
   * 当前会话所在频道是否被提示「正在音频审计」（CHANNEL_AUDIT_NOTICE）。
   * 仅本人视角；静默审计不会置 true。
   */
  channelAudited: boolean

  /** Gateway VOICE_STATE_UPDATE handler：两种形态按 user_id 合并 */
  applyVoiceStateUpdate: (payload: VoiceStateUpdatePayload) => void
  setChannelStates: (channelId: string, states: VoiceState[]) => void
  /**
   * READY / GUILD_CREATE 快照：按 channel_id 分组整体替换已知频道的参与者列表
   *（刷新后恢复语音树，docs 09 FR-06）。
   */
  applyVoiceStatesSnapshot: (states: VoiceState[]) => void
  /** 拉取频道语音成员快照；404（频道不可见）按空列表处理 */
  fetchChannelStates: (guildId: string, channelId: string) => Promise<void>

  setSession: (session: VoiceSession | null) => void
  patchSession: (patch: Partial<VoiceSession>) => void
  /** CHANNEL_AUDIT_NOTICE：更新当前会话频道的审计提示态 */
  setChannelAudited: (channelId: string, audited: boolean) => void

  setSpeakingUserIds: (userIds: string[]) => void
  setSelfSpeaking: (speaking: boolean) => void
  setLocalMuted: (userId: string, muted: boolean) => void
  /** 设置每用户音量（百分比 0–500；100 时移除记录回落默认） */
  setUserVolume: (userId: string, volume: number) => void

  reset: () => void
}

export const useVoiceStore = create<VoiceStoreState>()((set) => ({
  byChannel: {},
  session: null,
  speakingUserIds: {},
  selfSpeaking: false,
  localMuted: loadLocalMutes(),
  userVolumes: loadUserVolumes(),
  channelAudited: false,

  applyVoiceStateUpdate: (payload) =>
    set((state) => {
      if (!payload.user_id) return state

      // stage 增量形态：仅在原地合并字段，不做频道迁移
      if (!isFullVoiceStateUpdate(payload)) {
        const next: Record<string, VoiceState[]> = {}
        let touched = false
        for (const [channelId, states] of Object.entries(state.byChannel)) {
          next[channelId] = states.map((item) => {
            if (item.user_id !== payload.user_id) return item
            touched = true
            return { ...item, ...payload }
          })
        }
        return touched ? { byChannel: next } : state
      }

      // voice 全字段形态：先从所有频道移除旧状态，再按 channel_id 落位
      const next: Record<string, VoiceState[]> = {}
      let previous: VoiceState | undefined
      for (const [channelId, states] of Object.entries(state.byChannel)) {
        previous ??= states.find((item) => item.user_id === payload.user_id)
        next[channelId] = states.filter((item) => item.user_id !== payload.user_id)
      }
      if (payload.channel_id) {
        const merged = { ...previous, ...payload } as VoiceState
        const target = next[payload.channel_id] ?? []
        next[payload.channel_id] = [...target, merged]
      }
      return { byChannel: next }
    }),

  setChannelStates: (channelId, states) =>
    set((prev) => ({ byChannel: { ...prev.byChannel, [channelId]: states } })),

  applyVoiceStatesSnapshot: (states) =>
    set((prev) => {
      // 按 channel_id 聚合；仅处理仍在房内的状态（channel_id 非空）
      const grouped: Record<string, VoiceState[]> = {}
      for (const state of states) {
        const channelId = state.channel_id
        if (!channelId) continue
        const list = grouped[channelId] ?? []
        list.push(state)
        grouped[channelId] = list
      }
      // 合并进现有缓存：快照覆盖命中频道；未出现在快照中的频道保留
      //（READY 按 guild 下发，可能只覆盖本服可见频道）
      return { byChannel: { ...prev.byChannel, ...grouped } }
    }),

  fetchChannelStates: async (guildId, channelId) => {
    try {
      const states = await listVoiceStates(guildId, channelId)
      set((prev) => {
        const existing = prev.byChannel[channelId]
        // 内容相同时不换引用，避免语音列表多实例订阅时无意义重渲染
        if (
          existing &&
          existing.length === states.length &&
          existing.every((item, index) => {
            const next = states[index]
            return (
              item.user_id === next?.user_id &&
              item.channel_id === next?.channel_id &&
              item.self_mute === next?.self_mute &&
              item.self_deaf === next?.self_deaf &&
              item.server_mute === next?.server_mute &&
              item.server_deaf === next?.server_deaf &&
              item.self_stream === next?.self_stream
            )
          })
        ) {
          // 即使 byChannel 未变，仍用快照同步 shares（刷新后 Gateway START 已错过）
          useStageStore.getState().hydrateSharesFromVoiceStates(channelId, states)
          return prev
        }
        // 从 self_stream 回填活跃共享列表，避免刷新后 LIVE 角标全丢
        useStageStore.getState().hydrateSharesFromVoiceStates(channelId, states)
        return { byChannel: { ...prev.byChannel, [channelId]: states } }
      })
    } catch {
      // 404 / 网络失败：保持现有缓存，由 Gateway 增量继续维护
    }
  },

  setSession: (session) =>
    set(
      session === null
        ? {
            session: null,
            selfSpeaking: false,
            speakingUserIds: {},
            channelAudited: false,
          }
        : {
            session,
            // 切频道/重进：清除旧审计提示，等待新的 CHANNEL_AUDIT_NOTICE
            channelAudited: false,
          }
    ),

  patchSession: (patch) =>
    set((state) => (state.session ? { session: { ...state.session, ...patch } } : state)),

  setChannelAudited: (channelId, audited) =>
    set((state) => {
      // 只接受当前本人所在频道的提示，避免跨频道串扰
      if (!state.session || state.session.channelId !== channelId) {
        return state
      }
      return state.channelAudited === audited ? state : { channelAudited: audited }
    }),

  setSpeakingUserIds: (userIds) => {
    const map: Record<string, true> = {}
    for (const id of userIds) map[id] = true
    set({ speakingUserIds: map })
  },

  setSelfSpeaking: (speaking) =>
    set((state) => (state.selfSpeaking === speaking ? state : { selfSpeaking: speaking })),

  setLocalMuted: (userId, muted) =>
    set((state) => {
      const next = { ...state.localMuted }
      if (muted) next[userId] = true
      else delete next[userId]
      saveLocalMutes(next)
      return { localMuted: next }
    }),

  setUserVolume: (userId, volume) =>
    set((state) => {
      const clamped = Math.min(USER_VOLUME_MAX, Math.max(0, Math.round(volume)))
      const next = { ...state.userVolumes }
      if (clamped === 100) delete next[userId]
      else next[userId] = clamped
      saveUserVolumes(next)
      return { userVolumes: next }
    }),

  reset: () =>
    set({
      byChannel: {},
      session: null,
      speakingUserIds: {},
      selfSpeaking: false,
      channelAudited: false,
      // localMuted / userVolumes 是用户偏好，登出不清持久化，仅重载
      localMuted: loadLocalMutes(),
      userVolumes: loadUserVolumes(),
    }),
}))
