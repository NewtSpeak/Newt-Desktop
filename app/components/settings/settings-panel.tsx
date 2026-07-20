// 设置面板（docs 16 FR-01，Discord 风格）：全屏覆盖层 + 左侧分类导航 +
// 右侧内容区，Esc 关闭。打开入口：Ctrl/Cmd+, 快捷键（app-shell 挂载）与用户菜单。

import { useEffect } from "react"
import {
  BellIcon,
  CircleUserRoundIcon,
  InfoIcon,
  KeyboardIcon,
  MicIcon,
  PaletteIcon,
  XIcon,
} from "lucide-react"

import { cn } from "~/lib/utils"
import { useSettingsStore, type SettingsSection } from "~/stores/settings"
import { AboutSection } from "./about-section"
import { AccountSection } from "./account-section"
import { AppearanceSection } from "./appearance-section"
import { KeybindsSection } from "./keybinds-section"
import { NotificationsSection } from "./notifications-section"
import { VoiceSection } from "./voice-section"

const NAV: { group: string; items: { id: SettingsSection; label: string; icon: typeof MicIcon }[] }[] = [
  {
    group: "用户设置",
    items: [{ id: "account", label: "我的账号", icon: CircleUserRoundIcon }],
  },
  {
    group: "应用设置",
    items: [
      { id: "voice", label: "语音与视频", icon: MicIcon },
      { id: "notifications", label: "通知", icon: BellIcon },
      { id: "appearance", label: "外观", icon: PaletteIcon },
      { id: "keybinds", label: "快捷键", icon: KeyboardIcon },
    ],
  },
  {
    group: "高级",
    items: [{ id: "about", label: "关于", icon: InfoIcon }],
  },
]

function SectionContent({ section }: { section: SettingsSection }) {
  switch (section) {
    case "account":
      return <AccountSection />
    case "voice":
      return <VoiceSection />
    case "notifications":
      return <NotificationsSection />
    case "appearance":
      return <AppearanceSection />
    case "keybinds":
      return <KeybindsSection />
    case "about":
      return <AboutSection />
  }
}

export function SettingsPanel() {
  const open = useSettingsStore((state) => state.panelOpen)
  const section = useSettingsStore((state) => state.activeSection)
  const setSection = useSettingsStore((state) => state.setSection)
  const closePanel = useSettingsStore((state) => state.closePanel)

  // Esc 关闭（捕获阶段优先于内部控件）
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        closePanel()
      }
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [open, closePanel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
    >
      {/* 左侧导航（右对齐窄列） */}
      <nav className="flex w-56 shrink-0 flex-col overflow-y-auto border-r bg-sidebar py-12 pr-2 pl-4">
        {NAV.map(({ group, items }) => (
          <div key={group} className="mb-4">
            <p className="px-3 pb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {group}
            </p>
            {items.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors",
                  section === id
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* 右侧内容区 */}
      <div className="relative min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 py-12 pr-16">
          <SectionContent section={section} />
        </div>
        {/* 关闭按钮（Discord 风格右上角圆钮 + ESC 标注） */}
        <div className="absolute top-12 right-6 flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={closePanel}
            aria-label="关闭设置"
            className="flex size-9 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
          <span className="text-[10px] font-semibold text-muted-foreground select-none">ESC</span>
        </div>
      </div>
    </div>
  )
}
