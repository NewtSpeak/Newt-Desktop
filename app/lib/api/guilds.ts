// 服务器 / 频道 / 成员 / 邀请（clientapi resources.go）。

import { api } from "./http"
import type { Channel, Guild, GuildMember, MemberRecord, Role } from "./types"

/** 我加入的服务器列表 */
export const listMyGuilds = () => api<Guild[]>("/users/@me/guilds")

/** 创建服务器（name 2-100 字符），创建者自动成为 owner 与成员 */
export const createGuild = (name: string) =>
  api<Guild>("/guilds", { method: "POST", body: JSON.stringify({ name }) })

/** 当前用户可见的频道列表；非成员/服不存在一律 404 */
export const listChannels = (guildId: string) => api<Channel[]>(`/guilds/${guildId}/channels`)

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

/** 封禁用户（需 BAN_MEMBERS + 层级；按 user_id，效果 = 移除成员 + 禁止再加入） */
export const banUser = (guildId: string, userId: string, reason?: string) =>
  api<void>(`/guilds/${guildId}/bans/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ reason: reason ?? "" }),
  })
