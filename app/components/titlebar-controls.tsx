// 窗口右上角悬浮控制区：主题、活跃度速览、通知铃铛、好友入口（含私信未读）、窗口三键。

import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router"
import {
  CopyIcon,
  MailIcon,
  MinusIcon,
  MoonIcon,
  SquareIcon,
  SunIcon,
  XIcon,
} from "lucide-react"

import { ActivityQuickButton } from "~/components/activity-quick-popover"
import { NotificationsInboxButton } from "~/components/notifications-inbox"
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip"
import { FRIENDS_PATH } from "~/lib/friends-route"
import { useIsMobileApp, useShowWindowControls } from "~/lib/platform"
import { dragWindowOnMouseDown } from "~/lib/window-drag"
import { cn } from "~/lib/utils"
import { usePrivateChannelsStore } from "~/stores/private-channels"
import {
  channelUnreadCount,
  formatUnreadBadge,
  useReadStatesStore,
} from "~/stores/read-states"
import { pendingIncomingOf, useRelationshipsStore } from "~/stores/relationships"
import { useSettingsStore } from "~/stores/settings"
import { useUIStore } from "~/stores/ui"

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

// 可见约 32px 触控热区；角标相对按钮定位，容器需给顶部留白避免裁切
const titlebarIconBtnClass =
  "relative flex size-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring/50"

function ThemeToggleButton() {
  const isDark = useEffectiveDark()
  const setAppearance = useSettingsStore((state) => state.setAppearance)

  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={isDark ? "切换到日间模式" : "切换到夜间模式"}
        onClick={() => setAppearance({ theme: isDark ? "light" : "dark" })}
        className={titlebarIconBtnClass}
      >
        {isDark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isDark ? "切换到日间模式" : "切换到夜间模式"}
      </TooltipContent>
    </Tooltip>
  )
}

/** 好友入口：打开好友页；角标 = 私信未读 + 待处理好友请求 */
function FriendsButton() {
  const navigate = useNavigate()
  const privateChannels = usePrivateChannelsStore((s) => s.channels)
  const unreadCountByChannel = useReadStatesStore((s) => s.unreadCountByChannel)
  const lastReadByChannel = useReadStatesStore((s) => s.lastReadByChannel)
  const latestByChannel = useReadStatesStore((s) => s.latestByChannel)
  // selector 禁止返回新数组；在 useMemo 内汇总未读
  const dmUnread = useMemo(() => {
    let total = 0
    const slice = { unreadCountByChannel, lastReadByChannel, latestByChannel }
    for (const channel of privateChannels) {
      total += channelUnreadCount(slice, channel.id)
    }
    return total
  }, [
    privateChannels,
    unreadCountByChannel,
    lastReadByChannel,
    latestByChannel,
  ])
  const pendingFriends = useRelationshipsStore(
    (s) => pendingIncomingOf(s.items).length,
  )
  const badgeCount = dmUnread + pendingFriends
  const badge =
    badgeCount > 0 ? formatUnreadBadge(badgeCount) : null

  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={
          badge
            ? `好友与私信，${badge} 条未读或待处理`
            : "好友"
        }
        onClick={() => {
          useUIStore.getState().selectGuild(null)
          navigate(FRIENDS_PATH)
        }}
        className={titlebarIconBtnClass}
      >
        <MailIcon className="size-4" />
        <span className="t-badge" data-open={badge ? "true" : "false"}>
          {badge ? (
            <span className="t-badge-dot tabular-nums">{badge}</span>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {badge ? `好友（${badge} 条未读）` : "好友"}
      </TooltipContent>
    </Tooltip>
  )
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false)

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
    // 关闭走 updater_quit：有已下载更新时先启动安装再退出
    if (action === "close") {
      const { updaterQuit } = await import("~/lib/updater")
      await updaterQuit()
      return
    }
    const { getCurrentWindow } = await import("@tauri-apps/api/window")
    await getCurrentWindow()[action]()
  }

  const baseClass =
    "flex h-8 w-11 items-center justify-center text-foreground/70 outline-none transition-colors"

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
  const showWindowControls = useShowWindowControls()
  const isMobileApp = useIsMobileApp()

  // 移动 App：暂时隐藏右上角整组控件（主题/活跃度/通知/好友/窗口键），
  // 避免缩放后与系统状态栏、标题带重叠；桌面端保持原样。
  if (isMobileApp) return null

  return (
    <div
      className={cn(
        // 桌面：不再需要顶部留白（badge 已调整 top: -1px）；窄屏/移动 Web 走下方 safe-area
        "fixed top-0 right-0 z-60 flex items-start gap-0.5 overflow-visible",
        showWindowControls ? "pr-0" : "pr-2",
        "max-md:pt-[max(0.5rem,calc(env(safe-area-inset-top,0px)+0.35rem))] max-md:pr-2",
      )}
      onMouseDown={dragWindowOnMouseDown}
    >
      <ThemeToggleButton />
      <ActivityQuickButton />
      <NotificationsInboxButton />
      <FriendsButton />
      {/* 仅 Windows/Linux 桌面；Android/iOS App 不渲染窗口三键 */}
      {showWindowControls ? (
        <div className="flex h-8 items-center self-start">
          <WindowControls />
        </div>
      ) : null}
    </div>
  )
}
