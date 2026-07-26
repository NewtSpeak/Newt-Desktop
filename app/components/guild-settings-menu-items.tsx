// 右键菜单中的「服务器个人设置 / 服务器设置」入口。
// 频道很多时，侧栏空白处或服务器图标可能不在视口内，需在频道/分类右键中也能打开。

import { useMemo } from "react"
import { SettingsIcon, SlidersHorizontalIcon } from "lucide-react"

import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "~/components/ui/context-menu"
import { canOpenGuildAdmin } from "~/components/guild-settings/guild-settings-panel"
import { useAuthStore } from "~/stores/auth"
import { useMembersStore } from "~/stores/members"
import { memberGuildPermissions, useRolesStore } from "~/stores/roles"
import { useUIStore } from "~/stores/ui"

export function useCanOpenGuildAdmin(guildId: string): boolean {
  const selfId = useAuthStore((s) => s.user?.id)
  const systemAdmin = useAuthStore((s) => s.user?.system_admin)
  const self = useMembersStore((s) =>
    s.byGuild[guildId]?.find((m) => m.user_id === selfId),
  )
  const roles = useRolesStore((s) => s.byGuild[guildId])
  return useMemo(() => {
    if (systemAdmin) return true
    const perms = memberGuildPermissions(self, roles)
    return canOpenGuildAdmin(perms, Boolean(self?.is_owner))
  }, [self, roles, systemAdmin])
}

/**
 * 插入分隔线 + 个人设置 +（有权限时）服务器设置。
 * 个人设置任意成员可见；服务器设置需 canOpenGuildAdmin。
 */
export function GuildSettingsContextMenuItems({
  guildId,
  /** 是否在本段前加分隔线（默认 true） */
  withSeparator = true,
}: {
  guildId: string
  withSeparator?: boolean
}) {
  const canOpenAdmin = useCanOpenGuildAdmin(guildId)

  return (
    <>
      {withSeparator ? <ContextMenuSeparator /> : null}
      <ContextMenuItem
        onClick={() => useUIStore.getState().openGuildPersonal(guildId)}
      >
        <SlidersHorizontalIcon />
        服务器个人设置
      </ContextMenuItem>
      {canOpenAdmin ? (
        <ContextMenuItem
          onClick={() => useUIStore.getState().openGuildAdmin(guildId)}
        >
          <SettingsIcon />
          服务器设置
        </ContextMenuItem>
      ) : null}
    </>
  )
}
