// 设置 · 语音与视频（docs 16 FR-06/07/08/10 P0）：
// 设备枚举与选择只写设置 store（偏好存储），不直接操作正在进行的语音连接。
//
// TODO(语音层接入)：app/lib/voice/** 建立/重建音频轨时应读取
// useSettingsStore.getState().voice 的 inputDeviceId / aec / ns / agc 等值，
// 并订阅变化做热切换；本组件只负责偏好存储，接入点在语音连接层。

import { useCallback, useEffect, useState } from "react"
import { MicIcon, RefreshCwIcon } from "lucide-react"

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
import { useSettingsStore, type VoiceInputMode } from "~/stores/settings"
import { ComingSoon, GroupLabel, SectionTitle, SettingRow } from "./section"

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
