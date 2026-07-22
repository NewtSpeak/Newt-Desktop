// 设置 · 快捷键（docs 16 FR-21）：固定快捷键一览 + 可自定义 PTT 绑定。

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import { Slider } from "~/components/ui/slider"
import { formatKeyCode } from "~/lib/key-label"
import { useSettingsStore } from "~/stores/settings"
import { GroupLabel, SectionTitle, SettingRow } from "./section"

const IS_MAC =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")
const MOD = IS_MAC ? "⌘" : "Ctrl"

type FixedBind = { action: string; keys: string[] }

const FIXED: { id: string; group: string; items: FixedBind[] }[] = [
  {
    id: "keybinds-nav",
    group: "导航与搜索",
    items: [
      { action: "快速切换器 / 搜索", keys: [MOD, "K"] },
      { action: "打开设置", keys: [MOD, ","] },
      { action: "关闭浮层 / 面板", keys: ["Esc"] },
      { action: "界面放大", keys: [MOD, "+"] },
      { action: "界面缩小", keys: [MOD, "-"] },
      { action: "重置界面缩放", keys: [MOD, "0"] },
    ],
  },
  {
    id: "keybinds-message",
    group: "消息",
    items: [
      { action: "发送消息", keys: ["Enter"] },
      { action: "换行", keys: ["Shift", "Enter"] },
      { action: "编辑最近一条消息", keys: ["↑（输入框为空时）"] },
    ],
  },
  {
    id: "keybinds-voice",
    group: "语音",
    items: [
      { action: "切换静音（UI 按钮）", keys: ["点击麦克风"] },
      { action: "切换闭听（UI 按钮）", keys: ["点击耳机"] },
    ],
  },
]

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="rounded-md border bg-muted px-1.5 py-0.5 font-sans text-xs text-muted-foreground"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}

export function KeybindsSection() {
  const pttKey = useSettingsStore((s) => s.voice.pttKey)
  const pttDelay = useSettingsStore((s) => s.voice.pttReleaseDelayMs)
  const inputMode = useSettingsStore((s) => s.voice.inputMode)
  const setVoice = useSettingsStore((s) => s.setVoice)
  const [listening, setListening] = useState(false)

  useEffect(() => {
    if (!listening) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === "Escape") {
        setListening(false)
        return
      }
      // 过滤纯修饰键
      if (
        ["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(
          event.code,
        )
      ) {
        return
      }
      setVoice({ pttKey: event.code })
      setListening(false)
      toast.success(`PTT 已绑定为 ${formatKeyCode(event.code)}`)
    }
    const onMouse = (event: MouseEvent) => {
      if (event.button === 3 || event.button === 4) {
        event.preventDefault()
        const code = event.button === 3 ? "Mouse4" : "Mouse5"
        setVoice({ pttKey: code })
        setListening(false)
        toast.success(`PTT 已绑定为 ${formatKeyCode(code)}`)
      }
    }
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("mousedown", onMouse, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("mousedown", onMouse, true)
    }
  }, [listening, setVoice])

  return (
    <div>
      <SectionTitle>快捷键</SectionTitle>

      <GroupLabel id="keybinds-ptt">按键说话（可自定义）</GroupLabel>
      <p className="mb-2 text-xs text-muted-foreground">
        当前输入模式：
        {inputMode === "push-to-talk" ? "按键说话" : "语音激活"}
        。在「语音与视频」中切换模式。PTT 在应用焦点内生效。
      </p>
      <SettingRow
        label="PTT 按键"
        description={
          listening
            ? "请按下要绑定的键…（Esc 取消）"
            : `当前：${formatKeyCode(pttKey)}`
        }
      >
        <Button
          size="sm"
          variant={listening ? "default" : "outline"}
          onClick={() => setListening((v) => !v)}
        >
          {listening ? "等待按键…" : "重新绑定"}
        </Button>
      </SettingRow>
      <SettingRow
        label="释放延迟"
        description={`${pttDelay} ms — 松键后延迟关麦，避免尾音被切`}
      >
        <div className="w-40">
          <Slider
            min={0}
            max={2000}
            step={50}
            value={pttDelay}
            onValueChange={(value) =>
              setVoice({
                pttReleaseDelayMs: Array.isArray(value) ? value[0]! : value,
              })
            }
          />
        </div>
      </SettingRow>

      {FIXED.map(({ id, group, items }) => (
        <div key={id}>
          <GroupLabel id={id}>{group}</GroupLabel>
          {items.map((item) => (
            <div
              key={item.action}
              className="flex items-center justify-between py-3"
            >
              <span className="text-sm">{item.action}</span>
              <Keys keys={item.keys} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
