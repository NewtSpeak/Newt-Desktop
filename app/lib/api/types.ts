// 用户端平面（/gapi/v1）的请求/响应 TS 类型。
// 字段与 Newt-Server 后端结构体的 json tag 一一对应：
//   - clientapi（auth/resources）、message、voice、stage 各模块的 handler；
//   - 消息 ID 为雪花 int64，后端以 `json:"id,string"` 序列化为字符串，前端一律按 string 处理。

import type { EquippedSlot } from "./cosmetics"

// ---------------------------------------------------------------------------
// 用户与鉴权
// ---------------------------------------------------------------------------

/** 平台身份徽章（登录 / @me / READY 附带；系统所有者自动拥有） */
export type PlatformBadge = {
  id: string
  kind: string
  name: string
  description: string
  emoji: string
  color: string
  badge_id?: string
  granted_at?: string
  expires_at?: string | null
}

export type User = {
  id: string
  username: string
  email: string
  system_admin: boolean
  is_bot: boolean
  /** 显示名（1–32）；空串表示未设置，展示回退用户名 */
  display_name: string
  /** 个性签名 / About Me（≤190） */
  bio: string
  avatar_url: string
  avatar_animated: boolean
  banner_url: string
  accent_color: string
  /** 平台徽章（如系统所有者 👑）；登录与 GET @me 返回 */
  badges?: PlatformBadge[]
  created_at: string
  updated_at: string
}

/** 他人公开资料（GET /users/:id；不含 email 等私有字段） */
export type PublicUserProfile = {
  id: string
  username: string
  display_name: string
  avatar: string
  avatar_animated?: boolean
  banner?: string
  accent_color?: string
  bio: string
  /** 已装备装扮（full 模式含全部槽位；slot -> 装备视图） */
  cosmetics?: Record<string, EquippedSlot>
  /** 活跃度等级（0 = 无记录） */
  activity_level?: number
}

export type TokenResponse = {
  access_token: string
  refresh_token: string
  access_expires_at: string
  refresh_expires_at: string
  user: User
}

// ---------------------------------------------------------------------------
// 服务器 / 频道 / 成员
// ---------------------------------------------------------------------------

/** 服务器 banner（多张有序；docs 协议/服务器外观资产.md） */
export type GuildBanner = {
  id: string
  guild_id: string
  /** 公开访问路径（/public-assets/profile/...），不可变可长缓存 */
  url: string
  /** 展示顺序（0 起连续升序） */
  position: number
  created_at?: string
  updated_at?: string
}

export type Guild = {
  id: string
  name: string
  description?: string
  owner_user_id: string
  /** 服务器图标公开 URL（/public-assets/profile/...），空串表示未设置 */
  icon_url?: string
  /** 兼容旧单张 banner；多张时优先 banners 列表 */
  banner_url?: string
  /** 多 banner 列表（position 升序）；列表/READY/GUILD_UPDATE 可携带 */
  banners?: GuildBanner[]
  /**
   * 默认着陆文字频道 id（进服且未选频道时优先打开）。
   * null/缺省 = 未配置，客户端回退到侧栏第一个可见 TEXT 频道。
   */
  default_channel_id?: string | null
  /**
   * 归属账号 id（客户端多账号字段，非服务端返回）。
   * 用于 API 鉴权上下文与频道列表身份头像。
   */
  account_id?: string
  created_at?: string
  updated_at?: string
}

export type ChannelType = "TEXT" | "VOICE" | "CATEGORY"

export type Channel = {
  id: string
  guild_id: string
  name: string
  type: ChannelType
  /** 频道主题 / 简介 */
  topic?: string
  /** 语音频道人数上限（0 = 不限） */
  user_limit?: number
  /** 文本慢速模式秒数 */
  rate_limit_per_user?: number
  /** 慢速模式豁免角色；为空表示对所有成员生效 */
  rate_limit_exempt_role_ids?: string[]
  /** 是否允许发送限定可见消息（默认 true） */
  allow_restricted_visibility?: boolean
  /** 发送时未指定可见范围则套用的默认身份组 */
  default_visible_role_ids?: string[]
  /** 强制使用默认可见范围，忽略客户端选择 */
  force_default_visibility?: boolean
  /** 服务端当前模型未含 position 字段，预留：缺失时按 0 处理 */
  position?: number
  /** 所属分类（CATEGORY 的 id）；仅 TEXT/VOICE */
  parent_id?: string | null
  /** 是否设置了访问密码（服务端不下发哈希） */
  locked?: boolean
  /** 语音频道活动注释（列表在线成员区顶部展示） */
  voice_note?: string
  /** 频道最新消息雪花 ID（字符串，无消息为 "0"）；未读白点恢复用 */
  last_message_id?: string
  created_at?: string
  updated_at?: string
}

/** 频道权限覆盖（list overwrites 响应） */
export type ChannelOverwrite = {
  id: string
  channel_id: string
  type: "ROLE" | "MEMBER"
  target_id: string
  target_name?: string
  allow: number | string
  deny: number | string
  allow_str?: string
  deny_str?: string
}

/** 创建邀请响应 / 列表项（POST|GET /guilds/:id/invites） */
export type GuildInvite = {
  id: string
  guild_id: string
  code: string
  created_by: string
  expires_at?: string | null
  max_uses: number
  uses: number
  created_at?: string
  /** 列表接口附带完整分享链接 */
  share_url?: string
  /** 列表接口附带深链（桌面唤起） */
  deep_link?: string
}

export type GuildMember = {
  id: string
  user_id: string
  username: string
  /** 系统显示名（全局）；展示优先级：nickname > display_name > username */
  display_name?: string
  nickname: string
  avatar_url?: string
  avatar_animated?: boolean
  banner_url?: string
  bio?: string
  is_owner: boolean
  role_ids: string[]
  /**
   * 本人选用的用户名样式来源角色 ID；空 = 自动取持有角色中最高有样式者。
   * 仅影响展示，不改变角色绑定。
   */
  name_style_role_id?: string | null
  /** 装扮精简投影（头像框 + 铭牌）；完整槽位见 cosmetics store */
  cosmetics?: Record<
    string,
    {
      item_id: string
      category_key: string
      slot: string
      name: string
      assets: Record<
        string,
        {
          id: string
          url: string
          mime: string
          width: number
          height: number
          animated: boolean
          size_bytes: number
        }
      >
      payload: Record<string, unknown>
      render_hint?: string
    }
  >
}

/**
 * 角色名样式（Role.Style jsonb，customization/style.go）：
 * solid / linear / radial；colors 为 #RRGGBB；
 * speed 流动周期秒；icon_sync / icon 色点；badge 角色徽章。
 */
export type RoleSurfaceStyle = {
  type?: "solid" | "linear" | "radial" | ""
  colors?: string[]
  /** 暗色主题独立配色（数量规则同 colors）；空则亮暗共用 colors */
  colors_dark?: string[]
  angle?: number
  shape?: "circle" | "ellipse" | string
  animated?: boolean
  /** 流动动画周期（秒），0.5–20，默认 4 */
  speed?: number
}

/** 文字装饰 */
export type RoleTextDecor = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}

/** 角色徽章（消息流/成员列表标签） */
export type RoleBadgeStyle = RoleTextDecor & {
  enabled?: boolean
  background?: RoleSurfaceStyle
  /** 背景图（可与渐变叠加） */
  background_image_url?: string
  icon_url?: string
  show_name?: boolean
  text_color?: string
}

export type RoleNameStyle = RoleSurfaceStyle &
  RoleTextDecor & {
    /** 色点与文字合并样式 */
    icon_sync?: boolean
    /** 独立色点样式（icon_sync=false 时） */
    icon?: RoleSurfaceStyle
    /** 角色徽章 */
    badge?: RoleBadgeStyle
  }

/** 服务器角色（model.Role；permissions 为 int64 位掩码，JSON 序列化为 number） */
export type Role = {
  id: string
  guild_id: string
  name: string
  permissions: number | string
  position: number
  is_everyone: boolean
  /** 服务端内置托管角色（如「管理员」，permissions 为 ADMINISTRATOR）；普通角色缺省 */
  managed?: boolean
  /** 基础色 #RRGGBB（成员列表/用户名着色） */
  color?: string
  /** 高级用户名样式 JSON 字符串或对象 */
  style?: string | RoleNameStyle
  hoist?: boolean
  mentionable?: boolean
  created_at?: string
  updated_at?: string
}

/** joinInvite 返回 Member 记录（201 新加入 / 200 幂等已是成员） */
export type MemberRecord = {
  id: string
  guild_id: string
  user_id: string
  nickname?: string
  created_at?: string
}

// ---------------------------------------------------------------------------
// 消息 / 附件 / 编辑历史 / 搜索
// ---------------------------------------------------------------------------

export type AttachmentPreviewKind = "image" | "video" | "audio" | ""

export type MessageAttachment = {
  id: string
  filename: string
  mime: string
  size: number
  /** 预览白名单类型，空表示仅可下载 */
  preview?: AttachmentPreviewKind
  /** 短时签名下载 URL（已含 /gapi/v1 前缀，相对路径） */
  download_url: string
}

export type MessageType = string

/** 系统管理员临场发言（adminpresence）；客户端特殊头像/徽章渲染 */
export const MESSAGE_TYPE_SYSTEM_ADMIN = "SYSTEM_ADMIN" as const

/** 贴图消息（docs 17）：正文为空、恰一张 sticker */
export const MESSAGE_TYPE_STICKER = "STICKER" as const

/** 群组私信系统灰条（Server-16 BN.5） */
export const MESSAGE_TYPE_SYSTEM_RECIPIENT_ADD = "SYSTEM_RECIPIENT_ADD" as const
export const MESSAGE_TYPE_SYSTEM_RECIPIENT_REMOVE =
  "SYSTEM_RECIPIENT_REMOVE" as const
export const MESSAGE_TYPE_SYSTEM_CHANNEL_NAME_CHANGE =
  "SYSTEM_CHANNEL_NAME_CHANGE" as const

export function isGroupDmSystemMessage(type: string | undefined): boolean {
  return (
    type === MESSAGE_TYPE_SYSTEM_RECIPIENT_ADD ||
    type === MESSAGE_TYPE_SYSTEM_RECIPIENT_REMOVE ||
    type === MESSAGE_TYPE_SYSTEM_CHANNEL_NAME_CHANGE ||
    type === "SYSTEM"
  )
}

/** 服务端 messageView 反应聚合（docs 05 FR-26）：count 为总数，me 标记调用者是否已反应 */
export type ReactionSummary = {
  emoji: string
  count: number
  /** 列表/单条 REST 带 viewer 时准确；Gateway MESSAGE_* 广播常省略或为 false */
  me?: boolean
}

/** 消息内贴图/表情快照（docs 17） */
export type MessageStickerRef = {
  item_id: string
  pack_id: string
  mark: string
  kind?: "emote" | "sticker"
  animated?: boolean
  asset_url?: string
  width?: number
  height?: number
}

export type Message = {
  /** 雪花 ID（后端序列化为字符串） */
  id: string
  guild_id: string
  channel_id: string
  author_id: string
  author_username: string
  /** 作者是否为机器人（messageView 透出，BOT 徽标） */
  author_is_bot?: boolean
  type: MessageType
  content: string
  reply_to_id?: string
  attachments: MessageAttachment[]
  /** 贴图消息载荷（type=STICKER 时长度 1） */
  sticker_items?: MessageStickerRef[]
  /** 被提及且确为本服成员的用户 ID（wire format <@UUID>） */
  mentions?: string[]
  /** 被提及且确为本服角色的角色 ID */
  mention_roles?: string[]
  /** 正文含 @everyone/@here 且作者具备 MENTION_EVERYONE 权限 */
  mention_everyone?: boolean
  /** 表情反应聚合；列表/单条拉取时服务端始终返回（可为空数组） */
  reactions?: ReactionSummary[]
  /**
   * 流式消息状态（bot 专项）：
   * - `"STREAMING"`：生成中，正文随 MESSAGE_STREAM_DELTA 增长
   * - 缺省 / 空串：普通消息或已收束
   */
  stream_status?: "" | "STREAMING" | string
  /**
   * 卡片载荷（bot 专项）：服务端 JSON 对象透传（≤16KB）。
   * buttons 键由服务端解析校验并按接收者裁剪（设计文档 2026-07-26），
   * 其余键渲染 schema 由客户端约定（lib/bot-card.ts）。
   */
  card?: unknown
  /**
   * ephemeral 定向可见名单（bot 专项，设计文档 2026-07-26）：
   * 非空 = 仅名单用户 + 作者可见（服务端已过滤，能收到即代表本人可见）。
   * 此类消息不计未读、不可回复/反应、刷新后仍在（历史按 viewer 过滤）。
   */
  visible_to?: string[]
  /**
   * 限定可见身份组；空/省略 = 公开（频道 VIEW 即可）。
   * 非空时仅作者、持有任一角色的成员、MANAGE_MESSAGES 可见。
   * 与 visible_user_ids 取并集。
   */
  visible_role_ids?: string[]
  /**
   * 限定可见用户（服内成员 user_id）；空/省略 = 不额外限定用户。
   * 与 visible_role_ids 任一非空即启用限定可见；作者始终可见。
   */
  visible_user_ids?: string[]
  edit_count: number
  edited_at?: string
  nonce?: string
  created_at: string
  deleted_at?: string
}

/** 是否为 ephemeral（仅指定用户可见）消息 */
export function isEphemeralMessage(
  message: Pick<Message, "visible_to">
): boolean {
  return Array.isArray(message.visible_to) && message.visible_to.length > 0
}

// ---------------------------------------------------------------------------
// 贴图与表情包（docs 17）
// ---------------------------------------------------------------------------

export type StickerKind = "emote" | "sticker"
export type StickerPackScope = "account" | "guild"
export type StickerPackStatus =
  | "active"
  | "soft_deleted"
  | "soft_deleted_expired"
  | "globally_banned"
  | "purged"

export type StickerPack = {
  id: string
  owner_user_id: string
  scope: StickerPackScope
  guild_id?: string
  kind: StickerKind
  name: string
  description?: string
  cover_item_id?: string
  cover_asset_id?: string
  /** 服务端解析：自定义上传 > 指定条目 > 包内首条 */
  cover_url?: string
  /** 是否为用户上传的独立封面 */
  cover_custom?: boolean
  allow_browse_full: boolean
  status: StickerPackStatus
  soft_deleted_at?: string
  restore_deadline?: string
  item_count?: number
  items?: StickerItem[]
  created_at: string
  updated_at: string
}

export type StickerItem = {
  id: string
  pack_id: string
  kind: StickerKind
  name?: string
  content_hash: string
  mark: string
  asset_id: string
  asset_url: string
  width: number
  height: number
  animated: boolean
  source_item_id?: string
  source_pack_id?: string
  sort_order: number
  status: "active" | "purged"
  created_at: string
  updated_at: string
}

export type StickerLibraryEntry = {
  pack_id: string
  status: "active" | "hidden"
  installed_at: string
  sort_order: number
  pack?: StickerPack
}

export type GuildStickerPackBan = {
  guild_id: string
  pack_id: string
  banned_by: string
  reason?: string
  created_at: string
}

/** 正文内嵌小表情 wire format：`<e:item_id:mark>` */
export function customEmoteWire(itemId: string, mark: string): string {
  return `<e:${itemId}:${mark}>`
}

/** 自定义反应路径键：`item:{item_id}` */
export function customReactionKey(itemId: string): string {
  return `item:${itemId}`
}

export type MessageEdit = {
  id: string
  message_id: string
  version: number
  content: string
  editor_id: string
  edited_at: string
}

export type PresignResult = {
  attachment_id: string
  /** 本地存储实现下为 PUT /gapi/v1/attachments/{id}/content?token= 相对地址 */
  upload_url: string
  expires_at: string
  preview: AttachmentPreviewKind
}

export type UploadResult = {
  attachment_id: string
  size: number
  uploaded: boolean
}

export type SearchMessagesParams = {
  q: string
  guild_id?: string
  channel_id?: string
  author_id?: string
  /** 雪花消息 ID 游标 */
  before?: string
  after?: string
  limit?: number
}

// ---------------------------------------------------------------------------
// 入场语音包（只读）
// ---------------------------------------------------------------------------

export type VoicePackScope = string
export type VoicePackTrigger = string

export type GuildVoicePackConfig = {
  guild_id: string
  enabled?: boolean
  audio_url?: string
  scope?: VoicePackScope
  trigger?: VoicePackTrigger
}

export type ChannelVoicePackConfig = {
  guild_id?: string
  channel_id?: string
  enabled?: boolean
  audio_url?: string
}

// ---------------------------------------------------------------------------
// 语音
// ---------------------------------------------------------------------------

export type VoiceState = {
  id: string
  guild_id: string
  user_id: string
  channel_id?: string | null
  node_id?: string | null
  room_id?: string | null
  voice_session_id?: string | null
  self_mute: boolean
  self_deaf: boolean
  server_mute: boolean
  server_deaf: boolean
  connected: boolean
  joined_at?: string | null
  created_at?: string
  updated_at?: string
  /** 展示字段（listVoiceStates / VOICE_STATE_UPDATE 附带，成员缓存未就绪时用） */
  username?: string
  display_name?: string
  avatar_url?: string
  nickname?: string
  // stage 模块增量字段（VOICE_STATE_UPDATE 第二形态，按 user_id 合并）
  stage_role?: StageRoleWire | null
  capacity_muted?: boolean
  self_stream?: boolean
}

/** Media Token caps 列表（如 ["join","publish_audio","subscribe_audio"]，服务端裁决结果，客户端只读） */
export type VoiceCaps = string[]

export type VoiceJoinRequest = {
  guild_id: string
  channel_id: string
  self_mute?: boolean
  self_deaf?: boolean
}

export type VoiceJoinResult = {
  token: string
  node_id: string
  room_id: string
  /** SFU 客户端信令 WSS 端点（advertise_wss_url 为规范字段，sfu_endpoint 为兼容别名） */
  advertise_wss_url: string
  sfu_endpoint: string
  caps: VoiceCaps
  session_id: string
  ice_servers?: unknown[]
  expires_at?: number | string
  /** 切频道时返回 */
  move?: boolean
  previous_channel_id?: string
  force_reconnect?: boolean
}

export type VoiceLeaveResult = { left: boolean }

export type VoiceTokenRefreshResult = {
  token: string
  caps: VoiceCaps
  /** Unix 秒 */
  expires_at: number
}

export type SelfVoiceStatePatch = {
  guild_id: string
  self_mute?: boolean
  self_deaf?: boolean
}

export type RTTSample = { node_id: string; rtt_ms: number }
export type RTTReportResult = { stored: number; ttl_seconds: number }

export type VoicePublicKey = {
  algorithm: string
  keys: { kid: string; public_key_base64: string; public_key_pem: string }[]
  token_ttl_seconds: number
}

// ---------------------------------------------------------------------------
// 舞台 / 屏幕共享
// ---------------------------------------------------------------------------

export type VoiceChannelMode = "FREE_DISCUSSION" | "STAGE"
export type StageRole = "AUDIENCE" | "QUEUED" | "SPEAKER"
/** 线上形态：FREE 模式服务端返回空串（stage/authority.go RoleNone = ""） */
export type StageRoleWire = StageRole | "NONE" | ""

export type StageConfig = {
  guild_id?: string
  channel_id?: string
  mode: VoiceChannelMode
  max_speakers: number
  request_to_speak_enabled: boolean
  allow_co_mod_change_mode?: boolean
}

export type StageConfigPatch = {
  mode?: VoiceChannelMode
  max_speakers?: number
  request_to_speak_enabled?: boolean
  allow_co_mod_change_mode?: boolean
  co_moderator_ids?: string[]
  max_concurrent_screens?: number
}

export type StageQueueSource = "USER_APPLY" | "CAPACITY_QUEUE" | "ADMIN"

export type StageQueueBrief = {
  position: number
  user_id: string
  name?: string
}

export type StageQueueExtendedEntry = {
  position: number
  user_id: string
  source?: StageQueueSource
  requested_at?: string
}

export type StageQueueResult = {
  channel_id: string
  queue: StageQueueBrief[]
  /** 仅队列管理者可见 */
  queue_extended?: StageQueueExtendedEntry[]
}

export type StageApplyResult = { status: "QUEUED"; idempotent: boolean }
export type StageSeatResult = {
  status: "SPEAKER" | "AUDIENCE"
  idempotent?: boolean
}

export type ScreenQuality = "480p" | "720p" | "1080p"

export type ScreenStartResult = {
  slot_id: string
  state: "RESERVED" | "ACTIVE"
  quality: string
  reservation_expires_at: string
}

export type ScreenQuota = {
  base_limit: number
  effective_limit: number
  dynamic_enabled: boolean
  dynamic_cap?: number
  used: number
}
