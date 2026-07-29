// 未连接服务器 / 未登录时的欢迎壳：保留应用壳布局，左侧栏只有「+」添加按钮，
// 右侧为引导 + 已记住账号的一键登录；提交邀请链接并预检通过后，右侧切换为
// 该服务器的页内登录/注册流程（ServerAuthView）。

import * as React from "react"
import { PlusIcon } from "lucide-react"

import { AddServerDialog } from "~/components/add-server-dialog"
import { SavedCredentialsPanel } from "~/components/saved-credentials-panel"
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
import { Toaster } from "~/components/ui/sonner"
import { useIsMacDesktop } from "~/lib/platform"
import { cn } from "~/lib/utils"
import {
  dragWindowOnMouseDown,
  dragWindowOnSelfMouseDown,
} from "~/lib/window-drag"
import { useConnectStore } from "~/stores/connect"

/** 右侧引导：已记住的「服务器 + 账号」一键登录；无记录时提示去添加服务器 */
function WelcomeGuide() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="text-center">
        <p className="text-base font-medium">欢迎使用 NewtSpeak</p>
        <p className="mt-1 text-sm text-muted-foreground">
          点击已记住的账号即可登录；或点左侧「+」通过邀请链接添加服务器
        </p>
      </div>
      {/* 灰色卡片、无描边：已记住账号（含服务器信息）一键登录 */}
      <SavedCredentialsPanel
        action="login"
        asCard
        className="w-full max-w-md"
      />
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
