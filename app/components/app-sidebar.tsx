import * as React from "react"
import { useNavigate } from "react-router"
import { HomeIcon, PlusIcon } from "lucide-react"

import { AddGuildDialog } from "~/components/add-guild-dialog"
import { NavUser } from "~/components/nav-user"
import { ServerRailItem } from "~/components/server-rail"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar"
import { dragWindowOnMouseDown } from "~/lib/window-drag"
import { useIsMacDesktop } from "~/lib/platform"
import { cn } from "~/lib/utils"
import { useGuildsStore } from "~/stores/guilds"
import { useUIStore } from "~/stores/ui"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const isMacDesktop = useIsMacDesktop()
  const navigate = useNavigate()
  const guilds = useGuildsStore((state) => state.guilds)
  const selectedGuildId = useUIStore((state) => state.selectedGuildId)
  const [addOpen, setAddOpen] = React.useState(false)

  /** 回到「选择一个服务器」空态：清空选中服并跳转首页 */
  const goHome = () => {
    useUIStore.getState().selectGuild(null)
    navigate("/")
  }

  return (
    <Sidebar
      collapsible="icon"
      onMouseDown={dragWindowOnMouseDown}
      {...props}
    >
      {/* Home + 加号固定在顶部，不随服务器列表滚动。
          左右对称间距：icon 模式下 px 统一，条目居中（不再为左侧未读条预留空隙）。 */}
      <SidebarHeader
        className={cn(
          "shrink-0 gap-0.5 border-b border-sidebar-border/50 group-data-[collapsible=icon]:px-1",
          isMacDesktop && "pt-8",
        )}
      >
        <SidebarMenu>
          <SidebarMenuItem className="flex justify-center">
            <SidebarMenuButton
              tooltip="主页"
              aria-label="主页"
              isActive={selectedGuildId == null}
              onClick={goHome}
              className="justify-center rounded-lg"
            >
              <HomeIcon className="size-4" />
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem className="flex justify-center">
            <SidebarMenuButton
              tooltip="添加服务器"
              aria-label="添加服务器"
              onClick={() => setAddOpen(true)}
              className="bg-sidebar-accent text-sidebar-accent-foreground justify-center rounded-lg"
            >
              <PlusIcon className="size-4" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* 仅服务器列表可滚动；icon 模式下默认 overflow-hidden 会挡住滚动，需显式覆盖。
          底部 NavUser 在 SidebarFooter 中，不随列表滚动。 */}
      <SidebarContent
        className={cn(
          "min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
          // 覆盖 sidebar.tsx 中 group-data-[collapsible=icon]:overflow-hidden
          "group-data-[collapsible=icon]:overflow-x-hidden group-data-[collapsible=icon]:overflow-y-auto",
        )}
      >
        <SidebarGroup className="min-h-0 group-data-[collapsible=icon]:px-1">
          <SidebarMenu>
            {guilds.map((guild) => (
              <ServerRailItem key={guild.id} guildId={guild.id} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="shrink-0 border-t border-sidebar-border/50 group-data-[collapsible=icon]:px-1">
        <NavUser />
      </SidebarFooter>
      <AddGuildDialog open={addOpen} onOpenChange={setAddOpen} />
    </Sidebar>
  )
}
