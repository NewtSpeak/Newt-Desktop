// 服级机器人管理（/gapi/v1/guilds/:gid/bots）：服主或 MANAGE_BOTS 创建本服独属 bot。

import { api } from "./http"

export type GuildBot = {
  id: string
  user_id: string
  owner_user_id?: string
  /** 非空 = 本服独属；缺省/null 可能为平台级安装 */
  home_guild_id?: string | null
  name: string
  description: string
  avatar_url: string
  username: string
  member_id: string
  role_ids: string[]
  created_at?: string
  updated_at?: string
}

export type BotTokenMeta = {
  id: string
  bot_id: string
  name: string
  prefix: string
  last_used_at?: string | null
  expires_at?: string | null
  revoked_at?: string | null
  created_at: string
}

export type CreateGuildBotInput = {
  name: string
  username: string
  description?: string
  avatar_url?: string
}

export const listGuildBots = (guildId: string) =>
  api<GuildBot[]>(`/guilds/${guildId}/bots`)

export const createGuildBot = (guildId: string, body: CreateGuildBotInput) =>
  api<GuildBot>(`/guilds/${guildId}/bots`, {
    method: "POST",
    body: JSON.stringify(body),
  })

export const updateGuildBot = (
  guildId: string,
  botId: string,
  body: { name?: string; description?: string; avatar_url?: string },
) =>
  api<GuildBot>(`/guilds/${guildId}/bots/${botId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })

/** 服级 bot 整档删除；平台 bot 仅卸载 */
export const deleteGuildBot = (guildId: string, botId: string) =>
  api<void>(`/guilds/${guildId}/bots/${botId}`, { method: "DELETE" })

export const listGuildBotTokens = (guildId: string, botId: string) =>
  api<{ tokens?: BotTokenMeta[] }>(
    `/guilds/${guildId}/bots/${botId}/tokens`,
  ).then((raw) => raw.tokens ?? [])

export const createGuildBotToken = (
  guildId: string,
  botId: string,
  body: { name?: string } = {},
) =>
  api<{ token: BotTokenMeta; plain: string }>(
    `/guilds/${guildId}/bots/${botId}/tokens`,
    { method: "POST", body: JSON.stringify(body) },
  )

export const revokeGuildBotToken = (
  guildId: string,
  botId: string,
  tokenId: string,
) =>
  api<void>(`/guilds/${guildId}/bots/${botId}/tokens/${tokenId}`, {
    method: "DELETE",
  })
