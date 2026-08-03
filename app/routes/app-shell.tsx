// 应用壳：
//   启动 gate（静默续期 → 加载态/欢迎空态）→ Gateway 自动连接 → 服务器栏 + 频道列表 + 内容区。
//   移动端：常驻左侧服务器导航轨（AppSidebar 包裹主区），频道列表可滑出，成员列表默认隐藏。
// 未登录不再整页跳转登录页，而是渲染欢迎壳（左侧只有「+」，右侧引导/页内认证流程）。
// 窗口拖拽、顶部 32px 留白（--app-top-inset）、macOS 交通灯避让行为保持不变。

import { useEffect, useState } from "react"
import { Outlet, useLocation } from "react-router"
import { PanelLeftIcon, UsersIcon, XIcon } from "lucide-react"

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
import { Button } from "~/components/ui/button"
import { SidebarProvider } from "~/components/ui/sidebar"
import { Toaster } from "~/components/ui/sonner"
import { useAuthBootstrap } from "~/hooks/use-auth-bootstrap"
import { useIsMobile } from "~/hooks/use-mobile"
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
import { initAndroidVoiceOverlayBridge } from "~/lib/voice/android-overlay"
import { cn } from "~/lib/utils"
import { bindGatewayToStores } from "~/stores/gateway-bindings"
import { useGuildsStore } from "~/stores/guilds"
import { initActivityAutoDetect } from "~/lib/activity/auto-detect"
import { initIdleWatcher } from "~/stores/presence"
import { useReadStatesStore } from "~/stores/read-states"
import { useSettingsStore } from "~/stores/settings"
import { useUIStore } from "~/stores/ui"

export default function AppShell() {
  const status = useAuthBootstrap()
  const isMobile = useIsMobile()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const guildAdminOpen = useUIStore((s) => s.guildAdminGuildId != null)
  const selectedGuildId = useUIStore((s) => s.selectedGuildId)
  const selectedChannelId = useUIStore((s) => s.selectedChannelId)
  const memberPanelOpen = useUIStore((s) => s.memberPanelOpen)
  // 移动端：频道列表抽屉（默认：已选频道则收起，未选则展开）
  const [mobileChannelsOpen, setMobileChannelsOpen] = useState(false)
  const [mobileMembersOpen, setMobileMembersOpen] = useState(false)

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
    // Android：语音中前台服务 + 悬浮窗（说话人 / 开闭麦）
    initAndroidVoiceOverlayBridge()
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

  // 移动端：选中频道后自动收起频道抽屉；切换服务器时打开
  useEffect(() => {
    if (!isMobile) return
    if (selectedChannelId) {
      setMobileChannelsOpen(false)
    } else if (selectedGuildId) {
      setMobileChannelsOpen(true)
    }
  }, [isMobile, selectedChannelId, selectedGuildId])

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

  // 移动端：状态栏 + 极矮标题带（0.5rem）；桌面 32px
  const appTopInset = isMobile
    ? "calc(env(safe-area-inset-top, 0px) + 0.5rem)"
    : "32px"

  return (
    <SidebarProvider
      defaultOpen={false}
      // 整壳铺满侧栏底色：左导航 + 右内容区外的空隙同一背景（PC inset 语义）
      className="h-svh w-full overflow-hidden bg-sidebar"
      // 顶部留白等裸露区域（直接点在容器本身）可拖拽窗口
      onMouseDown={dragWindowOnSelfMouseDown}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--sidebar-width-icon": "3rem",
          "--header-height": "calc(var(--spacing) * 12)",
          "--app-status-safe": "env(safe-area-inset-top, 0px)",
          "--app-titlebar-h": isMobile ? "0.5rem" : "32px",
          "--app-top-inset": appTopInset,
          // 底边距：可见但不挤占过多内容高度（叠系统手势条）
          "--app-content-mb": isMobile
            ? "max(0.5rem, env(safe-area-inset-bottom, 0px))"
            : "0.5rem",
        } as React.CSSProperties
      }
    >
      {/* 导航轨：peer + gap，与右侧列同属 bg-sidebar wrapper */}
      <AppSidebar variant="inset" />
      {/*
        右侧列：透明露出整页侧栏底色。
        内容卡：圆角；上/右/下留白，左侧 0 贴导航（同 PC inset）。
      */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-transparent">
        {/* 标题带：在侧栏背景上；min 为 --app-top-inset，可随按钮略增高避免裁切 */}
        <div className="flex min-h-(--app-top-inset) shrink-0 items-center">
          <SelectedGuildTitleBar
            isMobile={isMobile}
            mobileChannelsOpen={mobileChannelsOpen}
            onToggleChannels={() => {
              setMobileChannelsOpen((v) => !v)
              setMobileMembersOpen(false)
            }}
            onToggleMembers={() => {
              setMobileMembersOpen((v) => !v)
              setMobileChannelsOpen(false)
            }}
            membersAvailable={
              !guildAdminOpen &&
              Boolean(selectedGuildId && selectedGuildId !== "@me")
            }
          />
        </div>
        {/* 页面卡片：上 0（标题已占位）/ 右下有距 / 左 0 */}
        <div
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
            "rounded-2xl bg-white text-foreground dark:bg-card dark:text-card-foreground",
            // 右 / 下留白（下用 --app-content-mb，移动端更大）；左 0 贴导航
            "mr-2 ml-0 mb-[var(--app-content-mb,0.5rem)]",
          )}
        >
          <div className="relative flex min-h-0 min-w-0 flex-1 gap-2 overflow-hidden">
            <div
              className={cn(
                "md:relative md:z-auto md:flex md:h-auto md:w-auto md:max-w-none md:translate-x-0 md:shadow-none",
                isMobile &&
                  (mobileChannelsOpen
                    ? "absolute inset-y-0 left-0 z-30 flex h-full w-[min(20rem,85%)] overflow-hidden border-r border-border/60 bg-white shadow-lg dark:bg-card"
                    : "hidden"),
              )}
            >
              <ChannelList mobileMode={isMobile} />
            </div>
            {isMobile && mobileChannelsOpen ? (
              <button
                type="button"
                aria-label="关闭频道列表"
                className="absolute inset-0 z-20 bg-black/40 md:hidden"
                onClick={() => setMobileChannelsOpen(false)}
              />
            ) : null}

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {guildAdminOpen ? (
                <GuildAdminPanel />
              ) : (
                <div
                  className={cn(
                    "flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-none",
                    // 滚动区底部内边距，避免列表/输入最后一项贴边被裁
                    isMobile && "pb-3",
                  )}
                >
                  <Outlet />
                </div>
              )}
            </div>

            {!guildAdminOpen ? (
              <div
                className={cn(
                  "md:relative md:z-auto md:flex md:h-auto md:translate-x-0 md:shadow-none",
                  !isMobile && (memberPanelOpen ? "flex" : "hidden md:flex"),
                  isMobile &&
                    (mobileMembersOpen
                      ? "absolute inset-y-0 right-0 z-30 flex h-full w-[min(20rem,85%)] overflow-hidden border-l border-border/60 bg-white shadow-lg dark:bg-card"
                      : "hidden"),
                )}
              >
                <MemberPanel forceOpen={isMobile && mobileMembersOpen} />
              </div>
            ) : null}
            {isMobile && mobileMembersOpen ? (
              <button
                type="button"
                aria-label="关闭成员列表"
                className="absolute inset-0 z-20 bg-black/40 md:hidden"
                onClick={() => setMobileMembersOpen(false)}
              />
            ) : null}

            <SearchPanel />
          </div>
        </div>
      </div>
      {/* 全局 toast（语音错误提示等） */}
      <Toaster position={isMobile ? "top-center" : "bottom-right"} />
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
 * - 移动端：左右按钮打开频道列表 / 成员列表。
 */
function SelectedGuildTitleBar({
  isMobile,
  mobileChannelsOpen,
  onToggleChannels,
  onToggleMembers,
  membersAvailable,
}: {
  isMobile: boolean
  mobileChannelsOpen: boolean
  onToggleChannels: () => void
  onToggleMembers: () => void
  membersAvailable: boolean
}) {
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
      className={cn(
        // 在侧栏背景上的标题带（文档流，全高由父级 --app-top-inset 约束）
        "flex h-full w-full items-center px-2",
        isMobile ? "justify-between gap-1" : "justify-center px-4",
      )}
      onMouseDown={dragWindowOnMouseDown}
    >
      {isMobile ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-5 shrink-0 text-sidebar-foreground"
          aria-label={mobileChannelsOpen ? "关闭频道列表" : "打开频道列表"}
          aria-pressed={mobileChannelsOpen}
          onClick={(e) => {
            e.stopPropagation()
            onToggleChannels()
          }}
        >
          {mobileChannelsOpen ? (
            <XIcon className="size-3" />
          ) : (
            <PanelLeftIcon className="size-3" />
          )}
        </Button>
      ) : (
        <span className="w-5 shrink-0" aria-hidden />
      )}

      {title ? (
        <div className="flex min-w-0 max-w-md flex-1 items-center justify-center gap-1">
          {!isDm && !isHome && !isFriends && !isStickers && !isShop && hasIcon && guild ? (
            <GuildAvatar
              guild={guild}
              shape="circle"
              className="size-3.5 shrink-0"
            />
          ) : null}
          <h1 className="min-w-0 truncate text-center text-[11px] font-semibold leading-none text-sidebar-foreground select-none">
            {title}
          </h1>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {isMobile && membersAvailable ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-5 shrink-0 text-sidebar-foreground"
          aria-label="成员列表"
          onClick={(e) => {
            e.stopPropagation()
            onToggleMembers()
          }}
        >
          <UsersIcon className="size-3" />
        </Button>
      ) : isMobile ? (
        <span className="w-5 shrink-0" aria-hidden />
      ) : null}
    </div>
  )
}
