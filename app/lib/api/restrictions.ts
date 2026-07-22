// 多维限制 API（docs 08 / restriction）。

import { api, qs } from "./http"

export type RestrictionScope =
  | "TEXT_CHANNEL"
  | "VOICE_CHANNEL"
  | "GUILD_ALL_TEXT"
  | "GUILD_ALL_VOICE"

export type RestrictionKind = "SANCTION" | "CHANNEL_BAN"

export type DenyFlags = {
  view_text?: boolean
  send_text?: boolean
  listen_voice?: boolean
  speak_voice?: boolean
}

export type Restriction = {
  id: string
  guild_id: string
  target_user_id: string
  scope: RestrictionScope | string
  channel_id?: string | null
  deny: DenyFlags
  kind: RestrictionKind | string
  reason?: string
  expires_at?: string | null
  created_by?: string | null
  created_at: string
  lifted_at?: string | null
  lifted_by?: string | null
  active: boolean
}

export type CreateRestrictionInput = {
  target_user_id: string
  scope: RestrictionScope | string
  channel_id?: string | null
  deny: DenyFlags
  kind: RestrictionKind | string
  reason?: string
  /** RFC3339；永久则省略 */
  expires_at?: string | null
}

/** 限制列表（需 MODERATE_MEMBERS） */
export const listRestrictions = (
  guildId: string,
  query: {
    user_id?: string
    channel_id?: string
    scope?: string
    active?: boolean
  } = {},
) =>
  api<Restriction[]>(
    `/guilds/${guildId}/restrictions${qs({
      user_id: query.user_id,
      channel_id: query.channel_id,
      scope: query.scope,
      active:
        query.active === undefined
          ? undefined
          : query.active
            ? "true"
            : "false",
    })}`,
  )

/** 创建限制 */
export const createRestriction = (
  guildId: string,
  input: CreateRestrictionInput,
) =>
  api<Restriction>(`/guilds/${guildId}/restrictions`, {
    method: "POST",
    body: JSON.stringify(input),
  })

/** 提前解除限制 */
export const liftRestriction = (guildId: string, restrictionId: string) =>
  api<void>(`/guilds/${guildId}/restrictions/${restrictionId}`, {
    method: "DELETE",
  })

/** 更新限制（仅 reason / expires_at；scope/target 不可改） */
export const patchRestriction = (
  guildId: string,
  restrictionId: string,
  patch: { reason?: string; expires_at?: string | null },
) =>
  api<Restriction>(`/guilds/${guildId}/restrictions/${restrictionId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
