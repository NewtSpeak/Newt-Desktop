// 语音频道主内容区视图（docs 10 / docs 11 观看端）。
//
// FREE 模式：参与者头像网格（speaking 绿描边、闭麦/闭听/直播角标；点击出菜单：
// 本地静音开关 + 音量滑杆 0–200%）。
// STAGE 模式：上下分区——台上 SPEAKER 大头像网格 +「发言者 N/max」计数（满员变黄），
// 听众区小头像墙（QUEUED 显示举手角标 + 队列位次）；顶部自己的三态横幅；
// 右侧申请队列面板（全员可见简表，管理操作乐观显示、403/404 后隐藏）。
// 屏幕共享观看端：在播者卡片「观看」按钮 → subscribe kinds=["video"] 按需拉流 →
// 内嵌视频主画面（黑底自适应 + 全屏），结束显示占位 2s 优雅退出。
// 禁止默认拉流：连接层在链路 ready 后对全员退订视频轨（协议 §2.1 kinds），
// 不点观看 SFU 不转发视频；观看/停止即订阅/退订，与本地静音（audio）互相独立。

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ExpandIcon,
  HandIcon,
  HeadphoneOffIcon,
  ListOrderedIcon,
  MicOffIcon,
  MonitorXIcon,
  PhoneIcon,
  RadioIcon,
  Settings2Icon,
  Volume2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback } from "~/components/ui/avatar"
import { presenceDotClass } from "~/components/nav-user"
import { Button } from "~/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover"
import { Slider } from "~/components/ui/slider"
import { Switch } from "~/components/ui/switch"
import { StageSettingsDialog } from "~/components/voice/stage-settings-dialog"
import { ApiError } from "~/lib/api/http"
import {
  applyStage,
  cancelStageApply,
  stageBringDown,
  stageBringUp,
  stageSelfLeave,
  stopScreenShareOfUser,
} from "~/lib/api/stage"
import type { VoiceState } from "~/lib/api/types"
import { voiceConnection } from "~/lib/voice/connection"
import { markSelfStageAction } from "~/lib/voice/stage-notify"
import { screenErrorMessage, stageErrorMessage } from "~/lib/voice/stage-errors"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useMembersStore } from "~/stores/members"
import { usePresenceStore } from "~/stores/presence"
import { useSettingsStore } from "~/stores/settings"
import {
  inferChannelMode,
  normalizeStageRole,
  useStageStore,
  type StageChannelState,
} from "~/stores/stage"
import { useVoiceStore } from "~/stores/voice"

function userInitials(name: string): string {
  return name.trim().slice(0, 2) || "?"
}

/** 结束占位展示时长（docs 11 FR-22） */
const SHARE_ENDED_LINGER_MS = 2_000

// ---------------------------------------------------------------------------
// 参与者卡片（FREE 网格与 STAGE 台上/听众复用，尺寸两档）
// ---------------------------------------------------------------------------

type ParticipantTileProps = {
  guildId: string
  channelId: string
  state: VoiceState
  size: "lg" | "sm"
  stageMode: boolean
  /** 管理操作是否展示（乐观显示；403 后调用方收起） */
  showModeration: boolean
  onModerationDenied: () => void
  /** 队列位次（QUEUED 角标用） */
  queuePosition: number | null
  /** 该用户是否在直播中 */
  streaming: boolean
  onWatch: (userId: string) => void
}

function ParticipantTile({
  guildId,
  channelId,
  state,
  size,
  stageMode,
  showModeration,
  onModerationDenied,
  queuePosition,
  streaming,
  onWatch,
}: ParticipantTileProps) {
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
  const volume = useVoiceStore((s) => s.userVolumes[state.user_id] ?? 100)
  const presence = usePresenceStore((s) => s.statusByUser[state.user_id])
  const voicePackMuted = useSettingsStore((s) =>
    s.voice.voicePackMutedUsers.includes(state.user_id)
  )
  const setVoicePackMuted = useSettingsStore((s) => s.setVoicePackMuted)

  const isSelf = state.user_id === selfId
  const speaking = isSelf ? selfSpeaking || remoteSpeaking : remoteSpeaking
  const name =
    member?.nickname || member?.username || `用户${state.user_id.slice(0, 6)}`
  const role = normalizeStageRole(state.stage_role)

  const runModeration = async (
    action: () => Promise<unknown>,
    successText?: string
  ) => {
    try {
      await action()
      if (successText) toast.success(successText)
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 403 || error.status === 404)
      ) {
        onModerationDenied()
        toast.error("权限不足，管理操作已隐藏")
        return
      }
      toast.error(stageErrorMessage(error))
    }
  }

  const endOtherShare = async () => {
    try {
      await stopScreenShareOfUser(channelId, state.user_id)
      toast.success("已结束其屏幕共享")
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 403 || error.status === 404)
      ) {
        onModerationDenied()
        toast.error("权限不足，管理操作已隐藏")
        return
      }
      toast.error(screenErrorMessage(error))
    }
  }

  const avatarSize = size === "lg" ? "size-16" : "size-9"

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "group relative flex flex-col items-center gap-1.5 rounded-xl p-2 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/40",
          size === "lg" ? "w-28" : "w-20"
        )}
      >
        <span className="relative">
          <Avatar
            className={cn(
              avatarSize,
              speaking &&
                "ring-2 ring-emerald-500 ring-offset-2 ring-offset-background"
            )}
          >
            <AvatarFallback
              className={size === "lg" ? "text-lg" : "text-[10px]"}
            >
              {userInitials(name)}
            </AvatarFallback>
          </Avatar>
          {/* Presence 状态点（docs 01：头像右下角） */}
          <span
            className={cn(
              "absolute rounded-full ring-2 ring-background",
              size === "lg" ? "right-0.5 bottom-0.5 size-3" : "-right-0.5 -bottom-0.5 size-2.5",
              presenceDotClass(presence)
            )}
          />
          {/* 直播中红色角标（红色 + LIVE 文字双编码，docs 11 UX-07） */}
          {streaming && (
            <span className="absolute -right-2 -bottom-1 rounded-sm bg-red-600 px-1 text-[9px] font-bold text-white select-none">
              LIVE
            </span>
          )}
          {/* 举手角标 + 队列位次（QUEUED，黄色，docs 10 UX-03） */}
          {stageMode && role === "QUEUED" && (
            <span className="absolute -top-1 -right-2 flex items-center gap-0.5 rounded-full bg-amber-500 px-1 py-0.5 text-[9px] font-semibold text-white select-none">
              <HandIcon className="size-2.5" />
              {queuePosition ?? "·"}
            </span>
          )}
        </span>
        <span
          className={cn(
            "flex max-w-full items-center gap-1 text-xs",
            speaking ? "font-medium text-foreground" : "text-muted-foreground"
          )}
        >
          <span className="truncate">{name}</span>
          {(state.self_mute || state.server_mute) && (
            <MicOffIcon
              className={cn(
                "size-3 shrink-0",
                state.server_mute
                  ? "text-destructive"
                  : "text-muted-foreground/70"
              )}
            />
          )}
          {(state.self_deaf || state.server_deaf) && (
            <HeadphoneOffIcon
              className={cn(
                "size-3 shrink-0",
                state.server_deaf
                  ? "text-destructive"
                  : "text-muted-foreground/70"
              )}
            />
          )}
          {locallyMuted && !isSelf && (
            <MicOffIcon className="size-3 shrink-0 text-muted-foreground/40" />
          )}
        </span>
        {/* 容量禁说蓝灰标签（区别于服务器静音，docs 10 FR-22/UX-03） */}
        {state.capacity_muted && (
          <span className="rounded-sm bg-slate-500/15 px-1 text-[10px] text-slate-500 select-none">
            仅收听
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-60" align="center" side="bottom">
        <p className="text-sm font-medium">
          {name}
          {isSelf ? "（我）" : ""}
        </p>
        {!isSelf && (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">本地静音</span>
              <Switch
                size="sm"
                checked={locallyMuted}
                onCheckedChange={(checked) =>
                  voiceConnection.setLocalMute(state.user_id, Boolean(checked))
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between text-xs text-muted-foreground">
                <span>音量</span>
                <span>{volume}%</span>
              </span>
              <Slider
                min={0}
                max={200}
                value={[volume]}
                onValueChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value
                  if (typeof next === "number")
                    voiceConnection.setUserVolume(state.user_id, next)
                }}
              />
            </div>
            {/* 入场音效单人屏蔽（docs 12 FR-19，本地名单持久化） */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                不再播放 TA 的入场音效
              </span>
              <Switch
                size="sm"
                checked={voicePackMuted}
                onCheckedChange={(checked) =>
                  setVoicePackMuted(state.user_id, Boolean(checked))
                }
              />
            </div>
          </>
        )}
        {streaming && !isSelf && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onWatch(state.user_id)}
          >
            <RadioIcon className="size-3.5 text-red-500" />
            观看直播
          </Button>
        )}
        {showModeration && !isSelf && (
          <div className="flex flex-col gap-1.5 border-t pt-2.5">
            {stageMode &&
              (role === "SPEAKER" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void runModeration(
                      () => stageBringDown(channelId, state.user_id),
                      "已将其移至听众席"
                    )
                  }
                >
                  移至听众席
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void runModeration(
                      () => stageBringUp(channelId, state.user_id),
                      "已邀请上台"
                    )
                  }
                >
                  邀请上台
                </Button>
              ))}
            {streaming && (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                onClick={() => {
                  // 结束他人共享需二次确认（docs 11 FR-16）
                  if (!window.confirm(`确定要结束 ${name} 的屏幕共享吗？`))
                    return
                  void endOtherShare()
                }}
              >
                <MonitorXIcon className="size-3.5" />
                结束其共享
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// 自己的三态横幅（STAGE 模式，docs 10 FR-09/FR-22）
// ---------------------------------------------------------------------------

function SelfStageBanner({
  channelId,
  selfState,
  stage,
  queuePosition,
}: {
  channelId: string
  selfState: VoiceState
  stage: StageChannelState | undefined
  queuePosition: number | null
}) {
  const [busy, setBusy] = useState(false)
  const role = normalizeStageRole(selfState.stage_role) ?? "AUDIENCE"

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      toast.error(stageErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  // 容量禁说专属横幅（蓝灰，区别于其他状态，docs 10 FR-22）
  if (selfState.capacity_muted) {
    return (
      <div className="flex items-center justify-between gap-3 border-b bg-slate-500/10 px-4 py-2 text-sm text-slate-600 dark:text-slate-300">
        <span>
          频道人数超限，你处于仅收听状态
          {queuePosition !== null && `（已自动排队，第 ${queuePosition} 位）`}
        </span>
      </div>
    )
  }

  if (role === "SPEAKER") {
    return (
      <div className="flex items-center justify-between gap-3 border-b bg-primary/10 px-4 py-2 text-sm">
        <span className="font-medium">你在台上</span>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            markSelfStageAction()
            void run(() => stageSelfLeave(channelId))
          }}
        >
          下麦
        </Button>
      </div>
    )
  }

  if (role === "QUEUED") {
    return (
      <div className="flex items-center justify-between gap-3 border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
        <span className="flex items-center gap-1.5">
          <HandIcon className="size-4" />
          已举手{queuePosition !== null && ` · 队列第 ${queuePosition} 位`}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            markSelfStageAction()
            void run(() => cancelStageApply(channelId))
          }}
        >
          取消举手
        </Button>
      </div>
    )
  }

  // AUDIENCE
  return (
    <div className="flex items-center justify-between gap-3 border-b bg-muted/60 px-4 py-2 text-sm text-muted-foreground">
      <span>你正在收听</span>
      {stage?.requestToSpeakEnabled ? (
        <Button
          size="sm"
          disabled={busy}
          onClick={() => void run(() => applyStage(channelId))}
        >
          <HandIcon className="size-3.5" />
          举手申请上麦
        </Button>
      ) : (
        <span className="text-xs">本频道由管理员邀请上麦</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 申请队列面板（全员可见简表；管理操作乐观显示，docs 10 FR-12/FR-15）
// ---------------------------------------------------------------------------

function StageQueuePanel({
  guildId,
  channelId,
  stage,
  showModeration,
  onModerationDenied,
  onClose,
}: {
  guildId: string
  channelId: string
  stage: StageChannelState | undefined
  showModeration: boolean
  onModerationDenied: () => void
  onClose: () => void
}) {
  const members = useMembersStore((s) => s.byGuild[guildId])
  const selfId = useAuthStore((s) => s.user?.id)
  const queue = stage?.queue ?? []

  const resolveName = (userId: string, fallback?: string) => {
    const member = members?.find((item) => item.user_id === userId)
    return (
      member?.nickname ||
      member?.username ||
      fallback ||
      `用户${userId.slice(0, 6)}`
    )
  }

  const bringUp = async (userId: string) => {
    try {
      await stageBringUp(channelId, userId)
      toast.success("已邀请上台")
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 403 || error.status === 404)
      ) {
        onModerationDenied()
        toast.error("权限不足，管理操作已隐藏")
        return
      }
      toast.error(stageErrorMessage(error))
    }
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-l bg-muted/30">
      <header className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <span className="text-xs font-medium text-muted-foreground">
          申请队列（{queue.length}）
        </span>
        <button
          type="button"
          aria-label="关闭队列面板"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-2">
        {queue.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            暂无举手申请
          </p>
        ) : (
          queue.map((entry) => {
            const name = resolveName(entry.user_id, entry.name)
            return (
              <div
                key={entry.user_id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60"
              >
                <span className="w-5 shrink-0 text-center text-xs text-muted-foreground tabular-nums">
                  {entry.position}
                </span>
                <Avatar className="size-6 shrink-0">
                  <AvatarFallback className="text-[10px]">
                    {userInitials(name)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-xs">
                  {name}
                  {entry.user_id === selfId && "（我）"}
                </span>
                {showModeration && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => void bringUp(entry.user_id)}
                  >
                    上麦
                  </Button>
                )}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// 屏幕共享播放视图（docs 11 FR-18/FR-19/FR-22）
// ---------------------------------------------------------------------------
//
// 按需订阅（协议 §2.1 kinds）：视频轨默认已由连接层全员退订（不点观看不拉流），
// 点观看 → subscribe {user_id, kinds:["video"]}，停止观看 → unsubscribe 同 kinds。
// video 维度只覆盖屏幕轨（含伴轨），与本地静音的 audio 维度互相独立，无需再做
// 「停止观看后为被本地静音用户回补整人退订」的补偿。

function ScreenShareViewer({
  userId,
  name,
  active,
  onClose,
}: {
  userId: string
  name: string
  /** 该路共享是否仍在进行（SCREEN_SHARE_STOP / self_stream=false 后为 false） */
  active: boolean
  onClose: () => void
}) {
  const stream = useStageStore((s) => s.remoteVideos[userId])
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.srcObject = stream ?? null
    if (stream) void el.play().catch(() => undefined)
  }, [stream])

  // 共享结束：占位 2s 后优雅退出（docs 11 FR-22）
  useEffect(() => {
    if (active) return
    const timer = setTimeout(onClose, SHARE_ENDED_LINGER_MS)
    return () => clearTimeout(timer)
  }, [active, onClose])

  const enterFullscreen = () => {
    void containerRef.current?.requestFullscreen?.().catch(() => undefined)
  }

  return (
    <div
      ref={containerRef}
      className="relative mx-4 mt-3 flex aspect-video max-h-[55%] items-center justify-center overflow-hidden rounded-xl bg-black"
    >
      {active && stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-contain"
        />
      ) : (
        <p className="text-sm text-white/70">
          {active ? "正在加载直播…" : "共享已结束"}
        </p>
      )}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs text-white">
          <span className="rounded-sm bg-red-600 px-1 text-[9px] font-bold select-none">
            LIVE
          </span>
          {name} 的屏幕共享
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            title="全屏"
            aria-label="全屏"
            onClick={enterFullscreen}
            className="rounded p-1 text-white/80 hover:bg-white/15 hover:text-white"
          >
            <ExpandIcon className="size-4" />
          </button>
          <button
            type="button"
            title="停止观看"
            aria-label="停止观看"
            onClick={onClose}
            className="rounded p-1 text-white/80 hover:bg-white/15 hover:text-white"
          >
            <XIcon className="size-4" />
          </button>
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 主视图
// ---------------------------------------------------------------------------

export function VoiceChannelView({
  guildId,
  channelId,
  channelName,
}: {
  guildId: string
  channelId: string
  channelName: string
}) {
  const selfId = useAuthStore((s) => s.user?.id)
  const participantsRaw = useVoiceStore((s) => s.byChannel[channelId])
  const session = useVoiceStore((s) => s.session)
  const stage = useStageStore((s) => s.byChannel[channelId])
  const shares = useStageStore((s) => s.sharesByChannel[channelId])
  const members = useMembersStore((s) => s.byGuild[guildId])

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  /** 管理操作乐观显示；任一操作 403/404 后收起（docs 10 任务 4 策略） */
  const [moderationHidden, setModerationHidden] = useState(false)
  const [watchingId, setWatchingId] = useState<string | null>(null)

  const participants = useMemo(
    () => (participantsRaw ?? []).filter((item) => item.connected !== false),
    [participantsRaw]
  )

  // 进频道：语音成员快照 + 队列快照（404 静默）+ 屏幕配额
  useEffect(() => {
    void useVoiceStore.getState().fetchChannelStates(guildId, channelId)
    void useStageStore.getState().fetchStageSnapshot(channelId)
    void useStageStore.getState().fetchQuota(guildId)
    setModerationHidden(false)
    setQueueOpen(false)
    setWatchingId(null)
    // 离开视图/切频道：不再渲染任何观看画面，退订全部视频轨（省带宽）
    return () => voiceConnection.stopAllWatching()
  }, [guildId, channelId])

  const mode = stage?.instanceKnown
    ? stage.mode
    : inferChannelMode(participants)
  const isStage = mode === "STAGE"
  const maxSpeakers = stage?.maxSpeakers ?? 20
  const connectedHere = session?.channelId === channelId
  const showModeration = !moderationHidden

  const queuePositionOf = useCallback(
    (userId: string): number | null => {
      const entry = stage?.queue.find((item) => item.user_id === userId)
      return entry?.position ?? null
    },
    [stage?.queue]
  )

  const isStreaming = useCallback(
    (state: VoiceState): boolean =>
      Boolean(shares?.[state.user_id]) || Boolean(state.self_stream),
    [shares]
  )

  const resolveName = useCallback(
    (userId: string): string => {
      const member = members?.find((item) => item.user_id === userId)
      return member?.nickname || member?.username || `用户${userId.slice(0, 6)}`
    },
    [members]
  )

  // 观看端按需订阅视频轨（kinds=["video"]，见 ScreenShareViewer 注释）
  const startWatching = useCallback((userId: string) => {
    setWatchingId((current) => {
      if (current && current !== userId)
        voiceConnection.stopWatchingVideo(current)
      voiceConnection.startWatchingVideo(userId)
      return userId
    })
  }, [])

  const stopWatching = useCallback(() => {
    setWatchingId((current) => {
      if (current) voiceConnection.stopWatchingVideo(current)
      return null
    })
  }, [])

  const speakers = participants.filter(
    (item) => normalizeStageRole(item.stage_role) === "SPEAKER"
  )
  const audience = participants.filter(
    (item) => normalizeStageRole(item.stage_role) !== "SPEAKER"
  )
  const selfState = selfId
    ? participants.find((item) => item.user_id === selfId)
    : undefined
  const stageFull = speakers.length >= maxSpeakers

  const watchingActive = watchingId
    ? Boolean(shares?.[watchingId]) ||
      Boolean(
        participants.find((item) => item.user_id === watchingId)?.self_stream
      )
    : false

  const tileProps = {
    guildId,
    channelId,
    stageMode: isStage,
    showModeration,
    onModerationDenied: () => setModerationHidden(true),
    onWatch: startWatching,
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 频道头部：舞台频道用广播图标区分（docs 10 FR-06） */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        {isStage ? (
          <RadioIcon className="size-4 text-muted-foreground" />
        ) : (
          <Volume2Icon className="size-4 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">{channelName}</span>
        {isStage && (
          <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary select-none">
            舞台
          </span>
        )}
        <span className="flex-1" />
        {isStage && (
          <button
            type="button"
            title="申请队列"
            aria-label="申请队列"
            onClick={() => setQueueOpen((open) => !open)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
              queueOpen && "bg-accent text-foreground"
            )}
          >
            <ListOrderedIcon className="size-4" />
            队列
            {(stage?.queue.length ?? 0) > 0 && (
              <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-600 tabular-nums dark:text-amber-400">
                {stage?.queue.length}
              </span>
            )}
          </button>
        )}
        {/* 频道模式设置入口（乐观显示，提交 403 由服务端裁决，docs 10 任务 6） */}
        <button
          type="button"
          title="频道模式设置"
          aria-label="频道模式设置"
          onClick={() => setSettingsOpen(true)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Settings2Icon className="size-4" />
        </button>
      </header>

      {/* 自己的三态横幅（STAGE 且已连接本频道） */}
      {isStage && connectedHere && selfState && (
        <SelfStageBanner
          channelId={channelId}
          selfState={selfState}
          stage={stage}
          queuePosition={selfId ? queuePositionOf(selfId) : null}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* 观看端播放视图（点观看才渲染 = 才消费下行视频） */}
          {watchingId && (
            <ScreenShareViewer
              userId={watchingId}
              name={resolveName(watchingId)}
              active={watchingActive}
              onClose={stopWatching}
            />
          )}

          {participants.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <Volume2Icon className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">频道内暂无成员</p>
            </div>
          ) : isStage ? (
            <>
              {/* 台上区（docs 10 FR-06/FR-07） */}
              <section className="px-4 pt-4">
                <p
                  className={cn(
                    "pb-2 text-xs font-medium select-none",
                    stageFull
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground"
                  )}
                >
                  发言者 {speakers.length}/{maxSpeakers}
                </p>
                {speakers.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
                    暂无发言者
                    {showModeration && "，可从听众或队列中邀请成员上台"}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {speakers.map((state) => (
                      <ParticipantTile
                        key={state.user_id}
                        state={state}
                        size="lg"
                        queuePosition={null}
                        streaming={isStreaming(state)}
                        {...tileProps}
                      />
                    ))}
                  </div>
                )}
              </section>
              {/* 听众区（小头像墙；QUEUED 举手角标） */}
              <section className="px-4 pt-5 pb-4">
                <p className="pb-2 text-xs font-medium text-muted-foreground select-none">
                  听众 · {audience.length}
                </p>
                <div className="flex flex-wrap gap-1">
                  {audience.map((state) => (
                    <ParticipantTile
                      key={state.user_id}
                      state={state}
                      size="sm"
                      queuePosition={queuePositionOf(state.user_id)}
                      streaming={isStreaming(state)}
                      {...tileProps}
                    />
                  ))}
                </div>
              </section>
            </>
          ) : (
            /* FREE 模式：参与者头像网格 */
            <section className="flex flex-1 flex-wrap content-start gap-2 p-4">
              {participants.map((state) => (
                <ParticipantTile
                  key={state.user_id}
                  state={state}
                  size="lg"
                  queuePosition={null}
                  streaming={isStreaming(state)}
                  {...tileProps}
                />
              ))}
            </section>
          )}

          {/* 未连接本频道时的加入引导 */}
          {!connectedHere && (
            <div className="sticky bottom-0 flex shrink-0 items-center justify-center border-t bg-background/95 px-4 py-3">
              <Button
                onClick={() => void voiceConnection.join(guildId, channelId)}
              >
                <PhoneIcon className="size-4" />
                加入语音
              </Button>
            </div>
          )}
        </div>

        {/* 队列面板（右侧，全员可见简表） */}
        {isStage && queueOpen && (
          <StageQueuePanel
            guildId={guildId}
            channelId={channelId}
            stage={stage}
            showModeration={showModeration}
            onModerationDenied={() => setModerationHidden(true)}
            onClose={() => setQueueOpen(false)}
          />
        )}
      </div>

      <StageSettingsDialog
        channelId={channelId}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        stage={stage}
        inferredMode={mode}
      />
    </div>
  )
}
