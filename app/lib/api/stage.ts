// 舞台（麦序）与屏幕共享（stage 模块用户端路由，docs 11 / 14）。

import { api } from "./http"
import type {
  ScreenQuality,
  ScreenQuota,
  ScreenStartResult,
  StageApplyResult,
  StageConfig,
  StageConfigPatch,
  StageQueueResult,
  StageSeatResult,
} from "./types"

/** 修改语音频道舞台配置（服管/协管；权限由服务端裁决） */
export const patchVoiceStage = (channelId: string, patch: StageConfigPatch) =>
  api<StageConfig>(`/channels/${channelId}/voice-stage`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })

/** 申请上麦队列（全员可见简表；队列管理者附 queue_extended） */
export const getStageQueue = (channelId: string) =>
  api<StageQueueResult>(`/channels/${channelId}/stage/queue`)

/** 申请上麦（须在频道内、舞台模式开启申请） */
export const applyStage = (channelId: string) =>
  api<StageApplyResult>(`/channels/${channelId}/stage/apply`, { method: "POST" })

/** 取消申请（幂等，204） */
export const cancelStageApply = (channelId: string) =>
  api<void>(`/channels/${channelId}/stage/apply`, { method: "DELETE" })

/** 抱上麦（需 STAGE_BRING_UP） */
export const stageBringUp = (channelId: string, userId: string) =>
  api<StageSeatResult>(`/channels/${channelId}/stage/bring-up`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  })

/** 抱下麦（需 STAGE_BRING_DOWN） */
export const stageBringDown = (channelId: string, userId: string) =>
  api<StageSeatResult>(`/channels/${channelId}/stage/bring-down`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  })

/** 主动下麦（幂等） */
export const stageSelfLeave = (channelId: string) =>
  api<StageSeatResult>(`/channels/${channelId}/stage/self-leave`, { method: "POST" })

/**
 * 发起屏幕共享（占坑 RESERVED，SFU 轨道生效后转 ACTIVE）。
 * 409 SCREEN_ALREADY_ACTIVE / SCREEN_QUOTA_EXCEEDED；403 见 docs 14 §9。
 */
export const startScreenShare = (channelId: string, quality?: ScreenQuality) =>
  api<ScreenStartResult>(`/channels/${channelId}/voice/screen/start`, {
    method: "POST",
    body: JSON.stringify(quality ? { quality } : {}),
  })

/** 结束自己的共享（幂等，204） */
export const stopScreenShare = (channelId: string) =>
  api<void>(`/channels/${channelId}/voice/screen/stop`, { method: "POST" })

/** 强制结束他人共享（需 STREAM_END_OTHERS） */
export const stopScreenShareOfUser = (channelId: string, userId: string) =>
  api<void>(`/channels/${channelId}/voice/screen/stop-user`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  })

/** 服级屏幕共享配额 */
export const getScreenQuota = (guildId: string) =>
  api<ScreenQuota>(`/guilds/${guildId}/screen-quota`)
