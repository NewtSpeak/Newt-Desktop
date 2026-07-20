// Gateway DISPATCH 事件名常量与 payload 类型（对齐 Owl-Server internal/eventbus/events.go
// 与各模块 Publish 的 payload 结构；docs 14）。
// 后续消息/语音功能 agent 按事件名注册 handler，payload 类型在此集中演进。

import type { Message, StageConfig, StageQueueBrief, User, VoiceCaps, VoiceState } from "~/lib/api/types"

// ---------------------------------------------------------------------------
// 事件名常量
// ---------------------------------------------------------------------------

export const GatewayEvents = {
  MessageCreate: "MESSAGE_CREATE",
  MessageUpdate: "MESSAGE_UPDATE",
  MessageDelete: "MESSAGE_DELETE",
  MessageReactionAdd: "MESSAGE_REACTION_ADD",
  MessageReactionRemove: "MESSAGE_REACTION_REMOVE",
  TypingStart: "TYPING_START",

  VoiceStateUpdate: "VOICE_STATE_UPDATE",
  VoiceServerUpdate: "VOICE_SERVER_UPDATE",
  VoiceCapsUpdate: "VOICE_CAPS_UPDATE",
  VoiceChannelStatus: "VOICE_CHANNEL_STATUS",
  VoiceMigrating: "VOICE_MIGRATING",
  VoiceMigrated: "VOICE_MIGRATED",
  VoicePackPlay: "VOICE_PACK_PLAY",

  RestrictionCreate: "RESTRICTION_CREATE",
  RestrictionUpdate: "RESTRICTION_UPDATE",
  RestrictionLift: "RESTRICTION_LIFT",

  StageQueueUpdate: "STAGE_QUEUE_UPDATE",
  StageInstanceUpdate: "STAGE_INSTANCE_UPDATE",

  ScreenShareStart: "SCREEN_SHARE_START",
  ScreenShareStop: "SCREEN_SHARE_STOP",
  ScreenQuotaUpdate: "SCREEN_QUOTA_UPDATE",

  PermissionsUpdate: "PERMISSIONS_UPDATE",
} as const

export type GatewayEventName = (typeof GatewayEvents)[keyof typeof GatewayEvents]

// ---------------------------------------------------------------------------
// payload 类型
// ---------------------------------------------------------------------------

export type MessageCreatePayload = Message
export type MessageUpdatePayload = Message

export type MessageDeletePayload = {
  id: string
  channel_id: string
  guild_id: string
}

export type MessageReactionPayload = {
  message_id: string
  channel_id: string
  guild_id: string
  user_id: string
  emoji: string
}

export type TypingStartPayload = {
  channel_id: string
  guild_id: string
  user_id: string
  timestamp: string
}

/**
 * VOICE_STATE_UPDATE 有两种形态，按 user_id 合并：
 *   1. voice 模块：VoiceState 全字段 + 可选 reason（如 ADMIN_DISCONNECT）；
 *   2. stage 模块：增量 { user_id, stage_role, capacity_muted, self_stream }。
 */
export type VoiceStateUpdatePayload = Partial<VoiceState> & {
  user_id: string
  /** 部分事件附带（如离房原因 ADMIN_DISCONNECT） */
  reason?: string
}

/** 换节点指令：驱动双 PC 热切（保持旧链路收发，并行建新链路后 CUTOVER，docs 13 FR-04） */
export type VoiceServerUpdatePayload = {
  guild_id: string
  channel_id?: string
  node_id?: string
  /** SFU 客户端信令端点 */
  advertise_wss_url?: string
  endpoint?: string
  sfu_endpoint?: string
  token?: string
  caps?: VoiceCaps
  session_id?: string
  expires_at?: number | string
  migration_id?: string
}

export type VoiceCapsUpdatePayload = {
  guild_id: string
  channel_id: string
  user_id: string
  caps: VoiceCaps
}

export type VoiceMigratingPayload = {
  migration_id: string
  guild_id: string
  channel_id: string
  user_id: string
  to_node_id?: string
  token?: string
  advertise_wss_url?: string
  deadline?: string
}

export type VoiceMigratedPayload = {
  migration_id: string
  guild_id: string
  channel_id: string
  user_id: string
  node_id?: string
}

export type VoicePackPlayPayload = {
  guild_id: string
  channel_id: string
  user_id: string
  audio_url?: string
}

export type RestrictionEventPayload = {
  id: string
  guild_id: string
  target_user_id: string
  scope?: string
  channel_id?: string | null
  deny?: Record<string, boolean>
  kind?: string
  reason?: string
  expires_at?: string | null
  active?: boolean
}

export type StageQueueUpdatePayload = {
  channel_id: string
  guild_id?: string
  queue: StageQueueBrief[]
}

export type StageInstanceUpdatePayload = StageConfig

export type ScreenSharePayload = {
  guild_id: string
  channel_id: string
  user_id: string
  slot_id?: string
  quality?: string
}

export type ScreenQuotaUpdatePayload = {
  guild_id: string
  quota: {
    base_limit: number
    effective_limit: number
    dynamic_enabled: boolean
    used: number
  }
}

export type PermissionsUpdatePayload = {
  guild_id: string
  channel_id?: string
  user_id?: string
}

/** 事件名 → payload 的映射（subscribe 的类型入口） */
export type GatewayEventPayloadMap = {
  [GatewayEvents.MessageCreate]: MessageCreatePayload
  [GatewayEvents.MessageUpdate]: MessageUpdatePayload
  [GatewayEvents.MessageDelete]: MessageDeletePayload
  [GatewayEvents.MessageReactionAdd]: MessageReactionPayload
  [GatewayEvents.MessageReactionRemove]: MessageReactionPayload
  [GatewayEvents.TypingStart]: TypingStartPayload
  [GatewayEvents.VoiceStateUpdate]: VoiceStateUpdatePayload
  [GatewayEvents.VoiceServerUpdate]: VoiceServerUpdatePayload
  [GatewayEvents.VoiceCapsUpdate]: VoiceCapsUpdatePayload
  [GatewayEvents.VoiceChannelStatus]: Record<string, unknown>
  [GatewayEvents.VoiceMigrating]: VoiceMigratingPayload
  [GatewayEvents.VoiceMigrated]: VoiceMigratedPayload
  [GatewayEvents.VoicePackPlay]: VoicePackPlayPayload
  [GatewayEvents.RestrictionCreate]: RestrictionEventPayload
  [GatewayEvents.RestrictionUpdate]: RestrictionEventPayload
  [GatewayEvents.RestrictionLift]: RestrictionEventPayload
  [GatewayEvents.StageQueueUpdate]: StageQueueUpdatePayload
  [GatewayEvents.StageInstanceUpdate]: StageInstanceUpdatePayload
  [GatewayEvents.ScreenShareStart]: ScreenSharePayload
  [GatewayEvents.ScreenShareStop]: ScreenSharePayload
  [GatewayEvents.ScreenQuotaUpdate]: ScreenQuotaUpdatePayload
  [GatewayEvents.PermissionsUpdate]: PermissionsUpdatePayload
}

// ---------------------------------------------------------------------------
// 协议帧
// ---------------------------------------------------------------------------

export type GatewayFrame = {
  op: "HELLO" | "IDENTIFY" | "READY" | "HEARTBEAT" | "HEARTBEAT_ACK" | "DISPATCH" | string
  t?: string
  d?: unknown
}

/** 注意：字段名是 heartbeat_interval_ms（服务端 protocol.go helloData） */
export type HelloData = { heartbeat_interval_ms: number }

export type ReadyData = { user: User; guild_ids: string[] }

/** 应用层关闭码 */
export const GatewayCloseCodes = {
  /** 连续两个心跳周期未收到 HEARTBEAT */
  HeartbeatDead: 4000,
  /** 超时未 IDENTIFY */
  IdentifyTimeout: 4001,
  /** 访问令牌无效 */
  AuthFailed: 4003,
  /** 发送队列积压（慢消费者） */
  SlowConsumer: 4008,
} as const
