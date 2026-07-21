// 设置 · 语音与视频（docs 16 FR-06/07/08/10 P0）：
// 设备枚举与选择只写设置 store（偏好存储），不直接操作正在进行的语音连接。
// 麦克风测试：开关打开后采集当前输入设备，显示频谱/电平并本地回放。
//
// TODO(语音层接入)：app/lib/voice/** 建立/重建音频轨时应读取
// useSettingsStore.getState().voice 的 inputDeviceId / aec / ns / agc 等值，
// 并订阅变化做热切换；本组件只负责偏好存储，接入点在语音连接层。

import { useCallback, useEffect, useRef, useState } from "react"
import { MicIcon, RefreshCwIcon, XIcon } from "lucide-react"

import { Button } from "~/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { Slider } from "~/components/ui/slider"
import { Switch } from "~/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group"
import { cn } from "~/lib/utils"
import { useMembersStore } from "~/stores/members"
import { useSettingsStore, type VoiceInputMode } from "~/stores/settings"
import { ComingSoon, GroupLabel, SectionTitle, SettingRow } from "./section"

// ---------------------------------------------------------------------------
// 麦克风测试：电平可视化 + 本地回放
// ---------------------------------------------------------------------------

const METER_BARS = 24

type MicTestProps = {
  inputDeviceId: string | null
  outputDeviceId: string | null
  inputVolume: number
  aec: boolean
  ns: boolean
  agc: boolean
  onPermissionGranted?: () => void
}

function MicTestPanel({
  inputDeviceId,
  outputDeviceId,
  inputVolume,
  aec,
  ns,
  agc,
  onPermissionGranted,
}: MicTestProps) {
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 0–1 总体电平 */
  const [level, setLevel] = useState(0)
  /** 频谱条 0–1 */
  const [bars, setBars] = useState<number[]>(() => Array(METER_BARS).fill(0))

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef(0)

  const stopTest = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    try {
      gainRef.current?.disconnect()
      analyserRef.current?.disconnect()
    } catch {
      // ignore
    }
    gainRef.current = null
    analyserRef.current = null
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => undefined)
      ctxRef.current = null
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop()
      streamRef.current = null
    }
    setLevel(0)
    setBars(Array(METER_BARS).fill(0))
  }, [])

  // 开关 / 设备 / 处理链变化时重建采集
  useEffect(() => {
    if (!enabled) {
      stopTest()
      return
    }

    let cancelled = false

    const start = async () => {
      stopTest()
      try {
        const audio: MediaTrackConstraints = {
          echoCancellation: aec,
          noiseSuppression: ns,
          autoGainControl: agc,
        }
        if (inputDeviceId) {
          audio.deviceId = { exact: inputDeviceId }
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio })
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop()
          return
        }
        streamRef.current = stream
        onPermissionGranted?.()

        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext
        const ctx = new AudioCtx()
        ctxRef.current = ctx
        if (ctx.state === "suspended") await ctx.resume()

        // 输出设备（Chromium / 新版浏览器）
        const sinkId = outputDeviceId ?? ""
        const maybeSetSink = (
          ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
        ).setSinkId
        if (typeof maybeSetSink === "function" && sinkId) {
          await maybeSetSink.call(ctx, sinkId).catch(() => undefined)
        }

        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        analyser.smoothingTimeConstant = 0.75
        analyserRef.current = analyser

        const gain = ctx.createGain()
        // 输入音量 0–200% → 0–2 增益；略压一点防啸叫
        gain.gain.value = Math.min(2, Math.max(0, inputVolume / 100)) * 0.85
        gainRef.current = gain

        // 分析 + 回放到扬声器
        source.connect(analyser)
        source.connect(gain)
        gain.connect(ctx.destination)

        const timeData = new Uint8Array(analyser.fftSize)
        const freqData = new Uint8Array(analyser.frequencyBinCount)

        const tick = () => {
          const node = analyserRef.current
          if (!node) return
          node.getByteTimeDomainData(timeData)
          let sum = 0
          for (let i = 0; i < timeData.length; i++) {
            const v = (timeData[i]! - 128) / 128
            sum += v * v
          }
          const rms = Math.sqrt(sum / timeData.length)
          // 放大便于观察轻声
          setLevel(Math.min(1, rms * 4))

          node.getByteFrequencyData(freqData)
          const nextBars: number[] = []
          const binsPerBar = Math.max(1, Math.floor(freqData.length / METER_BARS))
          for (let b = 0; b < METER_BARS; b++) {
            let acc = 0
            const start = b * binsPerBar
            for (let i = 0; i < binsPerBar; i++) {
              acc += freqData[start + i] ?? 0
            }
            nextBars.push(Math.min(1, acc / binsPerBar / 255))
          }
          setBars(nextBars)
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
        setError(null)
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "麦克风权限被拒绝"
            : err instanceof DOMException && err.name === "NotFoundError"
              ? "未找到可用麦克风"
              : err instanceof DOMException && err.name === "OverconstrainedError"
                ? "当前选择的麦克风不可用，请换一个设备"
                : "无法打开麦克风"
        setError(message)
        setEnabled(false)
        stopTest()
      }
    }

    void start()
    return () => {
      cancelled = true
      stopTest()
    }
    // inputVolume 单独用另一个 effect 调增益，避免重建采集
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, inputDeviceId, outputDeviceId, aec, ns, agc, stopTest])

  // 热更新回放音量
  useEffect(() => {
    if (gainRef.current) {
      gainRef.current.gain.value =
        Math.min(2, Math.max(0, inputVolume / 100)) * 0.85
    }
  }, [inputVolume])

  // 卸载清理
  useEffect(() => () => stopTest(), [stopTest])

  return (
    <div className="mt-2 space-y-3 rounded-2xl border p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">测试麦克风</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            打开后显示实时电平，并通过扬声器回放你的声音（建议使用耳机，避免啸叫）
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => setEnabled(Boolean(checked))}
        />
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {enabled && !error && (
        <div className="space-y-2">
          {/* 频谱条 */}
          <div
            className="flex h-16 items-end gap-0.5 rounded-xl bg-muted/50 px-2 py-2"
            aria-hidden
          >
            {bars.map((value, index) => (
              <div
                key={index}
                className={cn(
                  "min-w-0 flex-1 rounded-sm transition-[height,background-color] duration-75",
                  value > 0.75
                    ? "bg-destructive"
                    : value > 0.45
                      ? "bg-amber-500"
                      : "bg-emerald-500",
                )}
                style={{ height: `${Math.max(4, value * 100)}%` }}
              />
            ))}
          </div>
          {/* 总电平条 */}
          <div className="flex items-center gap-2">
            <MicIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-[width,background-color] duration-75",
                  level > 0.75
                    ? "bg-destructive"
                    : level > 0.45
                      ? "bg-amber-500"
                      : "bg-emerald-500",
                )}
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
              {Math.round(level * 100)}%
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            对着麦克风说话，条形图应随音量跳动，同时能听到回放。回放音量跟随上方「输入音量」。
          </p>
        </div>
      )}
    </div>
  )
}

/** 语音包屏蔽名单条目：跨已缓存服务器解析昵称，查不到显示 ID 片段 */
function VoicePackMutedRow({ userId }: { userId: string }) {
  const name = useMembersStore((state) => {
    for (const members of Object.values(state.byGuild)) {
      const member = members.find((item) => item.user_id === userId)
      if (member) {
        return member.nickname?.trim() || member.display_name?.trim() || member.username
      }
    }
    return null
  })
  const setVoicePackMuted = useSettingsStore((state) => state.setVoicePackMuted)

  return (
    <div className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-sm">
        {name ?? `用户${userId.slice(0, 6)}`}
      </span>
      <Button size="sm" variant="ghost" onClick={() => setVoicePackMuted(userId, false)}>
        <XIcon />
        移除
      </Button>
    </div>
  )
}

type DeviceOption = { deviceId: string; label: string }
type PermissionState = "unknown" | "granted" | "denied"

const DEFAULT_DEVICE = "__default__"

export function VoiceSection() {
  const voice = useSettingsStore((state) => state.voice)
  const setVoice = useSettingsStore((state) => state.setVoice)

  const [inputs, setInputs] = useState<DeviceOption[]>([])
  const [outputs, setOutputs] = useState<DeviceOption[]>([])
  const [permission, setPermission] = useState<PermissionState>("unknown")

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
    const toOption = (device: MediaDeviceInfo, index: number, fallback: string): DeviceOption => ({
      deviceId: device.deviceId,
      label: device.label || `${fallback} ${index + 1}`,
    })
    const audioIn = devices.filter((d) => d.kind === "audioinput" && d.deviceId)
    const audioOut = devices.filter((d) => d.kind === "audiooutput" && d.deviceId)
    setInputs(audioIn.map((d, i) => toOption(d, i, "麦克风")))
    setOutputs(audioOut.map((d, i) => toOption(d, i, "扬声器")))
    // 拿得到 label 说明已有麦克风权限
    if (audioIn.some((d) => d.label)) setPermission("granted")
  }, [])

  /** 请求一次麦克风权限（enumerateDevices 需要权限才能返回 label） */
  const requestPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      for (const track of stream.getTracks()) track.stop()
      setPermission("granted")
      await refreshDevices()
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setPermission("denied")
      }
    }
  }, [refreshDevices])

  useEffect(() => {
    void refreshDevices()
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices)
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices)
  }, [refreshDevices])

  const deviceSelect = (
    kind: "input" | "output",
    options: DeviceOption[],
    selected: string | null,
  ) => (
    <Select
      value={selected ?? DEFAULT_DEVICE}
      onValueChange={(value) => {
        const deviceId = value === DEFAULT_DEVICE ? null : (value as string)
        setVoice(kind === "input" ? { inputDeviceId: deviceId } : { outputDeviceId: deviceId })
      }}
    >
      <SelectTrigger size="sm" className="w-64 max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_DEVICE}>系统默认</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.deviceId} value={option.deviceId}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <div>
      <SectionTitle>语音与视频</SectionTitle>

      <GroupLabel>设备</GroupLabel>
      {permission !== "granted" && (
        <div className="mb-3 flex items-center justify-between gap-4 rounded-2xl bg-muted/50 p-4">
          <div>
            <p className="text-sm font-medium">
              {permission === "denied" ? "麦克风权限被拒绝" : "需要麦克风权限"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {permission === "denied"
                ? "请在系统设置中允许 OwlSpeak 访问麦克风后，点击刷新重试"
                : "授权后才能显示设备名称并选择输入/输出设备"}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={requestPermission}>
            <MicIcon />
            {permission === "denied" ? "重试" : "授权麦克风"}
          </Button>
        </div>
      )}
      <SettingRow label="输入设备" description="麦克风">
        {deviceSelect("input", inputs, voice.inputDeviceId)}
      </SettingRow>
      <SettingRow label="输出设备" description="扬声器 / 耳机">
        {deviceSelect("output", outputs, voice.outputDeviceId)}
      </SettingRow>
      <SettingRow label="刷新设备列表" description="设备热插拔后手动刷新">
        <Button size="sm" variant="ghost" onClick={() => void refreshDevices()}>
          <RefreshCwIcon />
          刷新
        </Button>
      </SettingRow>

      <GroupLabel>麦克风测试</GroupLabel>
      <MicTestPanel
        inputDeviceId={voice.inputDeviceId}
        outputDeviceId={voice.outputDeviceId}
        inputVolume={voice.inputVolume}
        aec={voice.aec}
        ns={voice.ns}
        agc={voice.agc}
        onPermissionGranted={() => {
          setPermission("granted")
          void refreshDevices()
        }}
      />

      <GroupLabel>音量</GroupLabel>
      <SettingRow label="输入音量" description={`${voice.inputVolume}%`}>
        <div className="w-56">
          <Slider
            min={0}
            max={200}
            value={voice.inputVolume}
            onValueChange={(value) =>
              setVoice({ inputVolume: Array.isArray(value) ? value[0] : value })
            }
          />
        </div>
      </SettingRow>
      <SettingRow label="输出音量" description={`${voice.outputVolume}%`}>
        <div className="w-56">
          <Slider
            min={0}
            max={200}
            value={voice.outputVolume}
            onValueChange={(value) =>
              setVoice({ outputVolume: Array.isArray(value) ? value[0] : value })
            }
          />
        </div>
      </SettingRow>

      <GroupLabel>入场音效</GroupLabel>
      <SettingRow label="播放入场音效" description="他人进入语音频道时播放其入场语音包">
        <Switch
          checked={voice.voicePackEnabled}
          onCheckedChange={(checked) => setVoice({ voicePackEnabled: Boolean(checked) })}
        />
      </SettingRow>
      <SettingRow label="音效音量" description={`${voice.voicePackVolume}%（独立于通话输出音量）`}>
        <div className="w-56">
          <Slider
            min={0}
            max={100}
            value={voice.voicePackVolume}
            onValueChange={(value) =>
              setVoice({ voicePackVolume: Array.isArray(value) ? value[0] : value })
            }
          />
        </div>
      </SettingRow>
      {voice.voicePackMutedUsers.length > 0 && (
        <div className="mt-2 rounded-2xl border p-4">
          <p className="mb-1 text-sm font-medium">已屏蔽的入场音效</p>
          <p className="mb-2 text-xs text-muted-foreground">
            以下成员的入场语音不会出声（仍显示视觉提示）
          </p>
          {voice.voicePackMutedUsers.map((userId) => (
            <VoicePackMutedRow key={userId} userId={userId} />
          ))}
        </div>
      )}

      <GroupLabel>输入模式</GroupLabel>
      <div className="flex items-center gap-2 py-1">
        <span className="text-xs text-muted-foreground">设置将在语音层接入后生效</span>
        <ComingSoon />
      </div>
      <RadioGroup
        className="mt-2 gap-2"
        value={voice.inputMode}
        onValueChange={(value) => setVoice({ inputMode: value as VoiceInputMode })}
      >
        <label className="flex items-start gap-3 rounded-2xl border p-4">
          <RadioGroupItem value="voice-activity" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">语音激活</p>
            <p className="mt-0.5 text-xs text-muted-foreground">检测到说话时自动传输声音</p>
            {voice.inputMode === "voice-activity" && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs text-muted-foreground">
                  输入灵敏度：{voice.vadSensitivity}
                </p>
                <Slider
                  min={0}
                  max={100}
                  value={voice.vadSensitivity}
                  onValueChange={(value) =>
                    setVoice({ vadSensitivity: Array.isArray(value) ? value[0] : value })
                  }
                />
              </div>
            )}
          </div>
        </label>
        <label className="flex items-start gap-3 rounded-2xl border p-4">
          <RadioGroupItem value="push-to-talk" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">按键说话</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              按住指定按键时才传输声音；快捷键绑定即将推出
            </p>
          </div>
        </label>
      </RadioGroup>

      <GroupLabel>音频处理</GroupLabel>
      <SettingRow label="回声消除（AEC）" description="消除扬声器回授到麦克风的回声">
        <Switch checked={voice.aec} onCheckedChange={(checked) => setVoice({ aec: checked })} />
      </SettingRow>
      <SettingRow label="噪声抑制（NS）" description="过滤键盘声、风扇声等环境噪音">
        <Switch checked={voice.ns} onCheckedChange={(checked) => setVoice({ ns: checked })} />
      </SettingRow>
      <SettingRow label="自动增益（AGC）" description="自动调整麦克风输入电平">
        <Switch checked={voice.agc} onCheckedChange={(checked) => setVoice({ agc: checked })} />
      </SettingRow>
    </div>
  )
}
