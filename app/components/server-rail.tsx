// 服务器栏条目：圆角方形图标（有 icon_url 显示图片，否则名称首两个字符）、选中高亮、tooltip 显示服名。
// 未读指示：头像右下红色圆形角标（@提及优先；否则汇总全服未读消息条数，封顶 9999+）。
// 静音服务器不显示普通未读角标，@提及角标穿透静音。
// 右键菜单：打开服务器 / 全部已读 / 复制 ID·名称 / 通知覆盖 / 退出服务器。
// 图标随 guilds store / GUILD_UPDATE 实时更新。

import { useState } from "react"
import { useNavigate } from "react-router"
import {
  CheckCheckIcon,
  CopyIcon,
  DoorOpenIcon,
  HashIcon,
  LogOutIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
import { toast } from "sonner"

import { GuildAvatar } from "~/components/guild-avatar"
import { NotifyOverrideMenuItems } from "~/components/notify-override-menu"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Button } from "~/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "~/components/ui/context-menu"
import { SidebarMenuButton, SidebarMenuItem } from "~/components/ui/sidebar"
import { canOpenGuildAdmin } from "~/components/guild-settings/guild-settings-panel"
import { leaveGuild } from "~/lib/api/guilds"
import { ApiError } from "~/lib/api/http"
import {
  nameInitials,
  resolveProfileAssetUrl,
  userDisplayName,
} from "~/lib/user-display"
import { useAuthStore } from "~/stores/auth"
import { memberGuildPermissions } from "~/stores/roles"
import { copyText } from "~/lib/clipboard"
import { cn } from "~/lib/utils"
import { useChannelsStore } from "~/stores/channels"
import { useGuildsStore } from "~/stores/guilds"
import { useMembersStore } from "~/stores/members"
import {
  channelUnreadCount,
  formatUnreadBadge,
  useReadStatesStore,
} from "~/stores/read-states"
import { useRolesStore } from "~/stores/roles"
import { isOverrideMuted, useSettingsStore } from "~/stores/settings"
import { useUIStore } from "~/stores/ui"

/** 多账号时服务器图标左下角显示归属账号头像，避免用错身份 */
function ServerAccountBadge({
  accountId,
}: {
  accountId: string | undefined
}) {
  const accounts = useAuthStore((s) => s.accounts)
  if (accounts.length < 2 || !accountId) return null
  const account = accounts.find((a) => a.id === accountId)
  if (!account) return null
  const display = userDisplayName(account.user)
  const avatarSrc = resolveProfileAssetUrl(
    account.user.avatar_url,
    account.serverBaseUrl,
  )
  return (
    <span
      title={`以 ${display}（@${account.user.username}）身份访问`}
      aria-label={`账号 ${display}`}
      className="pointer-events-none absolute -bottom-0.5 -left-0.5 z-20"
    >
      <Avatar className="size-3.5 rounded-full shadow-sm ring-2 ring-sidebar after:border-0">
        {avatarSrc ? (
          <AvatarImage
            src={avatarSrc}
            alt={display}
            className="rounded-full object-cover"
          />
        ) : null}
        <AvatarFallback className="rounded-full text-[7px] font-semibold leading-none">
          {nameInitials(display)}
        </AvatarFallback>
      </Avatar>
    </span>
  )
}

export function guildInitials(name: string): string {
  return name.trim().slice(0, 2) || "?"
}

// formatUnreadBadge 已统一到 read-states（频道列表与服务器栏共用 9999+ 规则）
export { formatUnreadBadge } from "~/stores/read-states"

export function ServerRailItem({
  guildId,
  accountId,
}: {
  guildId: string
  /** 多账号并存时用于精确定位服务器条目 */
  accountId?: string
}) {
  const navigate = useNavigate()
  // 直接订阅 store 中的该服，确保 GUILD_UPDATE 改 icon_url 后即时重渲染
  const guild = useGuildsStore((state) =>
    state.guilds.find((item) =>
      item.id === guildId &&
      (accountId ? item.account_id === accountId : true),
    ),
  )
  const selected = useUIStore((state) => state.selectedGuildId === guildId)
  const override = useSettingsStore((state) => state.notifications.perGuild[guildId])
  const muted = isOverrideMuted(override)
  // 必须返回原始值（number），不能 return { ... }：
  // Zustand 用 Object.is 比较 snapshot，新对象每次都不等 → useSyncExternalStore 无限重渲染。
  /** 本服 @提及总数（角标数字优先用提及数） */
  const mentionCount = useReadStatesStore((state) => {
    let mentions = 0
    for (const [channelId, gid] of Object.entries(state.guildByChannel)) {
      if (gid !== guildId) continue
      mentions += state.mentionsByChannel[channelId] ?? 0
    }
    return mentions
  })
  /** 本服未读消息总条数（各频道 unreadCount 汇总；静音服不显示普通未读） */
  const unreadMessageCount = useReadStatesStore((state) => {
    let total = 0
    for (const [channelId, gid] of Object.entries(state.guildByChannel)) {
      if (gid !== guildId) continue
      total += channelUnreadCount(state, channelId)
    }
    return total
  })
  // 角标数字：有 @ 用提及总数（穿透静音）；否则用未读消息总条数（静音服不显示普通未读）
  const badgeCount =
    mentionCount > 0
      ? mentionCount
      : !muted && unreadMessageCount > 0
        ? unreadMessageCount
        : 0
  const showBadge = badgeCount > 0

  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leavePending, setLeavePending] = useState(false)

  // 服管入口可见性（docs 18 FR-02：任一管理向权限；无权限完全隐藏不灰置）
  const selfId = useAuthStore((state) => state.user?.id)
  const selfMember = useMembersStore((state) =>
    state.byGuild[guildId]?.find((m) => m.user_id === selfId),
  )
  const roles = useRolesStore((state) => state.byGuild[guildId])
  const canOpenAdmin = canOpenGuildAdmin(
    memberGuildPermissions(selfMember, roles),
    selfMember?.is_owner === true,
  )

  if (!guild) return null

  const handleSelect = () => {
    if (selected) return
    void import("~/lib/ensure-guild-account").then(async (m) => {
      const ok = await m.ensureGuildAccount(guild.id)
      if (!ok) return
      useUIStore.getState().selectGuild(guild.id)
      navigate("/")
    })
  }

  const hasIcon = Boolean(guild.icon_url?.trim())

  const doLeave = async () => {
    setLeavePending(true)
    try {
      const ok = await import("~/lib/ensure-guild-account").then((m) =>
        m.ensureGuildAccount(guild.id),
      )
      if (!ok) {
        setLeavePending(false)
        return
      }
      await leaveGuild(guild.id)
      useGuildsStore.getState().removeGuild(guild.id, guild.account_id)
      useChannelsStore.getState().removeGuild(guild.id)
      useMembersStore.getState().removeGuild(guild.id)
      useRolesStore.getState().removeGuild(guild.id)
      // GPS / 通知覆盖 / 排序清理（docs 17 FR-30）
      useSettingsStore.getState().clearGuildPersonal(guild.id)
      if (useUIStore.getState().selectedGuildId === guild.id) {
        useUIStore.getState().selectGuild(null)
        navigate("/", { replace: true })
      }
      toast.success(`已退出「${guild.name}」`)
      setLeaveOpen(false)
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "退出服务器失败",
      )
    } finally {
      setLeavePending(false)
    }
  }

  return (
    <SidebarMenuItem
      className={cn(
        "relative flex justify-center overflow-visible",
        // 选中时抬高层级，避免相邻条目裁切角标/光晕
        selected && "z-10"
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <SidebarMenuButton
              tooltip={guild.name}
              aria-label={
                showBadge
                  ? mentionCount > 0
                    ? `${guild.name}，${mentionCount} 条未读提及`
                    : `${guild.name}，${badgeCount} 条未读消息`
                  : guild.name
              }
              isActive={selected}
              onClick={handleSelect}
              // size=lg 在 icon 模式下自带 p-0!；再强制去掉 base 的 p-2!，让头像铺满 size-10 按钮
              size="lg"
              className={cn(
                // overflow-visible! 盖过 base 的 overflow-hidden，角标/选中光晕可溢出
                "relative justify-center overflow-visible! rounded-lg p-0! text-xs font-semibold group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-0!",
                // 有图标时去掉色块底，让图片铺满；无图标保留原色块（无描边）
                hasIcon
                  ? "bg-transparent hover:bg-transparent data-active:bg-transparent"
                  : selected
                    ? "bg-primary text-primary-foreground data-active:bg-primary data-active:text-primary-foreground"
                    : "bg-sidebar-accent text-sidebar-accent-foreground",
                muted && !selected && "opacity-60",
              )}
            />
          }
        >
          <GuildAvatar
            guild={guild}
            selected={selected}
            className="absolute inset-0 size-full! rounded-lg"
            fallbackClassName={
              selected && !hasIcon
                ? "bg-primary text-primary-foreground"
                : undefined
            }
          />
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-48">
          <ContextMenuItem onClick={handleSelect}>
            <LogOutIcon className="rotate-180" />
            打开服务器
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => useReadStatesStore.getState().ackGuild(guild.id)}
          >
            <CheckCheckIcon />
            标记为全部已读
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => void copyText("服务器名称", guild.name)}>
            <CopyIcon />
            复制服务器名称
          </ContextMenuItem>
          <ContextMenuItem onClick={() => void copyText("服务器 ID", guild.id)}>
            <HashIcon />
            复制服务器 ID
          </ContextMenuItem>
          <ContextMenuSeparator />
          <NotifyOverrideMenuItems
            override={override}
            inheritLabel="跟随全局"
            onChange={(patch) =>
              useSettingsStore.getState().setGuildNotify(guild.id, patch)
            }
          />
          <ContextMenuSeparator />
          {/* 个人 vs 管理入口严格分离（docs 17 FR-04 / docs 18 FR-03） */}
          <ContextMenuItem
            onClick={() => useUIStore.getState().openGuildPersonal(guild.id)}
          >
            <SlidersHorizontalIcon />
            服务器个人设置
          </ContextMenuItem>
          {canOpenAdmin && (
            <ContextMenuItem
              onClick={() => useUIStore.getState().openGuildAdmin(guild.id)}
            >
              <SettingsIcon />
              服务器设置
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onClick={() => setLeaveOpen(true)}
          >
            <DoorOpenIcon />
            退出服务器
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {/* 多账号：归属账号头像（左下角） */}
      <ServerAccountBadge accountId={guild.account_id ?? accountId} />
      {/* 未读圆形角标（右下；数字封顶 9999+） */}
      {showBadge && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 bottom-0 z-20 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] leading-none font-bold text-white tabular-nums ring-2 ring-sidebar select-none"
        >
          {formatUnreadBadge(badgeCount)}
        </span>
      )}

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>退出服务器</DialogTitle>
            <DialogDescription>
              确定退出「{guild.name}」？退出后需凭邀请重新加入。所有者需先转让所有权。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLeaveOpen(false)}
              disabled={leavePending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => void doLeave()}
              disabled={leavePending}
            >
              退出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  )
}
