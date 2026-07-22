// 客户端侧管理员能力判定与语音管理 API 封装（UI 显隐预判，服务端仍为最终裁决）。

import { toast } from "sonner"

import {
  disconnectVoiceUser,
  patchServerVoiceState,
} from "~/lib/api/voice"
import { ApiError } from "~/lib/api/http"
import type { GuildMember, Role, VoiceState, User } from "~/lib/api/types"
import { hasPermission, Permissions } from "~/lib/permissions"
import {
  memberGuildPermissions,
  memberIsAdmin,
} from "~/stores/roles"
import { useVoiceStore } from "~/stores/voice"

export type AdminCaps = {
  /** 是否显示管理员菜单段 */
  isModerator: boolean
  /** 系统管理员 */
  systemAdmin: boolean
  canMute: boolean
  canDeafen: boolean
  canDisconnect: boolean
  canKick: boolean
  canBan: boolean
  canManageRoles: boolean
  canManageNicknames: boolean
  /** 多维限制（超时/禁言等，MODERATE_MEMBERS） */
  canModerateMembers: boolean
}

/** 根据本人身份与角色计算管理能力 */
export function computeAdminCaps(
  self: GuildMember | undefined,
  roles: Role[] | undefined,
  user: Pick<User, "system_admin"> | null | undefined,
): AdminCaps {
  const perms = memberGuildPermissions(self, roles)
  const systemAdmin = Boolean(user?.system_admin)
  const isOwner = Boolean(self?.is_owner)
  const isAdminRole = memberIsAdmin(self, roles)
  const canMute =
    systemAdmin || isOwner || hasPermission(perms, Permissions.MUTE_MEMBERS)
  const canDeafen =
    systemAdmin || isOwner || hasPermission(perms, Permissions.DEAFEN_MEMBERS)
  const canDisconnect =
    systemAdmin ||
    isOwner ||
    hasPermission(perms, Permissions.MOVE_MEMBERS) ||
    hasPermission(perms, Permissions.MUTE_MEMBERS)
  const canKick =
    systemAdmin || isOwner || hasPermission(perms, Permissions.KICK_MEMBERS)
  const canBan =
    systemAdmin || isOwner || hasPermission(perms, Permissions.BAN_MEMBERS)
  const canManageRoles =
    systemAdmin || isOwner || hasPermission(perms, Permissions.MANAGE_ROLES)
  const canManageNicknames =
    systemAdmin ||
    isOwner ||
    hasPermission(perms, Permissions.MANAGE_NICKNAMES)
  const canModerateMembers =
    systemAdmin ||
    isOwner ||
    hasPermission(perms, Permissions.MODERATE_MEMBERS)
  const isModerator =
    systemAdmin ||
    isOwner ||
    isAdminRole ||
    hasPermission(perms, Permissions.ADMINISTRATOR) ||
    canMute ||
    canDeafen ||
    canDisconnect ||
    canKick ||
    canBan ||
    canModerateMembers

  return {
    isModerator,
    systemAdmin,
    canMute,
    canDeafen,
    canDisconnect,
    canKick,
    canBan,
    canManageRoles,
    canManageNicknames,
    canModerateMembers,
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  return fallback
}

/** 切换服务器静音；成功后把 VOICE_STATE 写回 store */
export async function toggleServerMute(
  guildId: string,
  userId: string,
  next: boolean,
): Promise<boolean> {
  try {
    const state = await patchServerVoiceState(guildId, userId, {
      server_mute: next,
    })
    useVoiceStore.getState().applyVoiceStateUpdate(state)
    toast.success(next ? "已服务器静音" : "已解除服务器静音")
    return true
  } catch (error) {
    toast.error(errorMessage(error, "服务器静音操作失败"))
    return false
  }
}

/** 切换服务器禁听（耳聋）；开启时同步禁言实现「双向禁止」 */
export async function toggleServerDeaf(
  guildId: string,
  userId: string,
  next: boolean,
): Promise<boolean> {
  try {
    const patch = next
      ? { server_deaf: true, server_mute: true }
      : { server_deaf: false }
    const state = await patchServerVoiceState(guildId, userId, patch)
    useVoiceStore.getState().applyVoiceStateUpdate(state)
    toast.success(next ? "已禁听（并禁言）" : "已解除禁听")
    return true
  } catch (error) {
    toast.error(errorMessage(error, "禁听操作失败"))
    return false
  }
}

/** 管理员踢出语音 */
export async function adminDisconnectVoice(
  guildId: string,
  userId: string,
): Promise<boolean> {
  try {
    await disconnectVoiceUser(guildId, userId)
    // 本地从所有频道移除该用户语音状态
    useVoiceStore.getState().applyVoiceStateUpdate({
      user_id: userId,
      channel_id: null,
      connected: false,
    } as VoiceState)
    toast.success("已将用户踢出语音")
    return true
  } catch (error) {
    toast.error(errorMessage(error, "踢出语音失败"))
    return false
  }
}

/** 音量预设（%） */
export const VOLUME_PRESETS = [0, 25, 50, 75, 100, 125, 150, 200] as const
