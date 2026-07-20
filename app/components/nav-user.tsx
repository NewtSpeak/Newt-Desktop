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
import { setManualPresence, usePresenceStore } from "~/stores/presence"
import { useSettingsStore, type ManualPresenceStatus } from "~/stores/settings"
import { useUIStore } from "~/stores/ui"

function userInitials(username: string): string {
  return username.trim().slice(0, 2) || "?"
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

/** Presence 状态点配色（docs 01：在线绿 / 闲置黄 / 勿扰红 / 隐身与离线灰） */
export function presenceDotClass(status: string | undefined): string {
  switch (status) {
    case "online":
      return "bg-emerald-500"
    case "idle":
      return "bg-amber-500"
    case "dnd":
      return "bg-red-500"
    default:
      return "bg-muted-foreground/50"
  }
}

const PRESENCE_OPTIONS: {
  value: ManualPresenceStatus
  label: string
  description?: string
}[] = [
  { value: "online", label: "在线" },
  { value: "idle", label: "闲置" },
  { value: "dnd", label: "勿扰", description: "不会收到任何桌面通知" },
  { value: "invisible", label: "隐身", description: "对他人显示为离线" },
]

export function NavUser() {
  const { isMobile } = useSidebar()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const gatewayStatus = useUIStore((state) => state.gatewayStatus)
  const manualStatus = useSettingsStore((state) => state.presence.manualStatus)
  const autoIdle = usePresenceStore((state) => state.autoIdle)

  if (!user) return null

  // 本人有效状态：手动 online 时叠加空闲检测；未连接时按离线灰点
  const selfStatus =
    gatewayStatus === "connected"
      ? manualStatus === "online" && autoIdle
        ? "idle"
        : manualStatus
      : "offline"

  const handleLogout = async () => {
    await useAuthStore.getState().logout()
    // /login 路由已移除：未登录态由应用壳渲染欢迎空态，回到根路由即可
    navigate("/", { replace: true })
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
            {/* 仅显示头像：居中、方形带圆角；右下角 Presence 状态点 */}
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
                  presenceDotClass(selfStatus),
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
                    className={cn("size-2 rounded-full", presenceDotClass(selfStatus))}
                  />
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {/* Presence 四态切换（docs 01 FR-18） */}
            <DropdownMenuGroup>
              {PRESENCE_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => setManualPresence(option.value)}
                >
                  <span
                    className={cn(
                      "size-2.5 shrink-0 rounded-full",
                      presenceDotClass(option.value),
                    )}
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={cn(manualStatus === option.value && "font-semibold")}
                    >
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </div>
                </DropdownMenuItem>
              ))}
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
