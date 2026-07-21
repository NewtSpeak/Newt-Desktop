// 成员面板（docs 02 §3.7 FR-22/23）：
//   右侧可折叠 240px 面板，按在线/离线分组；条目 = 头像 + 状态点 + 显示名 + 徽章。
//
// 成员点击菜单（Discord 风格资料卡，尽量丰富）：
//   - 横幅 / 大头像 / 显示名 / 用户名 / 状态 / 签名 / 彩色角色标签
//   - 复制用户 ID、复制用户名、复制 @提及 token
//   - 修改昵称（本人 CHANGE_NICKNAME / 他人 MANAGE_NICKNAMES）
//   - 身份组子菜单（MANAGE_ROLES 时复选分配，@everyone / managed 不可改）
//   - 设为/移除管理员、踢出、封禁
//   - 本人：编辑资料（打开设置）

import { useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"
import {
  AtSignIcon,
  BanIcon,
  CopyIcon,
  CrownIcon,
  HashIcon,
  LogOutIcon,
  PencilIcon,
  SettingsIcon,
  ShieldIcon,
  UserRoundIcon,
} from "lucide-react"
import { toast } from "sonner"

import { AdminMemberMenuSection } from "~/components/admin/admin-member-menu"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
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
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "~/components/ui/context-menu"
import { Input } from "~/components/ui/input"
import { presenceDotClass } from "~/components/nav-user"
import {
  assignMemberRole,
  banUser,
  kickMember,
  removeMemberRole,
  updateMemberNickname,
} from "~/lib/api/guilds"
import { ApiError, isNotFound } from "~/lib/api/http"
import { copyText } from "~/lib/clipboard"
import type { GuildMember, Role } from "~/lib/api/types"
import { hasPermission, Permissions } from "~/lib/permissions"
import {
  memberDisplayName,
  nameInitials,
  resolveProfileAssetUrl,
} from "~/lib/user-display"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useMembersStore } from "~/stores/members"
import type { PresenceStatus } from "~/lib/gateway/events"
import { effectiveSelfStatus, usePresenceStore } from "~/stores/presence"
import {
  findAdminRole,
  memberGuildPermissions,
  memberIsAdmin,
  useRolesStore,
} from "~/stores/roles"
import { useSettingsStore } from "~/stores/settings"
import { useUIStore } from "~/stores/ui"

function displayName(member: GuildMember): string {
  return memberDisplayName(member)
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  return fallback
}

function presenceLabel(status: string | undefined): string {
  switch (status) {
    case "online":
      return "在线"
    case "idle":
      return "闲置"
    case "dnd":
      return "勿扰"
    case "invisible":
      return "隐身"
    default:
      return "离线"
  }
}

/** 角色色 → 可读的 CSS 颜色；缺省用 muted */
function roleColorStyle(color: string | undefined): CSSProperties | undefined {
  if (!color?.trim()) return undefined
  const c = color.trim()
  if (c.startsWith("#") || c.startsWith("rgb") || c.startsWith("hsl") || c.startsWith("oklch")) {
    return { backgroundColor: c, color: "#fff" }
  }
  // 纯 hex 无 # 前缀
  if (/^[0-9a-fA-F]{3,8}$/.test(c)) {
    return { backgroundColor: `#${c}`, color: "#fff" }
  }
  return undefined
}

type ConfirmState =
  | { kind: "kick"; member: GuildMember }
  | { kind: "ban"; member: GuildMember }
  | null

// ---------------------------------------------------------------------------
// 成员条目 + 丰富资料卡菜单
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
  const status: PresenceStatus | undefined = isSelf
    ? effectiveSelfStatus()
    : presence
  const online = isSelf || Boolean(presence)
  const isAdmin = memberIsAdmin(member, roles)
  const name = displayName(member)
  const avatarSrc = resolveProfileAssetUrl(member.avatar_url)
  const bannerSrc = resolveProfileAssetUrl(member.banner_url)
  const username = member.username?.trim() || member.user_id.slice(0, 8)
  const globalDisplay = member.display_name?.trim()
  const nick = member.nickname?.trim()

  const adminRole = findAdminRole(roles)
  const selfPerms = memberGuildPermissions(self, roles)
  const canAppoint =
    Boolean(adminRole) &&
    (Boolean(self?.is_owner) ||
      hasPermission(selfPerms, Permissions.ADMINISTRATOR))
  const canKick = hasPermission(selfPerms, Permissions.KICK_MEMBERS)
  const canBan = hasPermission(selfPerms, Permissions.BAN_MEMBERS)
  const canManageRoles = hasPermission(selfPerms, Permissions.MANAGE_ROLES)
  const canEditNickname =
    (isSelf && hasPermission(selfPerms, Permissions.CHANGE_NICKNAME)) ||
    (!isSelf && hasPermission(selfPerms, Permissions.MANAGE_NICKNAMES))
  const manageable = !isSelf && !member.is_owner
  const showModeration = manageable && (canAppoint || canKick || canBan)

  const memberRoles = useMemo(
    () =>
      (roles ?? [])
        .filter((role) => !role.is_everyone && member.role_ids.includes(role.id))
        .sort((a, b) => b.position - a.position),
    [roles, member.role_ids],
  )

  const assignableRoles = useMemo(
    () =>
      (roles ?? [])
        .filter((role) => !role.is_everyone && !role.managed)
        .sort((a, b) => b.position - a.position),
    [roles],
  )

  const [nickOpen, setNickOpen] = useState(false)
  const [nickDraft, setNickDraft] = useState(nick ?? "")
  const [nickPending, setNickPending] = useState(false)
  const [rolePendingId, setRolePendingId] = useState<string | null>(null)

  const openNickDialog = () => {
    setNickDraft(nick ?? "")
    setNickOpen(true)
  }

  const saveNickname = async () => {
    setNickPending(true)
    const previous = member.nickname
    const next = nickDraft.trim()
    useMembersStore.getState().upsertMember(guildId, {
      user_id: member.user_id,
      nickname: next,
    })
    try {
      await updateMemberNickname(guildId, member.id, next)
      toast.success(next ? "昵称已更新" : "昵称已清除")
      setNickOpen(false)
    } catch (error) {
      useMembersStore.getState().upsertMember(guildId, {
        user_id: member.user_id,
        nickname: previous,
      })
      toast.error(errorMessage(error, "修改昵称失败"))
    } finally {
      setNickPending(false)
    }
  }

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
      toast.success(makeAdmin ? "已设为管理员" : "已移除管理员")
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

  const toggleRole = async (role: Role, assigned: boolean) => {
    setRolePendingId(role.id)
    const previous = member.role_ids
    const next = assigned
      ? previous.filter((id) => id !== role.id)
      : [...previous, role.id]
    useMembersStore.getState().upsertMember(guildId, {
      user_id: member.user_id,
      role_ids: next,
    })
    try {
      if (assigned) await removeMemberRole(guildId, member.id, role.id)
      else await assignMemberRole(guildId, member.id, role.id)
    } catch (error) {
      useMembersStore.getState().upsertMember(guildId, {
        user_id: member.user_id,
        role_ids: previous,
      })
      toast.error(errorMessage(error, assigned ? "移除角色失败" : "分配角色失败"))
    } finally {
      setRolePendingId(null)
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/70",
            online ? "text-foreground/90" : "opacity-50",
          )}
          onClick={(event) => {
            // 左键也打开同一右键菜单（合成 contextmenu 事件）
            event.currentTarget.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                clientX: event.clientX,
                clientY: event.clientY,
              }),
            )
          }}
        >
          <span className="relative shrink-0">
            <Avatar className="size-7 rounded-lg after:rounded-lg after:border-0">
              {avatarSrc && (
                <AvatarImage
                  src={avatarSrc}
                  alt={name}
                  className="rounded-lg object-cover"
                />
              )}
              <AvatarFallback className="rounded-lg text-[10px]">
                {nameInitials(name)}
              </AvatarFallback>
            </Avatar>
            <span
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background",
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
        </ContextMenuTrigger>

        <ContextMenuContent
          className="w-72 overflow-hidden p-0"
          side="left"
          align="start"
          sideOffset={8}
        >
          {/* —— 资料卡头部：横幅 + 头像 + 身份 —— */}
          <div className="relative">
            <div
              className={cn(
                "h-16 w-full",
                bannerSrc
                  ? "bg-muted"
                  : "bg-gradient-to-br from-sky-500/80 via-violet-500/70 to-fuchsia-500/60",
              )}
            >
              {bannerSrc ? (
                <img
                  src={bannerSrc}
                  alt=""
                  className="size-full object-cover"
                  draggable={false}
                />
              ) : null}
            </div>

            <div className="relative px-3 pb-2">
              {/* 头像压在横幅下沿，状态点独立于头像外 */}
              <div className="relative -mt-8 mb-2 size-16">
                <Avatar className="size-16 rounded-2xl ring-4 ring-popover after:rounded-2xl after:border-0">
                  {avatarSrc ? (
                    <AvatarImage
                      src={avatarSrc}
                      alt={name}
                      className="rounded-2xl object-cover"
                    />
                  ) : null}
                  <AvatarFallback className="rounded-2xl text-lg font-semibold">
                    {nameInitials(name)}
                  </AvatarFallback>
                </Avatar>
                <span
                  title={presenceLabel(status)}
                  className={cn(
                    "absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full ring-[3px] ring-popover",
                    presenceDotClass(status),
                  )}
                />
              </div>

              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-base font-semibold leading-tight">
                    {name}
                  </span>
                  {member.is_owner && (
                    <CrownIcon className="size-3.5 shrink-0 text-amber-500" />
                  )}
                  {!member.is_owner && isAdmin && (
                    <ShieldIcon className="size-3.5 shrink-0 text-sky-500" />
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  @{username}
                  {nick && globalDisplay ? ` · ${globalDisplay}` : null}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      presenceDotClass(status),
                    )}
                  />
                  {presenceLabel(status)}
                  {member.is_owner
                    ? " · 服务器所有者"
                    : isAdmin
                      ? " · 管理员"
                      : null}
                </p>
              </div>

              {member.bio?.trim() ? (
                <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                  {member.bio.trim()}
                </p>
              ) : null}

              {/* 角色彩色标签 */}
              {memberRoles.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {memberRoles.map((role) => (
                    <span
                      key={role.id}
                      className={cn(
                        "inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[10px] font-medium",
                        !role.color && "bg-muted text-muted-foreground",
                      )}
                      style={roleColorStyle(role.color)}
                      title={role.name}
                    >
                      {role.color ? (
                        <span className="size-1.5 shrink-0 rounded-full bg-white/90" />
                      ) : null}
                      <span className="truncate">{role.name}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground/70">
                  暂无身份组
                </p>
              )}
            </div>
          </div>

          <ContextMenuSeparator className="my-0" />

          {/* —— 快捷操作 —— */}
          <ContextMenuGroup className="p-1.5">
            <ContextMenuLabel className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              快捷操作
            </ContextMenuLabel>
            <ContextMenuItem
              onClick={() =>
                void copyText("提及", `<@${member.user_id}>`)
              }
            >
              <AtSignIcon />
              复制 @提及
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => void copyText("用户名", username)}
            >
              <UserRoundIcon />
              复制用户名
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => void copyText("用户 ID", member.user_id)}
            >
              <HashIcon />
              复制用户 ID
              <span className="ml-auto max-w-20 truncate font-mono text-[10px] text-muted-foreground">
                {member.user_id.slice(0, 8)}…
              </span>
            </ContextMenuItem>
            {isSelf ? (
              <ContextMenuItem
                onClick={() => useSettingsStore.getState().openPanel("profile")}
              >
                <SettingsIcon />
                编辑个人资料
              </ContextMenuItem>
            ) : null}
          </ContextMenuGroup>

          {(canEditNickname || (canManageRoles && assignableRoles.length > 0)) && (
            <>
              <ContextMenuSeparator className="my-0" />
              <ContextMenuGroup className="p-1.5">
                <ContextMenuLabel className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  成员管理
                </ContextMenuLabel>
                {canEditNickname ? (
                  <ContextMenuItem onClick={openNickDialog}>
                    <PencilIcon />
                    {isSelf ? "修改我的昵称" : "修改昵称"}
                    {nick ? (
                      <span className="ml-auto max-w-24 truncate text-xs text-muted-foreground">
                        {nick}
                      </span>
                    ) : null}
                  </ContextMenuItem>
                ) : null}
                {canManageRoles && assignableRoles.length > 0 ? (
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <ShieldIcon />
                      身份组
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className="min-w-44" side="left">
                      {assignableRoles.map((role) => {
                        const assigned = member.role_ids.includes(role.id)
                        return (
                          <ContextMenuCheckboxItem
                            key={role.id}
                            checked={assigned}
                            disabled={rolePendingId === role.id}
                            onCheckedChange={() =>
                              void toggleRole(role, assigned)
                            }
                            // 保持子菜单打开便于连续勾选
                            onSelect={(event) => event.preventDefault()}
                          >
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{
                                backgroundColor:
                                  role.color?.trim() ||
                                  "var(--color-muted-foreground)",
                              }}
                            />
                            <span className="truncate">{role.name}</span>
                          </ContextMenuCheckboxItem>
                        )
                      })}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                ) : null}
              </ContextMenuGroup>
            </>
          )}

          {showModeration && (
            <>
              <ContextMenuSeparator className="my-0" />
              <ContextMenuGroup className="p-1.5">
                <ContextMenuLabel className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  管理操作
                </ContextMenuLabel>
                {canAppoint &&
                  (isAdmin ? (
                    <ContextMenuItem onClick={() => void toggleAdmin(false)}>
                      <ShieldIcon />
                      移除管理员
                    </ContextMenuItem>
                  ) : (
                    <ContextMenuItem onClick={() => void toggleAdmin(true)}>
                      <ShieldIcon />
                      设为管理员
                    </ContextMenuItem>
                  ))}
                {canKick && (
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => onKick(member)}
                  >
                    <LogOutIcon />
                    踢出服务器
                  </ContextMenuItem>
                )}
                {canBan && (
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => onBan(member)}
                  >
                    <BanIcon />
                    封禁成员
                  </ContextMenuItem>
                )}
              </ContextMenuGroup>
            </>
          )}

          {/* 语音管理 + 管理员视图入口（分割线在组件内） */}
          <AdminMemberMenuSection
            guildId={guildId}
            targetUserId={member.user_id}
          />
        </ContextMenuContent>
      </ContextMenu>

      {/* 修改昵称对话框 */}
      <Dialog open={nickOpen} onOpenChange={setNickOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {isSelf ? "修改我的昵称" : `修改「${name}」的昵称`}
            </DialogTitle>
            <DialogDescription>
              服务器昵称仅在本服显示，优先于系统显示名。留空则清除昵称。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={nickDraft}
            onChange={(event) => setNickDraft(event.target.value)}
            placeholder={globalDisplay || username || "昵称"}
            maxLength={32}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void saveNickname()
              }
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNickOpen(false)}
              disabled={nickPending}
            >
              取消
            </Button>
            <Button onClick={() => void saveNickname()} disabled={nickPending}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
  const roles = useRolesStore((state) =>
    guildId ? state.byGuild[guildId] : undefined,
  )
  const statusByUser = usePresenceStore((state) => state.statusByUser)

  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [banReason, setBanReason] = useState("")
  const [pending, setPending] = useState(false)

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
      if (member.user_id === selfId || statusByUser[member.user_id])
        online.push(member)
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
        toast.error(
          errorMessage(error, kind === "kick" ? "踢出失败" : "封禁失败"),
        )
      }
    } finally {
      setPending(false)
    }
  }

  const renderGroup = (label: string, list: GuildMember[]) =>
    list.length > 0 && (
      <div className="flex flex-col gap-0.5">
        <p className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground select-none">
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

  const total = (members?.length ?? 0)

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden rounded-2xl bg-white text-foreground dark:bg-card dark:text-card-foreground">
      {/* 面板头 */}
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase select-none">
          成员
        </span>
        {members !== undefined && (
          <span className="text-[11px] tabular-nums text-muted-foreground select-none">
            {total}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {members === undefined ? (
          <p className="px-2 pt-3 text-xs text-muted-foreground">成员加载中…</p>
        ) : total === 0 ? (
          <p className="px-2 pt-3 text-xs text-muted-foreground">暂无成员</p>
        ) : (
          <>
            {renderGroup("在线", onlineMembers)}
            {renderGroup("离线", offlineMembers)}
          </>
        )}
      </div>

      <Dialog
        open={confirm !== null}
        onOpenChange={(next) => !next && closeConfirm()}
      >
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
