// 用户展示名与资料资源 URL 工具。
// 展示优先级（docs 01 FR-14）：服务器昵称 > 系统显示名 > 用户名。

import { resolveApiUrl } from "~/lib/api/http"
import type { GuildMember, User, VoiceState } from "~/lib/api/types"

/** 成员在频道/列表中的显示名 */
export function memberDisplayName(
  member: Pick<GuildMember, "nickname" | "display_name" | "username" | "user_id">,
): string {
  const nick = member.nickname?.trim()
  if (nick) return nick
  const display = member.display_name?.trim()
  if (display) return display
  const username = member.username?.trim()
  if (username) return username
  return member.user_id.slice(0, 6)
}

/** 当前用户 / 全局资料卡显示名（无服内昵称） */
export function userDisplayName(
  user: Pick<User, "display_name" | "username"> | null | undefined,
): string {
  if (!user) return "用户"
  const display = user.display_name?.trim()
  if (display) return display
  return user.username?.trim() || "用户"
}

/**
 * 语音参与者显示名：成员缓存 > VoiceState 附带资料 > 本人 auth 资料 > 兜底。
 * 避免成员列表未加载时只显示 UUID 片段。
 */
export function voiceParticipantDisplayName(
  state: Pick<VoiceState, "user_id" | "nickname" | "display_name" | "username">,
  member?: Pick<GuildMember, "nickname" | "display_name" | "username" | "user_id"> | null,
  self?: Pick<User, "id" | "display_name" | "username"> | null,
): string {
  if (member) {
    const name = memberDisplayName(member)
    if (name && name !== member.user_id.slice(0, 6)) return name
    if (member.username?.trim()) return member.username.trim()
  }
  const nick = state.nickname?.trim()
  if (nick) return nick
  const display = state.display_name?.trim()
  if (display) return display
  const username = state.username?.trim()
  if (username) return username
  if (self?.id === state.user_id) return userDisplayName(self)
  return `用户${state.user_id.slice(0, 6)}`
}

/** 语音参与者头像 URL（成员缓存 / VoiceState / 本人） */
export function voiceParticipantAvatarUrl(
  state: Pick<VoiceState, "user_id" | "avatar_url">,
  member?: Pick<GuildMember, "avatar_url" | "user_id"> | null,
  self?: Pick<User, "id" | "avatar_url"> | null,
): string | undefined {
  return resolveProfileAssetUrl(
    member?.avatar_url ||
      state.avatar_url ||
      (self?.id === state.user_id ? self.avatar_url : undefined),
  )
}

/** 头像/横幅等公开资产路径 → 当前服务器绝对 URL */
export function resolveProfileAssetUrl(path: string | undefined | null): string | undefined {
  const value = path?.trim()
  if (!value) return undefined
  return resolveApiUrl(value)
}

/** 名字首字母（头像 fallback） */
export function nameInitials(name: string): string {
  return name.trim().slice(0, 2) || "?"
}
