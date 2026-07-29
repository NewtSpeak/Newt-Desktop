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
import {
  CircleUserRoundIcon,
  Gamepad2Icon,
  MessageCircleIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react"
import * as React from "react"
import type { GatewayStatus } from "~/lib/gateway/client"
import {
  nameInitials,
  resolveProfileAssetUrl,
  userDisplayName,
} from "~/lib/user-display"
import { cn } from "~/lib/utils"
import {
  AvatarFrameOverlay,
  AvatarWithFrame,
} from "~/components/cosmetics/avatar-frame"
import { ActivityDialog } from "~/components/activity-dialog"
import { ActivityLine } from "~/components/activity-line"
import { CustomStatusDialog } from "~/components/custom-status-dialog"
import { CustomStatusLine } from "~/components/custom-status-line"
import { CustomEmoteImg } from "~/components/messages/custom-emote"
import { SwitchAccountDialog } from "~/components/switch-account-dialog"
import { useAuthStore } from "~/stores/auth"
import { useCosmeticsStore } from "~/stores/cosmetics"
import {
  customStatusTitle,
  effectiveSelfActivities,
  formatPrimaryActivity,
  hasCustomStatus,
  setManualPresence,
  statusEmoteItemId,
  usePresenceStore,
} from "~/stores/presence"
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

/** Presence 状态点配色（docs 01：在线绿 / 闲置黄 / 勿扰红 / 隐身与离线灰；一律不透明） */
export function presenceDotClass(status: string | undefined): string {
  switch (status) {
    case "online":
      return "bg-emerald-500"
    case "idle":
      return "bg-amber-500"
    case "dnd":
      return "bg-red-500"
    default:
      // 离线 / 隐身：实心灰，不用半透明
      return "bg-zinc-500"
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
  const user = useAuthStore((state) => state.user)
  const accounts = useAuthStore((state) => state.accounts)
  const gatewayStatus = useUIStore((state) => state.gatewayStatus)
  const manualStatus = useSettingsStore((state) => state.presence.manualStatus)
  const customText = useSettingsStore((state) => state.presence.customText)
  const customEmoji = useSettingsStore((state) => state.presence.customEmoji)
  const customExpiresAt = useSettingsStore(
    (state) => state.presence.customExpiresAt,
  )
  const autoIdle = usePresenceStore((state) => state.autoIdle)
  // 本人头像框（loadout 单槽订阅；COSMETIC_LOADOUT_UPDATE 实时生效）
  const avatarFrame = useCosmeticsStore((state) => state.loadout.avatar_frame)
  const activityEnabled = useSettingsStore((s) => s.presence.activityEnabled)
  const activityName = useSettingsStore((s) => s.presence.activityName)
  const activityType = useSettingsStore((s) => s.presence.activityType)
  const activityDetails = useSettingsStore((s) => s.presence.activityDetails)
  const activityStartedAt = useSettingsStore((s) => s.presence.activityStartedAt)
  const activityCoverUrl = useSettingsStore((s) => s.presence.activityCoverUrl)
  const detectGames = useSettingsStore((s) => s.presence.detectGames)
  const detectMedia = useSettingsStore((s) => s.presence.detectMedia)
  const manualOverride = useSettingsStore((s) => s.presence.activityManualOverride)
  const detectedActivities = usePresenceStore((s) => s.detectedActivities)
  const [switchOpen, setSwitchOpen] = React.useState(false)
  const [statusOpen, setStatusOpen] = React.useState(false)
  const [activityOpen, setActivityOpen] = React.useState(false)

  if (!user) return null

  const display = userDisplayName(user)
  const avatarSrc = resolveProfileAssetUrl(user.avatar_url)
  const selfCustom = {
    text: customText,
    emoji: customEmoji,
    expiresAt: customExpiresAt,
  }
  const hasCustom = hasCustomStatus(selfCustom)
  const customTitle = customStatusTitle(selfCustom)
  // 订阅 settings 字段以触发重绘
  void activityEnabled
  void activityName
  void activityType
  void activityDetails
  void activityStartedAt
  void activityCoverUrl
  void detectGames
  void detectMedia
  void manualOverride
  void detectedActivities
  const selfActivities = effectiveSelfActivities()
  const activityLabel = formatPrimaryActivity(selfActivities)
  const customItemId = statusEmoteItemId(selfCustom)

  // 本人有效状态：手动 online 时叠加空闲检测；未连接时按离线灰点
  const selfStatus =
    gatewayStatus === "connected"
      ? manualStatus === "online" && autoIdle
        ? "idle"
        : manualStatus
      : "offline"

  return (
    <SidebarMenu>
      <SidebarMenuItem className="relative overflow-visible">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                // 头像铺满按钮：禁止 sidebar 默认 hover/active/open 的灰底叠层（会像灰色滤镜）
                className={cn(
                  "relative justify-center overflow-hidden rounded-lg p-0!",
                  "group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-0!",
                  "bg-transparent! hover:bg-transparent! active:bg-transparent!",
                  "data-open:bg-transparent! data-open:hover:bg-transparent!",
                  "aria-expanded:bg-transparent!",
                  "hover:ring-2 hover:ring-sidebar-ring/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                )}
              />
            }
          >
            {/* 头像完整填充按钮（状态点独立在外侧，不随头像裁切） */}
            <Avatar className="absolute inset-0 size-full! h-full! w-full! rounded-lg after:rounded-lg after:border-0">
              {avatarSrc ? (
                <AvatarImage
                  src={avatarSrc}
                  alt={display}
                  className="size-full! rounded-lg object-cover opacity-100!"
                />
              ) : null}
              <AvatarFallback className="size-full! rounded-lg bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
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
                  {/* 下拉头部头像：正常内嵌头像框（无裁切问题） */}
                  <AvatarWithFrame frame={avatarFrame} sizeClass="size-8">
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
                  </AvatarWithFrame>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{display}</span>
                    {hasCustom ? (
                      <CustomStatusLine
                        custom={selfCustom}
                        className="text-xs"
                        emoteSize={12}
                      />
                    ) : activityLabel ? (
                      <ActivityLine
                        activities={selfActivities}
                        className="text-xs"
                      />
                    ) : (
                      <span className="truncate text-xs text-muted-foreground">
                        @{user.username}
                      </span>
                    )}
                    {hasCustom && activityLabel ? (
                      <ActivityLine
                        activities={selfActivities}
                        className="text-xs"
                      />
                    ) : null}
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
              <DropdownMenuItem onClick={() => setStatusOpen(true)}>
                {customItemId ? (
                  <CustomEmoteImg
                    itemId={customItemId}
                    size={16}
                    className="shrink-0"
                    alt=""
                  />
                ) : (
                  <MessageCircleIcon />
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span>自定义状态</span>
                  {hasCustom ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {customTitle}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      选小表情并写一句话
                    </span>
                  )}
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setActivityOpen(true)}>
                <Gamepad2Icon />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span>活动状态</span>
                  {activityLabel ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {activityLabel}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      正在玩 / 正在听
                    </span>
                  )}
                </div>
              </DropdownMenuItem>
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
            <DropdownMenuItem onClick={() => setSwitchOpen(true)}>
              <UsersIcon />
              切换账号
              {accounts.length > 1 ? (
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {accounts.length}
                </span>
              ) : null}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* 装扮头像框：主按钮为方形 overflow-hidden，框放按钮内会被裁切；
            参照 presence 点的做法，在 SidebarMenuItem 层级绝对定位叠在按钮外沿 */}
        {avatarFrame ? (
          <span
            className="pointer-events-none absolute inset-0 z-[5]"
            aria-hidden
          >
            <AvatarFrameOverlay frame={avatarFrame} />
          </span>
        ) : null}
        {/* Presence 状态点：独立于头像区块，叠在按钮右下角外沿，不被 overflow 裁切 */}
        <span
          aria-label={statusLabel(gatewayStatus)}
          className={cn(
            "pointer-events-none absolute -right-0.5 -bottom-0.5 z-10 size-2.5 rounded-full ring-2 ring-sidebar",
            presenceDotClass(selfStatus),
          )}
        />
        <SwitchAccountDialog open={switchOpen} onOpenChange={setSwitchOpen} />
        <CustomStatusDialog open={statusOpen} onOpenChange={setStatusOpen} />
        <ActivityDialog open={activityOpen} onOpenChange={setActivityOpen} />
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
