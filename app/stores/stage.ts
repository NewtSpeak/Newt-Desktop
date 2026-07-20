// 舞台与屏幕共享 store（docs 10 / docs 11）：
//   - byChannel：per-channel 舞台实例状态（mode / max_speakers / 举手开关 / 申请队列），
//     由 STAGE_INSTANCE_UPDATE / STAGE_QUEUE_UPDATE 事件驱动；进频道时 getStageQueue
//     拉一次队列快照（404 静默）。用户端平面没有 GET /voice-stage，模式初值靠
//     参与者 stage_role 推断（inferChannelMode），实例事件到达后以事件为准；
//   - sharesByChannel：频道内活跃屏幕共享（SCREEN_SHARE_START/STOP 增量维护）；
//   - quotaByGuild：服级屏幕配额（getScreenQuota 快照 + SCREEN_QUOTA_UPDATE 增量，
//     记录 fetchedAt 供 >60s 过期兜底刷新，docs 11 §6.9）；
//   - remoteVideos：SFU 下行视频轨（user_id → MediaStream），由连接层写入。
//     观看端「点击观看才渲染」在 UI 层收口（见 voice-channel-view）；
//   - selfScreen：本端共享状态机（idle→requesting→capturing→publishing→live→stopping），
//     由 lib/voice/screen-share.ts 编排写入。

import { create } from "zustand"

import { getStageQueue, getScreenQuota } from "~/lib/api/stage"
import type {
  ScreenQuality,
  ScreenQuota,
  StageQueueBrief,
  StageQueueExtendedEntry,
  StageRole,
  StageRoleWire,
  VoiceChannelMode,
  VoiceState,
} from "~/lib/api/types"
import type {
  ScreenQuotaUpdatePayload,
  ScreenSharePayload,
  StageInstanceUpdatePayload,
  StageQueueUpdatePayload,
} from "~/lib/gateway/events"

/** 线上 stage_role（含 ""/"NONE"）归一化；FREE 模式无角色返回 null */
export function normalizeStageRole(
  role: StageRoleWire | null | undefined
): StageRole | null {
  if (role === "AUDIENCE" || role === "QUEUED" || role === "SPEAKER")
    return role
  return null
}

/** 实例事件未达时按参与者 stage_role 推断频道模式（有任一角色即 STAGE） */
export function inferChannelMode(
  states: VoiceState[] | undefined
): VoiceChannelMode {
  if (states?.some((item) => normalizeStageRole(item.stage_role) !== null))
    return "STAGE"
  return "FREE_DISCUSSION"
}

export type StageChannelState = {
  mode: VoiceChannelMode
  maxSpeakers: number
  requestToSpeakEnabled: boolean
  allowCoModChangeMode: boolean
  /** 是否已收到权威实例数据（事件/PATCH 响应）；false 时 UI 用 inferChannelMode 兜底 */
  instanceKnown: boolean
  queue: StageQueueBrief[]
  /** 仅队列管理者可见（getStageQueue 附带） */
  queueExtended?: StageQueueExtendedEntry[]
}

const DEFAULT_STAGE_STATE: StageChannelState = {
  mode: "FREE_DISCUSSION",
  maxSpeakers: 20,
  requestToSpeakEnabled: true,
  allowCoModChangeMode: true,
  instanceKnown: false,
  queue: [],
}

export type ScreenShareEntry = {
  userId: string
  quality?: string
}

export type SelfScreenPhase =
  "idle" | "requesting" | "capturing" | "publishing" | "live" | "stopping"

export type SelfScreenState = {
  channelId: string
  quality: ScreenQuality
  phase: SelfScreenPhase
}

type QuotaEntry = ScreenQuota & { fetchedAt: number }

type StageStoreState = {
  byChannel: Record<string, StageChannelState>
  /** channelId → userId → 活跃共享 */
  sharesByChannel: Record<string, Record<string, ScreenShareEntry>>
  quotaByGuild: Record<string, QuotaEntry>
  /** SFU 下行视频轨（连接层写入；链路切换/销毁时整体清空） */
  remoteVideos: Record<string, MediaStream>
  /** 本端共享状态机（screen-share.ts 编排写入）；null = 未共享 */
  selfScreen: SelfScreenState | null

  applyQueueUpdate: (payload: StageQueueUpdatePayload) => void
  applyInstanceUpdate: (payload: StageInstanceUpdatePayload) => void
  /** 进频道拉队列快照（404 = 非语音频道/不可见，静默） */
  fetchStageSnapshot: (channelId: string) => Promise<void>

  applyScreenStart: (payload: ScreenSharePayload) => void
  applyScreenStop: (payload: ScreenSharePayload) => void
  applyQuotaUpdate: (payload: ScreenQuotaUpdatePayload) => void
  /** 拉服级配额快照（失败静默，保留缓存） */
  fetchQuota: (guildId: string) => Promise<void>

  setRemoteVideo: (userId: string, stream: MediaStream | null) => void
  clearRemoteVideos: () => void
  setSelfScreen: (state: SelfScreenState | null) => void

  reset: () => void
}

function mergeChannel(
  byChannel: Record<string, StageChannelState>,
  channelId: string,
  patch: Partial<StageChannelState>
): Record<string, StageChannelState> {
  const current = byChannel[channelId] ?? DEFAULT_STAGE_STATE
  return { ...byChannel, [channelId]: { ...current, ...patch } }
}

export const useStageStore = create<StageStoreState>()((set) => ({
  byChannel: {},
  sharesByChannel: {},
  quotaByGuild: {},
  remoteVideos: {},
  selfScreen: null,

  applyQueueUpdate: (payload) =>
    set((state) => {
      if (!payload.channel_id) return state
      // STAGE→FREE 后的残留队列事件：模式已知为 FREE 时忽略（docs 10 §6.2）
      const current = state.byChannel[payload.channel_id]
      if (current?.instanceKnown && current.mode === "FREE_DISCUSSION") {
        if ((payload.queue ?? []).length > 0) return state
      }
      return {
        byChannel: mergeChannel(state.byChannel, payload.channel_id, {
          queue: payload.queue ?? [],
        }),
      }
    }),

  applyInstanceUpdate: (payload) =>
    set((state) => {
      if (!payload.channel_id) return state
      const patch: Partial<StageChannelState> = { instanceKnown: true }
      if (payload.mode) patch.mode = payload.mode
      if (typeof payload.max_speakers === "number")
        patch.maxSpeakers = payload.max_speakers
      if (typeof payload.request_to_speak_enabled === "boolean") {
        patch.requestToSpeakEnabled = payload.request_to_speak_enabled
      }
      if (typeof payload.allow_co_mod_change_mode === "boolean") {
        patch.allowCoModChangeMode = payload.allow_co_mod_change_mode
      }
      // 切回 FREE：服务端清空队列，本地同步清（docs 10 FR-04）
      if (payload.mode === "FREE_DISCUSSION") {
        patch.queue = []
        patch.queueExtended = undefined
      }
      return {
        byChannel: mergeChannel(state.byChannel, payload.channel_id, patch),
      }
    }),

  fetchStageSnapshot: async (channelId) => {
    try {
      const result = await getStageQueue(channelId)
      set((state) => ({
        byChannel: mergeChannel(state.byChannel, channelId, {
          queue: result.queue ?? [],
          queueExtended: result.queue_extended,
        }),
      }))
    } catch {
      // 404（非语音频道/不可见）或网络失败：静默，由事件继续维护
    }
  },

  applyScreenStart: (payload) =>
    set((state) => {
      if (!payload.channel_id || !payload.user_id) return state
      const channel = { ...(state.sharesByChannel[payload.channel_id] ?? {}) }
      channel[payload.user_id] = {
        userId: payload.user_id,
        quality: payload.quality,
      }
      return {
        sharesByChannel: {
          ...state.sharesByChannel,
          [payload.channel_id]: channel,
        },
      }
    }),

  applyScreenStop: (payload) =>
    set((state) => {
      if (!payload.channel_id || !payload.user_id) return state
      const channel = state.sharesByChannel[payload.channel_id]
      if (!channel?.[payload.user_id]) return state
      const { [payload.user_id]: _, ...rest } = channel
      return {
        sharesByChannel: {
          ...state.sharesByChannel,
          [payload.channel_id]: rest,
        },
      }
    }),

  applyQuotaUpdate: (payload) =>
    set((state) => {
      if (!payload.guild_id || !payload.quota) return state
      return {
        quotaByGuild: {
          ...state.quotaByGuild,
          [payload.guild_id]: { ...payload.quota, fetchedAt: Date.now() },
        },
      }
    }),

  fetchQuota: async (guildId) => {
    try {
      const quota = await getScreenQuota(guildId)
      set((state) => ({
        quotaByGuild: {
          ...state.quotaByGuild,
          [guildId]: { ...quota, fetchedAt: Date.now() },
        },
      }))
    } catch {
      // 静默：配额仅用于展示与前置提示，最终以服务端错误码为准
    }
  },

  setRemoteVideo: (userId, stream) =>
    set((state) => {
      const next = { ...state.remoteVideos }
      if (stream) next[userId] = stream
      else delete next[userId]
      return { remoteVideos: next }
    }),

  clearRemoteVideos: () =>
    set((state) =>
      Object.keys(state.remoteVideos).length === 0
        ? state
        : { remoteVideos: {} }
    ),

  setSelfScreen: (selfScreen) => set({ selfScreen }),

  reset: () =>
    set({
      byChannel: {},
      sharesByChannel: {},
      quotaByGuild: {},
      remoteVideos: {},
      selfScreen: null,
    }),
}))
