// 成员面板（docs 02 §3.7 FR-22/23）：
//   右侧可折叠 240px 面板，默认按身份组分组，可切换为在线/离线分组；
//   条目 = 头像 + 状态点 + 显示名 + 徽章。
//
// 成员点击菜单（精简资料卡）：
//   - 横幅 / 圆形大头像 / 显示名 / 用户名 / 状态 / 签名 / 彩色角色标签
//   - 右上角：添加好友 + 更多（所有工作操作收纳进更多子菜单）

import { useEffect, useMemo, useState, type ReactNode } from "react"
import type { CSSProperties } from "react"
import {
  AtSignIcon,
  BanIcon,
  CrownIcon,
  HashIcon,
  LogOutIcon,
  MailIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SettingsIcon,
  ShieldIcon,
  UserPlusIcon,
  UserRoundIcon,
  UserXIcon,
  XIcon,
} from "lucide-react"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { AdminMemberMenuSection } from "~/components/admin/admin-member-menu"
import { PanelResizeHandle } from "~/components/panel-resize-handle"
import {
  RoleBadgePill,
  RoleStyleDot,
  StyledDisplayName,
} from "~/components/styled-name"
import { AvatarWithFrame } from "~/components/cosmetics/avatar-frame"
import { NameplateBackground } from "~/components/cosmetics/nameplate"
import { ProfileCardChrome } from "~/components/cosmetics/profile-decorations"
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
  ContextMenuContent,
  ContextMenuTrigger,
} from "~/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import { ActivityCard, ActivityLine } from "~/components/activity-line"
import { CustomStatusLine } from "~/components/custom-status-line"
import { EmojiTextField } from "~/components/ui/emoji-text-field"
import { Input } from "~/components/ui/input"
import { presenceDotClass } from "~/components/nav-user"
import { sliceByCodePoints } from "~/lib/text-length"
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
import {
  memberRoleBadges,
  resolveMemberNameStyle,
  resolveRoleIconResolved,
  type ResolvedNameStyle,
} from "~/lib/name-style"
import { hasPermission, Permissions } from "~/lib/permissions"
import {
  memberDisplayName,
  nameInitials,
  resolveProfileAssetUrl,
} from "~/lib/user-display"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useCosmeticsStore } from "~/stores/cosmetics"
import { useMembersStore } from "~/stores/members"
import type { PresenceStatus } from "~/lib/gateway/events"
import {
  effectiveSelfActivities,
  hasCustomStatus,
  memberListStatus,
  usePresenceStore,
} from "~/stores/presence"
import { usePrivateChannelsStore } from "~/stores/private-channels"
import {
  friendsOf,
  blockedOf,
  useRelationshipsStore,
} from "~/stores/relationships"
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

/** 右侧栏外壳：可拖拽宽度 + 圆角卡片；三处出口（成员/群成员/DM 资料）共用 */
function MemberPanelShell({ children }: { children: ReactNode }) {
  const width = useUIStore((s) => s.memberPanelWidth)
  const setWidth = useUIStore((s) => s.setMemberPanelWidth)
  return (
    <aside
      className="relative flex shrink-0 flex-col overflow-visible"
      style={{ width }}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white text-foreground dark:bg-card dark:text-card-foreground">
        {children}
      </div>
      <PanelResizeHandle
        edge="start"
        width={width}
        onWidthChange={setWidth}
        label="调整成员列表宽度"
      />
    </aside>
  )
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
  if (
    c.startsWith("#") ||
    c.startsWith("rgb") ||
    c.startsWith("hsl") ||
    c.startsWith("oklch")
  ) {
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

type MemberGroupingMode = "role" | "presence"

type MemberGroup = {
  key: string
  label: string
  members: GuildMember[]
  /** 纯色回退 */
  color?: string
  /** 身份组分组时的完整角色，用于圆点样式 */
  role?: Role
  /** 预解析的圆点样式 */
  iconStyle?: ResolvedNameStyle
}

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
  const navigate = useNavigate()
  const presence = usePresenceStore(
    (state) => state.statusByUser[member.user_id]
  )
  const cosmeticsSlots = useCosmeticsStore(
    (s) =>
      (member.user_id === selfId ? s.loadout : s.equippedByUser[member.user_id]) ??
      {},
  )
  const avatarFrame = cosmeticsSlots.avatar_frame
  const nameplate = cosmeticsSlots.nameplate
  const profileBorder = cosmeticsSlots.profile_border
  const profileEffect = cosmeticsSlots.profile_effect
  const customPresence = usePresenceStore(
    (state) => state.customByUser[member.user_id]
  )
  const activitiesPresence = usePresenceStore(
    (state) => state.activitiesByUser[member.user_id]
  )
  // 本人状态必须订阅 settings + autoIdle，切换后立即重绘（不必等 Gateway 回执）
  const manualStatus = useSettingsStore((s) => s.presence.manualStatus)
  const selfCustomText = useSettingsStore((s) => s.presence.customText)
  const selfCustomEmoji = useSettingsStore((s) => s.presence.customEmoji)
  const selfCustomExpires = useSettingsStore((s) => s.presence.customExpiresAt)
  const selfActivityEnabled = useSettingsStore((s) => s.presence.activityEnabled)
  const selfActivityName = useSettingsStore((s) => s.presence.activityName)
  const selfActivityType = useSettingsStore((s) => s.presence.activityType)
  const selfActivityDetails = useSettingsStore((s) => s.presence.activityDetails)
  const selfActivityStartedAt = useSettingsStore(
    (s) => s.presence.activityStartedAt,
  )
  const selfActivityCoverUrl = useSettingsStore((s) => s.presence.activityCoverUrl)
  const autoIdle = usePresenceStore((s) => s.autoIdle)
  const isSelf = member.user_id === selfId
  const selfStatus: PresenceStatus =
    manualStatus === "online" && autoIdle ? "idle" : manualStatus
  /** 状态点：本人用本地有效状态（含隐身灰点）；他人用 presence 表 */
  const status: PresenceStatus | undefined = isSelf
    ? selfStatus
    : presence
  const customForDisplay = isSelf
    ? {
        text: selfCustomText,
        emoji: selfCustomEmoji,
        expiresAt: selfCustomExpires,
      }
    : customPresence
  const showCustom = hasCustomStatus(customForDisplay)
  void selfActivityEnabled
  void selfActivityName
  void selfActivityType
  void selfActivityDetails
  void selfActivityStartedAt
  void selfActivityCoverUrl
  const activitiesForDisplay = isSelf
    ? effectiveSelfActivities()
    : (activitiesPresence ?? [])
  const showActivity = (activitiesForDisplay?.length ?? 0) > 0
  /** 列表明暗：隐身/离线沉底灰显；在线/闲置/勿扰保持不透明 */
  const online = isSelf
    ? selfStatus !== "invisible"
    : Boolean(presence)
  const isAdmin = memberIsAdmin(member, roles)
  const name = displayName(member)
  /** 最高位角色的用户名样式（纯色 / 渐变） */
  const nameStyle = resolveMemberNameStyle(member, roles)
  // 确保 owner 角色样式生效
  const ownerNameStyle = ownerRole
    ? resolveMemberNameStyle({ ...member, role_ids: [...member.role_ids, ownerRole.id] }, [ownerRole])
    : nameStyle
  const avatarSrc = resolveProfileAssetUrl(member.avatar_url)
  const bannerSrc = resolveProfileAssetUrl(member.banner_url)
  const username = member.username?.trim() || member.user_id.slice(0, 8)
  const globalDisplay = member.display_name?.trim()
  const nick = member.nickname?.trim()

  const relItems = useRelationshipsStore((s) => s.items)
  const isFriend = friendsOf(relItems).some((r) => r.user.id === member.user_id)
  const isBlocked = blockedOf(relItems).some(
    (r) => r.user.id === member.user_id
  )

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
        .filter(
          (role) => !role.is_everyone && member.role_ids.includes(role.id)
        )
        .sort((a, b) => b.position - a.position),
    [roles, member.role_ids]
  )

  const ownerRole = useMemo(
    () =>
      (roles ?? []).find((role) => role.is_everyone) ||
      (roles ?? []).find((role) => role.position === 0),
    [roles]
  )

  const ownerRole = useMemo(
    () =>
      (roles ?? []).find((role) => role.is_everyone) ||
      (roles ?? []).find((role) => role.position === 0),
    [roles]
  )

  const assignableRoles = useMemo(
    () =>
      (roles ?? [])
        .filter((role) => !role.is_everyone && !role.managed)
        .sort((a, b) => b.position - a.position),
    [roles]
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
    const next = sliceByCodePoints(nickDraft.trim(), 32)
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
        errorMessage(error, makeAdmin ? "设为管理员失败" : "移除管理员失败")
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
      toast.error(
        errorMessage(error, assigned ? "移除角色失败" : "分配角色失败")
      )
    } finally {
      setRolePendingId(null)
    }
  }

  const addFriend = async () => {
    try {
      const { sendFriendRequest } = await import("~/lib/api/social")
      const rel = await sendFriendRequest({ user_id: member.user_id })
      useRelationshipsStore.getState().upsert(rel)
      toast.success("好友请求已发送")
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.code === "PRIVACY_DENIED"
            ? "无法发送好友请求"
            : error.code === "RELATIONSHIP_STATE_CONFLICT"
              ? "已存在关系"
              : error.message
          : "发送失败"
      )
    }
  }

  const blockMember = async () => {
    if (!window.confirm(`确定屏蔽 ${name}？对方将无法向你发私信或好友请求。`)) {
      return
    }
    try {
      await useRelationshipsStore.getState().block(member.user_id)
      toast.success("已屏蔽")
    } catch (error) {
      toast.error(errorMessage(error, "屏蔽失败"))
    }
  }

  const unblockMember = async () => {
    try {
      await useRelationshipsStore.getState().unblock(member.user_id)
      toast.success("已解除屏蔽")
    } catch (error) {
      toast.error(errorMessage(error, "解除屏蔽失败"))
    }
  }

  const openDm = async () => {
    try {
      const ch = await usePrivateChannelsStore.getState().openDm(member.user_id)
      useUIStore.getState().selectChannel("@me", ch.id)
      navigate(`/channels/@me/${ch.id}`)
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.code === "PRIVACY_DENIED"
            ? "无法发送私信"
            : error.message
          : "打开私信失败"
      )
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          className={cn(
            "relative flex w-full items-center gap-2 overflow-hidden rounded-md px-2 py-0.5 text-left text-sm hover:bg-muted/70",
            online ? "text-foreground/90" : "opacity-50"
          )}
          onClick={(event) => {
            // 左键也打开同一右键菜单（合成 contextmenu 事件）
            event.currentTarget.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                clientX: event.clientX,
                clientY: event.clientY,
              })
            )
          }}
        >
          {/* 铭牌必须在内容下层，否则会盖住昵称（isolate + absolute 叠层） */}
          <NameplateBackground nameplate={nameplate} className="z-0" />
          {/* flex：消除 inline 基线偏移，让头像+头像框整体在行内垂直居中 */}
          <span className="relative z-[1] flex shrink-0 items-center justify-center">
            <AvatarWithFrame frame={avatarFrame} sizeClass="size-8">
              <Avatar className="size-8 rounded-full after:rounded-full after:border-0">
                {avatarSrc && (
                  <AvatarImage
                    src={avatarSrc}
                    alt={name}
                    className="rounded-full object-cover"
                  />
                )}
                <AvatarFallback className="rounded-full text-[10px]">
                  {nameInitials(name)}
                </AvatarFallback>
              </Avatar>
            </AvatarWithFrame>
            <span
              className={cn(
                "absolute -right-0.5 -bottom-0.5 z-[3] size-2 rounded-full ring-2 ring-background",
                presenceDotClass(status)
              )}
            />
          </span>
          <span className="relative z-[1] min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1">
              <StyledDisplayName
                name={name || username}
                style={isOwner ? ownerNameStyle : nameStyle}
                className="min-w-0 truncate text-[13px]"
              />
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
            </span>
            {showCustom && online ? (
              <CustomStatusLine
                custom={customForDisplay}
                className="mt-0.5 text-[11px]"
              />
            ) : null}
            {showActivity && online ? (
              <ActivityLine
                activities={activitiesForDisplay}
                className="mt-0.5 text-[11px]"
              />
            ) : null}
          </span>
        </ContextMenuTrigger>

        <ContextMenuContent
          // 透明外壳 + 内边距：外挂边框（上/下悬出、左右各超 5%）落在菜单盒内不被裁；
          // 基类的 overflow-x-hidden/overflow-y-auto 用 overflow-visible 覆盖
          className="w-72 overflow-visible rounded-none bg-transparent px-4 py-6 shadow-none ring-0 sm:w-80"
          side="left"
          align="start"
          sideOffset={8}
        >
          {/* —— 精简资料卡：固定 9:16 竖版（宽度固定、高度按比例），内容不满则底部留空 —— */}
          <ProfileCardChrome
            border={profileBorder}
            effect={profileEffect}
            size="compact"
            playAudio
            className="relative aspect-[9/16] rounded-2xl bg-popover shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10"
          >
            <div
              className={cn(
                "h-28 w-full",
                bannerSrc
                  ? "bg-muted"
                  : "bg-gradient-to-br from-sky-500/80 via-violet-500/70 to-fuchsia-500/60"
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

            {/* 右上角：添加好友 + 更多 */}
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
              {!isSelf && !isFriend && !isBlocked ? (
                <button
                  type="button"
                  title="添加好友"
                  aria-label="添加好友"
                  className="flex size-8 items-center justify-center rounded-full bg-black/40 text-white shadow-sm backdrop-blur-md transition-colors hover:bg-black/55"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void addFriend()
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <UserPlusIcon className="size-4" />
                </button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger
                  title="更多"
                  aria-label="更多操作"
                  className="flex size-8 items-center justify-center rounded-full bg-black/40 text-white shadow-sm backdrop-blur-md outline-none transition-colors hover:bg-black/55 focus-visible:ring-2 focus-visible:ring-white/40"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreHorizontalIcon className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  side="bottom"
                  sideOffset={6}
                  className="min-w-52"
                >
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                      快捷操作
                    </DropdownMenuLabel>
                    {!isSelf ? (
                      <>
                        <DropdownMenuItem onClick={() => void openDm()}>
                          <MailIcon />
                          发送私信
                        </DropdownMenuItem>
                        {isFriend ? (
                          <DropdownMenuItem
                            onClick={() =>
                              void useRelationshipsStore
                                .getState()
                                .removeFriend(member.user_id)
                                .then(() => toast.success("已移除好友"))
                                .catch((e) =>
                                  toast.error(errorMessage(e, "移除失败"))
                                )
                            }
                          >
                            <UserXIcon />
                            移除好友
                          </DropdownMenuItem>
                        ) : null}
                        {isBlocked ? (
                          <DropdownMenuItem
                            onClick={() => void unblockMember()}
                          >
                            <UserXIcon />
                            解除屏蔽
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => void blockMember()}
                          >
                            <BanIcon />
                            屏蔽
                          </DropdownMenuItem>
                        )}
                      </>
                    ) : null}
                    <DropdownMenuItem
                      onClick={() =>
                        void copyText("提及", `<@${member.user_id}>`)
                      }
                    >
                      <AtSignIcon />
                      复制 @提及
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => void copyText("用户名", username)}
                    >
                      <UserRoundIcon />
                      复制用户名
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => void copyText("用户 ID", member.user_id)}
                    >
                      <HashIcon />
                      复制用户 ID
                      <span className="ml-auto max-w-20 truncate font-mono text-[10px] text-muted-foreground">
                        {member.user_id.slice(0, 8)}…
                      </span>
                    </DropdownMenuItem>
                    {isSelf ? (
                      <DropdownMenuItem
                        onClick={() =>
                          useSettingsStore.getState().openPanel("profile")
                        }
                      >
                        <SettingsIcon />
                        编辑个人资料
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuGroup>

                  {canEditNickname ||
                  (canManageRoles && assignableRoles.length > 0) ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                          成员管理
                        </DropdownMenuLabel>
                        {canEditNickname ? (
                          <DropdownMenuItem onClick={openNickDialog}>
                            <PencilIcon />
                            {isSelf ? "修改我的昵称" : "修改昵称"}
                            {nick ? (
                              <span className="ml-auto max-w-24 truncate text-xs text-muted-foreground">
                                {nick}
                              </span>
                            ) : null}
                          </DropdownMenuItem>
                        ) : null}
                        {canManageRoles && assignableRoles.length > 0 ? (
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <ShieldIcon />
                              身份组
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="min-w-44">
                              {assignableRoles.map((role) => {
                                const assigned = member.role_ids.includes(
                                  role.id
                                )
                                return (
                                  <DropdownMenuCheckboxItem
                                    key={role.id}
                                    checked={assigned}
                                    disabled={rolePendingId === role.id}
                                    onCheckedChange={() =>
                                      void toggleRole(role, assigned)
                                    }
                                    onClick={(event) => event.preventDefault()}
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
                                  </DropdownMenuCheckboxItem>
                                )
                              })}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        ) : null}
                      </DropdownMenuGroup>
                    </>
                  ) : null}

                  {showModeration ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                          管理操作
                        </DropdownMenuLabel>
                        {canAppoint
                          ? isAdmin
                            ? (
                                <DropdownMenuItem
                                  onClick={() => void toggleAdmin(false)}
                                >
                                  <ShieldIcon />
                                  移除管理员
                                </DropdownMenuItem>
                              )
                            : (
                                <DropdownMenuItem
                                  onClick={() => void toggleAdmin(true)}
                                >
                                  <ShieldIcon />
                                  设为管理员
                                </DropdownMenuItem>
                              )
                          : null}
                        {canKick ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => onKick(member)}
                          >
                            <LogOutIcon />
                            踢出服务器
                          </DropdownMenuItem>
                        ) : null}
                        {canBan ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => onBan(member)}
                          >
                            <BanIcon />
                            封禁成员
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuGroup>
                    </>
                  ) : null}

                  <AdminMemberMenuSection
                    guildId={guildId}
                    targetUserId={member.user_id}
                    variant="dropdown"
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="relative px-4 pb-4">
              {/* 圆形头像压在横幅下沿；ml-3 右移让出外挂边框的悬出区 */}
              <div className="relative -mt-10 mb-3 ml-3 size-20">
                <AvatarWithFrame frame={avatarFrame} sizeClass="size-20">
                  <Avatar className="size-20 rounded-full ring-4 ring-popover after:rounded-full after:border-0">
                    {avatarSrc ? (
                      <AvatarImage
                        src={avatarSrc}
                        alt={name}
                        className="rounded-full object-cover"
                      />
                    ) : null}
                    <AvatarFallback className="rounded-full text-xl font-semibold">
                      {nameInitials(name)}
                    </AvatarFallback>
                  </Avatar>
                </AvatarWithFrame>
                <span
                  title={presenceLabel(status)}
                  className={cn(
                    "absolute -right-0.5 -bottom-0.5 z-[3] size-4 rounded-full ring-[3px] ring-popover",
                    presenceDotClass(status)
                  )}
                />
              </div>

              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <StyledDisplayName
                    name={name}
                    style={nameStyle}
                    className="truncate text-lg leading-tight font-semibold"
                  />
                  {member.is_owner && (
                    <CrownIcon className="size-4 shrink-0 text-amber-500" />
                  )}
                  {!member.is_owner && isAdmin && (
                    <ShieldIcon className="size-4 shrink-0 text-sky-500" />
                  )}
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  @{username}
                  {nick && globalDisplay ? ` · ${globalDisplay}` : null}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      presenceDotClass(status)
                    )}
                  />
                  {presenceLabel(status)}
                  {member.is_owner
                    ? " · 服务器所有者"
                    : isAdmin
                      ? " · 管理员"
                      : null}
                </p>
                {showCustom ? (
                  <CustomStatusLine
                    custom={customForDisplay}
                    className="mt-1 text-xs text-foreground/80"
                    emoteSize={16}
                  />
                ) : null}
                {showActivity ? (
                  <ActivityCard
                    activities={activitiesForDisplay}
                    className="mt-2"
                  />
                ) : null}
              </div>

              {member.bio?.trim() ? (
                <p className="mt-2.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                  {member.bio.trim()}
                </p>
              ) : null}

              {memberRoles.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {memberRoleBadges(member, roles).map((badge) => (
                    <RoleBadgePill
                      key={badge.id}
                      badge={badge}
                      className="h-6 max-w-[11rem] gap-1 px-2.5 text-[11px] [&_img]:size-3.5"
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </ProfileCardChrome>
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
          <EmojiTextField
            value={nickDraft}
            onChange={setNickDraft}
            placeholder={globalDisplay || username || "昵称"}
            maxChars={32}
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
// 私信右侧栏：群成员 / 1:1 资料卡（Discord 风格）
// ---------------------------------------------------------------------------

function GroupDmMembersPanel({ channelId }: { channelId: string }) {
  // 所有 hooks 必须在任何 early return 之前（避免 hooks 数量不一致崩溃）
  const selfId = useAuthStore((s) => s.user?.id)
  const selfUser = useAuthStore((s) => s.user)
  const channel = usePrivateChannelsStore((s) =>
    s.channels.find((c) => c.id === channelId)
  )
  const statusByUser = usePresenceStore((s) => s.statusByUser)
  const customByUser = usePresenceStore((s) => s.customByUser)
  const manualStatus = useSettingsStore((s) => s.presence.manualStatus)
  const selfCustomText = useSettingsStore((s) => s.presence.customText)
  const selfCustomEmoji = useSettingsStore((s) => s.presence.customEmoji)
  const selfCustomExpires = useSettingsStore((s) => s.presence.customExpiresAt)
  const autoIdle = usePresenceStore((s) => s.autoIdle)
  const selfEffective: PresenceStatus =
    manualStatus === "online" && autoIdle ? "idle" : manualStatus
  const navigate = useNavigate()

  if (!channel || channel.type !== "GROUP_DM") return null

  const people = [...channel.recipients]
  const hasSelf = selfId && people.some((p) => p.id === selfId)
  const list = hasSelf
    ? people
    : selfUser
      ? [
          {
            id: selfUser.id,
            username: selfUser.username,
            display_name: selfUser.display_name,
            avatar_url: selfUser.avatar_url,
          },
          ...people,
        ]
      : people

  const sorted = [...list].sort((a, b) => {
    const aSt = memberListStatus(
      a.id,
      selfId,
      statusByUser,
      a.id === selfId ? selfEffective : undefined
    )
    const bSt = memberListStatus(
      b.id,
      selfId,
      statusByUser,
      b.id === selfId ? selfEffective : undefined
    )
    const rank: Record<string, number> = {
      online: 0,
      idle: 1,
      dnd: 2,
      offline: 3,
    }
    const ar = rank[aSt] ?? 3
    const br = rank[bSt] ?? 3
    if (ar !== br) return ar - br
    const an = a.display_name?.trim() || a.username
    const bn = b.display_name?.trim() || b.username
    return an.localeCompare(bn, "zh-Hans-CN")
  })

  return (
    <MemberPanelShell>
      <div className="flex h-12 shrink-0 items-center px-3">
        <span className="text-[13px] font-semibold">
          成员 — {sorted.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {sorted.map((p) => {
          const isSelf = p.id === selfId
          const status = isSelf ? selfEffective : statusByUser[p.id]
          const name = p.display_name?.trim() || p.username
          const av = resolveProfileAssetUrl(p.avatar_url)
          const dimmed =
            memberListStatus(
              p.id,
              selfId,
              statusByUser,
              isSelf ? selfEffective : undefined
            ) === "offline"
          return (
            <div
              key={p.id}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-muted/70",
                dimmed && "opacity-50"
              )}
            >
              <span className="relative size-7 shrink-0">
                <Avatar className="size-7 rounded-full after:rounded-full after:border-0">
                  {av ? (
                    <AvatarImage
                      src={av}
                      alt=""
                      className="rounded-full object-cover"
                    />
                  ) : null}
                  <AvatarFallback className="rounded-full text-[10px]">
                    {nameInitials(name)}
                  </AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-card",
                    presenceDotClass(status)
                  )}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {name}
                  {isSelf ? (
                    <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                      （你）
                    </span>
                  ) : null}
                </span>
                {!dimmed ? (
                  <CustomStatusLine
                    custom={
                      isSelf
                        ? {
                            text: selfCustomText,
                            emoji: selfCustomEmoji,
                            expiresAt: selfCustomExpires,
                          }
                        : customByUser[p.id]
                    }
                    className="mt-0.5 text-[11px]"
                  />
                ) : null}
              </span>
              {!isSelf ? (
                <button
                  type="button"
                  title="私信"
                  aria-label={`私信 ${name}`}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => {
                    void usePrivateChannelsStore
                      .getState()
                      .openDm(p.id)
                      .then((ch) => {
                        useUIStore.getState().selectChannel("@me", ch.id)
                        navigate(`/channels/@me/${ch.id}`)
                      })
                      .catch((e) =>
                        toast.error(
                          e instanceof ApiError ? e.message : "打开私信失败"
                        )
                      )
                  }}
                >
                  <MailIcon className="size-3.5" />
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </MemberPanelShell>
  )
}

/** 1:1 私信对方资料卡 */
function DmProfilePanel({ channelId }: { channelId: string }) {
  const selfId = useAuthStore((s) => s.user?.id)
  const channel = usePrivateChannelsStore((s) =>
    s.channels.find((c) => c.id === channelId)
  )
  const peer =
    channel?.recipients.find((r) => r.id !== selfId) ?? channel?.recipients[0]
  const presence = usePresenceStore((s) =>
    peer?.id ? s.statusByUser[peer.id] : undefined
  )
  const customPresence = usePresenceStore((s) =>
    peer?.id ? s.customByUser[peer.id] : undefined
  )
  const peerActivities = usePresenceStore((s) =>
    peer?.id ? s.activitiesByUser[peer.id] : undefined
  )
  const relItems = useRelationshipsStore((s) => s.items)
  const isFriend = peer
    ? friendsOf(relItems).some((r) => r.user.id === peer.id)
    : false
  const isBlocked = peer
    ? blockedOf(relItems).some((r) => r.user.id === peer.id)
    : false
  const navigate = useNavigate()

  if (!channel || channel.type !== "DM" || !peer) return null

  const name = peer.display_name?.trim() || peer.username
  const av = resolveProfileAssetUrl(peer.avatar_url)

  const addFriend = () => {
    void useRelationshipsStore
      .getState()
      .sendRequest({ user_id: peer.id })
      .then(() => toast.success("好友请求已发送"))
      .catch((e) =>
        toast.error(
          e instanceof ApiError
            ? e.code === "PRIVACY_DENIED"
              ? "无法发送好友请求"
              : e.message
            : "发送失败"
        )
      )
  }

  return (
    <MemberPanelShell>
      <div className="flex h-12 shrink-0 items-center px-3">
        <span className="text-[13px] font-semibold">资料</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* 精简资料卡：圆形头像 + 右上角操作 */}
        <div className="relative">
          <div className="h-16 bg-gradient-to-br from-sky-500/70 via-violet-500/60 to-fuchsia-500/50" />

          <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
            {!isFriend && !isBlocked ? (
              <button
                type="button"
                title="添加好友"
                aria-label="添加好友"
                className="flex size-8 items-center justify-center rounded-full bg-black/40 text-white shadow-sm backdrop-blur-md transition-colors hover:bg-black/55"
                onClick={() => void addFriend()}
              >
                <UserPlusIcon className="size-4" />
              </button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger
                title="更多"
                aria-label="更多操作"
                className="flex size-8 items-center justify-center rounded-full bg-black/40 text-white shadow-sm backdrop-blur-md outline-none transition-colors hover:bg-black/55 focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <MoreHorizontalIcon className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom" className="min-w-48">
                <DropdownMenuItem
                  onClick={() => void copyText("用户名", peer.username)}
                >
                  <UserRoundIcon />
                  复制用户名
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void copyText("用户 ID", peer.id)}
                >
                  <HashIcon />
                  复制用户 ID
                </DropdownMenuItem>
                {isBlocked ? (
                  <DropdownMenuItem
                    onClick={() => {
                      void useRelationshipsStore
                        .getState()
                        .unblock(peer.id)
                        .then(() => toast.success("已解除屏蔽"))
                    }}
                  >
                    <UserXIcon />
                    解除屏蔽
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                      if (!window.confirm(`确定屏蔽 ${name}？`)) return
                      void useRelationshipsStore
                        .getState()
                        .block(peer.id)
                        .then(() => toast.success("已屏蔽"))
                    }}
                  >
                    <BanIcon />
                    屏蔽
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    void usePrivateChannelsStore
                      .getState()
                      .closeChannel(channelId)
                      .then(() => {
                        toast.success("已关闭私信")
                        useUIStore.getState().selectGuild(null)
                        navigate("/", { replace: true })
                      })
                  }}
                >
                  <XIcon />
                  关闭私信
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="absolute -bottom-6 left-3">
            <span className="relative block size-14">
              <Avatar className="size-14 rounded-full ring-4 ring-card after:rounded-full after:border-0">
                {av ? (
                  <AvatarImage
                    src={av}
                    alt=""
                    className="rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="rounded-full text-lg font-semibold">
                  {nameInitials(name)}
                </AvatarFallback>
              </Avatar>
              <span
                className={cn(
                  "absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full ring-[3px] ring-card",
                  presenceDotClass(presence)
                )}
              />
            </span>
          </div>
        </div>

        <div className="mt-8 px-3 pb-4">
          <p className="truncate text-base leading-tight font-semibold">
            {name}
          </p>
          <p className="truncate text-[12px] text-muted-foreground">
            @{peer.username}
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                presenceDotClass(presence)
              )}
            />
            {presenceLabel(presence)}
            {isFriend ? " · 好友" : isBlocked ? " · 已屏蔽" : null}
          </p>
          <CustomStatusLine custom={customPresence} className="mt-1 text-[12px]" />
          <ActivityCard activities={peerActivities} />
        </div>
      </div>
    </MemberPanelShell>
  )
}

function DmSidePanel() {
  const open = useUIStore((s) => s.memberPanelOpen)
  const channelId = useUIStore((s) => s.selectedChannelId)
  const channel = usePrivateChannelsStore((s) =>
    s.channels.find((c) => c.id === channelId)
  )
  if (!open || !channelId || !channel) return null
  if (channel.type === "GROUP_DM") {
    return <GroupDmMembersPanel channelId={channelId} />
  }
  return <DmProfilePanel channelId={channelId} />
}

// ---------------------------------------------------------------------------
// 面板
// ---------------------------------------------------------------------------

export function MemberPanel() {
  const open = useUIStore((state) => state.memberPanelOpen)
  const guildId = useUIStore((state) => state.selectedGuildId)
  const isDm = guildId === "@me"
  const selfId = useAuthStore((state) => state.user?.id)
  const members = useMembersStore((state) =>
    guildId && !isDm ? state.byGuild[guildId] : undefined
  )
  const roles = useRolesStore((state) =>
    guildId && !isDm ? state.byGuild[guildId] : undefined
  )
  const statusByUser = usePresenceStore((state) => state.statusByUser)
  // 本人状态变更须驱动分组重算（与 MemberRow 一致）
  const manualStatus = useSettingsStore((s) => s.presence.manualStatus)
  const autoIdle = usePresenceStore((s) => s.autoIdle)
  const selfEffective: PresenceStatus =
    manualStatus === "online" && autoIdle ? "idle" : manualStatus

  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [banReason, setBanReason] = useState("")
  const [pending, setPending] = useState(false)
  const [groupingMode, setGroupingMode] = useState<MemberGroupingMode>("role")

  useEffect(() => {
    if (!guildId || !open || isDm) return
    if (members === undefined) {
      void useMembersStore
        .getState()
        .fetchMembers(guildId)
        .catch(() => undefined)
    }
    if (roles === undefined) {
      void useRolesStore
        .getState()
        .fetchRoles(guildId)
        .catch(() => undefined)
    }
  }, [guildId, open, isDm, members, roles])

  const { presenceGroups, roleGroups, self } = useMemo(() => {
    const list = members ?? []
    const byName = (a: GuildMember, b: GuildMember) =>
      displayName(a).localeCompare(displayName(b), "zh-Hans-CN")

    // 在线状态分组顺序：在线 → 闲置 → 勿扰 → 离线（docs 01 四态；隐身归离线）
    const presenceOrder = ["online", "idle", "dnd", "offline"] as const
    const presenceLabels: Record<(typeof presenceOrder)[number], string> = {
      online: "在线",
      idle: "闲置",
      dnd: "勿扰",
      offline: "离线",
    }
    const buckets: Record<(typeof presenceOrder)[number], GuildMember[]> = {
      online: [],
      idle: [],
      dnd: [],
      offline: [],
    }
    const resolveStatus = (member: GuildMember) =>
      memberListStatus(
        member.user_id,
        selfId,
        statusByUser,
        member.user_id === selfId ? selfEffective : undefined
      )
    for (const member of list) {
      buckets[resolveStatus(member)].push(member)
    }
    for (const key of presenceOrder) {
      buckets[key].sort(byName)
    }

    // 组内排序：在线系优先（online > idle > dnd > offline），再按名称
    const presenceRank: Record<string, number> = {
      online: 0,
      idle: 1,
      dnd: 2,
      offline: 3,
    }
    const byPresenceThenName = (a: GuildMember, b: GuildMember) => {
      const ar = presenceRank[resolveStatus(a)] ?? 3
      const br = presenceRank[resolveStatus(b)] ?? 3
      if (ar !== br) return ar - br
      return byName(a, b)
    }

    // 身份组分组：成员出现在其每一个 hoist 身份组内，方便按组查看。
    // 没有任何 hoist 身份组的成员归入「成员」。
    const hoistedRoles = (roles ?? [])
      .filter((role) => role.hoist && !role.is_everyone)
      .slice()
      .sort((a, b) => b.position - a.position || a.id.localeCompare(b.id))
    const membersByRole = new Map<string, GuildMember[]>()
    const ungrouped: GuildMember[] = []
    for (const member of list) {
      const matchedRoles = hoistedRoles.filter((item) =>
        member.role_ids.includes(item.id)
      )
      if (matchedRoles.length === 0) {
        ungrouped.push(member)
        continue
      }
      for (const role of matchedRoles) {
        const group = membersByRole.get(role.id) ?? []
        group.push(member)
        membersByRole.set(role.id, group)
      }
    }

    const groupedByRole: MemberGroup[] = hoistedRoles.flatMap((role) => {
      const roleMembers = membersByRole.get(role.id)
      if (!roleMembers?.length) return []
      roleMembers.sort(byPresenceThenName)
      const iconStyle = resolveRoleIconResolved(role)
      return [
        {
          key: role.id,
          label: role.name,
          members: roleMembers,
          color: roleColorStyle(role.color)?.backgroundColor,
          role,
          iconStyle:
            iconStyle.kind !== "none" ? iconStyle : undefined,
        },
      ]
    })
    if (ungrouped.length > 0) {
      ungrouped.sort(byPresenceThenName)
      groupedByRole.push({
        key: "ungrouped",
        label: "成员",
        members: ungrouped,
      })
    }

    // 按状态分组：始终展示全部支持的状态分组（含空组，便于识别全部分类）
    const presenceGroups: MemberGroup[] = presenceOrder.map((key) => ({
      key,
      label: presenceLabels[key],
      members: buckets[key],
    }))

    return {
      presenceGroups,
      roleGroups: groupedByRole,
      self: list.find((member) => member.user_id === selfId),
    }
  }, [members, roles, statusByUser, selfId, selfEffective])

  // 私信：1:1 资料卡 / 群成员列表
  if (isDm) return <DmSidePanel />

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
          : `已封禁「${displayName(member)}」`
      )
      closeConfirm()
    } catch (error) {
      if (isNotFound(error)) {
        useMembersStore.getState().removeMember(guildId, member.user_id)
        closeConfirm()
      } else {
        toast.error(
          errorMessage(error, kind === "kick" ? "踢出失败" : "封禁失败")
        )
      }
    } finally {
      setPending(false)
    }
  }

  const renderGroup = (group: MemberGroup, opts?: { showEmpty?: boolean }) => {
    // 身份组模式隐藏空组；状态模式始终展示全部支持的在线状态分组
    if (!opts?.showEmpty && group.members.length === 0) return null
    return (
      <div key={group.key} className="flex flex-col gap-0.5">
        <p className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground select-none">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {group.iconStyle || group.role ? (
              <RoleStyleDot
                style={
                  group.iconStyle ??
                  (group.role
                    ? resolveRoleIconResolved(group.role)
                    : null)
                }
                fallbackColor={group.color ?? group.role?.color}
                className="size-2.5 border-0"
              />
            ) : group.color ? (
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: group.color }}
                aria-hidden
              />
            ) : group.key === "online" ||
              group.key === "idle" ||
              group.key === "dnd" ||
              group.key === "offline" ? (
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  presenceDotClass(
                    group.key === "offline" ? undefined : group.key
                  )
                )}
                aria-hidden
              />
            ) : null}
            <span className="truncate">{group.label}</span>
            <span className="tabular-nums">— {group.members.length}</span>
          </span>
        </p>
        {group.members.map((member) => (
          <MemberRow
            key={`${group.key}-${member.user_id}`}
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
  }

  const total = members?.length ?? 0

  return (
    <MemberPanelShell>
      {/* 面板头 */}
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase select-none">
          成员
        </span>
        <div className="flex items-center gap-1">
          {members !== undefined && (
            <span className="px-1 text-[11px] text-muted-foreground tabular-nums select-none">
              {total}
            </span>
          )}
          <button
            type="button"
            aria-label={
              groupingMode === "role"
                ? "切换为按在线状态分组"
                : "切换为按身份组分组"
            }
            title={
              groupingMode === "role"
                ? "当前按身份组分组，点击切换为在线/闲置/勿扰/离线"
                : "当前按在线状态分组，点击切换为身份组"
            }
            onClick={() =>
              setGroupingMode((current) =>
                current === "role" ? "presence" : "role"
              )
            }
            className="inline-flex h-7 min-w-14 items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-medium text-muted-foreground transition-[color,background-color,transform] hover:bg-muted hover:text-foreground active:scale-[0.96]"
          >
            {groupingMode === "role" ? (
              <ShieldIcon className="size-3.5" />
            ) : (
              <UserRoundIcon className="size-3.5" />
            )}
            {groupingMode === "role" ? "身份组" : "状态"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {members === undefined ? (
          <p className="px-2 pt-3 text-xs text-muted-foreground">成员加载中…</p>
        ) : total === 0 ? (
          <p className="px-2 pt-3 text-xs text-muted-foreground">暂无成员</p>
        ) : (
          (groupingMode === "role" ? roleGroups : presenceGroups).map(
            (group) =>
              renderGroup(group, {
                showEmpty: groupingMode === "presence",
              })
          )
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
    </MemberPanelShell>
  )
}
