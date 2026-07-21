// 语音会话编排（voice 模块用户端路由，docs 05 / 09 / 10）。

import { api, apiPublic } from "./http"
import type {
  RTTReportResult,
  RTTSample,
  SelfVoiceStatePatch,
  VoiceJoinRequest,
  VoiceJoinResult,
  VoiceLeaveResult,
  VoicePublicKey,
  VoiceState,
  VoiceTokenRefreshResult,
} from "./types"

/**
 * 进入语音频道：调度 SFU 节点并签发 Media Token。
 * 403 MISSING_PERMISSIONS / RESTRICTED / CHANNEL_FULL；503 无可用节点。
 * 同 guild 已在其他频道时服务端自动先离开（响应带 move/force_reconnect）。
 */
export const joinVoice = (input: VoiceJoinRequest) =>
  api<VoiceJoinResult>("/voice/join", { method: "POST", body: JSON.stringify(input) })

/** 离开当前语音频道（幂等：不在语音中返回 left:false） */
export const leaveVoice = (guildId: string) =>
  api<VoiceLeaveResult>("/voice/leave", {
    method: "POST",
    body: JSON.stringify({ guild_id: guildId }),
  })

/** 续签 Media Token（重算 caps；已无权限时 403 并被踢出语音） */
export const refreshVoiceToken = (guildId: string) =>
  api<VoiceTokenRefreshResult>("/voice/refresh-token", {
    method: "POST",
    body: JSON.stringify({ guild_id: guildId }),
  })

/** 更新自我状态（self_mute / self_deaf），广播 VOICE_STATE_UPDATE */
export const updateSelfVoiceState = (input: SelfVoiceStatePatch) =>
  api<VoiceState>("/voice/state", { method: "PATCH", body: JSON.stringify(input) })

/** 上报到各节点的 RTT 采样（调度打分用） */
export const reportRTT = (samples: RTTSample[]) =>
  api<RTTReportResult>("/voice/rtt", { method: "POST", body: JSON.stringify({ samples }) })

/** 确认收到热迁移指令（docs 09 §7） */
export const ackVoiceMigration = (migrationId: string) =>
  api<{ acknowledged: boolean }>(`/voice/migrations/${migrationId}/ack`, { method: "POST" })

/** 频道内语音成员列表；频道不可见一律 404 */
export const listVoiceStates = (guildId: string, channelId: string) =>
  api<{ voice_states?: VoiceState[] }>(
    `/guilds/${guildId}/channels/${channelId}/voice-states`,
  ).then((raw) => raw.voice_states ?? [])

/** Media Token 验签公钥（无需登录） */
export const getVoicePublicKey = () => apiPublic<VoicePublicKey>("/voice/public-key")

/**
 * 管理员：服务器静音 / 耳聋（docs 05）。
 * server_mute 需 MUTE_MEMBERS；server_deaf 需 DEAFEN_MEMBERS；目标须在语音内。
 */
export const patchServerVoiceState = (
  guildId: string,
  userId: string,
  patch: { server_mute?: boolean; server_deaf?: boolean },
) =>
  api<VoiceState>(`/guilds/${guildId}/voice/states/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })

/**
 * 管理员：将用户踢出语音（MOVE_MEMBERS 或 MUTE_MEMBERS + 层级）。
 * 目标不在语音 → 404 NOT_IN_VOICE。
 */
export const disconnectVoiceUser = (guildId: string, userId: string) =>
  api<{ disconnected?: boolean }>(`/guilds/${guildId}/voice/disconnect`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  })
