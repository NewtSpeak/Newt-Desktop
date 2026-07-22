// 「以身份查看」（docs 04 US-07 / UX-7）：
// 纯客户端复算：拉取各频道 overwrite，用目标角色/成员的 role_ids 投影 VIEW_CHANNEL。
// 需 MANAGE_ROLES 才能 list overwrites；仅作用于当前服已可见频道集合（服务端已过滤）。

import { create } from "zustand"

import { listChannelOverwrites } from "~/lib/api/guilds"
import type { Channel, ChannelOverwrite, GuildMember, Role } from "~/lib/api/types"
import {
  computeChannelPermissions,
  hasPermission,
  Permissions,
  toPermissionMask,
  type ChannelOverwriteInput,
  type RolePermissions,
} from "~/lib/permissions"
import { rolePermissionMask } from "~/stores/roles"

export type ViewAsTarget =
  | { kind: "role"; roleId: string; label: string }
  | { kind: "member"; userId: string; memberId: string; roleIds: string[]; label: string }

export type ViewAsSession = {
  guildId: string
  target: ViewAsTarget
  /** channelId → overwrites；加载中为 undefined */
  overwritesByChannel: Record<string, ChannelOverwrite[] | undefined>
  loading: boolean
  error: string | null
}

type ViewAsState = {
  session: ViewAsSession | null
  start: (
    guildId: string,
    target: ViewAsTarget,
    channelIds: string[],
  ) => Promise<void>
  stop: () => void
  /** 目标在某频道是否有 VIEW_CHANNEL（session 为空时恒 true） */
  canViewChannel: (
    channelId: string,
    roles: Role[] | undefined,
  ) => boolean
}

function toInputs(list: ChannelOverwrite[] | undefined): ChannelOverwriteInput[] {
  if (!list?.length) return []
  return list.map((o) => ({
    targetId: o.target_id,
    member: o.type === "MEMBER",
    allow: (() => {
      try {
        return toPermissionMask(o.allow_str ?? o.allow)
      } catch {
        return 0n
      }
    })(),
    deny: (() => {
      try {
        return toPermissionMask(o.deny_str ?? o.deny)
      } catch {
        return 0n
      }
    })(),
  }))
}

function roleInputsForTarget(
  roles: Role[] | undefined,
  target: ViewAsTarget,
): RolePermissions[] {
  if (!roles?.length) return []
  const assigned =
    target.kind === "role"
      ? new Set([target.roleId])
      : new Set(target.roleIds)
  return roles
    .filter((r) => r.is_everyone || assigned.has(r.id))
    .map((r) => ({
      id: r.id,
      permissions: rolePermissionMask(r),
      everyone: r.is_everyone,
    }))
}

export const useViewAsStore = create<ViewAsState>()((set, get) => ({
  session: null,

  start: async (guildId, target, channelIds) => {
    set({
      session: {
        guildId,
        target,
        overwritesByChannel: {},
        loading: true,
        error: null,
      },
    })
    const map: Record<string, ChannelOverwrite[] | undefined> = {}
    // 并行拉取；单频道失败记空数组（按仅角色并集估算）
    await Promise.all(
      channelIds.map(async (id) => {
        try {
          map[id] = await listChannelOverwrites(guildId, id)
        } catch {
          map[id] = []
        }
      }),
    )
    // 若中途已退出则丢弃
    const cur = get().session
    if (!cur || cur.guildId !== guildId) return
    set({
      session: {
        ...cur,
        overwritesByChannel: map,
        loading: false,
      },
    })
  },

  stop: () => set({ session: null }),

  canViewChannel: (channelId, roles) => {
    const session = get().session
    if (!session) return true
    if (session.loading) return true // 加载中暂不隐藏，避免闪烁
    const roleInputs = roleInputsForTarget(roles, session.target)
    // 若目标持有 ADMINISTRATOR，短路全可见
    let guildBits = 0n
    for (const r of roleInputs) guildBits |= r.permissions
    if (hasPermission(guildBits, Permissions.ADMINISTRATOR)) return true

    const ows = toInputs(session.overwritesByChannel[channelId])
    // member 覆盖的 target 是 member 记录 id
    const userKey =
      session.target.kind === "member"
        ? session.target.memberId
        : "__view_as_role__"
    const bits = computeChannelPermissions(
      false,
      userKey,
      roleInputs,
      ows,
    )
    return hasPermission(bits, Permissions.VIEW_CHANNEL)
  },
}))

/** 按「以身份查看」过滤频道列表：分类仅在仍有可见子频道时保留 */
export function filterChannelsForViewAs(
  channels: Channel[],
  roles: Role[] | undefined,
  canView: (channelId: string) => boolean,
): Channel[] {
  const session = useViewAsStore.getState().session
  if (!session) return channels

  const visibleIds = new Set<string>()
  for (const c of channels) {
    if (c.type === "CATEGORY") continue
    if (canView(c.id)) visibleIds.add(c.id)
  }
  // 分类：有可见子频道则保留
  for (const c of channels) {
    if (c.type !== "CATEGORY") continue
    const hasChild = channels.some(
      (ch) => ch.parent_id === c.id && visibleIds.has(ch.id),
    )
    if (hasChild) visibleIds.add(c.id)
  }
  return channels.filter((c) => visibleIds.has(c.id))
}

export function viewAsLabel(session: ViewAsSession | null): string {
  if (!session) return ""
  return session.target.label
}

/** 从成员构造 ViewAsTarget */
export function viewAsFromMember(member: GuildMember): ViewAsTarget {
  return {
    kind: "member",
    userId: member.user_id,
    memberId: member.id,
    roleIds: member.role_ids ?? [],
    label:
      member.nickname?.trim() ||
      member.display_name?.trim() ||
      member.username,
  }
}

export function viewAsFromRole(role: Role): ViewAsTarget {
  return {
    kind: "role",
    roleId: role.id,
    label: role.is_everyone ? "@everyone" : role.name,
  }
}
