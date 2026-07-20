// 未连接服务器 / 未登录时的欢迎壳：保留应用壳布局，左侧栏只有「+」添加按钮，
// 右侧为引导文案；提交邀请链接并预检通过后，右侧切换为该服务器的页内
// 登录/注册流程（ServerAuthView）。

import * as React from "react"
import { PlusIcon } from "lucide-react"

import { AddServerDialog } from "~/components/add-server-dialog"
import { ServerAuthView } from "~/components/server-auth"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "~/components/ui/sidebar"
import { Button } from "~/components/ui/button"
import { Toaster } from "~/components/ui/sonner"
import { useIsMacDesktop } from "~/lib/platform"
import { getSavedServer } from "~/lib/server-connection"
import { cn } from "~/lib/utils"
import {
  dragWindowOnMouseDown,
  dragWindowOnSelfMouseDown,
} from "~/lib/window-drag"
import { useConnectStore } from "~/stores/connect"

/** 右侧引导：默认空态；有已保存服务器（会话过期/登出后）时提供重新登录入口 */
function WelcomeGuide() {
  const saved = getSavedServer()

  const relogin = () => {
    if (!saved) return
    let host = saved.baseUrl
    try {
      host = new URL(saved.baseUrl).host
    } catch {
      // 保留原始基址
    }
    useConnectStore.getState().startAuth({
      serverBaseUrl: saved.baseUrl,
      serverName: saved.name ?? host,
      invite: null,
    })
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-base font-medium">欢迎使用 OwlSpeak</p>
      <p className="text-sm text-muted-foreground">
        点击左侧「+」按钮，通过邀请链接添加服务器
      </p>
      {saved && (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-2xl bg-muted/50 px-8 py-4">
          <p className="text-sm text-muted-foreground">
            已保存的服务器：
            <span className="text-foreground">
              {saved.name ?? saved.baseUrl}
            </span>
          </p>
          <Button variant="outline" size="sm" onClick={relogin}>
            重新登录
          </Button>
        </div>
      )}
    </div>
  )
}

export function WelcomeShell() {
  const isMacDesktop = useIsMacDesktop()
  const pending = useConnectStore((state) => state.pending)
  const [addOpen, setAddOpen] = React.useState(false)

  return (
    <SidebarProvider
      defaultOpen={false}
      className="h-svh overflow-hidden"
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
      <Sidebar
        collapsible="icon"
        variant="inset"
        onMouseDown={dragWindowOnMouseDown}
      >
        <SidebarContent className={cn(isMacDesktop && "pt-8")}>
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem className="flex justify-center">
                <SidebarMenuButton
                  tooltip="添加服务器"
                  aria-label="添加服务器"
                  onClick={() => setAddOpen(true)}
                  className="justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground"
                >
                  <PlusIcon className="size-4" />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="min-h-0 overflow-hidden md:peer-data-[variant=inset]:mt-(--app-top-inset)">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-none">
          {pending ? (
            <ServerAuthView key={pending.serverBaseUrl} pending={pending} />
          ) : (
            <WelcomeGuide />
          )}
        </div>
      </SidebarInset>
      <Toaster position="bottom-right" />
      <AddServerDialog open={addOpen} onOpenChange={setAddOpen} />
    </SidebarProvider>
  )
}
