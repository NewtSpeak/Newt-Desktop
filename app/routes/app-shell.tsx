// 受保护的应用壳（原 dashboard.tsx 改造）：
//   启动 gate（静默续期 → 加载态/跳登录）→ Gateway 自动连接 → 服务器栏 + 频道列表 + 内容区。
// 窗口拖拽、顶部 32px 留白（--app-top-inset）、macOS 交通灯避让行为保持不变。

import { useEffect, useState } from "react"
import { Navigate, Outlet } from "react-router"

import { AppSidebar } from "~/components/app-sidebar"
import { ChannelList } from "~/components/channel-list"
import { QuickSwitcher } from "~/components/quick-switcher"
import { SearchPanel } from "~/components/search/search-panel"
import { SettingsPanel } from "~/components/settings/settings-panel"
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar"
import { Toaster } from "~/components/ui/sonner"
import { useAuthBootstrap } from "~/hooks/use-auth-bootstrap"
import { dragWindowOnSelfMouseDown } from "~/lib/window-drag"
import { gateway } from "~/lib/gateway/client"
import { bindGatewayToStores } from "~/stores/gateway-bindings"
import { useGuildsStore } from "~/stores/guilds"
import { useSettingsStore } from "~/stores/settings"

export default function AppShell() {
  const status = useAuthBootstrap()
  const [switcherOpen, setSwitcherOpen] = useState(false)

  // 进入应用壳后：绑定事件分发 + 连接 Gateway + 拉服务器列表
  useEffect(() => {
    if (status !== "authenticated") return
    bindGatewayToStores()
    gateway.connect()
    void useGuildsStore.getState().fetchGuilds().catch(() => undefined)
  }, [status])

  // 全局快捷键：Ctrl/Cmd+K 快速切换器、Ctrl/Cmd+, 设置面板
  useEffect(() => {
    if (status !== "authenticated") return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === "k" || event.key === "K") {
        event.preventDefault()
        setSwitcherOpen((open) => !open)
      } else if (event.key === ",") {
        event.preventDefault()
        useSettingsStore.getState().openPanel()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [status])

  if (status === "loading") {
    return (
      <div
        className="flex h-svh items-center justify-center bg-background"
        onMouseDown={dragWindowOnSelfMouseDown}
      >
        <p className="text-sm text-muted-foreground">正在恢复会话…</p>
      </div>
    )
  }
  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />
  }

  return (
    <SidebarProvider
      defaultOpen={false}
      className="h-svh overflow-hidden"
      // 顶部留白等裸露区域（直接点在容器本身）可拖拽窗口
      onMouseDown={dragWindowOnSelfMouseDown}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--sidebar-width-icon": "3rem",
          "--header-height": "calc(var(--spacing) * 12)",
          "--app-top-inset": "32px",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      {/* 仅右侧页面区域向下让出顶部间距，左侧导航不受影响 */}
      <SidebarInset className="min-h-0 overflow-hidden md:peer-data-[variant=inset]:mt-(--app-top-inset)">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* 频道列表栏（240px） */}
          <ChannelList />
          {/* 页面内容在此容器内部滚动 */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-none">
            <Outlet />
          </div>
          {/* 消息搜索面板（右侧 420px 滑出） */}
          <SearchPanel />
        </div>
      </SidebarInset>
      {/* 全局 toast（语音错误提示等） */}
      <Toaster position="bottom-right" />
      {/* Ctrl/Cmd+K 快速切换器浮层 */}
      <QuickSwitcher open={switcherOpen} onOpenChange={setSwitcherOpen} />
      {/* 全屏设置面板（Ctrl/Cmd+, 或用户菜单打开） */}
      <SettingsPanel />
    </SidebarProvider>
  )
}
