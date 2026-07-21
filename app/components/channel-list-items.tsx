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
  HashIcon,
  HeadphoneOffIcon,
  HeadphonesIcon,
  LogOutIcon,
  MicOffIcon,
  PhoneIcon,
  PlusIcon,
  RadioIcon,
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
import { NotifyOverrideMenuItems } from "~/components/notify-override-menu"
import { presenceDotClass } from "~/components/nav-user"
import { createChannel } from "~/lib/api/guilds"
import { ApiError } from "~/lib/api/http"
import type { Channel, ChannelType, VoiceState } from "~/lib/api/types"
import { copyText } from "~/lib/clipboard"
import { VOLUME_PRESETS } from "~/lib/moderation"
import {
  nameInitials,
  voiceParticipantAvatarUrl,
  voiceParticipantDisplayName,
} from "~/lib/user-display"
import { voiceConnection } from "~/lib/voice/connection"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import { useMembersStore } from "~/stores/members"
import { usePresenceStore } from "~/stores/presence"
import {
  channelUnreadCount,
  formatUnreadBadge,
  isChannelUnread,
  useReadStatesStore,
} from "~/stores/read-states"
import { isOverrideMuted, useSettingsStore } from "~/stores/settings"
import { inferChannelMode, useStageStore } from "~/stores/stage"
import { useUIStore } from "~/stores/ui"
import { useVoiceStore } from "~/stores/voice"

function channelErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  return fallback
}

/**
 * 类别标题行（对标 Discord/KOOK）：
 * 左侧「名称 + 折叠箭头」，右侧「+」创建频道；点击名称区域折叠/展开子频道。
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

  const openCreate = (type: "TEXT" | "VOICE") => {
    setChannelName("")
    setCreateType(type)
  }

  const submitCreate = async () => {
    if (!createType) return
    const trimmed = channelName.trim()
    if (!trimmed) {
      toast.error("请输入名称")
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

  return (
    <>
      <div className="group/category flex h-7 w-full items-center gap-0.5 pr-0.5">
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
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <Dialog
        open={createType !== null}
        onOpenChange={(open) => !open && setCreateType(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {createType === "VOICE" ? "创建语音频道" : "创建文字频道"}
            </DialogTitle>
            <DialogDescription>
              将创建在类别「{name}」下。
            </DialogDescription>
          </DialogHeader>
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

  return (
    <ContextMenu>
      {/* block w-full：整行卡片任意位置都可右键，不限于文字/图标区域 */}
      <ContextMenuTrigger className="block w-full">
        <NavLink
          to={href}
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
        <ContextMenuItem onClick={() => void navigate(href)}>
          <HashIcon />
          打开频道
        </ContextMenuItem>
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

  const join = () => {
    void voiceConnection.join(guildId, channel.id)
    void navigate(href)
  }

  return (
    <div className="w-full">
      <ContextMenu>
        {/* block w-full：整行语音频道卡片任意位置都可右键 */}
        <ContextMenuTrigger className="block w-full">
          <button
            type="button"
            title={isAudited ? "加入语音（本频道正在被审计）" : "加入语音"}
            onClick={join}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-muted/70 hover:text-foreground",
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
      {count > 0 && (
        <div className="flex flex-col">
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
