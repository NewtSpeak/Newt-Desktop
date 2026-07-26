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
  CheckIcon,
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
  SlidersHorizontalIcon,
  SparklesIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
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
import {
  DFN_PRESETS,
  DTLN_PRESETS,
  isNsModelImplemented,
  NOISE_MODELS,
  resolveDfnPreset,
  resolveDtlnPreset,
  uplinkWasmModel,
  type DfnPresetId,
  type DtlnPresetId,
  type NoiseModelId,
} from "~/lib/noise-suppression"
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

/** 右键菜单快捷强度档位（0–100 干/湿混合） */
const NS_STRENGTH_PRESETS = [0, 25, 50, 75, 90, 100] as const

/** DeepFilterNet 首次选用算力确认（与设置页共用 key） */
const DFN_CONFIRM_KEY = "owl.nsDfnConfirmed"

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
  fallback = "系统默认"
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
              values.length === 1 ? w / 2 : (i / (values.length - 1)) * w
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
    Array.from({ length: STATS_HISTORY }, () => 0)
  )
  const [downHistory, setDownHistory] = useState<number[]>(() =>
    Array.from({ length: STATS_HISTORY }, () => 0)
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
      setUpHistory((prev) => [...prev.slice(1), stats.bitrateUpBps])
      setDownHistory((prev) => [...prev.slice(1), stats.bitrateDownBps])
      // 分流历史
      const nextHist = { ...streamHistRef.current }
      const seen = new Set<string>()
      for (const stream of stats.streams) {
        seen.add(stream.id)
        const series =
          nextHist[stream.id] ?? Array.from({ length: STATS_HISTORY }, () => 0)
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
    const devices = await navigator.mediaDevices
      .enumerateDevices()
      .catch(() => [])
    const toOption = (
      device: MediaDeviceInfo,
      index: number,
      fallback: string
    ): DeviceOption => ({
      deviceId: device.deviceId,
      label: device.label || `${fallback} ${index + 1}`,
    })
    setInputs(
      devices
        .filter((d) => d.kind === "audioinput" && d.deviceId)
        .map((d, i) => toOption(d, i, "麦克风"))
    )
    setOutputs(
      devices
        .filter((d) => d.kind === "audiooutput" && d.deviceId)
        .map((d, i) => toOption(d, i, "扬声器"))
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
        "flex h-9 flex-1 items-center justify-center rounded-xl bg-muted/70 text-foreground/80 transition-[background-color,color,transform,opacity] hover:bg-muted hover:text-foreground active:scale-[0.96] disabled:pointer-events-none disabled:opacity-45",
        active && "bg-primary/15 text-primary hover:bg-primary/20",
        danger &&
          "text-destructive hover:bg-destructive/10 hover:text-destructive",
        className
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
        disabled && "pointer-events-none opacity-45"
      )}
    >
      <button
        type="button"
        title={title}
        aria-label={title}
        disabled={disabled}
        onClick={onAction}
        className={cn(
          "flex min-w-0 flex-1 items-center justify-center transition-colors hover:bg-black/5 active:scale-[0.98] dark:hover:bg-white/5",
          danger && "hover:bg-destructive/15",
          active && !danger && "hover:bg-primary/20"
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
                active && !danger && "hover:bg-primary/20"
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
    Math.round(Math.sqrt(Math.max(0, inputLevel)) * 280)
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
            onValueChange={(value) => {
              setVoice({
                inputDeviceId:
                  !value || value === DEFAULT_DEVICE ? null : value,
              })
              voiceConnection.applyVoiceSettings({ reinitMic: true })
            }}
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
              <span className="text-muted-foreground tabular-nums">
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
              <span className="text-muted-foreground tabular-nums">
                {levelPct}%{muted ? " · 已静音" : ""}
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
                      : "bg-emerald-500/80"
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
              <span className="text-muted-foreground tabular-nums">
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
              "flex min-w-0 items-start gap-2 rounded-lg text-left transition-opacity outline-none hover:opacity-90",
              statusColor
            )}
          />
        }
      >
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
            connected ? "bg-emerald-500/15" : "bg-amber-500/15"
          )}
        >
          <SignalIcon rttMs={connected ? rttMs : null} />
        </span>
        <span className="min-w-0 overflow-hidden">
          <span className="block truncate text-[13px] leading-tight font-semibold">
            {statusLabel}
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
            {locationLabel}
          </span>
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 gap-3 p-3">
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
                    <span className="shrink-0 text-muted-foreground tabular-nums">
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
    return (
      state.guilds.find((guild) => guild.id === session.guildId)?.name ?? null
    )
  })
  const escalated = useRecoveryEscalated(session?.recoveringSince ?? null)
  const nsEnabled = useSettingsStore((s) => s.voice.ns)
  const nsModel = useSettingsStore((s) => s.voice.nsModel)
  const nsStrength =
    useSettingsStore((s) => s.voice.nsStrengthByModel?.[s.voice.nsModel]) ?? 100
  const dfnPreset = useSettingsStore((s) => s.voice.dfnPreset ?? "env-keyboard")
  const dtlnPreset = useSettingsStore(
    (s) => s.voice.dtlnPreset ?? "env-keyboard",
  )
  const setVoice = useSettingsStore((s) => s.setVoice)
  const setNsStrength = useSettingsStore((s) => s.setNsStrength)
  const applyDfnPreset = useSettingsStore((s) => s.applyDfnPreset)
  const applyDtlnPreset = useSettingsStore((s) => s.applyDtlnPreset)

  const selfId = useAuthStore((state) => state.user?.id)
  const stage = useStageStore((state) =>
    session ? state.byChannel[session.channelId] : undefined
  )
  const channelStates = useVoiceStore((state) =>
    session ? state.byChannel[session.channelId] : undefined
  )
  const quota = useStageStore((state) =>
    session ? state.quotaByGuild[session.guildId] : undefined
  )
  const selfScreen = useStageStore((state) => state.selfScreen)
  const [qualityOpen, setQualityOpen] = useState(false)
  /** Tauri 下 window.confirm 易被挡/误关，导致 DeepFilterNet「点了没反应」 */
  const [dfnConfirmOpen, setDfnConfirmOpen] = useState(false)
  const dfnConfirmAcceptedRef = useRef(false)

  const commitNoiseModel = useCallback(
    (model: NoiseModelId) => {
      const meta = NOISE_MODELS.find((item) => item.id === model)
      if (!meta) return
      console.info("[noise-suppression] 语音面板切换降噪模型 →", model, {
        available: isNsModelImplemented(model),
        nsEnabled,
      })
      setVoice({ nsModel: model })
      toast.message(
        nsEnabled
          ? `降噪模型已切换为 ${meta.label}`
          : `已选择 ${meta.label}，开启降噪后生效`,
      )
    },
    [nsEnabled, setVoice],
  )

  const selectNoiseModel = useCallback(
    (value: string | null) => {
      if (value == null) return
      const model = value as NoiseModelId
      const meta = NOISE_MODELS.find((item) => item.id === model)
      if (!meta?.implemented) {
        toast.message("该模型即将推出")
        return
      }
      // 不在此处用能力检测拦截：允许选定，运行时 createNsNodeWithFallback 会加载/回退并打日志
      if (model === "deepfilternet" && !window.localStorage.getItem(DFN_CONFIRM_KEY)) {
        console.info(
          "[noise-suppression] 语音面板弹出 DeepFilterNet 算力确认对话框",
        )
        dfnConfirmAcceptedRef.current = false
        setDfnConfirmOpen(true)
        return
      }
      commitNoiseModel(model)
    },
    [commitNoiseModel],
  )

  const confirmDeepFilterNet = useCallback(() => {
    dfnConfirmAcceptedRef.current = true
    window.localStorage.setItem(DFN_CONFIRM_KEY, "1")
    setDfnConfirmOpen(false)
    console.info("[noise-suppression] 用户确认启用 DeepFilterNet（语音面板）")
    commitNoiseModel("deepfilternet")
  }, [commitNoiseModel])

  const applyNsStrength = useCallback(
    (percent: number) => {
      setNsStrength(nsModel, percent)
      toast.message(`降噪强度 ${percent}%`)
    },
    [nsModel, setNsStrength],
  )

  const applyNsPreset = useCallback(
    (presetId: string) => {
      if (nsModel === "deepfilternet") {
        applyDfnPreset(presetId as DfnPresetId)
        const meta = resolveDfnPreset(presetId as DfnPresetId)
        toast.message(`降噪预设：${meta.label}`)
        return
      }
      if (nsModel === "dtln") {
        applyDtlnPreset(presetId as DtlnPresetId)
        const meta = resolveDtlnPreset(presetId as DtlnPresetId)
        toast.message(`降噪预设：${meta.label}`)
      }
    },
    [applyDfnPreset, applyDtlnPreset, nsModel],
  )

  const connected = session?.phase === "connected"
  const { rttMs, inputLevel, diag, upHistory, downHistory, streamHistories } =
    useVoiceDiagnostics(Boolean(session))

  if (!session) return null

  const isStage = stage?.instanceKnown
    ? stage.mode === "STAGE"
    : inferChannelMode(channelStates) === "STAGE"
  const selfRole = normalizeStageRole(
    channelStates?.find((item) => item.user_id === selfId)?.stage_role
  )

  const inRecovery =
    session.phase === "recovering" || session.phase === "suspended"
  /** 严重网络问题：在语音卡片外横幅提示，避免卡内长文换行 */
  const showNetworkBanner =
    Boolean(session.error) || (inRecovery && escalated)
  const bannerText =
    session.error?.trim() ||
    (inRecovery ? "网络状况不佳，仍在重连…" : "")
  // 卡片内只保留短状态，不放长错误文案
  const statusLabel = session.error
    ? "连接异常"
    : inRecovery
      ? session.phase === "suspended"
        ? "等待网络…"
        : "重连中…"
      : phaseLabel(session.phase)
  const showRetry = showNetworkBanner

  const statusColor = connected
    ? "text-emerald-600 dark:text-emerald-400"
    : session.error || showNetworkBanner
      ? "text-destructive"
      : inRecovery
        ? "text-amber-600 dark:text-amber-400"
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
    <div className="flex shrink-0 flex-col gap-1.5">
      {/* 网络异常横幅：在语音卡片外部，无描边，仅错误色底 + 文案 */}
      {showNetworkBanner && bannerText ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-2xl bg-destructive/12 px-3 py-2 text-destructive dark:bg-destructive/15 dark:text-red-400"
        >
          <p className="min-w-0 flex-1 text-[12px] leading-snug font-medium">
            {bannerText}
          </p>
          {showRetry ? (
            <button
              type="button"
              onClick={() => voiceConnection.retry()}
              className="shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-semibold text-destructive/90 transition-colors hover:bg-destructive/10 dark:text-red-300"
            >
              重试
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl bg-white text-foreground dark:bg-card dark:text-card-foreground">
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
            statusColor={statusColor}
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
            <ContextMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ContextMenuTrigger
                      render={
                        <button
                          type="button"
                          aria-label={
                            nsEnabled ? "关闭噪声抑制" : "开启噪声抑制"
                          }
                          aria-pressed={nsEnabled}
                          onClick={() => {
                            const next = !nsEnabled
                            setVoice({ ns: next })
                            toast.message(
                              next ? "噪声抑制已开启" : "噪声抑制已关闭"
                            )
                          }}
                          className={cn(
                            "flex size-8 items-center justify-center rounded-lg transition-[color,background-color,transform] hover:bg-muted active:scale-[0.96]",
                            nsEnabled
                              ? "text-emerald-500 dark:text-emerald-400"
                              : "text-muted-foreground"
                          )}
                        />
                      }
                    />
                  }
                >
                  <AudioLinesIcon className="size-4" />
                </TooltipTrigger>
                <TooltipContent side="top">
                  {nsEnabled ? "噪声抑制：开" : "噪声抑制：关"} · 右键模型/预设/强度
                </TooltipContent>
              </Tooltip>

              <ContextMenuContent className="w-72" side="top" align="end">
                <ContextMenuGroup>
                  <ContextMenuCheckboxItem
                    checked={nsEnabled}
                    onCheckedChange={(checked) => {
                      const next = Boolean(checked)
                      setVoice({ ns: next })
                      toast.message(
                        next ? "噪声抑制已开启" : "噪声抑制已关闭",
                      )
                    }}
                  >
                    噪声抑制总开关
                  </ContextMenuCheckboxItem>
                </ContextMenuGroup>

                <ContextMenuSeparator />

                <ContextMenuGroup>
                  <ContextMenuLabel className="pb-1">
                    选择降噪模型
                  </ContextMenuLabel>
                  <ContextMenuRadioGroup
                    value={nsModel}
                    onValueChange={selectNoiseModel}
                  >
                    {NOISE_MODELS.map((model) => {
                      const available = isNsModelImplemented(model.id)
                      return (
                        <ContextMenuRadioItem
                          key={model.id}
                          value={model.id}
                          disabled={!model.implemented}
                          className="items-start"
                        >
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate">
                              {model.label}
                              {!model.implemented
                                ? "（即将推出）"
                                : !available
                                  ? "（运行时可能回退）"
                                  : ""}
                            </span>
                            <span className="text-xs font-normal text-muted-foreground">
                              {model.scope} · 算力{model.cpu}
                            </span>
                          </span>
                        </ContextMenuRadioItem>
                      )
                    })}
                  </ContextMenuRadioGroup>
                </ContextMenuGroup>

                {/* WASM 模型：快捷预设 / 强度子菜单 */}
                {uplinkWasmModel(nsModel) && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuGroup>
                      <ContextMenuLabel className="pb-1">
                        快捷调整
                        {!nsEnabled ? " · 总开关已关" : ""}
                      </ContextMenuLabel>

                      {(nsModel === "deepfilternet" ||
                        nsModel === "dtln") && (
                        <ContextMenuSub>
                          <ContextMenuSubTrigger
                            disabled={!nsEnabled}
                            className={!nsEnabled ? "opacity-50" : undefined}
                          >
                            <SparklesIcon />
                            <span className="min-w-0 flex-1 truncate">
                              降噪预设
                            </span>
                            <span className="ml-1 max-w-24 truncate text-xs font-normal text-muted-foreground">
                              {nsModel === "deepfilternet"
                                ? resolveDfnPreset(dfnPreset).label
                                : resolveDtlnPreset(dtlnPreset).label}
                            </span>
                          </ContextMenuSubTrigger>
                          <ContextMenuSubContent className="min-w-52" side="left">
                            {(nsModel === "deepfilternet"
                              ? DFN_PRESETS
                              : DTLN_PRESETS
                            )
                              .filter((p) => p.id !== "custom")
                              .map((preset) => {
                                const active =
                                  nsModel === "deepfilternet"
                                    ? dfnPreset === preset.id
                                    : dtlnPreset === preset.id
                                return (
                                  <ContextMenuItem
                                    key={preset.id}
                                    disabled={!nsEnabled}
                                    onClick={() => applyNsPreset(preset.id)}
                                    className="items-start"
                                  >
                                    {active ? (
                                      <CheckIcon className="mt-0.5 size-4 shrink-0" />
                                    ) : (
                                      <span className="mt-0.5 size-4 shrink-0" />
                                    )}
                                    <span className="flex min-w-0 flex-col gap-0.5">
                                      <span>
                                        {preset.label}
                                        {preset.id === "env-keyboard"
                                          ? "（默认）"
                                          : ""}
                                      </span>
                                      <span className="text-xs font-normal leading-snug text-muted-foreground">
                                        {preset.description}
                                      </span>
                                    </span>
                                  </ContextMenuItem>
                                )
                              })}
                            {(nsModel === "deepfilternet"
                              ? dfnPreset === "custom"
                              : dtlnPreset === "custom") && (
                              <ContextMenuItem disabled>
                                <CheckIcon className="size-4" />
                                <span className="flex min-w-0 flex-col gap-0.5">
                                  <span>自定义</span>
                                  <span className="text-xs font-normal text-muted-foreground">
                                    已在设置中手动调参
                                  </span>
                                </span>
                              </ContextMenuItem>
                            )}
                          </ContextMenuSubContent>
                        </ContextMenuSub>
                      )}

                      <ContextMenuSub>
                        <ContextMenuSubTrigger
                          disabled={!nsEnabled}
                          className={!nsEnabled ? "opacity-50" : undefined}
                        >
                          <SlidersHorizontalIcon />
                          <span className="min-w-0 flex-1 truncate">
                            降噪强度
                          </span>
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            {nsStrength}%
                          </span>
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className="min-w-36" side="left">
                          {NS_STRENGTH_PRESETS.map((percent) => (
                            <ContextMenuItem
                              key={percent}
                              disabled={!nsEnabled}
                              onClick={() => applyNsStrength(percent)}
                            >
                              {nsStrength === percent ? (
                                <CheckIcon className="size-4" />
                              ) : (
                                <span className="size-4" />
                              )}
                              {percent}%
                              {percent === 0
                                ? "（原声）"
                                : percent === 100
                                  ? "（全湿）"
                                  : ""}
                            </ContextMenuItem>
                          ))}
                          {!NS_STRENGTH_PRESETS.includes(
                            nsStrength as (typeof NS_STRENGTH_PRESETS)[number],
                          ) && (
                            <ContextMenuItem disabled>
                              <CheckIcon className="size-4" />
                              {nsStrength}%（当前）
                            </ContextMenuItem>
                          )}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    </ContextMenuGroup>
                  </>
                )}

                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={() =>
                    useSettingsStore.getState().openPanel("voice")
                  }
                >
                  <Settings2Icon />
                  打开语音设置…
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

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
      </div>

      <ScreenQualityDialog
        open={qualityOpen}
        onOpenChange={setQualityOpen}
        onStart={(quality) =>
          void screenShare.start(session.channelId, quality)
        }
      />

      <Dialog
        open={dfnConfirmOpen}
        onOpenChange={(open) => {
          setDfnConfirmOpen(open)
          if (!open && !dfnConfirmAcceptedRef.current) {
            console.info(
              "[noise-suppression] 用户关闭 DeepFilterNet 算力确认（语音面板，未启用）",
            )
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>启用 DeepFilterNet 3？</DialogTitle>
            <DialogDescription>
              降噪质量更高，但可能显著增加 CPU 与内存占用（内置模型约
              18MB）。低配设备建议继续使用 RNNoise 或 Speex。确认后仅本机提示一次。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                console.info(
                  "[noise-suppression] 用户取消 DeepFilterNet 算力确认（语音面板）",
                )
                setDfnConfirmOpen(false)
              }}
            >
              取消
            </Button>
            <Button onClick={confirmDeepFilterNet}>仍要启用</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
