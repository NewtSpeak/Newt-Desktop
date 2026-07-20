// 用户端平面（/gapi/v1）的请求/响应 TS 类型。
// 字段与 Owl-Server 后端结构体的 json tag 一一对应：
//   - clientapi（auth/resources）、message、voice、stage 各模块的 handler；
//   - 消息 ID 为雪花 int64，后端以 `json:"id,string"` 序列化为字符串，前端一律按 string 处理。

// ---------------------------------------------------------------------------
// 用户与鉴权
// ---------------------------------------------------------------------------

export type User = {
  id: string
  username: string
  email: string
  system_admin: boolean
  is_bot: boolean
  avatar_url: string
  avatar_animated: boolean
  banner_url: string
  accent_color: string
  created_at: string
  updated_at: string
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

export type Guild = {
  id: string
  name: string
  owner_user_id: string
  created_at?: string
  updated_at?: string
}

export type ChannelType = "TEXT" | "VOICE"

export type Channel = {
  id: string
  guild_id: string
  name: string
  type: ChannelType
  /** 服务端当前模型未含 position 字段，预留：缺失时按 0 处理 */
  position?: number
  created_at?: string
  updated_at?: string
}

export type GuildMember = {
  id: string
  user_id: string
  username: string
  nickname: string
  is_owner: boolean
  role_ids: string[]
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
  // stage 模块增量字段（VOICE_STATE_UPDATE 第二形态，按 user_id 合并；本期仅存储）
  stage_role?: StageRole | null
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
export type StageSeatResult = { status: "SPEAKER" | "AUDIENCE"; idempotent?: boolean }

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
