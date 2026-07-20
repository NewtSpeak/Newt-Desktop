// 角色 store：按 guild 分组缓存角色列表（docs 02 §3.7 / docs 04）。
//
// 数据流：
//   - 选中服务器时 fetchRoles 全量拉取（GET /guilds/:gid/roles）；
//   - GUILD_ROLE_CREATE/UPDATE/DELETE 事件：已有缓存的服重拉对齐
//     （事件 payload 只带 id/name/permissions 片段，不足以增量重建完整角色对象）；
//   - 成员 role_ids 的增量维护在 members store（GUILD_MEMBER_UPDATE 已接）。
//
// 本地权限预判仅用于 UI 显隐（服务端仍是最终裁决，403/404 收敛）。

import { create } from "zustand"

import { listRoles } from "~/lib/api/guilds"
import { isNotFound } from "~/lib/api/http"
import type { GuildMember, Role } from "~/lib/api/types"
import {
  computeGuildPermissions,
  hasPermission,
  Permissions,
  toPermissionMask,
  type RolePermissions,
} from "~/lib/permissions"

type RolesState = {
  byGuild: Record<string, Role[]>
  /** 404（服不可见）返回 null 并清缓存 */
  fetchRoles: (guildId: string) => Promise<Role[] | null>
  removeGuild: (guildId: string) => void
  reset: () => void
}

export const useRolesStore = create<RolesState>()((set, get) => ({
  byGuild: {},

  fetchRoles: async (guildId) => {
    try {
      const roles = await listRoles(guildId)
      set((state) => ({ byGuild: { ...state.byGuild, [guildId]: roles } }))
      return roles
    } catch (error) {
      if (isNotFound(error)) {
        get().removeGuild(guildId)
        return null
      }
      throw error
    }
  },

  removeGuild: (guildId) =>
    set((state) => {
      const { [guildId]: _, ...rest } = state.byGuild
      return { byGuild: rest }
    }),

  reset: () => set({ byGuild: {} }),
}))

// ---------------------------------------------------------------------------
// 派生工具（纯函数，组件与通知管线共用）
// ---------------------------------------------------------------------------

/** 角色权限掩码 → BigInt（int64 JSON number/string 兼容，异常回退 0n） */
export function rolePermissionMask(role: Role): bigint {
  try {
    return toPermissionMask(role.permissions)
  } catch {
    return 0n
  }
}

/**
 * 服务端内置「管理员」角色：优先按 managed 标记识别；
 * 兜底取第一个（position 最低的）带 ADMINISTRATOR 位的非 @everyone 角色。
 */
export function findAdminRole(roles: Role[] | undefined): Role | undefined {
  if (!roles?.length) return undefined
  const managed = roles.find(
    (role) =>
      role.managed && hasPermission(rolePermissionMask(role), Permissions.ADMINISTRATOR),
  )
  if (managed) return managed
  return roles.find(
    (role) =>
      !role.is_everyone &&
      hasPermission(rolePermissionMask(role), Permissions.ADMINISTRATOR),
  )
}

/** 成员的服级权限（owner 短路 / 角色并集含 @everyone / ADMINISTRATOR 短路） */
export function memberGuildPermissions(
  member: Pick<GuildMember, "is_owner" | "role_ids"> | undefined,
  roles: Role[] | undefined,
): bigint {
  if (!member) return 0n
  const inputs: RolePermissions[] = (roles ?? [])
    .filter((role) => role.is_everyone || member.role_ids.includes(role.id))
    .map((role) => ({
      id: role.id,
      permissions: rolePermissionMask(role),
      everyone: role.is_everyone,
    }))
  return computeGuildPermissions(member.is_owner, inputs)
}

/** 成员是否持有「管理员」身份（role_ids 含管理员角色） */
export function memberIsAdmin(
  member: Pick<GuildMember, "role_ids"> | undefined,
  roles: Role[] | undefined,
): boolean {
  if (!member) return false
  const admin = findAdminRole(roles)
  return Boolean(admin && member.role_ids.includes(admin.id))
}
