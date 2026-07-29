// 设置 · 语音与视频（docs 16 FR-06/07/08/10 P0）：
// 设备枚举与选择只写设置 store（偏好存储），不直接操作正在进行的语音连接。
// 麦克风测试：开关打开后采集当前输入设备，显示频谱/电平并本地回放。
//
// 语音层读取 useSettingsStore.voice（含 stereo / aec / ns / agc / 设备），
// 通话中变更通过 voiceConnection.applyVoiceSettings({ reinitMic: true }) 热切换。

import { useCallback, useEffect, useRef, useState } from "react"
import { MicIcon, RefreshCwIcon, XIcon } from "lucide-react"

import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { voiceConnection } from "~/lib/voice/connection"
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
import {
  createNsNodeWithFallback,
  DFN_PRESETS,
  DTLN_PRESETS,
  downlinkFallbackLabel,
  isNsModelImplemented,
  NOISE_MODELS,
  uplinkWasmModel,
  type NoiseModelId,
  type NsHandle,
} from "~/lib/noise-suppression"
import { useMembersStore } from "~/stores/members"
import { formatKeyCode } from "~/lib/key-label"
import {
  useSettingsStore,
  type VoiceInputMode,
  type VoiceSettings,
} from "~/stores/settings"
import { GroupLabel, SectionTitle, SettingRow } from "./section"

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
  /** 降噪模型：测试链与上行同链（docs 20 FR-S07） */
  nsModel: NoiseModelId
  /** 当前模型的降噪强度 0–100（FR-S06） */
  nsStrength: number
  dfnAttenuationLimitDb: number
  dfnPresenceGainDb: number
  dtlnPresenceGainDb: number
  dtlnMakeupGainDb: number
  agc: boolean
  stereo: boolean
  onStereoChange: (enabled: boolean) => void
  onPermissionGranted?: () => void
}

function rmsFromAnalyser(node: AnalyserNode, buf: Uint8Array): number {
  // DOM 类型在部分 TS 版本要求 ArrayBuffer 视图；运行时兼容
  node.getByteTimeDomainData(buf as never)
  let sum = 0
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i]! - 128) / 128
    sum += v * v
  }
  return Math.min(1, Math.sqrt(sum / buf.length) * 4)
}

function MicTestPanel({
  inputDeviceId,
  outputDeviceId,
  inputVolume,
  aec,
  ns,
  nsModel,
  nsStrength,
  dfnAttenuationLimitDb,
  dfnPresenceGainDb,
  dtlnPresenceGainDb,
  dtlnMakeupGainDb,
  agc,
  stereo,
  onStereoChange,
  onPermissionGranted,
}: MicTestProps) {
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 0–1 总体电平 */
  const [level, setLevel] = useState(0)
  /** 左右声道电平（立体声生效时） */
  const [levelL, setLevelL] = useState(0)
  const [levelR, setLevelR] = useState(0)
  /** 频谱条 0–1 */
  const [bars, setBars] = useState<number[]>(() => Array(METER_BARS).fill(0))
  /** 实际采集声道数 */
  const [channelCount, setChannelCount] = useState<number | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const nsRef = useRef<NsHandle | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const analyserLRef = useRef<AnalyserNode | null>(null)
  const analyserRRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef(0)
  /** 试听对比（docs 20 M5）：按住临时旁路降噪（强度置 0 = 全干原声） */
  const [comparingRaw, setComparingRaw] = useState(false)

  const stopTest = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    try {
      gainRef.current?.disconnect()
      analyserRef.current?.disconnect()
      analyserLRef.current?.disconnect()
      analyserRRef.current?.disconnect()
    } catch {
      // ignore
    }
    nsRef.current?.destroy()
    nsRef.current = null
    gainRef.current = null
    analyserRef.current = null
    analyserLRef.current = null
    analyserRRef.current = null
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => undefined)
      ctxRef.current = null
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop()
      streamRef.current = null
    }
    setLevel(0)
    setLevelL(0)
    setLevelR(0)
    setBars(Array(METER_BARS).fill(0))
    setChannelCount(null)
  }, [])

  // 强度 / 对比原声变化即时应用到测试链（不重建采集，FR-S06）
  useEffect(() => {
    nsRef.current?.setStrength(comparingRaw ? 0 : nsStrength)
  }, [nsStrength, comparingRaw])

  // 开关 / 设备 / 处理链 / 立体声变化时重建采集
  useEffect(() => {
    if (!enabled) {
      stopTest()
      return
    }

    let cancelled = false

    const start = async () => {
      stopTest()
      try {
        // FR-S05/S07：浏览器 NS 仅在模型 = browser 时启用；WASM 模型走与上行相同的处理链
        const browserNs = ns && nsModel === "browser"
        const audio: MediaTrackConstraints = {
          echoCancellation: aec,
          noiseSuppression: browserNs,
          autoGainControl: agc,
          channelCount: stereo ? { ideal: 2 } : { ideal: 1 },
        }
        if (inputDeviceId) {
          audio.deviceId = { exact: inputDeviceId }
        }
        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio })
        } catch {
          const fallback: MediaTrackConstraints = {
            echoCancellation: aec,
            noiseSuppression: browserNs,
            autoGainControl: agc,
          }
          if (inputDeviceId) fallback.deviceId = { exact: inputDeviceId }
          stream = await navigator.mediaDevices.getUserMedia({ audio: fallback })
        }
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop()
          return
        }
        streamRef.current = stream
        const track = stream.getAudioTracks()[0]
        const ch = track?.getSettings?.().channelCount
        const channels = typeof ch === "number" ? ch : 1
        setChannelCount(channels)
        onPermissionGranted?.()

        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext
        // 48kHz：与降噪模型采样率假设一致（DFN 硬要求；不支持时回退默认）
        let ctx: AudioContext
        try {
          ctx = new AudioCtx({ sampleRate: 48_000 })
        } catch {
          ctx = new AudioCtx()
        }
        ctxRef.current = ctx
        if (ctx.state === "suspended") await ctx.resume()

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
        gain.gain.value = Math.min(2, Math.max(0, inputVolume / 100)) * 0.85
        gainRef.current = gain

        // 测试回放走与上行相同的降噪链（FR-S07）；模型加载失败直通
        let head: AudioNode = source
        const wasmModel = ns ? uplinkWasmModel(nsModel) : null
        if (wasmModel) {
          console.info("[noise-suppression] 麦克风测试链加载", {
            selected: nsModel,
            wasmModel,
            sampleRate: ctx.sampleRate,
          })
          const dfn =
            wasmModel === "deepfilternet"
              ? {
                  attenuationLimitDb: dfnAttenuationLimitDb,
                  presenceGainDb: dfnPresenceGainDb,
                }
              : null
          const dtln =
            wasmModel === "dtln"
              ? {
                  presenceGainDb: dtlnPresenceGainDb,
                  makeupGainDb: dtlnMakeupGainDb,
                }
              : null
          const handle = await createNsNodeWithFallback(
            ctx,
            wasmModel,
            nsStrength,
            dfn,
            dtln,
          )
          if (cancelled) {
            handle?.destroy()
            return
          }
          if (handle) {
            nsRef.current = handle
            source.connect(handle.input)
            head = handle.output
            console.info("[noise-suppression] 麦克风测试链就绪", {
              selected: nsModel,
              actual: handle.model,
            })
          }
        }
        head.connect(analyser)
        head.connect(gain)
        gain.connect(ctx.destination)

        // 立体声时拆 L/R 电平
        if (channels >= 2) {
          try {
            const splitter = ctx.createChannelSplitter(2)
            source.connect(splitter)
            const aL = ctx.createAnalyser()
            const aR = ctx.createAnalyser()
            aL.fftSize = 512
            aR.fftSize = 512
            splitter.connect(aL, 0)
            splitter.connect(aR, 1)
            analyserLRef.current = aL
            analyserRRef.current = aR
          } catch {
            analyserLRef.current = null
            analyserRRef.current = null
          }
        }

        const timeData = new Uint8Array(analyser.fftSize)
        const timeL = new Uint8Array(analyser.fftSize)
        const timeR = new Uint8Array(analyser.fftSize)
        const freqData = new Uint8Array(analyser.frequencyBinCount)

        const tick = () => {
          const node = analyserRef.current
          if (!node) return
          setLevel(rmsFromAnalyser(node, timeData))

          const aL = analyserLRef.current
          const aR = analyserRRef.current
          if (aL && aR) {
            setLevelL(rmsFromAnalyser(aL, timeL))
            setLevelR(rmsFromAnalyser(aR, timeR))
          } else {
            setLevelL(0)
            setLevelR(0)
          }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    inputDeviceId,
    outputDeviceId,
    aec,
    ns,
    nsModel,
    agc,
    stereo,
    stopTest,
  ])

  // DFN / DTLN 精调：测试进行中热更（不重建采集）
  useEffect(() => {
    nsRef.current?.setDfnTuning?.({
      attenuationLimitDb: dfnAttenuationLimitDb,
      presenceGainDb: dfnPresenceGainDb,
    })
  }, [dfnAttenuationLimitDb, dfnPresenceGainDb])

  useEffect(() => {
    nsRef.current?.setDtlnTuning?.({
      presenceGainDb: dtlnPresenceGainDb,
      makeupGainDb: dtlnMakeupGainDb,
    })
  }, [dtlnPresenceGainDb, dtlnMakeupGainDb])

  useEffect(() => {
    if (gainRef.current) {
      gainRef.current.gain.value =
        Math.min(2, Math.max(0, inputVolume / 100)) * 0.85
    }
  }, [inputVolume])

  useEffect(() => () => stopTest(), [stopTest])

  const stereoActive = channelCount != null && channelCount >= 2
  const stereoWantedButMono = stereo && enabled && channelCount != null && channelCount < 2

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

      {/* 立体声：放在测试卡片内，无需滚到页面底部 */}
      <div className="flex items-start justify-between gap-4 rounded-xl bg-muted/40 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium">立体声采集</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            请求双声道麦克风并按 Opus 立体声编码。普通耳机麦多为单声道；建议戴耳机，AEC
            可能导致仍为单声道。
          </p>
        </div>
        <Switch
          checked={stereo}
          onCheckedChange={(checked) => onStereoChange(Boolean(checked))}
        />
      </div>

      {/* 状态徽章：开关旁即可看到 */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
            stereo
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          偏好：{stereo ? "立体声" : "单声道"}
        </span>
        {enabled && channelCount != null && (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
              stereoActive
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
            )}
          >
            实际采集：{stereoActive ? "立体声（2 声道）" : "单声道"}
          </span>
        )}
        {enabled && channelCount == null && !error && (
          <span className="text-[11px] text-muted-foreground">正在打开麦克风…</span>
        )}
      </div>

      {stereoWantedButMono && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          已开启立体声，但设备仍输出单声道。可尝试关闭「回声消除（AEC）」或更换双声道麦克风/声卡。
        </p>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {enabled && !error && (
        <div className="space-y-2">
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

          {/* 试听对比（docs 20 M5）：按住旁路降噪，松开恢复 */}
          {ns && uplinkWasmModel(nsModel) && (
            <Button
              size="sm"
              variant="outline"
              onPointerDown={() => setComparingRaw(true)}
              onPointerUp={() => setComparingRaw(false)}
              onPointerLeave={() => setComparingRaw(false)}
            >
              {comparingRaw ? "正在播放未降噪原声…" : "按住对比原声"}
            </Button>
          )}

          {/* 总电平 */}
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

          {/* L/R 分轨电平：仅在实际立体声时显示 */}
          {stereoActive && (
            <div className="space-y-1.5 rounded-xl border border-dashed px-3 py-2">
              <p className="text-[11px] font-medium text-muted-foreground">
                左右声道电平（立体声生效）
              </p>
              {(
                [
                  ["L", levelL],
                  ["R", levelR],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-3 shrink-0 text-[10px] font-semibold text-muted-foreground">
                    {label}
                  </span>
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-sky-500 transition-[width] duration-75"
                      style={{ width: `${Math.round(value * 100)}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                    {Math.round(value * 100)}
                  </span>
                </div>
              ))}
            </div>
          )}

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
    <div className="flex items-center justify-between gap-3 py-2">
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
/** DeepFilterNet 首次选用算力确认（docs 20 §7.4）；localStorage 记一次 */
const DFN_CONFIRM_KEY = "owl.nsDfnConfirmed"

export function VoiceSection() {
  const voice = useSettingsStore((state) => state.voice)
  const setVoice = useSettingsStore((state) => state.setVoice)

  const [inputs, setInputs] = useState<DeviceOption[]>([])
  const [outputs, setOutputs] = useState<DeviceOption[]>([])
  const [permission, setPermission] = useState<PermissionState>("unknown")
  /** 应用内确认框：Tauri 下 window.confirm 易被误关/挡在背后，导致「切不过去」 */
  const [dfnConfirmOpen, setDfnConfirmOpen] = useState(false)
  /** 点「仍要启用」关窗时跳过「未启用」日志 */
  const dfnConfirmAcceptedRef = useRef(false)

  /** 持久化设置；采集相关变更在通话中热重开麦克风 */
  const patchVoice = useCallback(
    (patch: Partial<VoiceSettings>, reinitMic = false) => {
      setVoice(patch)
      if (reinitMic) voiceConnection.applyVoiceSettings({ reinitMic: true })
    },
    [setVoice],
  )

  const commitNsModel = useCallback(
    (value: NoiseModelId) => {
      console.info("[noise-suppression] 用户切换降噪模型 →", value, {
        available: isNsModelImplemented(value),
      })
      patchVoice({ nsModel: value })
    },
    [patchVoice],
  )

  /** 选择降噪模型；DeepFilterNet 首次选择需算力确认（docs 20 §7.4，每账号一次） */
  const selectNsModel = useCallback(
    (value: NoiseModelId) => {
      if (
        value === "deepfilternet" &&
        !window.localStorage.getItem(DFN_CONFIRM_KEY)
      ) {
        console.info("[noise-suppression] 弹出 DeepFilterNet 算力确认对话框")
        dfnConfirmAcceptedRef.current = false
        setDfnConfirmOpen(true)
        return
      }
      commitNsModel(value)
    },
    [commitNsModel],
  )

  const confirmDeepFilterNet = useCallback(() => {
    dfnConfirmAcceptedRef.current = true
    window.localStorage.setItem(DFN_CONFIRM_KEY, "1")
    setDfnConfirmOpen(false)
    console.info("[noise-suppression] 用户确认启用 DeepFilterNet")
    commitNsModel("deepfilternet")
  }, [commitNsModel])

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
        if (kind === "input") {
          patchVoice({ inputDeviceId: deviceId }, true)
        } else {
          setVoice({ outputDeviceId: deviceId })
          voiceConnection.applyVoiceSettings({ outputDeviceId: deviceId })
        }
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

      <GroupLabel id="voice-devices">设备</GroupLabel>
      {permission !== "granted" && (
        <div className="mb-3 flex items-center justify-between gap-4 rounded-2xl bg-muted/50 p-4">
          <div>
            <p className="text-sm font-medium">
              {permission === "denied" ? "麦克风权限被拒绝" : "需要麦克风权限"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {permission === "denied"
                ? "请在系统设置中允许 NewtSpeak 访问麦克风后，点击刷新重试"
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

      <GroupLabel id="voice-mic-test">麦克风测试</GroupLabel>
      <MicTestPanel
        inputDeviceId={voice.inputDeviceId}
        outputDeviceId={voice.outputDeviceId}
        inputVolume={voice.inputVolume}
        aec={voice.aec}
        ns={voice.ns}
        nsModel={voice.nsModel}
        nsStrength={voice.nsStrengthByModel?.[voice.nsModel] ?? 100}
        dfnAttenuationLimitDb={voice.dfnAttenuationLimitDb ?? 48}
        dfnPresenceGainDb={voice.dfnPresenceGainDb ?? 2}
        dtlnPresenceGainDb={voice.dtlnPresenceGainDb ?? 2}
        dtlnMakeupGainDb={voice.dtlnMakeupGainDb ?? 0.5}
        agc={voice.agc}
        stereo={voice.stereo}
        onStereoChange={(checked) => patchVoice({ stereo: checked }, true)}
        onPermissionGranted={() => {
          setPermission("granted")
          void refreshDevices()
        }}
      />

      <GroupLabel id="voice-volume">音量</GroupLabel>
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

      <GroupLabel id="voice-pack">入场音效</GroupLabel>
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

      <GroupLabel id="voice-input-mode">输入模式</GroupLabel>
      <p className="mb-2 text-xs text-muted-foreground">
        已接入语音层：按键说话时仅按住绑定键才开麦（应用焦点内）。
      </p>
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
              按住指定按键时才传输声音。当前绑定与释放延迟见「快捷键」分栏。
            </p>
            {voice.inputMode === "push-to-talk" && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  绑定键：
                  <kbd className="ml-1 rounded border bg-muted px-1.5 py-0.5 font-sans">
                    {formatKeyCode(voice.pttKey)}
                  </kbd>
                </span>
                <span>· 释放延迟 {voice.pttReleaseDelayMs ?? 0} ms</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() =>
                    useSettingsStore.getState().openPanel("keybinds")
                  }
                >
                  修改绑定
                </Button>
              </div>
            )}
          </div>
        </label>
      </RadioGroup>

      <GroupLabel id="voice-processing">音频处理</GroupLabel>
      <SettingRow label="回声消除（AEC）" description="消除扬声器回授到麦克风的回声">
        <Switch
          checked={voice.aec}
          onCheckedChange={(checked) => patchVoice({ aec: Boolean(checked) }, true)}
        />
      </SettingRow>
      <SettingRow label="噪声抑制（NS）" description="过滤键盘声、风扇声等环境噪音">
        {/* ns/nsModel 的通话中热切由 connection 的设置订阅统一驱动，勿再手动 reinit（防双重采麦） */}
        <Switch
          checked={voice.ns}
          onCheckedChange={(checked) => patchVoice({ ns: Boolean(checked) })}
        />
      </SettingRow>
      <SettingRow
        label="降噪模型"
        description={
          voice.ns
            ? "换模型将立即应用到当前通话；模型全部内置本地运行，无需联网"
            : "开启噪声抑制后可选择模型"
        }
      >
        <Select
          value={voice.nsModel}
          disabled={!voice.ns}
          onValueChange={(value) => selectNsModel(value as NoiseModelId)}
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NOISE_MODELS.map((model) => {
              const available = isNsModelImplemented(model.id)
              return (
                <SelectItem
                  key={model.id}
                  value={model.id}
                  disabled={!model.implemented || !available}
                >
                  <span className="flex flex-col items-start">
                    <span>
                      {model.label}
                      {!model.implemented
                        ? "（本平台即将推出）"
                        : !available
                          ? "（当前环境不支持）"
                          : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {model.scope} · 算力{model.cpu} · {model.license}
                    </span>
                  </span>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </SettingRow>
      {voice.ns && downlinkFallbackLabel(voice.nsModel) && (
        <p className="text-xs text-muted-foreground">
          当前模型仅作用于自己的麦克风；对他人的「本地降噪」将使用{" "}
          {downlinkFallbackLabel(voice.nsModel)}。
        </p>
      )}
      {voice.ns && uplinkWasmModel(voice.nsModel) && voice.stereo && (
        <p className="text-xs text-muted-foreground">
          使用 RNNoise / Speex / DTLN / DeepFilterNet 时，立体声会先合并为单声道再降噪。
        </p>
      )}
      {voice.ns && uplinkWasmModel(voice.nsModel) && (
        <SettingRow
          label="降噪强度"
          description={`${voice.nsStrengthByModel?.[voice.nsModel] ?? 100}%（干/湿混合，按模型记忆，实时生效）`}
        >
          <div className="w-56">
            <Slider
              min={0}
              max={100}
              value={voice.nsStrengthByModel?.[voice.nsModel] ?? 100}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value
                if (typeof next === "number")
                  useSettingsStore
                    .getState()
                    .setNsStrength(voice.nsModel, next)
              }}
            />
          </div>
        </SettingRow>
      )}

      {/* DeepFilterNet 专用：预设 + 衰减/清晰度细调 */}
      {voice.ns && voice.nsModel === "deepfilternet" && (
        <>
          <GroupLabel id="voice-dfn">DeepFilterNet 调参</GroupLabel>
          <p className="mb-2 text-xs text-foreground/55">
            预设快速匹配场景；也可拖动滑条自定义（实时生效，无需重进语音）。
          </p>
          <div className="mb-3 flex flex-col gap-1.5">
            {DFN_PRESETS.map((preset) => {
              const active = (voice.dfnPreset ?? "env-keyboard") === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    useSettingsStore.getState().applyDfnPreset(preset.id)
                  }
                  className={cn(
                    "rounded-xl px-3 py-2.5 text-left transition-colors",
                    active
                      ? "bg-black/[0.07] ring-1 ring-black/10 dark:bg-white/[0.1] dark:ring-white/15"
                      : "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
                  )}
                >
                  <p
                    className={cn(
                      "text-[13px]",
                      active ? "font-semibold text-foreground" : "text-foreground/85",
                    )}
                  >
                    {preset.label}
                    {preset.id === "env-keyboard" ? (
                      <span className="ml-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        默认
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-foreground/50">
                    {preset.description}
                  </p>
                </button>
              )
            })}
          </div>
          <SettingRow
            label="噪声衰减上限"
            description={`${voice.dfnAttenuationLimitDb ?? 48} dB · 越高越能压键盘/环境噪音，过高可能伤齿音`}
          >
            <div className="w-56">
              <Slider
                min={0}
                max={80}
                value={voice.dfnAttenuationLimitDb ?? 48}
                onValueChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value
                  if (typeof next === "number") {
                    useSettingsStore.getState().setDfnTuning({
                      attenuationLimitDb: next,
                    })
                  }
                }}
              />
            </div>
          </SettingRow>
          <SettingRow
            label="人声清晰度"
            description={`${(voice.dfnPresenceGainDb ?? 2) >= 0 ? "+" : ""}${voice.dfnPresenceGainDb ?? 2} dB · 轻度提升听感；过高易发干`}
          >
            <div className="w-56">
              <Slider
                min={-6}
                max={8}
                step={0.5}
                value={voice.dfnPresenceGainDb ?? 2}
                onValueChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value
                  if (typeof next === "number") {
                    useSettingsStore.getState().setDfnTuning({
                      presenceGainDb: next,
                    })
                  }
                }}
              />
            </div>
          </SettingRow>
        </>
      )}

      {/* DTLN 专用：预设 + 清晰度/输出补偿精调 */}
      {voice.ns && voice.nsModel === "dtln" && (
        <>
          <GroupLabel id="voice-dtln">DTLN 调参</GroupLabel>
          <p className="mb-2 text-xs text-foreground/55">
            预设快速匹配场景；也可拖动滑条自定义（实时生效，无需重进语音）。
            DTLN 模型本身无内部旋钮，清晰度与补偿经湿路后处理实现。
          </p>
          <div className="mb-3 flex flex-col gap-1.5">
            {DTLN_PRESETS.map((preset) => {
              const active = (voice.dtlnPreset ?? "env-keyboard") === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    useSettingsStore.getState().applyDtlnPreset(preset.id)
                  }
                  className={cn(
                    "rounded-xl px-3 py-2.5 text-left transition-colors",
                    active
                      ? "bg-black/[0.07] ring-1 ring-black/10 dark:bg-white/[0.1] dark:ring-white/15"
                      : "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
                  )}
                >
                  <p
                    className={cn(
                      "text-[13px]",
                      active ? "font-semibold text-foreground" : "text-foreground/85",
                    )}
                  >
                    {preset.label}
                    {preset.id === "env-keyboard" ? (
                      <span className="ml-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        默认
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-foreground/50">
                    {preset.description}
                  </p>
                </button>
              )
            })}
          </div>
          <SettingRow
            label="人声清晰度"
            description={`${(voice.dtlnPresenceGainDb ?? 2) >= 0 ? "+" : ""}${voice.dtlnPresenceGainDb ?? 2} dB · 约 2.8kHz 峰值提升；过高易发干`}
          >
            <div className="w-56">
              <Slider
                min={-6}
                max={8}
                step={0.5}
                value={voice.dtlnPresenceGainDb ?? 2}
                onValueChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value
                  if (typeof next === "number") {
                    useSettingsStore.getState().setDtlnTuning({
                      presenceGainDb: next,
                    })
                  }
                }}
              />
            </div>
          </SettingRow>
          <SettingRow
            label="输出补偿"
            description={`${(voice.dtlnMakeupGainDb ?? 0.5) >= 0 ? "+" : ""}${voice.dtlnMakeupGainDb ?? 0.5} dB · 强降噪后补回电平；过高可能削波`}
          >
            <div className="w-56">
              <Slider
                min={-6}
                max={6}
                step={0.5}
                value={voice.dtlnMakeupGainDb ?? 0.5}
                onValueChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value
                  if (typeof next === "number") {
                    useSettingsStore.getState().setDtlnTuning({
                      makeupGainDb: next,
                    })
                  }
                }}
              />
            </div>
          </SettingRow>
        </>
      )}

      <SettingRow
        label="下行同时降噪路数上限"
        description="对多人开启「本地为其降噪」的软上限，超出仅提示不拦截；默认按模型（轻量 8 路 / DeepFilterNet 4 路）"
      >
        <Select
          value={
            voice.localNsMaxTracks === null
              ? "auto"
              : String(voice.localNsMaxTracks)
          }
          onValueChange={(value) =>
            setVoice({
              localNsMaxTracks: value === "auto" ? null : Number(value),
            })
          }
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">默认（按模型）</SelectItem>
            {[4, 8, 12, 16].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} 路
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow label="自动增益（AGC）" description="自动调整麦克风输入电平">
        <Switch
          checked={voice.agc}
          onCheckedChange={(checked) => patchVoice({ agc: Boolean(checked) }, true)}
        />
      </SettingRow>
      <SettingRow
        label="立体声"
        description="双声道采集并按 Opus 立体声传输（适合有线双声道麦 / 声卡；普通耳机麦多半仍是单声道。建议戴耳机，AEC 可能限制双声道）"
      >
        <Switch
          checked={voice.stereo}
          onCheckedChange={(checked) => patchVoice({ stereo: Boolean(checked) }, true)}
        />
      </SettingRow>

      <Dialog
        open={dfnConfirmOpen}
        onOpenChange={(open) => {
          setDfnConfirmOpen(open)
          if (!open && !dfnConfirmAcceptedRef.current) {
            console.info(
              "[noise-suppression] 用户关闭 DeepFilterNet 算力确认（未启用）",
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
                  "[noise-suppression] 用户取消 DeepFilterNet 算力确认",
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
