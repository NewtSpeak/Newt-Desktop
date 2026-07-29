// 应用壳：
//   启动 gate（静默续期 → 加载态/欢迎空态）→ Gateway 自动连接 → 服务器栏 + 频道列表 + 内容区。
// 未登录不再整页跳转登录页，而是渲染欢迎壳（左侧只有「+」，右侧引导/页内认证流程）。
// 窗口拖拽、顶部 32px 留白（--app-top-inset）、macOS 交通灯避让行为保持不变。

import { useEffect, useState } from "react"
import { Outlet, useLocation } from "react-router"

import { AppSidebar } from "~/components/app-sidebar"
import { ChannelList } from "~/components/channel-list"
import { GuildAvatar } from "~/components/guild-avatar"
import { MemberPanel } from "~/components/member-panel"
import { QuickSwitcher } from "~/components/quick-switcher"
import { SearchPanel } from "~/components/search/search-panel"
import { SettingsPanel } from "~/components/settings/settings-panel"
import { ChannelSettingsPanel } from "~/components/channel-settings-panel"
import { ChannelUnlockDialog } from "~/components/channel-unlock-dialog"
import { GuildPersonalPanel } from "~/components/settings/guild-personal-panel"
import { GuildAdminPanel } from "~/components/guild-settings/guild-settings-panel"
import { PackPreviewDialog } from "~/components/messages/pack-preview-dialog"
import { WelcomeShell } from "~/components/welcome-shell"
import { SidebarProvider } from "~/components/ui/sidebar"
import { Toaster } from "~/components/ui/sonner"
import { useAuthBootstrap } from "~/hooks/use-auth-bootstrap"
import { useAuthStore } from "~/stores/auth"
import { isFriendsLocation } from "~/lib/friends-route"
import { isShopLocation } from "~/lib/shop-route"
import { isStickersLocation } from "~/lib/stickers-route"
import {
  dragWindowOnMouseDown,
  dragWindowOnSelfMouseDown,
} from "~/lib/window-drag"
import { gateway } from "~/lib/gateway/client"
import { initDockBadge } from "~/lib/notifications"
import { initSettingsSync } from "~/lib/settings-sync"
import { bindGatewayToStores } from "~/stores/gateway-bindings"
import { useGuildsStore } from "~/stores/guilds"
import { initActivityAutoDetect } from "~/lib/activity/auto-detect"
import { initIdleWatcher } from "~/stores/presence"
import { useReadStatesStore } from "~/stores/read-states"
import { useSettingsStore } from "~/stores/settings"
import { useUIStore } from "~/stores/ui"

export default function AppShell() {
  const status = useAuthBootstrap()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const guildAdminOpen = useUIStore((s) => s.guildAdminGuildId != null)

  // 进入应用壳后：绑定事件分发 + 连接 Gateway + 拉服务器列表
  // + 设置服务端同步 / 空闲检测 / Dock 角标（均幂等）
  useEffect(() => {
    if (status !== "authenticated") return
    bindGatewayToStores()
    gateway.connect()
    initSettingsSync()
    initIdleWatcher()
    initActivityAutoDetect()
    initDockBadge()
    void useGuildsStore
      .getState()
      .fetchGuilds()
      .catch(() => undefined)
  }, [status])

  // 全局快捷键：Ctrl/Cmd+K 快速切换器、Ctrl/Cmd+, 设置面板、
  // Shift+Esc 当前服务器全部已读（docs 15 FR-02）
  useEffect(() => {
    if (status !== "authenticated") return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey && event.key === "Escape") {
        const guildId = useUIStore.getState().selectedGuildId
        if (guildId) {
          event.preventDefault()
          useReadStatesStore.getState().ackGuild(guildId)
        }
        return
      }
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
        className="flex h-svh flex-col items-center justify-center gap-3 bg-background text-foreground"
        onMouseDown={dragWindowOnSelfMouseDown}
      >
        <div
          className="size-7 animate-spin rounded-full border-[3px] border-muted border-t-foreground"
          aria-hidden
        />
        <p className="text-sm font-medium">正在恢复会话…</p>
        <p className="text-xs text-muted-foreground">最多几秒，请稍候</p>
        <button
          type="button"
          className="mt-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
          onClick={() => {
            useAuthStore.setState({
              status: "unauthenticated",
              user: null,
              activeAccountId: null,
            })
          }}
        >
          跳过，进入欢迎页
        </button>
      </div>
    )
  }
  if (status === "unauthenticated") {
    return <WelcomeShell />
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
      {/*
        主内容区：左（频道）/ 中（页面）/ 右（成员）三张独立圆角白卡片，
        卡片间隙透出侧栏底色；顶部居中服名浮在卡片外。
      */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 卡片外顶部条：可拖窗口 + 居中服名/圆形头像 */}
        <SelectedGuildTitleBar />
        <div className="flex min-h-0 flex-1 gap-2 overflow-hidden p-2 pt-(--app-top-inset) md:pl-0">
          {/* 左：频道列表卡片 */}
          <ChannelList />
          {/* 中：页面内容卡片（服管设置嵌入此圆角卡片内，不盖全屏） */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white text-foreground dark:bg-card dark:text-card-foreground">
            {guildAdminOpen ? (
              <GuildAdminPanel />
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-none">
                <Outlet />
              </div>
            )}
          </main>
          {/* 右：成员面板卡片（可折叠；服管打开时隐藏以腾出空间） */}
          {!guildAdminOpen ? <MemberPanel /> : null}
          {/* 消息搜索面板（打开时同为圆角卡片） */}
          <SearchPanel />
        </div>
      </div>
      {/* 全局 toast（语音错误提示等） */}
      <Toaster position="bottom-right" />
      {/* Ctrl/Cmd+K 快速切换器浮层 */}
      <QuickSwitcher open={switcherOpen} onOpenChange={setSwitcherOpen} />
      {/* 全屏设置面板（Ctrl/Cmd+, 或用户菜单打开） */}
      <SettingsPanel />
      {/* 服务器个人设置中型面板（docs 17，右键服务器打开） */}
      <GuildPersonalPanel />
      {/* 频道设置（docs 03/04，频道右键「管理频道」） */}
      <ChannelSettingsPanel />
      {/* 上锁频道访问密码 */}
      <ChannelUnlockDialog />
      {/* 贴图包预览（消息内点击表情 / 贴图） */}
      <PackPreviewDialog />
    </SidebarProvider>
  )
}

/**
 * 卡片外顶部条：
 * - 整条区域可拖拽窗口（修复三卡片布局后 padding 区域无法拖动的问题）；
 * - 居中显示当前服务器名；有 icon_url 时左侧附圆形头像。
 */
function SelectedGuildTitleBar() {
  const location = useLocation()
  const selectedGuildId = useUIStore((state) => state.selectedGuildId)
  const guild = useGuildsStore((state) =>
    state.guilds.find((g) => g.id === selectedGuildId),
  )
  const hasIcon = Boolean(guild?.icon_url?.trim())
  const isDm = selectedGuildId === "@me"
  const isFriends = isFriendsLocation(location)
  const isStickers = isStickersLocation(location)
  const isShop = isShopLocation(location)
  const isHome = !selectedGuildId && !isFriends && !isStickers && !isShop
  const title = isFriends
    ? "好友"
    : isStickers
      ? "贴图库"
      : isShop
        ? "装扮商城"
        : isHome
          ? "私信"
          : isDm
            ? "私信"
            : guild?.name

  // 浏览器 / WebView 标签页标题
  useEffect(() => {
    document.title = title ? `${title} · NewtSpeak` : "NewtSpeak"
  }, [title])

  return (
    <div
      className="absolute inset-x-0 top-0 z-20 flex h-(--app-top-inset) items-center justify-center px-4"
      onMouseDown={dragWindowOnMouseDown}
    >
      {title ? (
        <div className="flex max-w-md items-center justify-center gap-2">
          {!isDm && !isHome && !isFriends && !isStickers && !isShop && hasIcon && guild ? (
            <GuildAvatar
              guild={guild}
              shape="circle"
              className="size-5 shrink-0"
            />
          ) : null}
          <h1 className="min-w-0 truncate text-center text-sm font-semibold text-sidebar-foreground select-none">
            {title}
          </h1>
        </div>
      ) : null}
    </div>
  )
}
