// 频道条目组件：类别标题 / 文字频道 / 语音频道 / 语音参与者（供频道列表与可排序树复用）。

import { useEffect, useState } from "react"
import { NavLink, useNavigate } from "react-router"
import {
  BellOffIcon,
  CheckCheckIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  EyeIcon,
  FolderIcon,
  HashIcon,
  HeadphoneOffIcon,
  HeadphonesIcon,
  LockIcon,
  LogOutIcon,
  MicOffIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  RadioIcon,
  SettingsIcon,
  Trash2Icon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"
import { toast } from "sonner"

import { AdminMemberMenuSection } from "~/components/admin/admin-member-menu"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import {
  ContextMenu,
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
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Switch } from "~/components/ui/switch"
import { NotifyOverrideMenuItems } from "~/components/notify-override-menu"
import { presenceDotClass } from "~/components/nav-user"
import {
  createChannel,
  deleteChannel,
  updateChannel,
} from "~/lib/api/guilds"
import { ApiError } from "~/lib/api/http"
import type { Channel, ChannelType, VoiceState } from "~/lib/api/types"
import { copyText } from "~/lib/clipboard"
import { VOLUME_PRESETS } from "~/lib/moderation"
import { hasPermission, Permissions } from "~/lib/permissions"
import {
  nameInitials,
  voiceParticipantAvatarUrl,
  voiceParticipantDisplayName,
} from "~/lib/user-display"
import { voiceConnection } from "~/lib/voice/connection"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useChannelUnlocksStore } from "~/stores/channel-unlocks"
import { useChannelsStore } from "~/stores/channels"
import { useMembersStore } from "~/stores/members"
import { usePresenceStore } from "~/stores/presence"
import {
  channelUnreadCount,
  formatUnreadBadge,
  isChannelUnread,
  useReadStatesStore,
} from "~/stores/read-states"
import {
  memberGuildPermissions,
  useRolesStore,
} from "~/stores/roles"
import { isOverrideMuted, useSettingsStore } from "~/stores/settings"
import { inferChannelMode, useStageStore } from "~/stores/stage"
import { useUIStore } from "~/stores/ui"
import { useVoiceStore } from "~/stores/voice"

function useCanEditChannel(guildId: string): boolean {
  const selfId = useAuthStore((s) => s.user?.id)
  const systemAdmin = useAuthStore((s) => s.user?.system_admin)
  const self = useMembersStore((s) =>
    s.byGuild[guildId]?.find((m) => m.user_id === selfId),
  )
  const roles = useRolesStore((s) => s.byGuild[guildId])
  if (systemAdmin || self?.is_owner) return true
  const perms = memberGuildPermissions(self, roles)
  return (
    hasPermission(perms, Permissions.MANAGE_CHANNELS) ||
    hasPermission(perms, Permissions.MANAGE_ROLES)
  )
}

function channelErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  return fallback
}

/**
 * 类别标题行（对标 Discord/KOOK）：
 * 左侧「名称 + 折叠箭头」，右侧「+」创建频道；点击名称区域折叠/展开子频道。
 * 有管理权时支持右键：重命名 / 管理分类 / 删除。
 */
export function CategoryHeader({
  guildId,
  categoryId,
  name,
  collapsed,
  onToggleCollapse,
  canManageChannels,
}: {
  guildId: string
  categoryId: string
  name: string
  collapsed: boolean
  onToggleCollapse: () => void
  canManageChannels: boolean
}) {
  const [createType, setCreateType] = useState<"TEXT" | "VOICE" | null>(null)
  const [channelName, setChannelName] = useState("")
  const [pending, setPending] = useState(false)
  const [privateChannel, setPrivateChannel] = useState(false)
  const [lockChannel, setLockChannel] = useState(false)
  const [channelPassword, setChannelPassword] = useState("")
  const [visibleRoleIds, setVisibleRoleIds] = useState<string[]>([])
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(name)
  const [renamePending, setRenamePending] = useState(false)
  const roles = useRolesStore((s) => s.byGuild[guildId])

  const openCreate = (type: "TEXT" | "VOICE") => {
    setChannelName("")
    setPrivateChannel(false)
    setLockChannel(false)
    setChannelPassword("")
    setVisibleRoleIds([])
    setCreateType(type)
  }

  const submitCreate = async () => {
    if (!createType) return
    const trimmed = channelName.trim()
    if (!trimmed) {
      toast.error("请输入名称")
      return
    }
    if (lockChannel && !channelPassword) {
      toast.error("上锁时请设置访问密码")
      return
    }
    setPending(true)
    try {
      const type: ChannelType = createType
      const finalName =
        type === "TEXT"
          ? trimmed.toLowerCase().replace(/\s+/g, "-")
          : trimmed
      const channel = await createChannel(guildId, {
        name: finalName,
        type,
        parent_id: categoryId,
        ...(lockChannel ? { password: channelPassword } : {}),
        ...(privateChannel
          ? { private: true, visible_role_ids: visibleRoleIds }
          : {}),
      })
      useChannelsStore.getState().upsertChannel(channel)
      toast.success(
        type === "VOICE"
          ? `已创建语音频道「${channel.name}」`
          : `已创建文字频道「${channel.name}」`,
      )
      setCreateType(null)
    } catch (error) {
      toast.error(channelErrorMessage(error, "创建失败"))
    } finally {
      setPending(false)
    }
  }

  const submitRename = async () => {
    const trimmed = renameValue.trim()
    if (!trimmed) {
      toast.error("名称不能为空")
      return
    }
    setRenamePending(true)
    try {
      const updated = await updateChannel(categoryId, { name: trimmed })
      useChannelsStore.getState().upsertChannel(updated)
      toast.success("分类已重命名")
      setRenameOpen(false)
    } catch (error) {
      toast.error(channelErrorMessage(error, "重命名失败"))
    } finally {
      setRenamePending(false)
    }
  }

  const onDeleteCategory = async () => {
    const ok = window.confirm(
      `确定删除分类「${name}」？子频道将上浮到根级，不会被删除。`,
    )
    if (!ok) return
    try {
      await deleteChannel(categoryId)
      useChannelsStore.getState().removeChannel(guildId, categoryId)
      toast.success("分类已删除")
    } catch (error) {
      toast.error(channelErrorMessage(error, "删除失败"))
    }
  }

  const headerButton = (
    <button
      type="button"
      onClick={onToggleCollapse}
      aria-expanded={!collapsed}
      aria-label={collapsed ? `展开类别 ${name}` : `折叠类别 ${name}`}
      className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground/80"
    >
      <span className="min-w-0 truncate">{name}</span>
      <ChevronDownIcon
        className={cn(
          "size-3.5 shrink-0 opacity-80 transition-transform duration-150",
          collapsed && "-rotate-90",
        )}
      />
    </button>
  )

  return (
    <>
      <div className="group/category flex h-7 w-full items-center gap-0.5 pr-0.5">
        {canManageChannels ? (
          <ContextMenu>
            <ContextMenuTrigger className="flex min-w-0 flex-1">
              {headerButton}
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-44">
              <ContextMenuItem
                onClick={() => {
                  setRenameValue(name)
                  setRenameOpen(true)
                }}
              >
                <PencilIcon />
                重命名
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() =>
                  useUIStore.getState().openChannelSettings(categoryId)
                }
              >
                <SettingsIcon />
                管理分类
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => openCreate("TEXT")}>
                <HashIcon />
                创建文字频道
              </ContextMenuItem>
              <ContextMenuItem onClick={() => openCreate("VOICE")}>
                <Volume2Icon />
                创建语音频道
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onClick={() => void onDeleteCategory()}
              >
                <Trash2Icon />
                删除分类
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          headerButton
        )}

        {canManageChannels && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`在「${name}」中创建频道`}
              title="创建频道"
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <PlusIcon className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="min-w-40">
              <DropdownMenuItem onClick={() => openCreate("TEXT")}>
                <HashIcon />
                创建文字频道
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openCreate("VOICE")}>
                <Volume2Icon />
                创建语音频道
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  useUIStore.getState().openChannelSettings(categoryId)
                }
              >
                <FolderIcon />
                管理分类
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <Dialog
        open={createType !== null}
        onOpenChange={(open) => !open && setCreateType(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {createType === "VOICE" ? "创建语音频道" : "创建文字频道"}
            </DialogTitle>
            <DialogDescription>
              将创建在类别「{name}」下。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor={`cat-channel-name-${categoryId}`}>名称</Label>
              <Input
                id={`cat-channel-name-${categoryId}`}
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder={
                  createType === "VOICE" ? "例如：大厅" : "例如：general"
                }
                maxLength={100}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    void submitCreate()
                  }
                }}
              />
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <div>
                <p className="text-sm">仅特定角色可见</p>
                <p className="text-xs text-muted-foreground">
                  开启后仅勾选的角色能看到此频道
                </p>
              </div>
              <Switch
                checked={privateChannel}
                onCheckedChange={setPrivateChannel}
              />
            </label>
            {privateChannel && (
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border p-2">
                {(roles ?? [])
                  .filter((r) => !r.is_everyone)
                  .sort((a, b) => b.position - a.position)
                  .map((role) => {
                    const checked = visibleRoleIds.includes(role.id)
                    return (
                      <label
                        key={role.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                      >
                        <input
                          type="checkbox"
                          className="size-3.5 accent-primary"
                          checked={checked}
                          onChange={() => {
                            setVisibleRoleIds((prev) =>
                              checked
                                ? prev.filter((id) => id !== role.id)
                                : [...prev, role.id],
                            )
                          }}
                        />
                        <span
                          className="truncate"
                          style={
                            role.color ? { color: role.color } : undefined
                          }
                        >
                          {role.name}
                        </span>
                      </label>
                    )
                  })}
              </div>
            )}
            <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <div>
                <p className="text-sm">频道上锁</p>
                <p className="text-xs text-muted-foreground">
                  需要密码才能访问
                </p>
              </div>
              <Switch
                checked={lockChannel}
                onCheckedChange={(on) => {
                  setLockChannel(on)
                  if (!on) setChannelPassword("")
                }}
              />
            </label>
            {lockChannel && (
              <div className="space-y-2">
                <Label htmlFor={`cat-channel-pw-${categoryId}`}>访问密码</Label>
                <Input
                  id={`cat-channel-pw-${categoryId}`}
                  type="password"
                  value={channelPassword}
                  maxLength={64}
                  placeholder="1–64 个字符"
                  onChange={(e) => setChannelPassword(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateType(null)}
              disabled={pending}
            >
              取消
            </Button>
            <Button onClick={() => void submitCreate()} disabled={pending}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名分类</DialogTitle>
            <DialogDescription>修改分类「{name}」的显示名称。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`cat-rename-${categoryId}`}>名称</Label>
            <Input
              id={`cat-rename-${categoryId}`}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={100}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void submitRename()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameOpen(false)}
              disabled={renamePending}
            >
              取消
            </Button>
            <Button
              onClick={() => void submitRename()}
              disabled={renamePending}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** 文字频道条目：未读加粗 + 左侧白点、名称右侧未读数红色胶囊（docs 15 UX-02）；
 * 右键：打开 / 已读 / 复制 / 通知覆盖 */
export function TextChannelItem({
  channel,
  guildId,
}: {
  channel: Channel
  guildId: string
}) {
  const navigate = useNavigate()
  const canEdit = useCanEditChannel(guildId)
  const unread = useReadStatesStore((state) => isChannelUnread(state, channel.id))
  const unreadCount = useReadStatesStore((state) => channelUnreadCount(state, channel.id))
  const mentionCount = useReadStatesStore(
    (state) => state.mentionsByChannel[channel.id] ?? 0
  )
  const guildMuted = useSettingsStore((state) =>
    isOverrideMuted(state.notifications.perGuild[guildId])
  )
  const channelOverride = useSettingsStore(
    (state) => state.notifications.perChannel[channel.id]
  )
  const channelMuted = isOverrideMuted(channelOverride)
  // 静音频道/服务器视觉降噪：不显示未读白点/加粗/数字（@ 计数穿透静音，FR-09）
  const showUnread = unread && !guildMuted && !channelMuted
  // 红色胶囊：有新消息显示未读条数；静音时仅 @ 穿透仍显示提及数（均 9999+ 封顶）
  const badgeCount =
    showUnread && unreadCount > 0
      ? unreadCount
      : mentionCount > 0
        ? mentionCount
        : 0
  const href = `/channels/${guildId}/${channel.id}`
  const isLocked = Boolean(channel.locked)
  const knownUnlocked = useChannelUnlocksStore(
    (s) => s.unlocked[channel.id] === true,
  )

  const openTextChannel = () => {
    void import("~/lib/ensure-guild-account").then(async (m) => {
      const ok = await m.ensureGuildAccount(guildId)
      if (!ok) return
      if (isLocked) {
        const unlocked = await useChannelUnlocksStore
          .getState()
          .ensureUnlocked(channel.id, true)
        if (!unlocked) {
          useChannelUnlocksStore.getState().requestUnlock(channel.id, () => {
            void navigate(href)
          })
          return
        }
      }
      void navigate(href)
    })
  }

  return (
    <ContextMenu>
      {/* block w-full：整行卡片任意位置都可右键，不限于文字/图标区域 */}
      <ContextMenuTrigger className="block w-full">
        <NavLink
          to={href}
          onClick={(event) => {
            // 多账号：先切换到频道归属账号再导航（异步，需拦截默认跳转）
            event.preventDefault()
            openTextChannel()
          }}
          className={({ isActive }) =>
            cn(
              "relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/80 hover:bg-muted/70 hover:text-foreground",
              showUnread && "font-semibold text-foreground",
              channelMuted && "text-muted-foreground/70",
              isActive && "bg-muted font-medium text-foreground"
            )
          }
        >
          {/* 未读白点（频道列表左缘，静音服务器视觉降噪不显示） */}
          {showUnread && (
            <span
              aria-label="有未读消息"
              className="absolute top-1/2 -left-1 size-1.5 -translate-y-1/2 rounded-full bg-foreground"
            />
          )}
          <HashIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{channel.name}</span>
          {isLocked && (
            <span title={knownUnlocked ? "已解锁" : "频道已上锁"}>
              <LockIcon
                className={cn(
                  "size-3.5 shrink-0",
                  knownUnlocked
                    ? "text-muted-foreground/50"
                    : "text-amber-600 dark:text-amber-400",
                )}
              />
            </span>
          )}
          {/* 静音角标 */}
          {channelMuted && (
            <BellOffIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
          )}
          {/* 未读/提及红色胶囊（名称右侧；超过 9999 显示 9999+；@ 穿透静音） */}
          {badgeCount > 0 && (
            <span
              aria-label={
                showUnread && unreadCount > 0
                  ? `${unreadCount} 条未读消息`
                  : `${mentionCount} 条未读提及`
              }
              className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white tabular-nums select-none"
            >
              {formatUnreadBadge(badgeCount)}
            </span>
          )}
        </NavLink>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">
        <ContextMenuItem onClick={() => openTextChannel()}>
          <HashIcon />
          打开频道
        </ContextMenuItem>
        {canEdit && (
          <ContextMenuItem
            onClick={() =>
              useUIStore.getState().openChannelSettings(channel.id)
            }
          >
            <SettingsIcon />
            管理频道
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onClick={() => useReadStatesStore.getState().ack(channel.id)}
        >
          <CheckCheckIcon />
          标记为已读
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => void copyText("频道名称", channel.name)}
        >
          <CopyIcon />
          复制频道名称
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => void copyText("频道 ID", channel.id)}
        >
          <HashIcon />
          复制频道 ID
        </ContextMenuItem>
        <ContextMenuSeparator />
        <NotifyOverrideMenuItems
          override={channelOverride}
          inheritLabel="跟随服务器"
          onChange={(patch) =>
            useSettingsStore.getState().setChannelNotify(channel.id, patch)
          }
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** 语音频道内嵌参与者行 + 右键菜单 */
function VoiceParticipantRow({
  guildId,
  state,
}: {
  guildId: string
  state: VoiceState
}) {
  const selfUser = useAuthStore((s) => s.user)
  const selfId = selfUser?.id
  const member = useMembersStore((s) =>
    s.byGuild[guildId]?.find((item) => item.user_id === state.user_id)
  )
  const remoteSpeaking = useVoiceStore((s) =>
    Boolean(s.speakingUserIds[state.user_id])
  )
  const selfSpeaking = useVoiceStore((s) => s.selfSpeaking)
  // docs 20 FR-R01：本地为其降噪（仅本机下行处理，名单跨端同步）
  const localNsOn = useSettingsStore((s) =>
    Boolean(s.voice.localNs?.[state.user_id]),
  )
  const nsMasterOn = useSettingsStore((s) => s.voice.ns)
  // docs 20 FR-R04 P1：每用户模型覆盖（null = 跟随全局）
  const localNsModel = useSettingsStore(
    (s) => s.voice.localNsModels?.[state.user_id] ?? null,
  )
  const locallyMuted = useVoiceStore((s) =>
    Boolean(s.localMuted[state.user_id])
  )
  const userVolume = useVoiceStore((s) => s.userVolumes[state.user_id] ?? 100)
  const streaming = useStageStore(
    (s) =>
      Boolean(
        state.channel_id && s.sharesByChannel[state.channel_id]?.[state.user_id]
      ) || Boolean(state.self_stream)
  )

  const presence = usePresenceStore((s) => s.statusByUser[state.user_id])

  const isSelf = state.user_id === selfId
  const speaking = isSelf ? selfSpeaking || remoteSpeaking : remoteSpeaking
  const name = voiceParticipantDisplayName(state, member, selfUser)
  const avatarSrc = voiceParticipantAvatarUrl(state, member, selfUser)

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full">
        <div className="group flex h-8 items-center gap-2 rounded-md py-1 pr-1 pl-7 text-sm text-muted-foreground hover:bg-muted/50">
          <span className="relative shrink-0">
            <Avatar
              className={cn(
                "size-6 after:border-0",
                // 无头像时去掉描边环，仅用底色块
                !avatarSrc && "after:hidden",
                speaking && "ring-2 ring-emerald-500",
              )}
            >
              {avatarSrc ? (
                <AvatarImage
                  src={avatarSrc}
                  alt={name}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback className="bg-muted text-[10px] text-muted-foreground">
                {nameInitials(name)}
              </AvatarFallback>
            </Avatar>
            <span
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background",
                presenceDotClass(presence)
              )}
            />
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              speaking && "text-foreground"
            )}
          >
            {name}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {streaming && (
              <span className="rounded-sm bg-red-600 px-1 text-[9px] font-bold text-white select-none">
                LIVE
              </span>
            )}
            {locallyMuted && !isSelf && (
              <VolumeXIcon className="size-3.5 text-muted-foreground" />
            )}
            {(state.self_mute || state.server_mute) && (
              <MicOffIcon
                className={cn(
                  "size-3.5",
                  state.server_mute
                    ? "text-destructive"
                    : "text-muted-foreground"
                )}
              />
            )}
            {(state.self_deaf || state.server_deaf) && (
              <HeadphoneOffIcon
                className={cn(
                  "size-3.5",
                  state.server_deaf
                    ? "text-destructive"
                    : "text-muted-foreground"
                )}
              />
            )}
            {!isSelf && (
              <button
                type="button"
                title={locallyMuted ? "取消本地静音" : "本地静音"}
                aria-label={locallyMuted ? "取消本地静音" : "本地静音"}
                onClick={(event) => {
                  event.stopPropagation()
                  voiceConnection.setLocalMute(state.user_id, !locallyMuted)
                }}
                className={cn(
                  "hidden rounded p-0.5 text-muted-foreground group-hover:block hover:text-foreground",
                  locallyMuted && "text-destructive hover:text-destructive"
                )}
              >
                {locallyMuted ? (
                  <Volume2Icon className="size-3.5" />
                ) : (
                  <VolumeXIcon className="size-3.5" />
                )}
              </button>
            )}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        <ContextMenuItem onClick={() => void copyText("显示名", name)}>
          <CopyIcon />
          复制显示名
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => void copyText("用户 ID", state.user_id)}
        >
          <HashIcon />
          复制用户 ID
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => void copyText("提及", `<@${state.user_id}>`)}
        >
          <CopyIcon />
          复制 @提及
        </ContextMenuItem>
        {!isSelf && (
          <>
            <ContextMenuSeparator />
            <ContextMenuGroup>
            <ContextMenuLabel className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              本地音频 · 当前 {userVolume}%
            </ContextMenuLabel>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Volume2Icon />
                用户音量
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-36">
                {VOLUME_PRESETS.map((percent) => (
                  <ContextMenuItem
                    key={percent}
                    onClick={() =>
                      voiceConnection.setUserVolume(state.user_id, percent)
                    }
                  >
                    {userVolume === percent ? (
                      <CheckIcon className="size-4" />
                    ) : (
                      <span className="size-4" />
                    )}
                    {percent}%
                    {percent === 0 ? "（耳机静音）" : ""}
                    {percent === 100 ? "（默认）" : ""}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem
              onClick={() =>
                voiceConnection.setLocalMute(state.user_id, !locallyMuted)
              }
            >
              {locallyMuted ? <Volume2Icon /> : <VolumeXIcon />}
              {locallyMuted ? "取消本地静音" : "本地静音"}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                // 耳机静音 = 输出音量 0（仍订阅，区别于本地静音退订）
                if (userVolume === 0) {
                  voiceConnection.setUserVolume(state.user_id, 100)
                } else {
                  voiceConnection.setUserVolume(state.user_id, 0)
                }
              }}
            >
              <HeadphonesIcon />
              {userVolume === 0 ? "取消耳机静音" : "耳机静音"}
            </ContextMenuItem>
            {/* 本地下行降噪（docs 20 FR-R01/R02）：仅本机处理，不改变对方设置 */}
            <ContextMenuItem
              onClick={() =>
                voiceConnection.setLocalNs(state.user_id, !localNsOn)
              }
            >
              {localNsOn ? (
                <CheckIcon className="size-4" />
              ) : (
                <span className="size-4" />
              )}
              本地为其降噪
              {localNsOn && !nsMasterOn ? "（总开关已关）" : ""}
            </ContextMenuItem>
            {/* 每用户降噪模型覆盖（docs 20 FR-R04 P1；缺省跟随全局） */}
            {localNsOn && (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Volume2Icon />
                  降噪模型
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="min-w-40">
                  {(
                    [
                      [null, "跟随全局"],
                      ["rnnoise", "RNNoise"],
                      ["speex", "Speex 轻量"],
                      ["dtln", "DTLN"],
                      ["deepfilternet", "DeepFilterNet 3"],
                    ] as const
                  ).map(([model, label]) => (
                    <ContextMenuItem
                      key={label}
                      onClick={() =>
                        useSettingsStore
                          .getState()
                          .setLocalNsModel(state.user_id, model)
                      }
                    >
                      {localNsModel === model ? (
                        <CheckIcon className="size-4" />
                      ) : (
                        <span className="size-4" />
                      )}
                      {label}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
            </ContextMenuGroup>
          </>
        )}
        {/* 管理员：服务器静音 / 禁言 / 禁听 / 管理视图 */}
        <AdminMemberMenuSection
          guildId={guildId}
          targetUserId={state.user_id}
          voiceState={state}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** 语音频道：点击加入；右键加入/离开/复制 */
export function VoiceChannelItem({
  channel,
  guildId,
}: {
  channel: Channel
  guildId: string
}) {
  const navigate = useNavigate()
  const canEdit = useCanEditChannel(guildId)
  const participants = useVoiceStore((s) => s.byChannel[channel.id])
  const isCurrent = useVoiceStore((s) => s.session?.channelId === channel.id)
  const isAudited = useVoiceStore(
    (s) => s.channelAudited && s.session?.channelId === channel.id
  )
  const isSelected = useUIStore((s) => s.selectedChannelId === channel.id)
  const isStage = useStageStore((s) => {
    const stage = s.byChannel[channel.id]
    return stage?.instanceKnown ? stage.mode === "STAGE" : undefined
  })

  useEffect(() => {
    void useVoiceStore.getState().fetchChannelStates(guildId, channel.id)
  }, [guildId, channel.id])

  const count = participants?.length ?? 0
  const stageChannel = isStage ?? inferChannelMode(participants) === "STAGE"
  const href = `/channels/${guildId}/${channel.id}`
  const isLocked = Boolean(channel.locked)
  const knownUnlocked = useChannelUnlocksStore(
    (s) => s.unlocked[channel.id] === true,
  )
  const voiceNote = channel.voice_note?.trim() ?? ""

  const doJoin = () => {
    void voiceConnection.join(guildId, channel.id)
    void navigate(href)
  }

  const join = () => {
    void import("~/lib/ensure-guild-account").then(async (m) => {
      const ok = await m.ensureGuildAccount(guildId)
      if (!ok) return
      if (isLocked && !isCurrent) {
        const unlocked = await useChannelUnlocksStore
          .getState()
          .ensureUnlocked(channel.id, true)
        if (!unlocked) {
          useChannelUnlocksStore.getState().requestUnlock(channel.id, doJoin)
          return
        }
      }
      doJoin()
    })
  }

  return (
    <div className="w-full">
      <ContextMenu>
        {/* block w-full：整行语音频道卡片任意位置都可右键 */}
        <ContextMenuTrigger className="block w-full">
          <button
            type="button"
            title={
              isLocked && !knownUnlocked
                ? "频道已上锁，点击输入密码加入"
                : isAudited
                  ? "加入语音（本频道正在被审计）"
                  : "加入语音"
            }
            onClick={join}
            className={cn(
              "relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-muted/70 hover:text-foreground",
              (isCurrent || isSelected) &&
                "bg-muted font-medium text-foreground"
            )}
          >
            {stageChannel ? (
              <RadioIcon className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Volume2Icon className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate">{channel.name}</span>
            {isLocked && (
              <LockIcon
                className={cn(
                  "size-3.5 shrink-0",
                  knownUnlocked
                    ? "text-muted-foreground/50"
                    : "text-amber-600 dark:text-amber-400",
                )}
              />
            )}
            {isAudited && (
              <span
                title="本频道正在被音频审计"
                className="inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-amber-500/15 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
              >
                <EyeIcon className="size-3" />
                审计
              </span>
            )}
            {count > 0 && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {count}
              </span>
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-48">
          <ContextMenuItem onClick={join}>
            <PhoneIcon />
            {isCurrent ? "打开语音视图" : "加入语音频道"}
          </ContextMenuItem>
          {canEdit && (
            <ContextMenuItem
              onClick={() =>
                useUIStore.getState().openChannelSettings(channel.id)
              }
            >
              <SettingsIcon />
              管理频道
            </ContextMenuItem>
          )}
          {isCurrent && (
            <ContextMenuItem
              variant="destructive"
              onClick={() => void voiceConnection.leave()}
            >
              <LogOutIcon />
              断开语音
            </ContextMenuItem>
          )}
          <ContextMenuItem
            onClick={() => useReadStatesStore.getState().ack(channel.id)}
          >
            <CheckCheckIcon />
            标记为已读
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => void copyText("频道名称", channel.name)}
          >
            <CopyIcon />
            复制频道名称
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => void copyText("频道 ID", channel.id)}
          >
            <HashIcon />
            复制频道 ID
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {/* 活动注释 + 在线成员：注释始终在成员列表最上方 */}
      {(voiceNote || count > 0) && (
        <div className="flex flex-col">
          {voiceNote ? (
            <div
              title={voiceNote}
              className="truncate py-0.5 pr-1 pl-7 text-[11px] leading-tight text-sky-600/90 dark:text-sky-400/90"
            >
              {voiceNote}
            </div>
          ) : null}
          {participants?.map((state) => (
            <VoiceParticipantRow
              key={state.user_id}
              guildId={guildId}
              state={state}
            />
          ))}
        </div>
      )}
    </div>
  )
}
