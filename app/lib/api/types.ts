// 用户端平面（/gapi/v1）的请求/响应 TS 类型。
// 字段与 Owl-Server 后端结构体的 json tag 一一对应：
//   - clientapi（auth/resources）、message、voice、stage 各模块的 handler；
//   - 消息 ID 为雪花 int64，后端以 `json:"id,string"` 序列化为字符串，前端一律按 string 处理。

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
  created_at?: string
  updated_at?: string
}

export type ChannelType = "TEXT" | "VOICE" | "CATEGORY"

export type Channel = {
  id: string
  guild_id: string
  name: string
  type: ChannelType
  /** 服务端当前模型未含 position 字段，预留：缺失时按 0 处理 */
  position?: number
  /** 所属分类（CATEGORY 的 id）；仅 TEXT/VOICE */
  parent_id?: string | null
  /** 频道最新消息雪花 ID（字符串，无消息为 "0"）；未读白点恢复用 */
  last_message_id?: string
  created_at?: string
  updated_at?: string
}

/** 创建邀请响应（POST /guilds/:id/invites） */
export type GuildInvite = {
  id: string
  guild_id: string
  code: string
  created_by: string
  expires_at?: string | null
  max_uses: number
  uses: number
  created_at?: string
  /** 部分列表接口会附带完整分享链接 */
  share_url?: string
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
}

/**
 * 角色名样式（Role.Style jsonb，customization/style.go）：
 * solid / linear / radial；colors 为 #RRGGBB。
 */
export type RoleNameStyle = {
  type?: "solid" | "linear" | "radial" | ""
  colors?: string[]
  angle?: number
  shape?: "circle" | "ellipse" | string
  animated?: boolean
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

/** 服务端 messageView 反应聚合（docs 05 FR-26）：count 为总数，me 标记调用者是否已反应 */
export type ReactionSummary = {
  emoji: string
  count: number
  /** 列表/单条 REST 带 viewer 时准确；Gateway MESSAGE_* 广播常省略或为 false */
  me?: boolean
}

export type Message = {
  /** 雪花 ID（后端序列化为字符串） */
  id: string
  guild_id: string
  channel_id: string
  author_id: string
  author_username: string
  type: MessageType
  content: string
  reply_to_id?: string
  attachments: MessageAttachment[]
  /** 被提及且确为本服成员的用户 ID（wire format <@UUID>） */
  mentions?: string[]
  /** 被提及且确为本服角色的角色 ID */
  mention_roles?: string[]
  /** 正文含 @everyone/@here 且作者具备 MENTION_EVERYONE 权限 */
  mention_everyone?: boolean
  /** 表情反应聚合；列表/单条拉取时服务端始终返回（可为空数组） */
  reactions?: ReactionSummary[]
  edit_count: number
  edited_at?: string
  nonce?: string
  created_at: string
  deleted_at?: string
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
