// Gateway DISPATCH 事件名常量与 payload 类型（对齐 Owl-Server internal/eventbus/events.go
// 与各模块 Publish 的 payload 结构；docs 14）。
// 后续消息/语音功能 agent 按事件名注册 handler，payload 类型在此集中演进。

import type {
  Channel,
  Guild,
  GuildBanner,
  Message,
  StageConfig,
  StageQueueBrief,
  User,
  VoiceCaps,
  VoiceState,
} from "~/lib/api/types"

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
  /** 频道音频审计提示（adminpresence：record∧notify 时 audited=true） */
  ChannelAuditNotice: "CHANNEL_AUDIT_NOTICE",

  RestrictionCreate: "RESTRICTION_CREATE",
  RestrictionUpdate: "RESTRICTION_UPDATE",
  RestrictionLift: "RESTRICTION_LIFT",

  StageQueueUpdate: "STAGE_QUEUE_UPDATE",
  StageInstanceUpdate: "STAGE_INSTANCE_UPDATE",

  ScreenShareStart: "SCREEN_SHARE_START",
  ScreenShareStop: "SCREEN_SHARE_STOP",
  ScreenQuotaUpdate: "SCREEN_QUOTA_UPDATE",

  PermissionsUpdate: "PERMISSIONS_UPDATE",

  RelationshipAdd: "RELATIONSHIP_ADD",
  RelationshipUpdate: "RELATIONSHIP_UPDATE",
  RelationshipRemove: "RELATIONSHIP_REMOVE",
  NotificationCreate: "NOTIFICATION_CREATE",
  NotificationDelete: "NOTIFICATION_DELETE",

  // 结构事件（服务器 / 频道 / 成员 / 角色，docs 14 §3.2）
  GuildCreate: "GUILD_CREATE",
  GuildUpdate: "GUILD_UPDATE",
  GuildDelete: "GUILD_DELETE",
  ChannelCreate: "CHANNEL_CREATE",
  ChannelUpdate: "CHANNEL_UPDATE",
  ChannelDelete: "CHANNEL_DELETE",
  GuildMemberAdd: "GUILD_MEMBER_ADD",
  GuildMemberUpdate: "GUILD_MEMBER_UPDATE",
  GuildMemberRemove: "GUILD_MEMBER_REMOVE",
  GuildRoleCreate: "GUILD_ROLE_CREATE",
  GuildRoleUpdate: "GUILD_ROLE_UPDATE",
  GuildRoleDelete: "GUILD_ROLE_DELETE",

  // 未读 / 在线状态 / 用户设置 / 用户资料（docs 15 §7-1、docs 01 §3.3–3.4、docs 16 §7-1）
  ReadStateUpdate: "READ_STATE_UPDATE",
  PresenceUpdate: "PRESENCE_UPDATE",
  UserSettingsUpdate: "USER_SETTINGS_UPDATE",
  UserUpdate: "USER_UPDATE",

  // 贴图与表情包（docs 17）
  StickerPackCreate: "STICKER_PACK_CREATE",
  StickerPackUpdate: "STICKER_PACK_UPDATE",
  StickerPackDelete: "STICKER_PACK_DELETE",
  StickerPackRestore: "STICKER_PACK_RESTORE",
  StickerItemCreate: "STICKER_ITEM_CREATE",
  StickerItemUpdate: "STICKER_ITEM_UPDATE",
  StickerItemDelete: "STICKER_ITEM_DELETE",
  StickerLibraryUpdate: "STICKER_LIBRARY_UPDATE",
  GuildStickerPackBanAdd: "GUILD_STICKER_PACK_BAN_ADD",
  GuildStickerPackBanRemove: "GUILD_STICKER_PACK_BAN_REMOVE",
} as const

export type GatewayEventName =
  (typeof GatewayEvents)[keyof typeof GatewayEvents]

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

/** VOICE_PACK_PLAY 载荷（服务端 message/voicepack.go VoicePackPlayPayload，docs 12 §6.1 定稿） */
export type VoicePackPlayPayload = {
  guild_id: string
  channel_id: string
  user_id: string
  pack_id?: string | null
  audio_url?: string
  /** FIRST_JOIN（进服首次）/ CHANNEL_JOIN（进指定语音频道） */
  scene?: string
  /** SAME_CHANNEL（默认，同语音频道）/ GUILD_ONLINE（全服在线） */
  scope?: string
  event_at?: string
}

/** CHANNEL_AUDIT_NOTICE：本频道是否向用户提示「正在被音频审计」 */
export type ChannelAuditNoticePayload = {
  guild_id: string
  channel_id: string
  /** true = 显示「本频道被审计」提示；false = 清除提示（静默审计 / 已关闭） */
  audited: boolean
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
  /** SCREEN_SHARE_STOP 附带：self | admin | demote | quota | disconnect | timeout */
  reason?: string
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

// ---------------------------------------------------------------------------
// 结构事件（服务端 eventbus/payloads.go / snapshot 包）
// ---------------------------------------------------------------------------

/** READY guilds[].member / GUILD_MEMBER_* 的成员实体（model.Member + role_ids） */
export type MemberSnapshot = {
  id: string
  guild_id: string
  user_id: string
  nickname?: string
  /** 用户名样式来源角色偏好 */
  name_style_role_id?: string | null
  created_at?: string
  role_ids?: string[]
}

/** GUILD_CREATE：建服/加入服务器时定向发送的全量快照（snapshot.GuildCreatePayload） */
export type GuildCreatePayload = {
  guild: Guild
  channels: Channel[]
  roles: unknown[]
  /** 服务器多 banner 列表（position 升序） */
  banners?: GuildBanner[]
  member: MemberSnapshot
  voice_states: VoiceState[]
  presences: PresenceEntry[]
  event_at: string
}

/** GUILD_UPDATE：guild 全量；banners 仅在 banner 增删/排序时携带（最新全量，客户端整体替换） */
export type GuildUpdatePayload = {
  guild: Guild
  banners?: GuildBanner[]
  event_at: string
}

export type GuildDeletePayload = {
  guild_id: string
  event_at: string
}

/** CHANNEL_CREATE / CHANNEL_UPDATE：频道快照平铺（snapshot.ChannelPayload） */
export type ChannelEventPayload = Channel & {
  topic?: string
  voice_config?: {
    mode: string
    max_speakers: number
    request_to_speak_enabled: boolean
  }
  event_at: string
}

export type ChannelDeletePayload = {
  guild_id: string
  channel_id: string
  event_at: string
}

export type GuildMemberAddPayload = {
  guild_id: string
  member: MemberSnapshot
  user: User
  event_at: string
}

export type GuildMemberUpdatePayload = {
  guild_id: string
  member: MemberSnapshot
  role_ids: string[]
  event_at: string
}

export type GuildMemberRemovePayload = {
  guild_id: string
  member_id: string
  user_id: string
  /** kick / ban / leave */
  reason: string
  event_at: string
}

export type GuildRolePayload = {
  guild_id: string
  role: { id: string; name?: string; permissions?: number | string }
  event_at: string
}

export type GuildRoleDeletePayload = {
  guild_id: string
  role_id: string
  event_at: string
}

// ---------------------------------------------------------------------------
// 未读 / Presence / 用户设置
// ---------------------------------------------------------------------------

/** READ_STATE_UPDATE：定向多端同步（本人 ack 或被提及计数增长时触发） */
export type ReadStateUpdatePayload = {
  user_id: string
  channel_id: string
  /** 雪花 ID 字符串 */
  last_read_message_id: string
  mention_count: number
  event_at: string
}

export type PresenceStatus = "online" | "idle" | "dnd" | "invisible" | "offline"

/** PRESENCE_UPDATE：他人载荷不会出现 invisible（服务端已掩码为 offline） */
export type PresenceUpdatePayload = {
  user_id: string
  status: PresenceStatus
  custom_text?: string
  event_at: string
}

/** USER_UPDATE：用户资料公开投影（头像/横幅/显示名/签名等；不含 email） */
export type UserUpdatePayload = {
  id: string
  username: string
  display_name: string
  /** 头像公开路径，空串表示未设置 */
  avatar: string
  avatar_animated?: boolean
  banner?: string
  accent_color?: string
  bio?: string
  event_at: string
}

/** USER_SETTINGS_UPDATE：合并后的全量设置文档（其他端整体替换本地副本） */
export type UserSettingsUpdatePayload = {
  settings: Record<string, unknown>
  event_at: string
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
  [GatewayEvents.ChannelAuditNotice]: ChannelAuditNoticePayload
  [GatewayEvents.RestrictionCreate]: RestrictionEventPayload
  [GatewayEvents.RestrictionUpdate]: RestrictionEventPayload
  [GatewayEvents.RestrictionLift]: RestrictionEventPayload
  [GatewayEvents.StageQueueUpdate]: StageQueueUpdatePayload
  [GatewayEvents.StageInstanceUpdate]: StageInstanceUpdatePayload
  [GatewayEvents.ScreenShareStart]: ScreenSharePayload
  [GatewayEvents.ScreenShareStop]: ScreenSharePayload
  [GatewayEvents.ScreenQuotaUpdate]: ScreenQuotaUpdatePayload
  [GatewayEvents.PermissionsUpdate]: PermissionsUpdatePayload
  [GatewayEvents.GuildCreate]: GuildCreatePayload
  [GatewayEvents.GuildUpdate]: GuildUpdatePayload
  [GatewayEvents.GuildDelete]: GuildDeletePayload
  [GatewayEvents.ChannelCreate]: ChannelEventPayload
  [GatewayEvents.ChannelUpdate]: ChannelEventPayload
  [GatewayEvents.ChannelDelete]: ChannelDeletePayload
  [GatewayEvents.GuildMemberAdd]: GuildMemberAddPayload
  [GatewayEvents.GuildMemberUpdate]: GuildMemberUpdatePayload
  [GatewayEvents.GuildMemberRemove]: GuildMemberRemovePayload
  [GatewayEvents.GuildRoleCreate]: GuildRolePayload
  [GatewayEvents.GuildRoleUpdate]: GuildRolePayload
  [GatewayEvents.GuildRoleDelete]: GuildRoleDeletePayload
  [GatewayEvents.ReadStateUpdate]: ReadStateUpdatePayload
  [GatewayEvents.PresenceUpdate]: PresenceUpdatePayload
  [GatewayEvents.UserSettingsUpdate]: UserSettingsUpdatePayload
  [GatewayEvents.UserUpdate]: UserUpdatePayload
  [GatewayEvents.RelationshipAdd]: RelationshipEventPayload
  [GatewayEvents.RelationshipUpdate]: RelationshipEventPayload
  [GatewayEvents.RelationshipRemove]: RelationshipEventPayload
  [GatewayEvents.NotificationCreate]: NotificationEventPayload
  [GatewayEvents.NotificationDelete]: NotificationEventPayload
}

export type RelationshipEventPayload = {
  id: string
  user_id: string
  target_user_id: string
  type: string
  nickname?: string
  user?: {
    id: string
    username: string
    display_name?: string
    avatar_url?: string
  }
  event_at?: string
}

export type NotificationEventPayload = {
  id: string
  user_id: string
  type: string
  payload?: Record<string, unknown>
  event_at?: string
}

// ---------------------------------------------------------------------------
// 协议帧
// ---------------------------------------------------------------------------

export type GatewayFrame = {
  op:
    | "HELLO"
    | "IDENTIFY"
    | "RESUME"
    | "READY"
    | "RESUMED"
    | "INVALID_SESSION"
    | "HEARTBEAT"
    | "HEARTBEAT_ACK"
    | "DISPATCH"
    | "PRESENCE"
    | string
  t?: string
  /** DISPATCH 帧携带：会话内从 1 起递增的序列号（resume 续传游标） */
  s?: number
  d?: unknown
}

/** 注意：字段名是 heartbeat_interval_ms（服务端 protocol.go helloData） */
export type HelloData = { heartbeat_interval_ms: number }

/** READY presences 条目（顶层扁平视图与 guilds[].presences 元素同构） */
export type PresenceEntry = {
  user_id: string
  status: PresenceStatus
  custom_text?: string
}

/** READY read_states 条目（服务端为每个可见频道下发精确未读数） */
export type ReadyReadState = {
  channel_id: string
  last_read_message_id: string
  mention_count: number
  /** 该频道当前最新消息 ID（字符串雪花，无消息为 "0"） */
  last_message_id?: string
  /** 服务端按 last_read_message_id 聚合出的普通未读消息数 */
  unread_count?: number
}

/** READY guilds 数组元素（snapshot.Guild：按可见性过滤的全量快照） */
export type ReadyGuild = {
  guild: Guild
  channels: Channel[]
  roles: unknown[]
  /** 服务器多 banner 列表（position 升序） */
  banners?: GuildBanner[]
  member: MemberSnapshot
  voice_states: VoiceState[]
  presences: PresenceEntry[]
}

export type ReadyData = {
  session_id: string
  user: User
  guild_ids: string[]
  guilds?: ReadyGuild[]
  presences?: PresenceEntry[]
  read_states?: ReadyReadState[]
  /** Server-16 社交扩展 */
  relationships?: import("~/lib/api/social").Relationship[]
  privacy?: import("~/lib/api/social").PrivacySettings
  private_channels?: import("~/lib/api/social").PrivateChannel[]
  notification_unread_count?: number
}

/** 应用层关闭码 */
export const GatewayCloseCodes = {
  /** 连续两个心跳周期未收到 HEARTBEAT */
  HeartbeatDead: 4000,
  /** 超时未 IDENTIFY */
  IdentifyTimeout: 4001,
  /** 访问令牌无效 */
  AuthFailed: 4003,
  /** 同一 session 被新连接 RESUME 接管，旧连接关闭 */
  SessionReplaced: 4006,
  /** 发送队列积压（慢消费者） */
  SlowConsumer: 4008,
  /** RESUME 失败：session 不存在 / 超出回放窗口 / 用户不符 */
  InvalidSession: 4009,
} as const
