// 语音频道主内容区视图（docs 10 / docs 11 观看端）。
//
// FREE 模式（无屏幕共享）：彩色等分卡片（按用户名染色、禁止灰色），
// 点击卡片进入「舞台」放大（顶部占满宽度，其余底部横滑）；再次点击或关闭退出。
// 有人屏幕共享时：顶部主画面 + 底部其余用户横向滚动。
// 卡片菜单：本地静音 / 音量等（⋯ 按钮打开，避免与点击放大冲突）。
// STAGE 模式：上下分区——台上 SPEAKER 大头像网格 +「发言者 N/max」计数（满员变黄），
// 听众区小头像墙（QUEUED 显示举手角标 + 队列位次）；顶部自己的三态横幅；
// 右侧申请队列面板（全员可见简表，管理操作乐观显示、403/404 后隐藏）。
// 屏幕共享观看端：在播者卡片「观看」按钮 → subscribe kinds=["video"] 按需拉流 →
// 内嵌视频主画面（黑底自适应 + 全屏），结束显示占位 2s 优雅退出。
// 禁止默认拉流：连接层在链路 ready 后对全员退订视频轨（协议 §2.1 kinds），
// 不点观看 SFU 不转发视频；观看/停止即订阅/退订，与本地静音（audio）互相独立。

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExpandIcon,
  EyeIcon,
  HandIcon,
  HeadphoneOffIcon,
  ListOrderedIcon,
  MicOffIcon,
  MonitorXIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  RadioIcon,
  Settings2Icon,
  Volume2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { AvatarWithFrame } from "~/components/cosmetics/avatar-frame"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover"
import { Slider } from "~/components/ui/slider"
import { Switch } from "~/components/ui/switch"
import { StageSettingsDialog } from "~/components/voice/stage-settings-dialog"
import { VoiceChannelToolbar } from "~/components/voice/voice-channel-toolbar"
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
import { USER_VOLUME_MAX } from "~/lib/moderation"
import {
  nameInitials,
  resolveProfileAssetUrl,
  voiceParticipantAvatarUrl,
  voiceParticipantDisplayName,
} from "~/lib/user-display"
import { voiceConnection } from "~/lib/voice/connection"
import { screenShare } from "~/lib/voice/screen-share"
import { markSelfStageAction } from "~/lib/voice/stage-notify"
import { screenErrorMessage, stageErrorMessage } from "~/lib/voice/stage-errors"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useCosmeticsStore } from "~/stores/cosmetics"
import { useMembersStore } from "~/stores/members"
import { useSettingsStore } from "~/stores/settings"
import {
  inferChannelMode,
  normalizeStageRole,
  useStageStore,
  type StageChannelState,
} from "~/stores/stage"
import { useVoiceStore } from "~/stores/voice"



/** 结束占位展示时长（docs 11 FR-22） */
const SHARE_ENDED_LINGER_MS = 2_000

/**
 * 根据用户名生成高饱和彩色背景（禁止灰色/低饱和，保证白字可读）。
 * 同一名字稳定同色。
 */
function colorFromUsername(name: string): {
  backgroundColor: string
  color: string
} {
  const key = name.trim() || "?"
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (Math.imul(31, hash) + key.charCodeAt(i)) | 0
  }
  const hue = Math.abs(hash) % 360
  // 饱和度 62–78%、明度 34–44%：始终有色相，白字对比充足
  const sat = 62 + (Math.abs(hash >> 7) % 17)
  const light = 34 + (Math.abs(hash >> 14) % 11)
  return {
    backgroundColor: `hsl(${hue} ${sat}% ${light}%)`,
    color: "#ffffff",
  }
}

// ---------------------------------------------------------------------------
// 放大主卡画框：在可用区域内 fit 严格 16:9 并居中
// ---------------------------------------------------------------------------

function StageFrame({
  children,
  closeButton,
}: {
  children: ReactNode
  closeButton?: ReactNode
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const measure = () => {
      // 用内容盒尺寸（扣掉 padding），避免按外框算 16:9 后被 padding 裁切
      const style = getComputedStyle(host)
      const padX =
        (parseFloat(style.paddingLeft) || 0) +
        (parseFloat(style.paddingRight) || 0)
      const padY =
        (parseFloat(style.paddingTop) || 0) +
        (parseFloat(style.paddingBottom) || 0)
      const w = host.clientWidth - padX
      const h = host.clientHeight - padY
      if (w <= 0 || h <= 0) {
        setBox({ width: 0, height: 0 })
        return
      }
      // 在内容区内最大 16:9 矩形
      let width = w
      let height = (w * 9) / 16
      if (height > h) {
        height = h
        width = (h * 16) / 9
      }
      setBox({ width, height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      ref={hostRef}
      // 底部多留白，避免 16:9 主卡贴底/被圆角与布局裁切
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 pt-3 pb-5"
    >
      {box.width > 0 && box.height > 0 ? (
        <div
          className="relative min-h-0 min-w-0 overflow-hidden rounded-xl"
          style={{ width: box.width, height: box.height, aspectRatio: "16 / 9" }}
        >
          {children}
          {closeButton}
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 底部成员横滑：内容左右居中；溢出时两端显示滚动按钮
// ---------------------------------------------------------------------------

function FocusMemberRail({
  users,
  focusedUserId,
  selfId,
  selfRef,
  freeCardProps,
  isStreaming,
  onSelect,
}: {
  users: VoiceState[]
  focusedUserId: string
  selfId?: string
  selfRef: RefObject<HTMLDivElement | null>
  freeCardProps: {
    guildId: string
    channelId: string
    stageMode: boolean
    showModeration: boolean
    onModerationDenied: () => void
    onWatch: (userId: string) => void
  }
  isStreaming: (state: VoiceState) => boolean
  onSelect: (userId: string) => void
}) {
  const railRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const updateScrollState = useCallback(() => {
    const el = railRef.current
    if (!el) {
      setCanLeft(false)
      setCanRight(false)
      return
    }
    const max = el.scrollWidth - el.clientWidth
    const left = el.scrollLeft
    // 允许 1px 浮点误差
    setCanLeft(left > 1)
    setCanRight(left < max - 1)
  }, [])

  useLayoutEffect(() => {
    const el = railRef.current
    if (!el) return
    updateScrollState()
    const ro = new ResizeObserver(updateScrollState)
    ro.observe(el)
    el.addEventListener("scroll", updateScrollState, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener("scroll", updateScrollState)
    }
  }, [users.length, updateScrollState])

  // 进入舞台后：本人卡滚到视口正中
  useEffect(() => {
    if (!selfId) return
    const rail = railRef.current
    const card = selfRef.current
    if (!rail || !card) return
    const frame = requestAnimationFrame(() => {
      const target =
        card.offsetLeft + card.offsetWidth / 2 - rail.clientWidth / 2
      rail.scrollTo({ left: Math.max(0, target), behavior: "smooth" })
      // smooth 结束后再校正按钮显隐
      window.setTimeout(updateScrollState, 320)
    })
    return () => cancelAnimationFrame(frame)
  }, [selfId, users.length, focusedUserId, selfRef, updateScrollState])

  const scrollByPage = (dir: -1 | 1) => {
    const el = railRef.current
    if (!el) return
    const delta = Math.max(160, el.clientWidth * 0.7) * dir
    el.scrollBy({ left: delta, behavior: "smooth" })
  }

  return (
    // 外层占满底部轨高；内层 h-full + 内边距，卡片 16:9 填满内容区
    <div className="relative h-40 shrink-0">
      {canLeft && (
        <button
          type="button"
          aria-label="向左滚动成员"
          onClick={() => scrollByPage(-1)}
          className={cn(
            "absolute top-1/2 left-1 z-10 flex size-8 -translate-y-1/2 items-center justify-center",
            "rounded-full border border-border/60 bg-background/90 text-foreground shadow-md",
            "backdrop-blur-sm hover:bg-accent",
          )}
        >
          <ChevronLeftIcon className="size-4" />
        </button>
      )}
      {canRight && (
        <button
          type="button"
          aria-label="向右滚动成员"
          onClick={() => scrollByPage(1)}
          className={cn(
            "absolute top-1/2 right-1 z-10 flex size-8 -translate-y-1/2 items-center justify-center",
            "rounded-full border border-border/60 bg-background/90 text-foreground shadow-md",
            "backdrop-blur-sm hover:bg-accent",
          )}
        >
          <ChevronRightIcon className="size-4" />
        </button>
      )}
      <div
        ref={railRef}
        className={cn(
          "flex h-full flex-nowrap items-stretch gap-1.5 overflow-x-auto px-10 py-2",
          // 内容不足一整行时整体水平居中（safe 避免溢出时裁切焦点）
          "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
        )}
        style={{ justifyContent: "safe center" }}
      >
        {users.map((state) => {
          const isSelfCard = Boolean(selfId && state.user_id === selfId)
          return (
            <div
              key={state.user_id}
              ref={isSelfCard ? selfRef : undefined}
              className="h-full shrink-0"
            >
              <FreeVoiceCard
                state={state}
                layout="rail"
                streaming={isStreaming(state)}
                onActivate={() => onSelect(state.user_id)}
                {...freeCardProps}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FREE 模式彩色卡片：grid 等分 / stage 占满主区 / rail 底部横滑
// ---------------------------------------------------------------------------

type FreeCardLayout = "grid" | "stage" | "rail"

function FreeVoiceCard({
  guildId,
  channelId,
  state,
  layout,
  stageMode,
  showModeration,
  onModerationDenied,
  streaming,
  onWatch,
  onActivate,
}: {
  guildId: string
  channelId: string
  state: VoiceState
  layout: FreeCardLayout
  stageMode: boolean
  showModeration: boolean
  onModerationDenied: () => void
  streaming: boolean
  onWatch: (userId: string) => void
  /** 点击卡片主体（不含菜单按钮） */
  onActivate?: () => void
}) {
  const selfUser = useAuthStore((s) => s.user)
  const selfId = selfUser?.id
  const member = useMembersStore((s) =>
    s.byGuild[guildId]?.find((item) => item.user_id === state.user_id),
  )
  const remoteSpeaking = useVoiceStore((s) =>
    Boolean(s.speakingUserIds[state.user_id]),
  )
  const selfSpeaking = useVoiceStore((s) => s.selfSpeaking)
  const locallyMuted = useVoiceStore((s) =>
    Boolean(s.localMuted[state.user_id]),
  )
  const volume = useVoiceStore((s) => s.userVolumes[state.user_id] ?? 100)
  const voicePackMuted = useSettingsStore((s) =>
    s.voice.voicePackMutedUsers.includes(state.user_id),
  )
  const setVoicePackMuted = useSettingsStore((s) => s.setVoicePackMuted)
  // docs 20 FR-R01：本地为其降噪（仅本机下行处理，名单跨端同步）
  const localNsOn = useSettingsStore((s) =>
    Boolean(s.voice.localNs?.[state.user_id]),
  )
  const nsMasterOn = useSettingsStore((s) => s.voice.ns)
  // 头像框：本人走 loadout，他人复用成员进服时缓存的 equippedByUser（零新增请求）
  const avatarFrame = useCosmeticsStore((s) =>
    state.user_id === selfId
      ? s.loadout.avatar_frame
      : s.equippedByUser[state.user_id]?.avatar_frame,
  )

  const isSelf = state.user_id === selfId
  const speaking = isSelf ? selfSpeaking || remoteSpeaking : remoteSpeaking
  const name = voiceParticipantDisplayName(state, member, selfUser)
  const avatarSrc = voiceParticipantAvatarUrl(state, member, selfUser)
  // 本人 banner 优先用自己资料；他人用成员缓存
  const bannerSrc = resolveProfileAssetUrl(
    isSelf
      ? selfUser?.banner_url?.trim() || member?.banner_url
      : member?.banner_url,
  )
  const role = normalizeStageRole(state.stage_role)
  const tint = colorFromUsername(name)

  const runModeration = async (
    action: () => Promise<unknown>,
    successText?: string,
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

  const menu = (
    <Popover>
      <PopoverTrigger
        aria-label={`${name} 的更多操作`}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className={cn(
          "absolute z-10 flex items-center justify-center rounded-md bg-black/25 text-white outline-none hover:bg-black/40 focus-visible:ring-2 focus-visible:ring-white/50",
          layout === "rail" ? "top-1 right-1 size-6" : "top-2 right-2 size-7",
        )}
      >
        <MoreHorizontalIcon className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        className="w-60"
        align="end"
        side="bottom"
        onClick={(event) => event.stopPropagation()}
      >
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
                max={USER_VOLUME_MAX}
                value={[volume]}
                onValueChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value
                  if (typeof next === "number")
                    voiceConnection.setUserVolume(state.user_id, next)
                }}
              />
            </div>
            {/* 本地下行降噪（docs 20 FR-R01/R02；决议 R1 关总开关保留勾选） */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-xs text-muted-foreground"
                  title="仅你听起来更干净，不会改变对方设置；将在多端同步"
                >
                  本地为其降噪
                </span>
                <Switch
                  size="sm"
                  checked={localNsOn}
                  onCheckedChange={(checked) =>
                    voiceConnection.setLocalNs(state.user_id, Boolean(checked))
                  }
                />
              </div>
              {localNsOn && !nsMasterOn && (
                <p className="text-[11px] text-muted-foreground">
                  降噪总开关已关闭，开启后将恢复
                </p>
              )}
            </div>
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
                      "已将其移至听众席",
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
                      "已邀请上台",
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

  const avatarClass =
    layout === "stage"
      ? "size-24"
      : layout === "grid"
        ? "size-16"
        : "size-9"

  // 有 banner 时用背景图；否则回退用户名色块
  const cardStyle = bannerSrc
    ? {
        backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.25), rgba(0,0,0,0.55)), url(${bannerSrc})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        color: "#ffffff",
      }
    : tint

  // 外层用 div：卡片内含 PopoverTrigger（button），不可再套 button（hydration 非法嵌套）
  return (
    <div
      role={onActivate ? "button" : undefined}
      tabIndex={onActivate ? 0 : undefined}
      onClick={onActivate}
      onKeyDown={
        onActivate
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onActivate()
              }
            }
          : undefined
      }
      style={cardStyle}
      className={cn(
        "group relative flex overflow-hidden rounded-xl border-0 text-left outline-none transition-[box-shadow,transform] focus-visible:ring-2 focus-visible:ring-ring/50",
        onActivate && "cursor-pointer",
        // 放大主卡不显示说话外框；网格/横滑小卡保留绿环（无 ring-offset，避免未说话时出现黑边感）
        speaking &&
          layout !== "stage" &&
          "ring-2 ring-emerald-400",
        layout === "grid" &&
          // 原始网格：严格 16:9，宽度上限避免单人撑满
          "aspect-video w-full max-w-[14rem] flex-col items-center justify-center gap-2 p-3 hover:brightness-110 justify-self-start",
        layout === "stage" &&
          // 由外层 StageFrame 保证 16:9 尺寸，卡片填满画框
          "h-full w-full flex-col items-center justify-center gap-3 p-6",
        layout === "rail" &&
          // 有轨高时 h-full 填满；否则 min-h 兜底。宽度一律按 16:9 推导
          "aspect-video h-full min-h-[7rem] w-auto shrink-0 flex-col items-center justify-center gap-1 p-2 hover:brightness-110",
      )}
    >
      {menu}
      <span className="relative">
        {/* 卡片外圈已有说话绿边，头像不再加描边；语音内不显示在线状态点 */}
        {/* 头像框内嵌头像；LIVE 角标保持在框外层 */}
        <AvatarWithFrame frame={avatarFrame} sizeClass={avatarClass}>
          <Avatar
            className={cn(avatarClass, "after:hidden after:border-0")}
          >
            {avatarSrc ? (
              <AvatarImage src={avatarSrc} alt={name} className="object-cover" />
            ) : null}
            <AvatarFallback
              className={cn(
                "bg-black/20 font-semibold text-white",
                layout === "stage" ? "text-2xl" : layout === "grid" ? "text-lg" : "text-[10px]",
              )}
            >
              {nameInitials(name)}
            </AvatarFallback>
          </Avatar>
        </AvatarWithFrame>
        {streaming && (
          <span className="absolute -right-2 -bottom-1 z-[3] rounded-sm bg-red-600 px-1 text-[9px] font-bold text-white select-none">
            LIVE
          </span>
        )}
      </span>
      <span
        className={cn(
          "flex max-w-full items-center justify-center gap-1 font-medium text-white drop-shadow-sm",
          layout === "stage" ? "text-base" : "text-xs",
        )}
      >
        <span className="truncate">{name}</span>
        {isSelf && layout !== "rail" && (
          <span className="shrink-0 text-white/80">（我）</span>
        )}
        {(state.self_mute || state.server_mute) && (
          <MicOffIcon className="size-3.5 shrink-0 text-white/90" />
        )}
        {(state.self_deaf || state.server_deaf) && (
          <HeadphoneOffIcon className="size-3.5 shrink-0 text-white/90" />
        )}
        {locallyMuted && !isSelf && (
          <MicOffIcon className="size-3.5 shrink-0 text-white/70" />
        )}
      </span>
      {state.capacity_muted && layout !== "rail" && (
        <span className="rounded-sm bg-black/25 px-1.5 text-[10px] text-white/90 select-none">
          仅收听
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 参与者卡片（STAGE 台上/听众复用，尺寸两档）
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
  const volume = useVoiceStore((s) => s.userVolumes[state.user_id] ?? 100)
  const voicePackMuted = useSettingsStore((s) =>
    s.voice.voicePackMutedUsers.includes(state.user_id)
  )
  const setVoicePackMuted = useSettingsStore((s) => s.setVoicePackMuted)
  // docs 20 FR-R01：本地为其降噪（仅本机下行处理，名单跨端同步）
  const localNsOn = useSettingsStore((s) =>
    Boolean(s.voice.localNs?.[state.user_id]),
  )
  const nsMasterOn = useSettingsStore((s) => s.voice.ns)
  // 头像框：本人走 loadout，他人复用成员缓存 equippedByUser（零新增请求）
  const avatarFrame = useCosmeticsStore((s) =>
    state.user_id === selfId
      ? s.loadout.avatar_frame
      : s.equippedByUser[state.user_id]?.avatar_frame,
  )

  const isSelf = state.user_id === selfId
  const speaking = isSelf ? selfSpeaking || remoteSpeaking : remoteSpeaking
  const name = voiceParticipantDisplayName(state, member, selfUser)
  const avatarSrc = voiceParticipantAvatarUrl(state, member, selfUser)
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
          // shrink-0：底部横向滚动条内不被压缩
          "group relative flex shrink-0 flex-col items-center gap-1.5 rounded-xl p-2 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/40",
          size === "lg" ? "w-28" : "w-20"
        )}
      >
        <span className="relative">
          {/* 头像框内嵌头像；LIVE / 举手角标保持在框外层 */}
          <AvatarWithFrame frame={avatarFrame} sizeClass={avatarSize}>
            <Avatar
              className={cn(
                avatarSize,
                "after:hidden after:border-0",
                speaking &&
                  "ring-2 ring-emerald-500 ring-offset-2 ring-offset-background"
              )}
            >
              {avatarSrc ? (
                <AvatarImage src={avatarSrc} alt={name} className="object-cover" />
              ) : null}
              <AvatarFallback
                className={size === "lg" ? "text-lg" : "text-[10px]"}
              >
                {nameInitials(name)}
              </AvatarFallback>
            </Avatar>
          </AvatarWithFrame>
          {/* 语音内不显示在线状态点；仅保留 LIVE / 举手角标 */}
          {streaming && (
            <span className="absolute -right-2 -bottom-1 z-[3] rounded-sm bg-red-600 px-1 text-[9px] font-bold text-white select-none">
              LIVE
            </span>
          )}
          {/* 举手角标 + 队列位次（QUEUED，黄色，docs 10 UX-03） */}
          {stageMode && role === "QUEUED" && (
            <span className="absolute -top-1 -right-2 z-[3] flex items-center gap-0.5 rounded-full bg-amber-500 px-1 py-0.5 text-[9px] font-semibold text-white select-none">
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
                max={USER_VOLUME_MAX}
                value={[volume]}
                onValueChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value
                  if (typeof next === "number")
                    voiceConnection.setUserVolume(state.user_id, next)
                }}
              />
            </div>
            {/* 本地下行降噪（docs 20 FR-R01/R02；决议 R1 关总开关保留勾选） */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-xs text-muted-foreground"
                  title="仅你听起来更干净，不会改变对方设置；将在多端同步"
                >
                  本地为其降噪
                </span>
                <Switch
                  size="sm"
                  checked={localNsOn}
                  onCheckedChange={(checked) =>
                    voiceConnection.setLocalNs(state.user_id, Boolean(checked))
                  }
                />
              </div>
              {localNsOn && !nsMasterOn && (
                <p className="text-[11px] text-muted-foreground">
                  降噪总开关已关闭，开启后将恢复
                </p>
              )}
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
  const selfUser = useAuthStore((s) => s.user)
  const selfId = selfUser?.id
  const queue = stage?.queue ?? []

  const resolveName = (userId: string, fallback?: string) => {
    const member = members?.find((item) => item.user_id === userId)
    const name = voiceParticipantDisplayName(
      { user_id: userId },
      member,
      selfUser,
    )
    if (name.startsWith("用户") && fallback) return fallback
    return name
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
                    {nameInitials(name)}
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
  className,
  showClose = true,
}: {
  userId: string
  name: string
  /** 该路共享是否仍在进行（SCREEN_SHARE_STOP / self_stream=false 后为 false） */
  active: boolean
  onClose: () => void
  className?: string
  /** 是否显示「停止观看」；自动主画面场景可隐藏 */
  showClose?: boolean
}) {
  const selfId = useAuthStore((s) => s.user?.id)
  const remoteStream = useStageStore((s) => s.remoteVideos[userId])
  // 本人共享：优先本地预览（SFU 不回环）；他人：remoteVideos 订阅后写入
  const stream =
    remoteStream ??
    (userId === selfId ? screenShare.getLocalStream() : null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  /** 是否曾经真正 active 过；避免「准备中 active=false」误触发 2s 自动关闭 */
  const wasLiveRef = useRef(false)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.srcObject = stream ?? null
    if (stream) void el.play().catch(() => undefined)
  }, [stream])

  useEffect(() => {
    if (active || stream) wasLiveRef.current = true
  }, [active, stream])

  // 共享结束：仅在曾经 live 过后，占位 2s 再优雅退出（docs 11 FR-22）
  useEffect(() => {
    if (active) return
    if (!wasLiveRef.current) return
    // 仍有本地/远端流时不要关（本人采集尚未标 live 但已有预览）
    if (stream) return
    const timer = setTimeout(onClose, SHARE_ENDED_LINGER_MS)
    return () => clearTimeout(timer)
  }, [active, stream, onClose])

  const enterFullscreen = () => {
    void containerRef.current?.requestFullscreen?.().catch(() => undefined)
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-xl bg-black",
        className,
      )}
    >
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-contain"
        />
      ) : (
        <p className="text-sm text-white/70">
          {active || !wasLiveRef.current
            ? "正在加载直播…"
            : "共享已结束"}
        </p>
      )}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs text-white">
          <span className="rounded-sm bg-red-600 px-1 text-[9px] font-bold select-none">
            LIVE
          </span>
          {name} 的屏幕共享
          {userId === selfId ? "（预览）" : ""}
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
          {showClose && (
            <button
              type="button"
              title="停止观看"
              aria-label="停止观看"
              onClick={onClose}
              className="rounded p-1 text-white/80 hover:bg-white/15 hover:text-white"
            >
              <XIcon className="size-4" />
            </button>
          )}
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
  /** 本人在本频道且服务端下发了「被审计」提示时显示横幅 */
  const channelAudited = useVoiceStore(
    (s) => s.channelAudited && s.session?.channelId === channelId
  )
  const stage = useStageStore((s) => s.byChannel[channelId])
  const shares = useStageStore((s) => s.sharesByChannel[channelId])
  const selfScreenPhase = useStageStore((s) => s.selfScreen?.phase)
  const remoteVideos = useStageStore((s) => s.remoteVideos)
  const members = useMembersStore((s) => s.byGuild[guildId])

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  /** 本频道审计提示条：用户可点关闭；换频道后重新显示 */
  const [auditNoticeDismissed, setAuditNoticeDismissed] = useState(false)
  /** 管理操作乐观显示；任一操作 403/404 后收起（docs 10 任务 4 策略） */
  const [moderationHidden, setModerationHidden] = useState(false)
  const [watchingId, setWatchingId] = useState<string | null>(null)
  /**
   * FREE 无共享时：点击卡片进入「舞台」放大的用户 id；
   * null = 等分彩色网格。
   */
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null)
  /**
   * 用户主动点「停止观看」后暂不自动切入下一路；
   * 全部共享结束后复位，下次有人开播再自动观看。
   */
  const skipAutoWatchRef = useRef(false)

  // 仍在房内（channel_id 非空）一律展示——含 connected=false 的「连接中/断线重连」态。
  // 刷新后 SFU 会先标 connected=false 但 channel_id 仍在；旧逻辑滤掉会导致名单空白。
  const participants = useMemo(
    () => (participantsRaw ?? []).filter((item) => Boolean(item.channel_id)),
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
    setFocusedUserId(null)
    setAuditNoticeDismissed(false)
    skipAutoWatchRef.current = false
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
    (state: VoiceState): boolean => {
      if (Boolean(shares?.[state.user_id]) || Boolean(state.self_stream))
        return true
      // 本人从占坑/采集起就算共享中，便于立刻切主画面（不必等 SCREEN_SHARE_START）
      if (
        selfId &&
        state.user_id === selfId &&
        selfScreenPhase &&
        selfScreenPhase !== "idle" &&
        selfScreenPhase !== "stopping"
      ) {
        return true
      }
      return false
    },
    [shares, selfId, selfScreenPhase],
  )

  const selfUser = useAuthStore((s) => s.user)
  const resolveName = useCallback(
    (userId: string): string => {
      const member = members?.find((item) => item.user_id === userId)
      return voiceParticipantDisplayName(
        { user_id: userId },
        member,
        selfUser,
      )
    },
    [members, selfUser]
  )

  // 观看端按需订阅视频轨（kinds=["video"]，见 ScreenShareViewer 注释）
  const startWatching = useCallback((userId: string) => {
    skipAutoWatchRef.current = false
    setWatchingId((current) => {
      if (current && current !== userId)
        voiceConnection.stopWatchingVideo(current)
      // 本人预览无需 SFU 订阅；他人才 subscribe kinds=["video"]
      const me = useAuthStore.getState().user?.id
      if (userId !== me) voiceConnection.startWatchingVideo(userId)
      return userId
    })
  }, [])

  const stopWatching = useCallback(() => {
    skipAutoWatchRef.current = true
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
  // FREE 有人开共享时：顶部主画面 + 底部其余用户横向滚动
  const streamers = useMemo(
    () => participants.filter((item) => isStreaming(item)),
    [participants, isStreaming]
  )
  const nonStreamers = useMemo(
    () => participants.filter((item) => !isStreaming(item)),
    [participants, isStreaming]
  )
  const hasScreenShare = streamers.length > 0
  const streamerIdsKey = streamers.map((item) => item.user_id).join(",")
  // 有人开屏幕共享时退出手动舞台聚焦
  useEffect(() => {
    if (hasScreenShare) setFocusedUserId(null)
  }, [hasScreenShare])
  // 聚焦用户离开频道时退出舞台
  useEffect(() => {
    if (
      focusedUserId &&
      !participants.some((item) => item.user_id === focusedUserId)
    ) {
      setFocusedUserId(null)
    }
  }, [focusedUserId, participants])
  const focusedState = focusedUserId
    ? participants.find((item) => item.user_id === focusedUserId)
    : undefined
  const selfState = selfId
    ? participants.find((item) => item.user_id === selfId)
    : undefined
  /**
   * 手动舞台底部横滑：全体成员（含本人与当前放大对象）；
   * 本人插到中位，再 scroll 到视口正中。
   */
  const focusRailUsers = useMemo(() => {
    if (!focusedUserId) return []
    if (!selfId) return participants
    const selfIdx = participants.findIndex((item) => item.user_id === selfId)
    if (selfIdx < 0) return participants
    const self = participants[selfIdx]
    const rest = participants.filter((item) => item.user_id !== selfId)
    const mid = Math.floor(rest.length / 2)
    return [...rest.slice(0, mid), self, ...rest.slice(mid)]
  }, [participants, focusedUserId, selfId])

  const focusRailSelfRef = useRef<HTMLDivElement>(null)

  const stageFull = speakers.length >= maxSpeakers

  // 有人开共享时自动切入主画面（无需再点「观看直播」）
  useEffect(() => {
    if (!streamerIdsKey) {
      skipAutoWatchRef.current = false
      return
    }
    const ids = streamerIdsKey.split(",").filter(Boolean)
    if (ids.length === 0) {
      skipAutoWatchRef.current = false
      return
    }
    // 当前观看对象仍在共享列表中 → 保持
    if (watchingId && ids.includes(watchingId)) return
    // 用户主动停止观看后：若共享集合未清空则不自动再进；
    // 但若观看对象已离开列表（换人/重开），允许自动切到新的一路
    if (skipAutoWatchRef.current && watchingId && ids.includes(watchingId)) {
      return
    }
    if (skipAutoWatchRef.current && watchingId && !ids.includes(watchingId)) {
      skipAutoWatchRef.current = false
    }
    if (skipAutoWatchRef.current && !watchingId) {
      // 停止观看后 watchingId 已清空：保持跳过，直到本轮共享全部结束
      return
    }
    const preferred =
      (selfId && ids.includes(selfId) ? selfId : null) ?? ids[0]
    if (preferred) startWatching(preferred)
  }, [streamerIdsKey, watchingId, selfId, startWatching])

  // 主画面是否视为「仍在共享」：含本人采集中/发布中（尚未收到 START 事件）
  const watchingHasStream = Boolean(
    watchingId &&
      (remoteVideos[watchingId] ||
        (watchingId === selfId && screenShare.getLocalStream())),
  )
  const watchingActive = Boolean(
    watchingId &&
      (Boolean(shares?.[watchingId]) ||
        Boolean(
          participants.find((item) => item.user_id === watchingId)
            ?.self_stream,
        ) ||
        (watchingId === selfId &&
          Boolean(selfScreenPhase) &&
          selfScreenPhase !== "idle" &&
          selfScreenPhase !== "stopping") ||
        watchingHasStream),
  )

  const tileProps = {
    guildId,
    channelId,
    stageMode: isStage,
    showModeration,
    onModerationDenied: () => setModerationHidden(true),
    onWatch: startWatching,
  }

  const shareViewer =
    watchingId && (
      <ScreenShareViewer
        userId={watchingId}
        name={resolveName(watchingId)}
        active={watchingActive}
        onClose={stopWatching}
        showClose
      />
    )

  const freeCardProps = {
    guildId,
    channelId,
    stageMode: isStage,
    showModeration,
    onModerationDenied: () => setModerationHidden(true),
    onWatch: startWatching,
  }

  /** FREE：无共享=等分彩卡（可点进舞台）；有共享=顶部主画面+底部横滑 */
  const freeParticipantsBody = hasScreenShare ? (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 顶部：共享主画面（自动订阅/本地预览） */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {shareViewer ?? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl bg-muted/40 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              正在准备屏幕共享画面…
            </p>
            {streamers[0] && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => startWatching(streamers[0].user_id)}
              >
                <RadioIcon className="size-3.5 text-red-500" />
                立即观看
              </Button>
            )}
          </div>
        )}
        {streamers.length > 1 && (
          <div
            className={cn(
              "flex shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5",
              "[scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5",
            )}
          >
            {streamers.map((state) => (
              <button
                key={state.user_id}
                type="button"
                onClick={() => startWatching(state.user_id)}
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  watchingId === state.user_id
                    ? "bg-red-600 text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                )}
              >
                {resolveName(state.user_id)}
                {state.user_id === selfId ? "（我）" : ""}
              </button>
            ))}
          </div>
        )}
      </div>
      {nonStreamers.length > 0 && (
        <div className="shrink-0 border-t bg-muted/30">
          <div
            className={cn(
              "flex flex-nowrap items-center gap-1.5 overflow-x-auto px-3 py-2",
              "[scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5",
            )}
          >
            {nonStreamers.map((state) => (
              <FreeVoiceCard
                key={state.user_id}
                state={state}
                layout="rail"
                streaming={false}
                {...freeCardProps}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  ) : focusedState ? (
    /* 手动舞台：顶部 16:9 放大卡居中；底部成员横滑（居中 + 超长左右按钮） */
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <StageFrame
        closeButton={
          <button
            type="button"
            aria-label="退出舞台"
            title="退出舞台"
            onClick={() => setFocusedUserId(null)}
            className="absolute top-2 left-2 z-20 flex size-8 items-center justify-center rounded-lg bg-black/35 text-white hover:bg-black/50"
          >
            <XIcon className="size-4" />
          </button>
        }
      >
        <FreeVoiceCard
          state={focusedState}
          layout="stage"
          streaming={isStreaming(focusedState)}
          onActivate={() => setFocusedUserId(null)}
          {...freeCardProps}
        />
      </StageFrame>
      <FocusMemberRail
        users={focusRailUsers}
        focusedUserId={focusedState.user_id}
        selfId={selfId}
        selfRef={focusRailSelfRef}
        freeCardProps={freeCardProps}
        isStreaming={isStreaming}
        onSelect={(userId) =>
          setFocusedUserId(userId === focusedState.user_id ? null : userId)
        }
      />
    </section>
  ) : (
    /* 等分彩色网格：16:9 卡片，auto-fill 保留空轨 */
    <section
      className={cn(
        "grid min-h-0 flex-1 content-start justify-items-start gap-2 overflow-y-auto p-3",
        "grid-cols-[repeat(auto-fill,minmax(9.5rem,14rem))]",
      )}
    >
      {participants.map((state) => (
        <FreeVoiceCard
          key={state.user_id}
          state={state}
          layout="grid"
          streaming={isStreaming(state)}
          onActivate={() => setFocusedUserId(state.user_id)}
          {...freeCardProps}
        />
      ))}
    </section>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 频道头部：舞台频道用广播图标区分（docs 10 FR-06） */}
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
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
        {channelAudited && (
          <span
            title="本频道音频正在被系统审计录制"
            className="inline-flex items-center gap-1 rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 select-none dark:text-amber-400"
          >
            <EyeIcon className="size-3" />
            审计中
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

      {/* 音频审计提示：可关闭的圆角卡片；换频道后重新出现 */}
      {channelAudited && !auditNoticeDismissed && (
        <div
          role="status"
          className="mx-3 mb-1 flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
        >
          <EyeIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            本频道语音正在被系统审计录制。你的上行音频可能被保存供管理员查阅。
          </span>
          <button
            type="button"
            title="关闭提示"
            aria-label="关闭审计提示"
            onClick={() => setAuditNoticeDismissed(true)}
            className="shrink-0 rounded-md p-1 text-amber-800/70 transition-colors hover:bg-amber-500/15 hover:text-amber-900 dark:text-amber-300/70 dark:hover:text-amber-200"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}

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
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* STAGE 或无「共享专用布局」时：观看画面叠在成员区上方 */}
          {watchingId && (isStage || !hasScreenShare) && (
            <div className="mx-4 mt-3 flex max-h-[55%] min-h-[12rem] shrink-0 flex-col">
              {shareViewer}
            </div>
          )}

          {participants.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <Volume2Icon className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">频道内暂无成员</p>
            </div>
          ) : isStage ? (
            <div className="min-h-0 flex-1 overflow-y-auto pb-24">
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
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col pb-24">
              {freeParticipantsBody}
            </div>
          )}

          {/* 未连接本频道时的加入引导 */}
          {!connectedHere && (
            <div className="flex shrink-0 items-center justify-center border-t bg-background/95 px-4 py-3">
              <Button
                onClick={() => void voiceConnection.join(guildId, channelId)}
              >
                <PhoneIcon className="size-4" />
                加入语音
              </Button>
            </div>
          )}

          {/* 已连接：底部白色毛玻璃控制条（麦 / 视频 / 屏幕 / 降噪 / 闭听 / 挂断） */}
          {connectedHere && (
            <VoiceChannelToolbar guildId={guildId} channelId={channelId} />
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
