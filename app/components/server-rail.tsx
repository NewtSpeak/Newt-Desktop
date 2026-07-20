// 服务器栏条目：圆角方形图标（无图标显示名称首两个字符）、选中高亮、tooltip 显示服名。
// 未读指示（docs 15 UX-01）：任一可见频道未读 → 图标左侧白色胶囊短条（静音服务器不显示）；
// @提及 → 图标右下红色数字角标（穿透静音，99+ 封顶）。
// 右键菜单：通知层级覆盖 + 静音时长（docs 15 FR-09 / UX-06）。

import { useNavigate } from "react-router"

import { NotifyOverrideMenuItems } from "~/components/notify-override-menu"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "~/components/ui/context-menu"
import { SidebarMenuButton, SidebarMenuItem } from "~/components/ui/sidebar"
import type { Guild } from "~/lib/api/types"
import { cn } from "~/lib/utils"
import { isChannelUnread, useReadStatesStore } from "~/stores/read-states"
import { isOverrideMuted, useSettingsStore } from "~/stores/settings"
import { useUIStore } from "~/stores/ui"

export function guildInitials(name: string): string {
  return name.trim().slice(0, 2) || "?"
}

export function ServerRailItem({ guild }: { guild: Guild }) {
  const navigate = useNavigate()
  const selected = useUIStore((state) => state.selectedGuildId === guild.id)
  const override = useSettingsStore((state) => state.notifications.perGuild[guild.id])
  const muted = isOverrideMuted(override)
  const unread = useReadStatesStore((state) => {
    for (const [channelId, guildId] of Object.entries(state.guildByChannel)) {
      if (guildId !== guild.id) continue
      if (isChannelUnread(state, channelId)) return true
    }
    return false
  })
  const mentionCount = useReadStatesStore((state) => {
    let total = 0
    for (const [channelId, count] of Object.entries(state.mentionsByChannel)) {
      if (state.guildByChannel[channelId] === guild.id) total += count
    }
    return total
  })

  const handleSelect = () => {
    if (selected) return
    useUIStore.getState().selectGuild(guild.id)
    navigate("/")
  }

  return (
    <SidebarMenuItem className="relative flex justify-center">
      {/* 未读白色胶囊短条（静音服务器视觉降噪不显示，FR-09） */}
      {unread && !muted && !selected && (
        <span
          aria-label="有未读消息"
          className="absolute top-1/2 -left-1.5 h-2 w-1 -translate-y-1/2 rounded-r-full bg-foreground"
        />
      )}
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <SidebarMenuButton
              tooltip={guild.name}
              aria-label={guild.name}
              isActive={selected}
              onClick={handleSelect}
              className={cn(
                "justify-center rounded-lg text-xs font-semibold",
                selected
                  ? "bg-primary text-primary-foreground data-active:bg-primary data-active:text-primary-foreground"
                  : "bg-sidebar-accent text-sidebar-accent-foreground",
                muted && !selected && "opacity-60",
              )}
            />
          }
        >
          <span className="select-none">{guildInitials(guild.name)}</span>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-44">
          <NotifyOverrideMenuItems
            override={override}
            inheritLabel="跟随全局"
            onChange={(patch) =>
              useSettingsStore.getState().setGuildNotify(guild.id, patch)
            }
          />
        </ContextMenuContent>
      </ContextMenu>
      {/* @提及红色数字角标（穿透静音，FR-03；99+ 封顶，UX-04） */}
      {mentionCount > 0 && (
        <span
          aria-label={`${mentionCount} 条提及`}
          className="pointer-events-none absolute -right-0.5 -bottom-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white tabular-nums ring-2 ring-sidebar select-none"
        >
          {mentionCount > 99 ? "99+" : mentionCount}
        </span>
      )}
    </SidebarMenuItem>
  )
}
