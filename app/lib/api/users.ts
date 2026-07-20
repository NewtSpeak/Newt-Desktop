// 用户级数据：已读推进（ack）/ read state 快照 / 服务端设置文档（userapi 模块）。

import { api, qs } from "./http"

// ---------------------------------------------------------------------------
// 已读（docs 15 §7-1）
// ---------------------------------------------------------------------------

export type ReadStateRecord = {
  user_id: string
  channel_id: string
  guild_id: string
  /** 雪花 ID 字符串 */
  last_read_message_id: string
  mention_count: number
  updated_at: string
}

/** 频道已读推进：只前进不后退，清零 mention_count；无 VIEW 权限 404 */
export const ackChannel = (channelId: string, messageId: string) =>
  api<void>(`/channels/${channelId}/ack`, {
    method: "POST",
    body: JSON.stringify({ message_id: messageId }),
  })

/** 全服可见频道标记已读（Shift+Esc，docs 15 FR-02） */
export const ackGuild = (guildId: string) =>
  api<void>(`/guilds/${guildId}/ack`, { method: "POST" })

/** 本人 read state 快照（可按 guild 过滤；没有记录的频道不出现） */
export const getMyReadStates = (guildId?: string) =>
  api<{ read_states?: ReadStateRecord[] }>(
    `/users/@me/read-states${qs({ guild_id: guildId })}`,
  ).then((raw) => raw.read_states ?? [])

// ---------------------------------------------------------------------------
// 服务端用户设置文档（docs 16 §7-1）
// ---------------------------------------------------------------------------

export type UserSettingsDoc = Record<string, unknown>

/** 读取设置文档；从未写入返回 {} */
export const getMySettings = () =>
  api<{ settings: UserSettingsDoc; updated_at?: string }>("/users/@me/settings")

/** 整体替换设置文档（≤64KB）→ 204，触发 USER_SETTINGS_UPDATE */
export const putMySettings = (settings: UserSettingsDoc) =>
  api<void>("/users/@me/settings", { method: "PUT", body: JSON.stringify(settings) })

/** 顶层 key 合并（null 删 key）→ 200 返回合并后文档 */
export const patchMySettings = (patch: UserSettingsDoc) =>
  api<{ settings: UserSettingsDoc; updated_at?: string }>("/users/@me/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
