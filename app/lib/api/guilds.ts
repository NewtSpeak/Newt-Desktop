// 服务器 / 频道 / 成员 / 邀请（clientapi resources.go）。

import { api } from "./http"
import type {
  Channel,
  ChannelType,
  Guild,
  GuildInvite,
  GuildMember,
  MemberRecord,
  Role,
} from "./types"

/** 我加入的服务器列表 */
export const listMyGuilds = () => api<Guild[]>("/users/@me/guilds")

/** 创建服务器（name 2-100 字符），创建者自动成为 owner 与成员 */
export const createGuild = (name: string) =>
  api<Guild>("/guilds", { method: "POST", body: JSON.stringify({ name }) })

/** 当前用户可见的频道列表；非成员/服不存在一律 404 */
export const listChannels = (guildId: string) => api<Channel[]>(`/guilds/${guildId}/channels`)

export type CreateChannelInput = {
  name: string
  type: ChannelType
  topic?: string
  position?: number
  parent_id?: string | null
  user_limit?: number
  rate_limit_per_user?: number
}

/** 创建频道 / 分类（需 MANAGE_CHANNELS）；type=CATEGORY 时为创建类别 */
export const createChannel = (guildId: string, input: CreateChannelInput) =>
  api<Channel>(`/guilds/${guildId}/channels`, {
    method: "POST",
    body: JSON.stringify(input),
  })

/** 批量排序频道 / 类别（需 MANAGE_CHANNELS）；支持跨分类移动 parent_id */
export type ChannelReorderItem = {
  id: string
  position: number
  /** null / 省略 = 根级；分类 id = 归入该类别 */
  parent_id?: string | null
}

export const reorderChannels = (guildId: string, items: ChannelReorderItem[]) =>
  api<void>(`/guilds/${guildId}/channels`, {
    method: "PATCH",
    body: JSON.stringify(items),
  })

/** 创建服务器邀请（需 CREATE_INSTANT_INVITE）；不传参 = 不过期、不限次 */
export const createGuildInvite = (
  guildId: string,
  input?: { ttl_seconds?: number; max_uses?: number },
) => {
  const body: Record<string, number> = {}
  // 后端 binding：ttl_seconds min=60；max_uses min=1；0/缺省表示不限
  if (input?.ttl_seconds && input.ttl_seconds >= 60) {
    body.ttl_seconds = input.ttl_seconds
  }
  if (input?.max_uses && input.max_uses >= 1) {
    body.max_uses = input.max_uses
  }
  return api<GuildInvite>(`/guilds/${guildId}/invites`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}
/** 服务器成员列表（需本人是成员） */
export const listMembers = (guildId: string) => api<GuildMember[]>(`/guilds/${guildId}/members`)

/** 凭邀请码加入服务器；404 无效/过期、403 BANNED；已是成员幂等返回 200 */
export const joinInvite = (code: string) =>
  api<MemberRecord>(`/invites/${encodeURIComponent(code)}/join`, { method: "POST" })

/** 服务器全量角色（成员即可见） */
export const listRoles = (guildId: string) => api<Role[]>(`/guilds/${guildId}/roles`)

/** 给成员绑定角色（需 MANAGE_ROLES + 层级；memberId 为成员记录 ID，非 user_id） */
export const assignMemberRole = (guildId: string, memberId: string, roleId: string) =>
  api<void>(`/guilds/${guildId}/members/${memberId}/roles/${roleId}`, { method: "PUT" })

/** 解绑成员角色（同 assignMemberRole 语义） */
export const removeMemberRole = (guildId: string, memberId: string, roleId: string) =>
  api<void>(`/guilds/${guildId}/members/${memberId}/roles/${roleId}`, { method: "DELETE" })

/** 踢出成员（需 KICK_MEMBERS + 层级；memberId 为成员记录 ID） */
export const kickMember = (guildId: string, memberId: string) =>
  api<void>(`/guilds/${guildId}/members/${memberId}`, { method: "DELETE" })

/** 主动退出服务器（所有者不可退，需先转让；路径 @me） */
export const leaveGuild = (guildId: string) =>
  api<void>(`/guilds/${guildId}/members/@me`, { method: "DELETE" })

/** 修改成员昵称（本人 CHANGE_NICKNAME / 他人 MANAGE_NICKNAMES；空串清空） */
export const updateMemberNickname = (
  guildId: string,
  memberId: string,
  nickname: string,
) =>
  api<void>(`/guilds/${guildId}/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify({ nickname }),
  })

/** 封禁用户（需 BAN_MEMBERS + 层级；按 user_id，效果 = 移除成员 + 禁止再加入） */
export const banUser = (guildId: string, userId: string, reason?: string) =>
  api<void>(`/guilds/${guildId}/bans/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ reason: reason ?? "" }),
  })

/** 解封（需 BAN_MEMBERS） */
export const unbanUser = (guildId: string, userId: string) =>
  api<void>(`/guilds/${guildId}/bans/${userId}`, { method: "DELETE" })

export type GuildBan = {
  id?: string
  guild_id?: string
  user_id: string
  reason?: string
  created_by?: string
  created_at?: string
}

/** 封禁列表（需 BAN_MEMBERS） */
export const listBans = (guildId: string) =>
  api<GuildBan[] | { bans?: GuildBan[]; items?: GuildBan[] }>(
    `/guilds/${guildId}/bans`,
  ).then((raw) => {
    if (Array.isArray(raw)) return raw
    return raw.bans ?? raw.items ?? []
  })
