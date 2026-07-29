// 服务器内展示名：统一走 nickname 优先级 + 角色昵称样式（颜色/渐变/加粗等）。

import { StyledDisplayName } from "~/components/styled-name"
import type { GuildMember, Role } from "~/lib/api/types"
import { resolveMemberNameStyle } from "~/lib/name-style"
import { memberDisplayName } from "~/lib/user-display"
import { useMembersStore } from "~/stores/members"
import { useRolesStore } from "~/stores/roles"
import { cn } from "~/lib/utils"

type MemberLike = Pick<
  GuildMember,
  "user_id" | "nickname" | "display_name" | "username" | "role_ids" | "name_style_role_id"
>

/**
 * 在服务器上下文中渲染用户名。
 * - 优先用传入的 member；否则按 guildId + userId 从 store 取
 * - 样式：resolveMemberNameStyle（角色 style / color）
 * - 文案：memberDisplayName（nickname > display_name > username）
 */
export function MemberStyledName({
  guildId,
  userId,
  member: memberProp,
  roles: rolesProp,
  name: nameOverride,
  className,
  fallback = "未知用户",
  prefix,
}: {
  guildId?: string | null
  userId?: string | null
  member?: MemberLike | null
  roles?: Role[] | null
  /** 覆盖显示文案（仍套用角色样式） */
  name?: string
  className?: string
  fallback?: string
  prefix?: string
}) {
  const storeMember = useMembersStore((s) => {
    if (memberProp || !guildId || !userId || guildId === "@me") return undefined
    return s.byGuild[guildId]?.find((m) => m.user_id === userId)
  })
  const storeRoles = useRolesStore((s) => {
    if (rolesProp || !guildId || guildId === "@me") return undefined
    return s.byGuild[guildId]
  })

  const member = memberProp ?? storeMember
  const roles = rolesProp ?? storeRoles
  const name =
    nameOverride?.trim() ||
    (member ? memberDisplayName(member) : "") ||
    fallback
  const style =
    guildId && guildId !== "@me"
      ? resolveMemberNameStyle(member, roles)
      : null

  return (
    <StyledDisplayName
      name={name}
      style={style}
      prefix={prefix}
      className={cn(className)}
    />
  )
}
