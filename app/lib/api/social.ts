// 社交层 API：隐私 / 好友关系 / 通知收件箱（Server-16）。

import { api, qs } from "./http"

// ---------------------------------------------------------------------------
// 隐私
// ---------------------------------------------------------------------------

export type FriendRequestFrom =
  | "everyone"
  | "mutual_friends"
  | "mutual_guilds"
  | "nobody"

export type DmFrom = "everyone" | "friends" | "mutual_guilds" | "nobody"

export type PrivacySettings = {
  friend_request_from: FriendRequestFrom
  dm_from: DmFrom
  message_request_filter: boolean
  show_mutual_guilds: boolean
  public_profile_to_non_friends: boolean
  guild_overrides: Record<string, { allow_dm: boolean }>
}

export const getPrivacy = () => api<PrivacySettings>("/users/@me/privacy")

export const patchPrivacy = (
  patch: Partial<{
    friend_request_from: FriendRequestFrom
    dm_from: DmFrom
    message_request_filter: boolean
    show_mutual_guilds: boolean
    public_profile_to_non_friends: boolean
  }>,
) =>
  api<PrivacySettings>("/users/@me/privacy", {
    method: "PATCH",
    body: JSON.stringify(patch),
  })

export const putGuildPrivacy = (guildId: string, allowDm: boolean) =>
  api<{ guild_id: string; allow_dm: boolean }>(
    `/users/@me/guilds/${guildId}/privacy`,
    {
      method: "PUT",
      body: JSON.stringify({ allow_dm: allowDm }),
    },
  )

// ---------------------------------------------------------------------------
// 关系
// ---------------------------------------------------------------------------

export type RelationshipType =
  | "friend"
  | "pending_outgoing"
  | "pending_incoming"
  | "blocked"

export type RelationshipUser = {
  id: string
  username: string
  display_name?: string
  avatar_url?: string
  /** 个性签名（若关系列表/READY 附带则直接用） */
  bio?: string
  /** 个人资料横幅（若关系列表/READY 附带则直接用） */
  banner_url?: string
  /** 主题色（无横幅时的卡片底色回退） */
  accent_color?: string
}

export type Relationship = {
  id: string
  type: RelationshipType
  nickname?: string
  user: RelationshipUser
  created_at: string
}

export const listRelationships = () =>
  api<{ relationships?: Relationship[] }>("/users/@me/relationships").then(
    (r) => r.relationships ?? [],
  )

export const sendFriendRequest = (input: {
  username?: string
  user_id?: string
}) =>
  api<Relationship>("/users/@me/relationships", {
    method: "POST",
    body: JSON.stringify(input),
  })

export const acceptFriendRequest = (userId: string) =>
  api<Relationship>(`/users/@me/relationships/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ type: "friend" }),
  })

export const blockUser = (userId: string) =>
  api<Relationship>(`/users/@me/relationships/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ type: "blocked" }),
  })

export const patchRelationshipNickname = (userId: string, nickname: string) =>
  api<Relationship>(`/users/@me/relationships/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ nickname }),
  })

/** 删好友 / 取消请求 / 忽略请求 / 解除屏蔽 */
export const deleteRelationship = (userId: string) =>
  api<void>(`/users/@me/relationships/${userId}`, { method: "DELETE" })

// ---------------------------------------------------------------------------
// 通知收件箱
// ---------------------------------------------------------------------------

export type NotificationItem = {
  id: string
  type: string
  payload: Record<string, unknown>
  created_at: string
  read: boolean
}

export const listNotifications = (opts?: {
  before?: string
  limit?: number
}) =>
  api<{
    items: NotificationItem[]
    has_more: boolean
    next_cursor?: string
    unread_count: number
  }>(
    `/users/@me/notifications${qs({
      before: opts?.before,
      limit: opts?.limit,
    })}`,
  )

export const ackNotifications = (lastReadId: string) =>
  api<{ unread_count: number }>("/users/@me/notifications/ack", {
    method: "POST",
    body: JSON.stringify({ last_read_id: lastReadId }),
  })

export const deleteNotification = (id: string) =>
  api<void>(`/users/@me/notifications/${id}`, { method: "DELETE" })

// ---------------------------------------------------------------------------
// 私信频道（Server-16 BR.2）
// ---------------------------------------------------------------------------

export type PrivateChannelRecipient = RelationshipUser

export type PrivateChannelLastMessage = {
  id: string
  author_id: string
  content: string
  type?: string
  created_at?: string
}

/** 1:1 拉黑状态（服务端 privateChannelView.block_state） */
export type DmBlockState = "" | "blocked_by_me" | "blocked_by_peer"

export type PrivateChannel = {
  id: string
  type: "DM" | "GROUP_DM"
  name?: string
  recipients: PrivateChannelRecipient[]
  last_message_id?: string
  /** 当前用户在该私信中的服务端已读游标 */
  last_read_message_id?: string
  /** 当前用户在该私信中的未读提及数 */
  mention_count?: number
  /** 服务端按已读游标聚合出的精确未读消息数 */
  unread_count?: number
  /** 列表副标题预览 */
  last_message?: PrivateChannelLastMessage
  message_request: boolean
  hidden: boolean
  created_at: string
  /** 1:1 拉黑：blocked_by_me=我拉黑对方；blocked_by_peer=对方拉黑我 */
  block_state?: DmBlockState
}

export const listPrivateChannels = (opts?: { filter?: "message_request" }) =>
  api<{ channels?: PrivateChannel[] }>(
    `/users/@me/channels${qs({ filter: opts?.filter })}`,
  ).then((r) => r.channels ?? [])

/** 1:1 DM get-or-create */
export const openDmChannel = (recipientId: string) =>
  api<PrivateChannel>("/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({ recipient_id: recipientId }),
  })

/** 群组私信：recipients 为其他成员 user_id（不含自己，2–9 人） */
export const createGroupDm = (recipientIds: string[], name?: string) =>
  api<PrivateChannel>("/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({
      recipients: recipientIds,
      name: name?.trim() || undefined,
    }),
  })

export const patchDmRecipientMe = (
  channelId: string,
  body: { hidden?: boolean; message_request?: boolean },
) =>
  api<PrivateChannel>(`/channels/${channelId}/recipients/@me`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })

/** 离开群组私信 */
export const leaveGroupDm = (channelId: string) =>
  api<void>(`/channels/${channelId}/recipients/@me`, { method: "DELETE" })

/** 群组私信改名（挂在 @me 下，避免与服频道 PATCH 冲突） */
export const renameGroupDm = (channelId: string, name: string) =>
  api<PrivateChannel>(`/users/@me/channels/${channelId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  })
/** 邀请好友进群组私信 */
export const inviteToGroupDm = (channelId: string, userId: string) =>
  api<PrivateChannel>(`/channels/${channelId}/recipients/${userId}`, {
    method: "PUT",
  })
