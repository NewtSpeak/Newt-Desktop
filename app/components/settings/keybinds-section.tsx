// 设置 · 快捷键（docs 16 FR-21 P0 骨架）：只读列表展示现有快捷键，自定义即将推出。

import { ComingSoon, GroupLabel, SectionTitle } from "./section"

const IS_MAC = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")
const MOD = IS_MAC ? "⌘" : "Ctrl"

type Keybind = { action: string; keys: string[] }

const KEYBINDS: { group: string; items: Keybind[] }[] = [
  {
    group: "导航与搜索",
    items: [
      { action: "快速切换器 / 搜索", keys: [MOD, "K"] },
      { action: "打开设置", keys: [MOD, ","] },
      { action: "关闭浮层 / 面板", keys: ["Esc"] },
    ],
  },
  {
    group: "消息",
    items: [
      { action: "发送消息", keys: ["Enter"] },
      { action: "换行", keys: ["Shift", "Enter"] },
      { action: "编辑最近一条消息", keys: ["↑（输入框为空时）"] },
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
  return (
    <div>
      <SectionTitle>快捷键</SectionTitle>
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">自定义快捷键</span>
        <ComingSoon />
      </div>
      {KEYBINDS.map(({ group, items }) => (
        <div key={group}>
          <GroupLabel>{group}</GroupLabel>
          {items.map((item) => (
            <div
              key={item.action}
              className="flex items-center justify-between border-b py-3 last:border-b-0"
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
