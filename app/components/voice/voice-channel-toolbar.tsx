// 语音频道主视图底部浮动控制条：白色毛玻璃胶囊分组
//   ① 音频组：麦克风 · 输出/闭听 · 降噪
//   ② 视频组：摄像头 · 屏幕共享
//   ③ 挂断
// 逻辑与左下角 VoicePanel 共用连接层。

import { useState, type ReactNode } from "react"
import {
  AudioLinesIcon,
  CameraOffIcon,
  ChevronDownIcon,
  HeadphoneOffIcon,
  HeadphonesIcon,
  MicIcon,
  MicOffIcon,
  MonitorUpIcon,
  PhoneOffIcon,
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
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useSettingsStore, type VoiceInputMode } from "~/stores/settings"
import {
  inferChannelMode,
  normalizeStageRole,
  useStageStore,
} from "~/stores/stage"
import { useVoiceStore } from "~/stores/voice"

const DEFAULT_DEVICE = "__default__"

const INPUT_MODE_LABELS: Record<VoiceInputMode, string> = {
  "voice-activity": "语音激活",
  "push-to-talk": "按键说话",
}

type DeviceOption = { deviceId: string; label: string }

function deviceLabel(
  deviceId: string | null | undefined,
  devices: DeviceOption[],
  fallback = "系统默认",
): string {
  if (!deviceId) return fallback
  return devices.find((d) => d.deviceId === deviceId)?.label ?? fallback
}

// ---------------------------------------------------------------------------
// 毛玻璃按钮原语
// ---------------------------------------------------------------------------

/** 独立白色高斯模糊胶囊（无描边；阴影加在组件自身） */
function GlassGroup({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-center overflow-hidden rounded-2xl",
        // 白色高斯模糊本体
        "bg-white/55 backdrop-blur-2xl backdrop-saturate-150",
        "shadow-[0_6px_24px_rgba(0,0,0,0.14)]",
        "dark:bg-white/12 dark:shadow-[0_6px_24px_rgba(0,0,0,0.4)]",
      )}
    >
      {children}
    </div>
  )
}

function GlassIconButton({
  title,
  active,
  danger,
  /** 开启态用绿色（如噪声抑制） */
  success,
  disabled,
  onClick,
  children,
  className,
}: {
  title: string
  active?: boolean
  danger?: boolean
  success?: boolean
  disabled?: boolean
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
        "flex size-11 items-center justify-center text-foreground/85 transition-colors",
        "hover:bg-black/5 dark:hover:bg-white/10",
        "disabled:pointer-events-none disabled:opacity-40",
        // success（如降噪开启）：保持毛玻璃白底，仅图标变绿
        active &&
          success &&
          !danger &&
          "text-emerald-600 dark:text-emerald-400",
        active &&
          !danger &&
          !success &&
          "bg-primary/15 text-primary hover:bg-primary/20",
        danger && "bg-destructive/15 text-destructive hover:bg-destructive/20",
        className,
      )}
    >
      {children}
    </button>
  )
}

function GlassSplit({
  title,
  menuTitle,
  active,
  danger,
  disabled,
  onAction,
  icon,
  menu,
}: {
  title: string
  menuTitle: string
  active?: boolean
  danger?: boolean
  disabled?: boolean
  onAction?: () => void
  icon: ReactNode
  menu: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex items-stretch",
        active && !danger && "bg-primary/15 text-primary",
        danger && "bg-destructive/15 text-destructive",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      <button
        type="button"
        title={title}
        aria-label={title}
        disabled={disabled}
        onClick={onAction}
        className="flex size-11 items-center justify-center transition-colors hover:bg-black/5 dark:hover:bg-white/10"
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
              className="flex w-6 items-center justify-center transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            />
          }
        >
          <ChevronDownIcon className="size-3 opacity-70" />
        </PopoverTrigger>
        <PopoverContent side="top" align="center" className="w-72 gap-3 p-3">
          {menu}
        </PopoverContent>
      </Popover>
    </div>
  )
}

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
// 主控制条
// ---------------------------------------------------------------------------

export function VoiceChannelToolbar({
  guildId,
  channelId,
}: {
  guildId: string
  channelId: string
}) {
  const session = useVoiceStore((s) => s.session)
  const channelStates = useVoiceStore((s) => s.byChannel[channelId])
  const selfId = useAuthStore((s) => s.user?.id)
  const stage = useStageStore((s) => s.byChannel[channelId])
  const quota = useStageStore((s) => s.quotaByGuild[guildId])
  const selfScreen = useStageStore((s) => s.selfScreen)
  const voice = useSettingsStore((s) => s.voice)
  const setVoice = useSettingsStore((s) => s.setVoice)
  const nsEnabled = voice.ns
  const [qualityOpen, setQualityOpen] = useState(false)
  const [devices, setDevices] = useState<{
    inputs: DeviceOption[]
    outputs: DeviceOption[]
  }>({ inputs: [], outputs: [] })

  // 懒加载设备列表（打开菜单时也会刷新）
  const refreshDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const list = await navigator.mediaDevices.enumerateDevices().catch(() => [])
    const map = (kind: MediaDeviceKind, fallback: string) =>
      list
        .filter((d) => d.kind === kind && d.deviceId)
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `${fallback} ${i + 1}`,
        }))
    setDevices({
      inputs: map("audioinput", "麦克风"),
      outputs: map("audiooutput", "扬声器"),
    })
  }

  if (!session || session.channelId !== channelId) return null

  const connected = session.phase === "connected"
  const isStage = stage?.instanceKnown
    ? stage.mode === "STAGE"
    : inferChannelMode(channelStates) === "STAGE"
  const selfRole = normalizeStageRole(
    channelStates?.find((item) => item.user_id === selfId)?.stage_role,
  )

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
      void useStageStore.getState().fetchQuota(guildId)
    }
    setQualityOpen(true)
  }

  const micMenu = (
    <>
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        输入设备
      </p>
      <Select
        value={voice.inputDeviceId ?? DEFAULT_DEVICE}
        onValueChange={(value) => {
          setVoice({
            inputDeviceId: !value || value === DEFAULT_DEVICE ? null : value,
          })
          voiceConnection.applyVoiceSettings({ reinitMic: true })
        }}
        onOpenChange={(open) => {
          if (open) void refreshDevices()
        }}
      >
        <SelectTrigger size="sm" className="w-full min-w-0">
          <SelectValue placeholder="系统默认">
            {deviceLabel(voice.inputDeviceId, devices.inputs)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_DEVICE}>系统默认</SelectItem>
          {devices.inputs.map((device) => (
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

      <button
        type="button"
        className="rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
        onClick={() => useSettingsStore.getState().openPanel("voice")}
      >
        打开语音设置…
      </button>
    </>
  )

  const outputMenu = (
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
        onOpenChange={(open) => {
          if (open) void refreshDevices()
        }}
      >
        <SelectTrigger size="sm" className="w-full min-w-0">
          <SelectValue placeholder="系统默认">
            {deviceLabel(voice.outputDeviceId, devices.outputs)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_DEVICE}>系统默认</SelectItem>
          {devices.outputs.map((device) => (
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
        className="rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
        onClick={() => useSettingsStore.getState().openPanel("voice")}
      >
        打开语音设置…
      </button>
    </>
  )

  return (
    <>
      {/* 底部居中：音频组 | 视频组 | 挂断（组内无竖分割线） */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-5 pt-16">
        <div className="pointer-events-auto flex items-center gap-3">
          {/* ① 音频：输入 · 输出/闭听 · 降噪 */}
          <GlassGroup>
            <GlassSplit
              title={micTitle}
              menuTitle="输入设置"
              active={muted}
              danger={muted}
              onAction={() => {
                if (micBlocked && !session.selfMute) {
                  toast.error(micTitle)
                  return
                }
                voiceConnection.toggleMute()
              }}
              icon={
                muted ? (
                  <MicOffIcon className="size-[1.15rem]" />
                ) : (
                  <MicIcon className="size-[1.15rem]" />
                )
              }
              menu={micMenu}
            />
            <GlassSplit
              title={selfDeaf ? "取消闭听" : "闭听"}
              menuTitle="输出设置"
              active={selfDeaf}
              danger={selfDeaf}
              onAction={() => voiceConnection.toggleDeaf()}
              icon={
                selfDeaf ? (
                  <HeadphoneOffIcon className="size-[1.15rem]" />
                ) : (
                  <HeadphonesIcon className="size-[1.15rem]" />
                )
              }
              menu={outputMenu}
            />
            <GlassIconButton
              title={nsEnabled ? "关闭噪声抑制" : "开启噪声抑制"}
              active={nsEnabled}
              success
              onClick={() => {
                const next = !nsEnabled
                setVoice({ ns: next })
                voiceConnection.applyVoiceSettings({ reinitMic: true })
                toast.message(next ? "噪声抑制已开启" : "噪声抑制已关闭")
              }}
            >
              <AudioLinesIcon className="size-[1.15rem]" />
            </GlassIconButton>
          </GlassGroup>

          {/* ② 视频：摄像头 · 屏幕共享 */}
          <GlassGroup>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    title="摄像头（即将推出）"
                    aria-label="摄像头（即将推出）"
                    disabled
                    className="flex size-11 items-center justify-center text-foreground/50 opacity-50"
                  />
                }
              >
                <CameraOffIcon className="size-[1.15rem]" />
              </TooltipTrigger>
              <TooltipContent side="top">摄像头即将推出</TooltipContent>
            </Tooltip>
            <GlassIconButton
              title={screenTitle}
              active={sharing}
              disabled={screenDisabled}
              onClick={handleScreenClick}
            >
              <MonitorUpIcon className="size-[1.15rem]" />
            </GlassIconButton>
          </GlassGroup>

          {/* ③ 挂断 */}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  title="断开语音"
                  aria-label="断开语音"
                  onClick={() => void voiceConnection.leave()}
                  className={cn(
                    "flex size-11 shrink-0 items-center justify-center rounded-2xl",
                    "bg-red-500 text-white transition-[transform,background-color]",
                    "shadow-[0_6px_24px_rgba(239,68,68,0.35)]",
                    "hover:bg-red-600 active:scale-[0.96]",
                  )}
                />
              }
            >
              <PhoneOffIcon className="size-[1.15rem]" />
            </TooltipTrigger>
            <TooltipContent side="top">断开</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <ScreenQualityDialog
        open={qualityOpen}
        onOpenChange={setQualityOpen}
        onStart={(quality) => void screenShare.start(channelId, quality)}
      />
    </>
  )
}
