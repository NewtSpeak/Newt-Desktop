// 底部语音状态面板（docs 09 FR-16 / docs 13 §4，对标 Discord 左下角）：
//   1. 顶栏：连接状态（点击打开流量诊断浮窗）| 降噪占位 + 挂断
//   2. 功能行：摄像头 · 屏幕 · 静音|输入菜单 · 闭听|输出菜单（同一按钮左右分栏）
// 音频链路：麦 → 输入增益 → PeerConnection → SFU；下行 ontrack → <audio>/Gain → 输出设备。

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  AudioLinesIcon,
  CameraOffIcon,
  ChevronDownIcon,
  HeadphoneOffIcon,
  HeadphonesIcon,
  MicIcon,
  MicOffIcon,
  MonitorUpIcon,
  PhoneOffIcon,
  Settings2Icon,
  SignalHighIcon,
  SignalLowIcon,
  SignalMediumIcon,
  SignalZeroIcon,
} from "lucide-react"
import { toast } from "sonner"

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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { Slider } from "~/components/ui/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip"
import type { ScreenQuality } from "~/lib/api/types"
import { voiceConnection } from "~/lib/voice/connection"
import { screenShare, SCREEN_QUALITIES } from "~/lib/voice/screen-share"
import type { VoiceMediaDiagnostics, VoiceStreamStat } from "~/lib/voice/webrtc"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import { useGuildsStore } from "~/stores/guilds"
import {
  inferChannelMode,
  normalizeStageRole,
  useStageStore,
} from "~/stores/stage"
import { useSettingsStore, type VoiceInputMode } from "~/stores/settings"
import { useVoiceStore, type VoicePhase } from "~/stores/voice"

/** 重连超过该时长后升级文案并给出重试按钮（UX-05） */
const RECOVERING_ESCALATE_MS = 30_000
const DEFAULT_DEVICE = "__default__"

type DeviceOption = { deviceId: string; label: string }

const INPUT_MODE_LABELS: Record<VoiceInputMode, string> = {
  "voice-activity": "语音激活",
  "push-to-talk": "按键说话",
}

/** Base UI Select 关闭时 Item 不在 DOM，SelectValue 会回退显示 raw value；显式传入中文标签。 */
function deviceLabel(
  deviceId: string | null | undefined,
  devices: DeviceOption[],
  fallback = "系统默认",
): string {
  if (!deviceId) return fallback
  return devices.find((d) => d.deviceId === deviceId)?.label ?? fallback
}

// ---------------------------------------------------------------------------
// 文案 / 小工具
// ---------------------------------------------------------------------------

function phaseLabel(phase: VoicePhase): string {
  switch (phase) {
    case "joining":
      return "正在加入…"
    case "signaling":
      return "信令连接中…"
    case "negotiating":
      return "协商中…"
    case "connected":
      return "语音已连接"
    case "recovering":
      return "网络重连中…"
    case "suspended":
      return "等待网络…"
    default:
      return ""
  }
}

function SignalIcon({ rttMs }: { rttMs: number | null }) {
  const className = "size-4"
  if (rttMs === null) return <SignalMediumIcon className={className} />
  if (rttMs < 80) return <SignalHighIcon className={className} />
  if (rttMs < 160) return <SignalMediumIcon className={className} />
  if (rttMs < 300) return <SignalLowIcon className={className} />
  return <SignalZeroIcon className={className} />
}

function useRecoveryEscalated(recoveringSince: number | null): boolean {
  const [escalated, setEscalated] = useState(false)
  useEffect(() => {
    if (!recoveringSince) {
      setEscalated(false)
      return
    }
    const evaluate = () =>
      setEscalated(Date.now() - recoveringSince >= RECOVERING_ESCALATE_MS)
    evaluate()
    const timer = setInterval(evaluate, 1_000)
    return () => clearInterval(timer)
  }, [recoveringSince])
  return escalated
}

const STATS_HISTORY = 32

function formatBitrate(bps: number): string {
  if (bps < 1000) return `${bps} bps`
  if (bps < 1_000_000) return `${(bps / 1000).toFixed(1)} kbps`
  return `${(bps / 1_000_000).toFixed(2)} Mbps`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** 简易折线示意：values 为 0+ 序列，自动归一化到 viewBox */
function Sparkline({
  values,
  stroke,
  className,
}: {
  values: number[]
  stroke: string
  className?: string
}) {
  const w = 120
  const h = 36
  const max = Math.max(1, ...values)
  const pts =
    values.length === 0
      ? `0,${h}`
      : values
          .map((v, i) => {
            const x =
              values.length === 1
                ? w / 2
                : (i / (values.length - 1)) * w
            const y = h - (v / max) * (h - 2) - 1
            return `${x.toFixed(1)},${y.toFixed(1)}`
          })
          .join(" ")
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn("h-9 w-full", className)}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  )
}

/** 连接诊断轮询：电平 + RTT + 上下行码率历史（供浮窗示意图） */
function useVoiceDiagnostics(active: boolean) {
  const [rttMs, setRttMs] = useState<number | null>(null)
  const [inputLevel, setInputLevel] = useState(0)
  const [diag, setDiag] = useState<VoiceMediaDiagnostics | null>(null)
  const [upHistory, setUpHistory] = useState<number[]>(() =>
    Array.from({ length: STATS_HISTORY }, () => 0),
  )
  const [downHistory, setDownHistory] = useState<number[]>(() =>
    Array.from({ length: STATS_HISTORY }, () => 0),
  )
  const streamHistRef = useRef<Record<string, number[]>>({})

  useEffect(() => {
    if (!active) {
      setRttMs(null)
      setInputLevel(0)
      setDiag(null)
      setUpHistory(Array.from({ length: STATS_HISTORY }, () => 0))
      setDownHistory(Array.from({ length: STATS_HISTORY }, () => 0))
      streamHistRef.current = {}
      return
    }
    let cancelled = false
    const tick = async () => {
      const stats = await voiceConnection.getDiagnostics()
      if (cancelled) return
      setInputLevel(stats.inputLevel)
      setRttMs(stats.rttMs)
      setDiag(stats)
      setUpHistory((prev) =>
        [...prev.slice(1), stats.bitrateUpBps],
      )
      setDownHistory((prev) =>
        [...prev.slice(1), stats.bitrateDownBps],
      )
      // 分流历史
      const nextHist = { ...streamHistRef.current }
      const seen = new Set<string>()
      for (const stream of stats.streams) {
        seen.add(stream.id)
        const series = nextHist[stream.id] ?? Array.from({ length: STATS_HISTORY }, () => 0)
        nextHist[stream.id] = [...series.slice(1), stream.bitrateBps]
      }
      for (const id of Object.keys(nextHist)) {
        if (!seen.has(id)) delete nextHist[id]
      }
      streamHistRef.current = nextHist
    }
    void tick()
    const timer = setInterval(() => void tick(), 500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [active])

  return {
    rttMs,
    inputLevel,
    diag,
    upHistory,
    downHistory,
    streamHistories: streamHistRef.current,
  }
}

function useAudioDevices() {
  const [inputs, setInputs] = useState<DeviceOption[]>([])
  const [outputs, setOutputs] = useState<DeviceOption[]>([])

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
    const toOption = (
      device: MediaDeviceInfo,
      index: number,
      fallback: string,
    ): DeviceOption => ({
      deviceId: device.deviceId,
      label: device.label || `${fallback} ${index + 1}`,
    })
    setInputs(
      devices
        .filter((d) => d.kind === "audioinput" && d.deviceId)
        .map((d, i) => toOption(d, i, "麦克风")),
    )
    setOutputs(
      devices
        .filter((d) => d.kind === "audiooutput" && d.deviceId)
        .map((d, i) => toOption(d, i, "扬声器")),
    )
  }, [])

  useEffect(() => {
    void refresh()
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh)
    return () =>
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh)
  }, [refresh])

  return { inputs, outputs, refresh }
}

// ---------------------------------------------------------------------------
// 屏幕共享质量弹窗
// ---------------------------------------------------------------------------

function ScreenQualityDialog({
  open,
  onOpenChange,
  onStart,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStart: (quality: ScreenQuality) => void
}) {
  const [quality, setQuality] = useState<ScreenQuality>("720p")
  const labels: Record<ScreenQuality, string> = {
    "480p": "480p · 流畅（15fps）",
    "720p": "720p · 标准（30fps，推荐）",
    "1080p": "1080p · 高清（30fps）",
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>共享屏幕</DialogTitle>
          <DialogDescription>
            选择画面质量后开始共享，接下来在系统弹窗中选择要共享的屏幕或窗口。
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={quality}
          onValueChange={(value) => setQuality(value as ScreenQuality)}
          className="gap-2"
        >
          {SCREEN_QUALITIES.map((item) => (
            <label
              key={item}
              className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm hover:bg-accent/50"
            >
              <RadioGroupItem value={item} />
              {labels[item]}
            </label>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false)
              onStart(quality)
            }}
          >
            开始共享
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// 功能卡片按钮
// ---------------------------------------------------------------------------

function ActionCard({
  title,
  active,
  disabled,
  danger,
  onClick,
  children,
  className,
}: {
  title: string
  active?: boolean
  disabled?: boolean
  danger?: boolean
  onClick?: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-9 flex-1 items-center justify-center rounded-xl bg-muted/70 text-foreground/80 transition-[background-color,color,transform,opacity] active:scale-[0.96] hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-45",
        active && "bg-primary/15 text-primary hover:bg-primary/20",
        danger && "text-destructive hover:bg-destructive/10 hover:text-destructive",
        className,
      )}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// 左右分栏操作：左侧一键（静音/闭听），右侧打开对应设置子菜单
// ---------------------------------------------------------------------------

/** 同一圆角容器内左右两键：左 = 主操作，右 = 下拉菜单触发 */
function SplitActionCard({
  title,
  menuTitle,
  active,
  danger,
  disabled,
  onAction,
  icon,
  menu,
  menuAlign = "center",
}: {
  title: string
  menuTitle: string
  active?: boolean
  danger?: boolean
  disabled?: boolean
  onAction?: () => void
  icon: ReactNode
  menu: ReactNode
  menuAlign?: "start" | "center" | "end"
}) {
  return (
    <div
      className={cn(
        "flex h-9 min-w-0 flex-1 overflow-hidden rounded-xl bg-muted/70 text-foreground/80",
        active && "bg-primary/15 text-primary",
        danger && "bg-destructive/10 text-destructive",
        disabled && "pointer-events-none opacity-45",
      )}
    >
      <button
        type="button"
        title={title}
        aria-label={title}
        disabled={disabled}
        onClick={onAction}
        className={cn(
          "flex min-w-0 flex-1 items-center justify-center transition-colors active:scale-[0.98] hover:bg-black/5 dark:hover:bg-white/5",
          danger && "hover:bg-destructive/15",
          active && !danger && "hover:bg-primary/20",
        )}
      >
        {icon}
      </button>
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              title={menuTitle}
              aria-label={menuTitle}
              disabled={disabled}
              className={cn(
                "flex w-6 shrink-0 items-center justify-center transition-colors hover:bg-black/5 dark:hover:bg-white/5",
                danger && "hover:bg-destructive/15",
                active && !danger && "hover:bg-primary/20",
              )}
            />
          }
        >
          <ChevronDownIcon className="size-3 opacity-70" />
        </PopoverTrigger>
        <PopoverContent side="top" align={menuAlign} className="w-72 gap-3 p-3">
          {menu}
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** 静音（左）+ 输入设备/音量/电平菜单（右） */
function MuteInputSplit({
  inputLevel,
  muted,
  title,
  disabled,
  onToggleMute,
}: {
  inputLevel: number
  muted: boolean
  title: string
  disabled?: boolean
  onToggleMute: () => void
}) {
  const voice = useSettingsStore((s) => s.voice)
  const setVoice = useSettingsStore((s) => s.setVoice)
  const { inputs } = useAudioDevices()
  const openSettings = () => useSettingsStore.getState().openPanel("voice")

  const levelPct = Math.min(
    100,
    Math.round(Math.sqrt(Math.max(0, inputLevel)) * 280),
  )

  return (
    <SplitActionCard
      title={title}
      menuTitle="输入设置"
      active={muted}
      danger={muted}
      disabled={disabled}
      onAction={onToggleMute}
      icon={
        muted ? (
          <MicOffIcon className="size-4" />
        ) : (
          <MicIcon className="size-4" />
        )
      }
      menuAlign="center"
      menu={
        <>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            输入设备
          </p>
          <Select
            value={voice.inputDeviceId ?? DEFAULT_DEVICE}
            onValueChange={(value) =>
              setVoice({
                inputDeviceId:
                  !value || value === DEFAULT_DEVICE ? null : value,
              })
            }
          >
            <SelectTrigger size="sm" className="w-full min-w-0">
              <SelectValue placeholder="系统默认">
                {deviceLabel(voice.inputDeviceId, inputs)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_DEVICE}>系统默认</SelectItem>
              {inputs.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            输入模式
          </p>
          <Select
            value={voice.inputMode}
            onValueChange={(value) =>
              setVoice({ inputMode: value as VoiceInputMode })
            }
          >
            <SelectTrigger size="sm" className="w-full min-w-0">
              <SelectValue placeholder="语音激活">
                {INPUT_MODE_LABELS[voice.inputMode] ?? "语音激活"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="voice-activity">语音激活</SelectItem>
              <SelectItem value="push-to-talk">按键说话</SelectItem>
            </SelectContent>
          </Select>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">输入音量</span>
              <span className="tabular-nums text-muted-foreground">
                {voice.inputVolume}%
              </span>
            </div>
            <Slider
              min={0}
              max={200}
              step={1}
              value={[voice.inputVolume]}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value
                if (typeof next === "number") {
                  setVoice({ inputVolume: next })
                  voiceConnection.applyVoiceSettings({ inputVolume: next })
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">输入电平</span>
              <span className="tabular-nums text-muted-foreground">
                {levelPct}%
                {muted ? " · 已静音" : ""}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-[width,background-color] duration-75",
                  levelPct > 85
                    ? "bg-destructive"
                    : levelPct > 40
                      ? "bg-emerald-500"
                      : "bg-emerald-500/80",
                )}
                style={{ width: `${levelPct}%` }}
              />
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">
              电平来自麦克风监听轨；静音只停上行，不影响指示。
            </p>
          </div>

          <button
            type="button"
            onClick={openSettings}
            className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Settings2Icon className="size-4" />
            打开语音详细设置
          </button>
        </>
      }
    />
  )
}

/** 闭听（左）+ 输出设备/音量菜单（右） */
function DeafOutputSplit({
  selfDeaf,
  disabled,
  onToggleDeaf,
}: {
  selfDeaf: boolean
  disabled?: boolean
  onToggleDeaf: () => void
}) {
  const voice = useSettingsStore((s) => s.voice)
  const setVoice = useSettingsStore((s) => s.setVoice)
  const { outputs } = useAudioDevices()
  const openSettings = () => useSettingsStore.getState().openPanel("voice")

  return (
    <SplitActionCard
      title={selfDeaf ? "取消闭听" : "闭听"}
      menuTitle="输出设置"
      active={selfDeaf}
      danger={selfDeaf}
      disabled={disabled}
      onAction={onToggleDeaf}
      icon={
        selfDeaf ? (
          <HeadphoneOffIcon className="size-4" />
        ) : (
          <HeadphonesIcon className="size-4" />
        )
      }
      menuAlign="end"
      menu={
        <>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            输出设备
          </p>
          <Select
            value={voice.outputDeviceId ?? DEFAULT_DEVICE}
            onValueChange={(value) => {
              const id = !value || value === DEFAULT_DEVICE ? null : value
              setVoice({ outputDeviceId: id })
              voiceConnection.applyVoiceSettings({ outputDeviceId: id })
            }}
          >
            <SelectTrigger size="sm" className="w-full min-w-0">
              <SelectValue placeholder="系统默认">
                {deviceLabel(voice.outputDeviceId, outputs)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_DEVICE}>系统默认</SelectItem>
              {outputs.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">输出音量</span>
              <span className="tabular-nums text-muted-foreground">
                {voice.outputVolume}%
              </span>
            </div>
            <Slider
              min={0}
              max={200}
              step={1}
              value={[voice.outputVolume]}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value
                if (typeof next === "number") {
                  setVoice({ outputVolume: next })
                  voiceConnection.applyVoiceSettings({ outputVolume: next })
                }
              }}
            />
          </div>

          <button
            type="button"
            onClick={openSettings}
            className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Settings2Icon className="size-4" />
            打开语音详细设置
          </button>
        </>
      }
    />
  )
}

/** 连接状态点击浮窗：上下行流量示意图 + 总量 + 分流明细 */
function ConnectionStatsPopover({
  connected,
  statusColor,
  statusLabel,
  locationLabel,
  rttMs,
  latencyHint,
  diag,
  upHistory,
  downHistory,
  streamHistories,
}: {
  connected: boolean
  statusColor: string
  statusLabel: string
  locationLabel: string
  rttMs: number | null
  latencyHint: string
  diag: VoiceMediaDiagnostics | null
  upHistory: number[]
  downHistory: number[]
  streamHistories: Record<string, number[]>
}) {
  const streams = diag?.streams ?? []

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex min-w-0 items-start gap-2 rounded-lg text-left outline-none transition-opacity hover:opacity-90",
              statusColor,
            )}
          />
        }
      >
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
            connected
              ? "bg-emerald-500/15"
              : "bg-amber-500/15",
          )}
        >
          <SignalIcon rttMs={connected ? rttMs : null} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] leading-tight font-semibold">
            {statusLabel}
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
            {locationLabel}
          </span>
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-80 gap-3 p-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">连接与流量</p>
            <p className="text-[11px] text-muted-foreground">{latencyHint}</p>
          </div>
          <div className="text-right text-[10px] text-muted-foreground tabular-nums">
            <div>PC {diag?.connectionState ?? "—"}</div>
            <div>ICE {diag?.iceState ?? "—"}</div>
          </div>
        </div>

        {/* 总上下行示意图 */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-muted/50 p-2">
            <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-sky-600 dark:text-sky-400">
              <ArrowUpIcon className="size-3" />
              上传
            </div>
            <Sparkline values={upHistory} stroke="rgb(14 165 233)" />
            <p className="mt-0.5 text-[11px] font-semibold tabular-nums">
              {formatBitrate(diag?.bitrateUpBps ?? 0)}
            </p>
            <p className="text-[10px] text-muted-foreground tabular-nums">
              累计 {formatBytes(diag?.bytesSent ?? 0)}
            </p>
          </div>
          <div className="rounded-xl bg-muted/50 p-2">
            <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <ArrowDownIcon className="size-3" />
              下载
            </div>
            <Sparkline values={downHistory} stroke="rgb(16 185 129)" />
            <p className="mt-0.5 text-[11px] font-semibold tabular-nums">
              {formatBitrate(diag?.bitrateDownBps ?? 0)}
            </p>
            <p className="text-[10px] text-muted-foreground tabular-nums">
              累计 {formatBytes(diag?.bytesReceived ?? 0)}
            </p>
          </div>
        </div>

        {/* 分流明细 */}
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            分数据流
          </p>
          {streams.length === 0 ? (
            <p className="rounded-lg border border-dashed px-2 py-3 text-center text-[11px] text-muted-foreground">
              {connected
                ? "未检测到媒体轨：请确认未静音且具备发言权限，然后重新进语音"
                : "连接建立后显示各路上行/下行"}
            </p>
          ) : (
            <ul className="flex max-h-44 flex-col gap-1.5 overflow-y-auto">
              {streams.map((stream: VoiceStreamStat) => (
                <li
                  key={stream.id}
                  className="rounded-lg bg-muted/40 px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="min-w-0 truncate font-medium">
                      {stream.label}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatBitrate(stream.bitrateBps)}
                    </span>
                  </div>
                  <Sparkline
                    values={
                      streamHistories[stream.id] ??
                      Array.from({ length: STATS_HISTORY }, () => 0)
                    }
                    stroke={
                      stream.direction === "up"
                        ? "rgb(14 165 233)"
                        : "rgb(16 185 129)"
                    }
                    className="mt-1 h-6"
                  />
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-muted-foreground tabular-nums">
                    <span>累计 {formatBytes(stream.bytesTotal)}</span>
                    {stream.packetsLost > 0 && (
                      <span>丢包 {stream.packetsLost}</span>
                    )}
                    {stream.jitterMs !== null && (
                      <span>抖动 {stream.jitterMs} ms</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// 主面板
// ---------------------------------------------------------------------------

export function VoicePanel() {
  const session = useVoiceStore((state) => state.session)
  const channelName = useChannelsStore((state) => {
    if (!session) return null
    const channels = state.byGuild[session.guildId]
    return (
      channels?.find((channel) => channel.id === session.channelId)?.name ??
      null
    )
  })
  const guildName = useGuildsStore((state) => {
    if (!session) return null
    return state.guilds.find((guild) => guild.id === session.guildId)?.name ?? null
  })
  const escalated = useRecoveryEscalated(session?.recoveringSince ?? null)
  const nsEnabled = useSettingsStore((s) => s.voice.ns)
  const setVoice = useSettingsStore((s) => s.setVoice)

  const selfId = useAuthStore((state) => state.user?.id)
  const stage = useStageStore((state) =>
    session ? state.byChannel[session.channelId] : undefined,
  )
  const channelStates = useVoiceStore((state) =>
    session ? state.byChannel[session.channelId] : undefined,
  )
  const quota = useStageStore((state) =>
    session ? state.quotaByGuild[session.guildId] : undefined,
  )
  const selfScreen = useStageStore((state) => state.selfScreen)
  const [qualityOpen, setQualityOpen] = useState(false)

  const connected = session?.phase === "connected"
  const {
    rttMs,
    inputLevel,
    diag,
    upHistory,
    downHistory,
    streamHistories,
  } = useVoiceDiagnostics(Boolean(session))

  if (!session) return null

  const isStage = stage?.instanceKnown
    ? stage.mode === "STAGE"
    : inferChannelMode(channelStates) === "STAGE"
  const selfRole = normalizeStageRole(
    channelStates?.find((item) => item.user_id === selfId)?.stage_role,
  )

  const inRecovery =
    session.phase === "recovering" || session.phase === "suspended"
  const statusLabel =
    session.error ??
    (inRecovery && escalated
      ? "网络状况不佳，仍在重连…"
      : phaseLabel(session.phase))
  const showRetry = Boolean(session.error) || (inRecovery && escalated)

  const statusColor = connected
    ? "text-emerald-600 dark:text-emerald-400"
    : session.error
      ? "text-destructive"
      : "text-amber-600 dark:text-amber-400"

  const micBlocked =
    session.serverMute ||
    !session.caps.includes("publish_audio") ||
    session.listenOnly
  const muted = session.selfMute || micBlocked
  const selfDeaf = session.selfDeaf
  const micTitle = session.listenOnly
    ? "未获得麦克风权限"
    : session.serverMute
      ? "你已被服务器静音"
      : isStage && selfRole !== "SPEAKER" && micBlocked
        ? "舞台模式下需上台后才能发言"
        : !session.caps.includes("publish_audio") && session.caps.length > 0
          ? "你已被禁言"
          : session.selfMute
            ? "取消静音"
            : "静音"

  // 屏幕共享
  const sharing = selfScreen !== null && selfScreen.phase !== "idle"
  const stageBlocked = isStage && selfRole !== "SPEAKER"
  const screenDisabled = !connected || (stageBlocked && !sharing)
  const quotaText = quota
    ? `（本服 ${quota.used}/${quota.effective_limit}）`
    : ""
  const screenTitle = sharing
    ? "停止屏幕共享"
    : !connected
      ? "语音连接后才能共享屏幕"
      : stageBlocked
        ? "舞台模式下仅台上成员可共享屏幕"
        : `共享屏幕${quotaText}`

  const handleScreenClick = () => {
    if (sharing) {
      void screenShare.stop()
      return
    }
    if (!screenShare.isSupported()) {
      toast.error("当前环境不支持屏幕采集")
      return
    }
    if (!quota || Date.now() - quota.fetchedAt > 60_000) {
      void useStageStore.getState().fetchQuota(session.guildId)
    }
    setQualityOpen(true)
  }

  const latencyHint =
    rttMs === null
      ? "延迟测量中…"
      : rttMs < 80
        ? `延迟 ${rttMs} ms · 极佳`
        : rttMs < 160
          ? `延迟 ${rttMs} ms · 良好`
          : rttMs < 300
            ? `延迟 ${rttMs} ms · 一般`
            : `延迟 ${rttMs} ms · 较差`

  const locationLabel = [channelName ?? "语音频道", guildName]
    .filter(Boolean)
    .join(" / ")

  return (
    <div className="shrink-0 overflow-hidden rounded-2xl bg-white text-foreground dark:bg-card dark:text-card-foreground">
      {session.migrating && (
        <div className="bg-amber-500/15 px-3 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
          线路优化中…
        </div>
      )}

      <div className="flex flex-col gap-2 px-2.5 py-2.5">
        {/* 顶栏：状态（点击=流量诊断）+ 降噪 + 挂断 */}
        <div className="flex items-start justify-between gap-2">
          <ConnectionStatsPopover
            connected={connected}
            statusColor={
              session.error ? "text-destructive" : statusColor
            }
            statusLabel={statusLabel}
            locationLabel={locationLabel}
            rttMs={rttMs}
            latencyHint={latencyHint}
            diag={diag}
            upHistory={upHistory}
            downHistory={downHistory}
            streamHistories={streamHistories}
          />

          <div className="flex shrink-0 items-center gap-0.5">
            {showRetry && (
              <button
                type="button"
                onClick={() => voiceConnection.retry()}
                className="rounded-lg px-2 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                重试
              </button>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={nsEnabled ? "关闭噪声抑制" : "开启噪声抑制"}
                    aria-pressed={nsEnabled}
                    onClick={() => {
                      const next = !nsEnabled
                      setVoice({ ns: next })
                      // ns 在下次采集时生效；提示用户
                      toast.message(
                        next
                          ? "噪声抑制已开启（重进语音后完全生效）"
                          : "噪声抑制已关闭（重进语音后完全生效）",
                      )
                    }}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-muted",
                      nsEnabled
                        ? "text-primary"
                        : "text-muted-foreground",
                    )}
                  />
                }
              >
                <AudioLinesIcon className="size-4" />
              </TooltipTrigger>
              <TooltipContent side="top">
                {nsEnabled ? "噪声抑制：开" : "噪声抑制：关"}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="断开语音"
                    onClick={() => void voiceConnection.leave()}
                    className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  />
                }
              >
                <PhoneOffIcon className="size-4" />
              </TooltipTrigger>
              <TooltipContent side="top">断开</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* 功能行：摄像头 · 屏幕 · 静音|输入 · 闭听|输出（后两者左右分栏） */}
        <div className="flex items-center gap-1">
          <ActionCard
            title="摄像头（即将推出）"
            disabled
            className="opacity-50"
          >
            <CameraOffIcon className="size-4" />
          </ActionCard>

          <ActionCard
            title={screenTitle}
            active={sharing}
            disabled={screenDisabled}
            onClick={handleScreenClick}
          >
            <MonitorUpIcon className="size-4" />
          </ActionCard>

          <MuteInputSplit
            inputLevel={inputLevel}
            muted={muted}
            title={micTitle}
            onToggleMute={() => {
              if (micBlocked && !session.selfMute) {
                toast.error(micTitle)
                return
              }
              voiceConnection.toggleMute()
            }}
          />

          <DeafOutputSplit
            selfDeaf={selfDeaf}
            onToggleDeaf={() => voiceConnection.toggleDeaf()}
          />
        </div>
      </div>

      <ScreenQualityDialog
        open={qualityOpen}
        onOpenChange={setQualityOpen}
        onStart={(quality) =>
          void screenShare.start(session.channelId, quality)
        }
      />
    </div>
  )
}
