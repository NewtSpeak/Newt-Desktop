import { useNavigate } from "react-router"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "~/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "~/components/ui/sidebar"
import { CircleUserRoundIcon, LogOutIcon, SettingsIcon } from "lucide-react"
import type { GatewayStatus } from "~/lib/gateway/client"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useSettingsStore } from "~/stores/settings"
import { useUIStore } from "~/stores/ui"

function userInitials(username: string): string {
  return username.trim().slice(0, 2) || "?"
}

/** Gateway 连接状态圆点：绿=已连接、黄=连接/重连中、灰=离线 */
function statusDotClass(status: GatewayStatus): string {
  switch (status) {
    case "connected":
      return "bg-emerald-500"
    case "connecting":
    case "reconnecting":
      return "bg-amber-500"
    default:
      return "bg-muted-foreground/50"
  }
}

function statusLabel(status: GatewayStatus): string {
  switch (status) {
    case "connected":
      return "已连接"
    case "connecting":
      return "连接中"
    case "reconnecting":
      return "重连中"
    default:
      return "离线"
  }
}

export function NavUser() {
  const { isMobile } = useSidebar()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const gatewayStatus = useUIStore((state) => state.gatewayStatus)

  if (!user) return null

  const handleLogout = async () => {
    await useAuthStore.getState().logout()
    navigate("/login", { replace: true })
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="justify-center aria-expanded:bg-muted group-data-[collapsible=icon]:p-1!"
              />
            }
          >
            {/* 仅显示头像：居中、方形带圆角；右下角连接状态圆点 */}
            <span className="relative">
              <Avatar className="size-8 rounded-lg">
                {user.avatar_url && <AvatarImage src={user.avatar_url} alt={user.username} />}
                <AvatarFallback className="rounded-lg text-xs">
                  {userInitials(user.username)}
                </AvatarFallback>
              </Avatar>
              <span
                aria-label={statusLabel(gatewayStatus)}
                className={cn(
                  "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-sidebar",
                  statusDotClass(gatewayStatus),
                )}
              />
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="size-8">
                    {user.avatar_url && (
                      <AvatarImage src={user.avatar_url} alt={user.username} />
                    )}
                    <AvatarFallback className="rounded-lg text-xs">
                      {userInitials(user.username)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.username}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </div>
                  <span
                    title={statusLabel(gatewayStatus)}
                    className={cn("size-2 rounded-full", statusDotClass(gatewayStatus))}
                  />
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => useSettingsStore.getState().openPanel("account")}
              >
                <CircleUserRoundIcon />
                账户
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => useSettingsStore.getState().openPanel()}>
                <SettingsIcon />
                设置
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOutIcon />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
