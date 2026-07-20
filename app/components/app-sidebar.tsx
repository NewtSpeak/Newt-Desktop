import * as React from "react"

import { AddGuildDialog } from "~/components/add-guild-dialog"
import { NavUser } from "~/components/nav-user"
import { ServerRailItem } from "~/components/server-rail"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar"
import { PlusIcon } from "lucide-react"
import { dragWindowOnMouseDown } from "~/lib/window-drag"
import { useIsMacDesktop } from "~/lib/platform"
import { cn } from "~/lib/utils"
import { useGuildsStore } from "~/stores/guilds"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const isMacDesktop = useIsMacDesktop()
  const guilds = useGuildsStore((state) => state.guilds)
  const [addOpen, setAddOpen] = React.useState(false)

  return (
    <Sidebar
      collapsible="icon"
      onMouseDown={dragWindowOnMouseDown}
      {...props}
    >
      {/* 服务器栏；macOS 交通灯悬浮在窗口左上角，向下让出空间 */}
      <SidebarContent className={cn(isMacDesktop && "pt-8")}>
        <SidebarGroup>
          <SidebarMenu>
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
            {guilds.map((guild) => (
              <ServerRailItem key={guild.id} guild={guild} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <AddGuildDialog open={addOpen} onOpenChange={setAddOpen} />
    </Sidebar>
  )
}
