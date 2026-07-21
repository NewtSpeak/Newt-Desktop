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
import {
  nameInitials,
  resolveProfileAssetUrl,
  userDisplayName,
} from "~/lib/user-display"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { setManualPresence, usePresenceStore } from "~/stores/presence"
import { useSettingsStore, type ManualPresenceStatus } from "~/stores/settings"
import { useUIStore } from "~/stores/ui"

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

  const display = userDisplayName(user)
  const avatarSrc = resolveProfileAssetUrl(user.avatar_url)

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
      <SidebarMenuItem className="relative overflow-visible">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                // 与服务器栏一致：去掉内边距，头像铺满 size-10 按钮区域
                className="relative justify-center overflow-hidden rounded-lg p-0! group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-0! aria-expanded:bg-muted"
              />
            }
          >
            {/* 头像完整填充按钮（状态点独立在外侧，不随头像裁切） */}
            <Avatar className="absolute inset-0 size-full! h-full! w-full! rounded-lg after:rounded-lg after:border-0">
              {avatarSrc ? (
                <AvatarImage
                  src={avatarSrc}
                  alt={display}
                  className="size-full! rounded-lg object-cover"
                />
              ) : null}
              <AvatarFallback className="size-full! rounded-lg text-xs font-semibold">
                {nameInitials(display)}
              </AvatarFallback>
            </Avatar>
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
                  <Avatar className="size-8 rounded-lg after:rounded-lg after:border-0">
                    {avatarSrc ? (
                      <AvatarImage
                        src={avatarSrc}
                        alt={display}
                        className="rounded-lg object-cover"
                      />
                    ) : null}
                    <AvatarFallback className="rounded-lg text-xs">
                      {nameInitials(display)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{display}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      @{user.username}
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
                onClick={() => useSettingsStore.getState().openPanel("profile")}
              >
                <CircleUserRoundIcon />
                个人资料
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
        {/* Presence 状态点：独立于头像区块，叠在按钮右下角外沿，不被 overflow 裁切 */}
        <span
          aria-label={statusLabel(gatewayStatus)}
          className={cn(
            "pointer-events-none absolute -right-0.5 -bottom-0.5 z-10 size-2.5 rounded-full ring-2 ring-sidebar",
            presenceDotClass(selfStatus),
          )}
        />
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
