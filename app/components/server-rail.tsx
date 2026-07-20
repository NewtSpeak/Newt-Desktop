// 服务器栏条目：圆角方形图标（无图标显示名称首两个字符）、选中高亮、tooltip 显示服名。

import { useNavigate } from "react-router"

import { SidebarMenuButton, SidebarMenuItem } from "~/components/ui/sidebar"
import type { Guild } from "~/lib/api/types"
import { cn } from "~/lib/utils"
import { useUIStore } from "~/stores/ui"

export function guildInitials(name: string): string {
  return name.trim().slice(0, 2) || "?"
}

export function ServerRailItem({ guild }: { guild: Guild }) {
  const navigate = useNavigate()
  const selected = useUIStore((state) => state.selectedGuildId === guild.id)

  const handleSelect = () => {
    if (selected) return
    useUIStore.getState().selectGuild(guild.id)
    navigate("/")
  }

  return (
    <SidebarMenuItem className="flex justify-center">
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
        )}
      >
        <span className="select-none">{guildInitials(guild.name)}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
