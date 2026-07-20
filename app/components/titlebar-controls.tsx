// 窗口右上角悬浮控制区（挂载于 root，覆盖全部路由与全屏面板）：
//   - 主题切换按钮：在浅色/深色之间切换（写入 settings store 的 appearance.theme，
//     与设置面板·外观联动；当前为「跟随系统」时按实际生效主题取反）。
//   - Windows/Linux（无边框窗口）：主题按钮右侧渲染最小化/最大化/关闭三键，
//     对齐系统标题栏习惯；macOS 交通灯在左上角，此处仅渲染主题按钮。

import { useEffect, useState } from "react"
import { CopyIcon, MinusIcon, MoonIcon, SquareIcon, SunIcon, XIcon } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip"
import { useIsMacDesktop, useIsTauri } from "~/lib/platform"
import { dragWindowOnMouseDown } from "~/lib/window-drag"
import { cn } from "~/lib/utils"
import { useSettingsStore } from "~/stores/settings"

/** 当前实际生效的主题是否为深色（theme=system 时跟随系统） */
function useEffectiveDark() {
  const theme = useSettingsStore((state) => state.appearance.theme)
  const [systemDark, setSystemDark] = useState(false)

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    setSystemDark(media.matches)
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  return theme === "dark" || (theme === "system" && systemDark)
}

function ThemeToggleButton() {
  const isDark = useEffectiveDark()
  const setAppearance = useSettingsStore((state) => state.setAppearance)

  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={isDark ? "切换到日间模式" : "切换到夜间模式"}
        onClick={() => setAppearance({ theme: isDark ? "light" : "dark" })}
        className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {isDark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isDark ? "切换到日间模式" : "切换到夜间模式"}
      </TooltipContent>
    </Tooltip>
  )
}

/** Windows/Linux 无边框窗口的最小化/最大化（还原）/关闭三键 */
function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  // 跟踪最大化状态，切换最大化/还原图标
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window")
      const win = getCurrentWindow()
      const sync = async () => {
        const value = await win.isMaximized()
        if (!disposed) setMaximized(value)
      }
      await sync()
      const stop = await win.onResized(() => void sync())
      if (disposed) stop()
      else unlisten = stop
    })()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const invoke = async (action: "minimize" | "toggleMaximize" | "close") => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window")
    await getCurrentWindow()[action]()
  }

  const baseClass =
    "flex h-8 w-11 items-center justify-center text-foreground/70 transition-colors outline-none"

  return (
    <div className="flex">
      <button
        type="button"
        aria-label="最小化"
        onClick={() => void invoke("minimize")}
        className={cn(baseClass, "hover:bg-muted hover:text-foreground")}
      >
        <MinusIcon className="size-4" />
      </button>
      <button
        type="button"
        aria-label={maximized ? "还原" : "最大化"}
        onClick={() => void invoke("toggleMaximize")}
        className={cn(baseClass, "hover:bg-muted hover:text-foreground")}
      >
        {maximized ? (
          <CopyIcon className="size-3.5 -scale-x-100" />
        ) : (
          <SquareIcon className="size-3.5" />
        )}
      </button>
      <button
        type="button"
        aria-label="关闭"
        onClick={() => void invoke("close")}
        className={cn(baseClass, "hover:bg-[#e81123] hover:text-white")}
      >
        <XIcon className="size-4" />
      </button>
    </div>
  )
}

export function TitlebarControls() {
  const isTauri = useIsTauri()
  const isMacDesktop = useIsMacDesktop()
  // 无系统标题栏的桌面端（Windows/Linux）需要自绘窗口三键
  const showWindowControls = isTauri && !isMacDesktop

  return (
    <div
      // 与 --app-top-inset（32px）等高；空白处仍可拖拽窗口
      className={cn(
        "fixed top-0 right-0 z-60 flex h-8 items-center",
        showWindowControls ? "gap-1" : "pr-2",
      )}
      onMouseDown={dragWindowOnMouseDown}
    >
      <ThemeToggleButton />
      {showWindowControls && <WindowControls />}
    </div>
  )
}
