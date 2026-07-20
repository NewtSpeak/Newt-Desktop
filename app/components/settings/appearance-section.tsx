// 设置 · 外观（docs 16 FR-17/18/19 P0）：主题/字体大小即时生效（settings store
// 的 initAppearance 负责把值写到 html 根节点），消息密度先存储备用。

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"

import { Slider } from "~/components/ui/slider"
import {
  FONT_SIZE_STEPS,
  useSettingsStore,
  type MessageDensity,
  type ThemeMode,
} from "~/stores/settings"
import { cn } from "~/lib/utils"
import { GroupLabel, SectionTitle, SettingRow } from "./section"

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof MoonIcon }[] = [
  { value: "dark", label: "深色", icon: MoonIcon },
  { value: "light", label: "浅色", icon: SunIcon },
  { value: "system", label: "跟随系统", icon: MonitorIcon },
]

const DENSITY_OPTIONS: { value: MessageDensity; label: string; description: string }[] = [
  { value: "comfortable", label: "舒适", description: "头像与多行留白" },
  { value: "compact", label: "紧凑", description: "单行密集排列" },
]

export function AppearanceSection() {
  const appearance = useSettingsStore((state) => state.appearance)
  const setAppearance = useSettingsStore((state) => state.setAppearance)

  const fontIndex = Math.max(0, FONT_SIZE_STEPS.indexOf(appearance.fontSize as 12))

  return (
    <div>
      <SectionTitle>外观</SectionTitle>

      <GroupLabel>主题</GroupLabel>
      <div className="grid grid-cols-3 gap-2">
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setAppearance({ theme: value })}
            className={cn(
              "flex flex-col items-center gap-2 rounded-2xl border p-4 text-sm transition-colors",
              appearance.theme === value
                ? "border-primary bg-primary/10 font-medium"
                : "hover:bg-muted/50",
            )}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </div>

      <GroupLabel>字体大小</GroupLabel>
      <div className="rounded-2xl border p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">12px</span>
          <span className="text-sm font-medium">{appearance.fontSize}px</span>
          <span className="text-xs text-muted-foreground">24px</span>
        </div>
        <Slider
          min={0}
          max={FONT_SIZE_STEPS.length - 1}
          step={1}
          value={fontIndex}
          onValueChange={(value) => {
            const index = Array.isArray(value) ? value[0] : value
            setAppearance({ fontSize: FONT_SIZE_STEPS[index] ?? 16 })
          }}
        />
      </div>

      <GroupLabel>消息显示密度</GroupLabel>
      <div className="grid grid-cols-2 gap-2">
        {DENSITY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setAppearance({ density: option.value })}
            className={cn(
              "flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-colors",
              appearance.density === option.value
                ? "border-primary bg-primary/10"
                : "hover:bg-muted/50",
            )}
          >
            <span className="text-sm font-medium">{option.label}</span>
            <span className="text-xs text-muted-foreground">{option.description}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">消息区密度切换将在后续版本生效</p>
    </div>
  )
}
