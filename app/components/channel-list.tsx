// 频道列表栏（240px）：当前选中服务器的可见频道，TEXT/VOICE 分组、按 position 排序。
// 点击 TEXT 频道进入 /channels/:guildId/:channelId；
// VOICE 频道点击即加入（docs 09 FR-01），条目下内嵌参与者行（头像 + 昵称 +
// speaking 高亮 + 静音图标 + 悬停本地静音开关），底部挂语音状态面板。

import { useEffect } from "react"
import { NavLink, useNavigate } from "react-router"
import {
  BellOffIcon,
  HashIcon,
  HeadphoneOffIcon,
  MicOffIcon,
  RadioIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"

import { Avatar, AvatarFallback } from "~/components/ui/avatar"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "~/components/ui/context-menu"
import { NotifyOverrideMenuItems } from "~/components/notify-override-menu"
import { presenceDotClass } from "~/components/nav-user"
import { VoicePanel } from "~/components/voice-panel"
import type { Channel, VoiceState } from "~/lib/api/types"
import { voiceConnection } from "~/lib/voice/connection"
import { dragWindowOnMouseDown } from "~/lib/window-drag"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import { useGuildsStore } from "~/stores/guilds"
import { useMembersStore } from "~/stores/members"
import { usePresenceStore } from "~/stores/presence"
import { isChannelUnread, useReadStatesStore } from "~/stores/read-states"
import { isOverrideMuted, useSettingsStore } from "~/stores/settings"
import { inferChannelMode, useStageStore } from "~/stores/stage"
import { useUIStore } from "~/stores/ui"
import { useVoiceStore } from "~/stores/voice"

function userInitials(name: string): string {
  return name.trim().slice(0, 2) || "?"
}

/** 文字频道条目：未读加粗 + 左侧白点、@数红色胶囊（docs 15 UX-02）；
 * 右键菜单：频道级通知覆盖 + 静音时长（docs 15 FR-08/09 / UX-06） */
function TextChannelItem({
  channel,
  guildId,
}: {
  channel: Channel
  guildId: string
}) {
  const unread = useReadStatesStore((state) => isChannelUnread(state, channel.id))
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
  // 静音频道/服务器视觉降噪：不显示未读白点与加粗（@ 计数照常，FR-09）
  const showUnread = unread && !guildMuted && !channelMuted

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <NavLink
          to={`/channels/${guildId}/${channel.id}`}
          className={({ isActive }) =>
            cn(
              "relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              showUnread && "font-semibold text-sidebar-foreground",
              channelMuted && "text-sidebar-foreground/50",
              isActive &&
                "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
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
          <HashIcon className="size-4 shrink-0 text-sidebar-foreground/50" />
          <span className="min-w-0 flex-1 truncate">{channel.name}</span>
          {/* 静音角标 */}
          {channelMuted && (
            <BellOffIcon className="size-3.5 shrink-0 text-sidebar-foreground/40" />
          )}
          {/* @提及红色胶囊（穿透静音，99+ 封顶） */}
          {mentionCount > 0 && (
            <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white tabular-nums select-none">
              {mentionCount > 99 ? "99+" : mentionCount}
            </span>
          )}
        </NavLink>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
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

/** 语音频道内嵌参与者行（docs 09 FR-13/14/17/24） */
function VoiceParticipantRow({
  guildId,
  state,
}: {
  guildId: string
  state: VoiceState
}) {
  const selfId = useAuthStore((s) => s.user?.id)
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
  const streaming = useStageStore(
    (s) =>
      Boolean(
        state.channel_id && s.sharesByChannel[state.channel_id]?.[state.user_id]
      ) || Boolean(state.self_stream)
  )

  const presence = usePresenceStore((s) => s.statusByUser[state.user_id])

  const isSelf = state.user_id === selfId
  const speaking = isSelf ? selfSpeaking || remoteSpeaking : remoteSpeaking
  const name = member?.nickname || member?.username || state.user_id

  return (
    <div className="group flex h-8 items-center gap-2 rounded-md py-1 pr-1 pl-7 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50">
      <span className="relative shrink-0">
        <Avatar
          className={cn("size-6", speaking && "ring-2 ring-emerald-500")}
        >
          <AvatarFallback className="text-[10px]">
            {userInitials(name)}
          </AvatarFallback>
        </Avatar>
        {/* Presence 状态点（docs 01：头像右下角） */}
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-sidebar",
            presenceDotClass(presence)
          )}
        />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px]",
          speaking && "text-sidebar-foreground"
        )}
      >
        {name}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {/* 直播中红色角标（docs 11 FR-17） */}
        {streaming && (
          <span className="rounded-sm bg-red-600 px-1 text-[9px] font-bold text-white select-none">
            LIVE
          </span>
        )}
        {/* 被本地静音：灰色角标，仅自己可见（FR-24） */}
        {locallyMuted && !isSelf && (
          <VolumeXIcon className="size-3.5 text-sidebar-foreground/50" />
        )}
        {/* 服务器静音红色、自我静音灰色（FR-17，语义对齐 KOOK） */}
        {(state.self_mute || state.server_mute) && (
          <MicOffIcon
            className={cn(
              "size-3.5",
              state.server_mute
                ? "text-destructive"
                : "text-sidebar-foreground/50"
            )}
          />
        )}
        {(state.self_deaf || state.server_deaf) && (
          <HeadphoneOffIcon
            className={cn(
              "size-3.5",
              state.server_deaf
                ? "text-destructive"
                : "text-sidebar-foreground/50"
            )}
          />
        )}
        {/* 悬停：本地静音开关（= 真实退订，仅对他人） */}
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
              "hidden rounded p-0.5 text-sidebar-foreground/60 group-hover:block hover:text-sidebar-foreground",
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
  )
}

/** 语音频道条目：点击即加入并切路由到该频道主视图（docs 09 FR-01 / docs 10 任务 1），
 * 下方内嵌参与者列表与人数；舞台频道用广播图标区分 */
function VoiceChannelItem({
  channel,
  guildId,
}: {
  channel: Channel
  guildId: string
}) {
  const navigate = useNavigate()
  const participants = useVoiceStore((s) => s.byChannel[channel.id])
  const isCurrent = useVoiceStore((s) => s.session?.channelId === channel.id)
  const isSelected = useUIStore((s) => s.selectedChannelId === channel.id)
  const isStage = useStageStore((s) => {
    const stage = s.byChannel[channel.id]
    return stage?.instanceKnown ? stage.mode === "STAGE" : undefined
  })

  // 进入频道列表时拉一次快照；此后靠 Gateway VOICE_STATE_UPDATE 增量维护
  useEffect(() => {
    void useVoiceStore.getState().fetchChannelStates(guildId, channel.id)
  }, [guildId, channel.id])

  const count = participants?.length ?? 0
  const stageChannel = isStage ?? inferChannelMode(participants) === "STAGE"

  return (
    <div>
      <button
        type="button"
        title="加入语音"
        onClick={() => {
          void voiceConnection.join(guildId, channel.id)
          void navigate(`/channels/${guildId}/${channel.id}`)
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          (isCurrent || isSelected) &&
            "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
        )}
      >
        {stageChannel ? (
          <RadioIcon className="size-4 shrink-0 text-sidebar-foreground/50" />
        ) : (
          <Volume2Icon className="size-4 shrink-0 text-sidebar-foreground/50" />
        )}
        <span className="min-w-0 flex-1 truncate">{channel.name}</span>
        {count > 0 && (
          <span className="shrink-0 text-xs text-sidebar-foreground/50">
            {count}
          </span>
        )}
      </button>
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

function ChannelGroup({
  label,
  channels,
  guildId,
}: {
  label: string
  channels: Channel[]
  guildId: string
}) {
  if (channels.length === 0) return null
  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-2 pt-3 pb-1 text-xs font-medium text-sidebar-foreground/60 select-none">
        {label}
      </p>
      {channels.map((channel) =>
        channel.type === "TEXT" ? (
          <TextChannelItem key={channel.id} channel={channel} guildId={guildId} />
        ) : (
          <VoiceChannelItem
            key={channel.id}
            channel={channel}
            guildId={guildId}
          />
        )
      )}
    </div>
  )
}

export function ChannelList() {
  const selectedGuildId = useUIStore((state) => state.selectedGuildId)
  const guild = useGuildsStore((state) =>
    state.guilds.find((item) => item.id === selectedGuildId)
  )
  const channels = useChannelsStore((state) =>
    selectedGuildId ? state.byGuild[selectedGuildId] : undefined
  )
  const loading = useChannelsStore((state) =>
    selectedGuildId ? Boolean(state.loadingGuilds[selectedGuildId]) : false
  )

  // 切换服务器时拉取频道与成员；404（服不可见）由 store 负责清缓存
  useEffect(() => {
    if (!selectedGuildId) return
    void useChannelsStore.getState().fetchChannels(selectedGuildId)
    void useMembersStore
      .getState()
      .fetchMembers(selectedGuildId)
      .catch(() => undefined)
  }, [selectedGuildId])

  if (!selectedGuildId) return null

  const textChannels =
    channels?.filter((channel) => channel.type === "TEXT") ?? []
  const voiceChannels =
    channels?.filter((channel) => channel.type === "VOICE") ?? []

  return (
    <aside
      className="flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground"
      onMouseDown={dragWindowOnMouseDown}
    >
      {/* 服务器名头部 */}
      <header className="flex h-12 shrink-0 items-center border-b px-4">
        <span className="truncate text-sm font-semibold select-none">
          {guild?.name ?? "服务器"}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {channels === undefined && loading ? (
          <p className="px-2 pt-3 text-xs text-sidebar-foreground/60">
            频道加载中…
          </p>
        ) : channels && channels.length === 0 ? (
          <p className="px-2 pt-3 text-xs text-sidebar-foreground/60">
            暂无可见频道
          </p>
        ) : (
          <>
            <ChannelGroup
              label="文字频道"
              channels={textChannels}
              guildId={selectedGuildId}
            />
            <ChannelGroup
              label="语音频道"
              channels={voiceChannels}
              guildId={selectedGuildId}
            />
          </>
        )}
      </div>
      {/* 底部语音状态面板（在语音中时显示） */}
      <VoicePanel />
    </aside>
  )
}
