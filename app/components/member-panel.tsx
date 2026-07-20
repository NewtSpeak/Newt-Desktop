// 成员面板（docs 02 §3.7 FR-22/23，简化版）：
//   应用壳主内容区右侧可折叠 240px 面板，按在线/离线两组展示（presence 驱动，
//   离线沉底灰显）；条目 = 头像 + 状态点 + 昵称优先显示名 + owner 皇冠 +
//   管理员盾牌（role_ids 含管理员角色）。
//
// 成员点击菜单（DropdownMenu）：资料摘要（头像/用户名/角色名列表）+ 管理操作——
//   - 设为管理员 / 移除管理员：对「管理员」角色 PUT/DELETE member role，
//     乐观更新 + 失败回滚 toast；入口仅当自己是 owner 或有 ADMINISTRATOR
//     且目标不是 owner/自己时显示（本地预判，服务端兜底裁决）；
//   - 踢出 / 封禁：按 KICK_MEMBERS / BAN_MEMBERS 位预判显隐，红色确认弹窗
//     （封禁带原因输入）；403 toast 提示、404 按“已不存在”收敛。

import { useEffect, useMemo, useState } from "react"
import { CrownIcon, ShieldIcon } from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import { Input } from "~/components/ui/input"
import { presenceDotClass } from "~/components/nav-user"
import {
  assignMemberRole,
  banUser,
  kickMember,
  removeMemberRole,
} from "~/lib/api/guilds"
import { ApiError, isNotFound } from "~/lib/api/http"
import type { GuildMember, Role } from "~/lib/api/types"
import { hasPermission, Permissions } from "~/lib/permissions"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useMembersStore } from "~/stores/members"
import { effectiveSelfStatus, usePresenceStore } from "~/stores/presence"
import {
  findAdminRole,
  memberGuildPermissions,
  memberIsAdmin,
  useRolesStore,
} from "~/stores/roles"
import { useUIStore } from "~/stores/ui"

function memberInitials(name: string): string {
  return name.trim().slice(0, 2) || "?"
}

function displayName(member: GuildMember): string {
  return member.nickname || member.username || member.user_id.slice(0, 6)
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  return fallback
}

type ConfirmState =
  | { kind: "kick"; member: GuildMember }
  | { kind: "ban"; member: GuildMember }
  | null

// ---------------------------------------------------------------------------
// 成员条目 + 菜单
// ---------------------------------------------------------------------------

function MemberRow({
  guildId,
  member,
  roles,
  self,
  onKick,
  onBan,
}: {
  guildId: string
  member: GuildMember
  roles: Role[] | undefined
  self: GuildMember | undefined
  onKick: (member: GuildMember) => void
  onBan: (member: GuildMember) => void
}) {
  const selfId = useAuthStore((state) => state.user?.id)
  const presence = usePresenceStore((state) => state.statusByUser[member.user_id])
  const isSelf = member.user_id === selfId
  const status = isSelf ? effectiveSelfStatus() : presence
  const online = isSelf || Boolean(presence)
  const isAdmin = memberIsAdmin(member, roles)
  const name = displayName(member)

  // 本地权限预判（服务端兜底裁决）：owner 或 ADMINISTRATOR 才能任命管理员
  const adminRole = findAdminRole(roles)
  const selfPerms = memberGuildPermissions(self, roles)
  const canAppoint =
    Boolean(adminRole) &&
    (Boolean(self?.is_owner) || hasPermission(selfPerms, Permissions.ADMINISTRATOR))
  const canKick = hasPermission(selfPerms, Permissions.KICK_MEMBERS)
  const canBan = hasPermission(selfPerms, Permissions.BAN_MEMBERS)
  // 对自己 / owner 不显示管理区块
  const manageable = !isSelf && !member.is_owner
  const showManage = manageable && (canAppoint || canKick || canBan)

  const roleNames = (roles ?? [])
    .filter((role) => !role.is_everyone && member.role_ids.includes(role.id))
    .map((role) => role.name)

  // 管理员任命/移除：乐观更新 role_ids，失败回滚 + toast
  const toggleAdmin = async (makeAdmin: boolean) => {
    if (!adminRole) return
    const previous = member.role_ids
    const next = makeAdmin
      ? [...previous, adminRole.id]
      : previous.filter((id) => id !== adminRole.id)
    useMembersStore.getState().upsertMember(guildId, {
      user_id: member.user_id,
      role_ids: next,
    })
    try {
      if (makeAdmin) await assignMemberRole(guildId, member.id, adminRole.id)
      else await removeMemberRole(guildId, member.id, adminRole.id)
    } catch (error) {
      useMembersStore.getState().upsertMember(guildId, {
        user_id: member.user_id,
        role_ids: previous,
      })
      toast.error(
        errorMessage(error, makeAdmin ? "设为管理员失败" : "移除管理员失败"),
      )
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent",
          online ? "text-sidebar-foreground/90" : "opacity-50",
        )}
      >
        <span className="relative shrink-0">
          <Avatar className="size-7">
            <AvatarFallback className="text-[10px]">
              {memberInitials(name)}
            </AvatarFallback>
          </Avatar>
          <span
            className={cn(
              "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-sidebar",
              presenceDotClass(status),
            )}
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{name}</span>
        {member.is_owner && (
          <CrownIcon
            aria-label="服务器所有者"
            className="size-3.5 shrink-0 text-amber-500"
          />
        )}
        {!member.is_owner && isAdmin && (
          <ShieldIcon
            aria-label="管理员"
            className="size-3.5 shrink-0 text-sky-500"
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56" side="left" align="start">
        {/* 资料摘要（GroupLabel 必须位于 Group 内，否则 Base UI 抛缺少上下文错误） */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5">
              <Avatar className="size-9">
                <AvatarFallback className="text-xs">
                  {memberInitials(name)}
                </AvatarFallback>
              </Avatar>
              <div className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-sm font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  @{member.username || member.user_id.slice(0, 8)}
                </span>
              </div>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <div className="px-2 pb-1.5 text-xs text-muted-foreground">
          {member.is_owner ? "服务器所有者" : null}
          {member.is_owner && roleNames.length > 0 ? " · " : null}
          {roleNames.length > 0 ? `角色：${roleNames.join("、")}` : null}
          {!member.is_owner && roleNames.length === 0 ? "暂无角色" : null}
        </div>

        {showManage && (
          <>
            <DropdownMenuSeparator />
            {canAppoint &&
              (isAdmin ? (
                <DropdownMenuItem onClick={() => void toggleAdmin(false)}>
                  <ShieldIcon className="size-4" />
                  移除管理员
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => void toggleAdmin(true)}>
                  <ShieldIcon className="size-4" />
                  设为管理员
                </DropdownMenuItem>
              ))}
            {canKick && (
              <DropdownMenuItem variant="destructive" onClick={() => onKick(member)}>
                踢出服务器
              </DropdownMenuItem>
            )}
            {canBan && (
              <DropdownMenuItem variant="destructive" onClick={() => onBan(member)}>
                封禁
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------------------------------------------------------------------------
// 面板
// ---------------------------------------------------------------------------

export function MemberPanel() {
  const open = useUIStore((state) => state.memberPanelOpen)
  const guildId = useUIStore((state) => state.selectedGuildId)
  const selfId = useAuthStore((state) => state.user?.id)
  const members = useMembersStore((state) =>
    guildId ? state.byGuild[guildId] : undefined,
  )
  const roles = useRolesStore((state) => (guildId ? state.byGuild[guildId] : undefined))
  const statusByUser = usePresenceStore((state) => state.statusByUser)

  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [banReason, setBanReason] = useState("")
  const [pending, setPending] = useState(false)

  // 选中服务器变化时拉取成员与角色（members 在频道列表已拉，这里兜底幂等）
  useEffect(() => {
    if (!guildId || !open) return
    void useMembersStore.getState().fetchMembers(guildId).catch(() => undefined)
    void useRolesStore.getState().fetchRoles(guildId).catch(() => undefined)
  }, [guildId, open])

  const { onlineMembers, offlineMembers, self } = useMemo(() => {
    const list = members ?? []
    const online: GuildMember[] = []
    const offline: GuildMember[] = []
    for (const member of list) {
      // 本人恒显示在在线组（隐身时他人视角由服务端掩码，自己知道自己在线）
      if (member.user_id === selfId || statusByUser[member.user_id]) online.push(member)
      else offline.push(member)
    }
    const byName = (a: GuildMember, b: GuildMember) =>
      displayName(a).localeCompare(displayName(b), "zh-Hans-CN")
    online.sort(byName)
    offline.sort(byName)
    return {
      onlineMembers: online,
      offlineMembers: offline,
      self: list.find((member) => member.user_id === selfId),
    }
  }, [members, statusByUser, selfId])

  if (!open || !guildId) return null

  const closeConfirm = () => {
    setConfirm(null)
    setBanReason("")
  }

  // 踢出/封禁执行：404 按“成员已不存在”收敛（本地移除，不报错）
  const executeConfirm = async () => {
    if (!confirm) return
    const { kind, member } = confirm
    setPending(true)
    try {
      if (kind === "kick") await kickMember(guildId, member.id)
      else await banUser(guildId, member.user_id, banReason.trim() || undefined)
      useMembersStore.getState().removeMember(guildId, member.user_id)
      toast.success(
        kind === "kick"
          ? `已将「${displayName(member)}」移出服务器`
          : `已封禁「${displayName(member)}」`,
      )
      closeConfirm()
    } catch (error) {
      if (isNotFound(error)) {
        useMembersStore.getState().removeMember(guildId, member.user_id)
        closeConfirm()
      } else {
        toast.error(errorMessage(error, kind === "kick" ? "踢出失败" : "封禁失败"))
      }
    } finally {
      setPending(false)
    }
  }

  const renderGroup = (label: string, list: GuildMember[]) =>
    list.length > 0 && (
      <div className="flex flex-col gap-0.5">
        <p className="px-2 pt-3 pb-1 text-xs font-medium text-sidebar-foreground/60 select-none">
          {label} — {list.length}
        </p>
        {list.map((member) => (
          <MemberRow
            key={member.user_id}
            guildId={guildId}
            member={member}
            roles={roles}
            self={self}
            onKick={(target) => setConfirm({ kind: "kick", member: target })}
            onBan={(target) => setConfirm({ kind: "ban", member: target })}
          />
        ))}
      </div>
    )

  return (
    <aside className="flex w-60 shrink-0 flex-col border-l bg-sidebar text-sidebar-foreground">
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {members === undefined ? (
          <p className="px-2 pt-3 text-xs text-sidebar-foreground/60">成员加载中…</p>
        ) : (
          <>
            {renderGroup("在线", onlineMembers)}
            {renderGroup("离线", offlineMembers)}
          </>
        )}
      </div>

      {/* 踢出 / 封禁确认弹窗（危险操作红色按钮，docs 02 UI/UX-1） */}
      <Dialog open={confirm !== null} onOpenChange={(next) => !next && closeConfirm()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === "ban" ? "封禁成员" : "踢出成员"}
            </DialogTitle>
            <DialogDescription>
              {confirm
                ? confirm.kind === "ban"
                  ? `封禁「${displayName(confirm.member)}」将把其移出服务器，且无法凭邀请再次加入。`
                  : `确定将「${displayName(confirm.member)}」移出服务器？其可凭邀请重新加入。`
                : null}
            </DialogDescription>
          </DialogHeader>
          {confirm?.kind === "ban" && (
            <Input
              value={banReason}
              onChange={(event) => setBanReason(event.target.value)}
              placeholder="封禁原因（可选）"
              maxLength={512}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeConfirm} disabled={pending}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => void executeConfirm()}
              disabled={pending}
            >
              {confirm?.kind === "ban" ? "封禁" : "踢出"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
