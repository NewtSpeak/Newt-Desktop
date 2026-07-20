// 服务器 / 频道 / 成员 / 邀请（clientapi resources.go）。

import { api } from "./http"
import type { Channel, Guild, GuildMember, MemberRecord } from "./types"

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
