// 频道列表栏：banner + 可排序频道树 / 空态右键创建 + 底部语音面板。

import { useEffect } from "react"
import { HashIcon } from "lucide-react"

import { GuildChannelSpaceMenu } from "~/components/guild-channel-space-menu"
import { SortableChannelTree } from "~/components/sortable-channel-tree"
import { GuildBannerCarousel } from "~/components/guild-banner"
import { VoicePanel } from "~/components/voice-panel"
import { dragWindowOnMouseDown } from "~/lib/window-drag"
import { cn } from "~/lib/utils"
import { useChannelsStore } from "~/stores/channels"
import { useGuildsStore } from "~/stores/guilds"
import { useMembersStore } from "~/stores/members"
import { useRolesStore } from "~/stores/roles"
import { useUIStore } from "~/stores/ui"

export function ChannelList() {
  const selectedGuildId = useUIStore((state) => state.selectedGuildId)
  const guild = useGuildsStore((state) =>
    state.guilds.find((item) => item.id === selectedGuildId)
  )
  const channels = useChannelsStore((state) =>
    selectedGuildId ? state.byGuild[selectedGuildId] : undefined
  )
  const loading = useChannelsStore((state) =>
    selectedGuildId ? Boolean(state.loadingGuilds[selectedGuildId]) : false
  )

  // 切换服务器时拉取频道、成员与角色（空列表右键菜单权限依赖 roles）
  useEffect(() => {
    if (!selectedGuildId) return
    void useChannelsStore.getState().fetchChannels(selectedGuildId)
    void useMembersStore
      .getState()
      .fetchMembers(selectedGuildId)
      .catch(() => undefined)
    void useRolesStore
      .getState()
      .fetchRoles(selectedGuildId)
      .catch(() => undefined)
  }, [selectedGuildId])

  if (!selectedGuildId) return null

  const hasChannels = (channels?.length ?? 0) > 0
  const isEmpty = channels !== undefined && !loading && !hasChannels
  // 无 banner 时列表紧贴卡片顶边，补上与 banner 外框相当的顶部留白
  const hasBanner = Boolean(
    (guild?.banners && guild.banners.length > 0) ||
      guild?.banner_url?.trim(),
  )

  const listBody =
    channels === undefined && loading ? (
      <p className="px-2 pt-3 text-xs text-muted-foreground">频道加载中…</p>
    ) : isEmpty ? (
      <div className="flex min-h-[12rem] flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
        <HashIcon className="size-8 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">
          暂无可见频道
        </p>
        <p className="text-xs text-muted-foreground/80">
          有权限时，在此区域
          <strong className="font-medium text-foreground/80">右键</strong>
          可创建频道、类别或邀请成员
        </p>
      </div>
    ) : (
      <SortableChannelTree guildId={selectedGuildId} />
    )

  return (
    <aside
      className="flex w-60 shrink-0 flex-col gap-2 overflow-hidden bg-transparent"
      onMouseDown={dragWindowOnMouseDown}
    >
      {/* 上卡片：服务器 banner + 频道列表 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white text-foreground dark:bg-card dark:text-card-foreground">
        {guild && <GuildBannerCarousel guild={guild} />}
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-2 pb-3",
            !hasBanner && "pt-2",
          )}
        >
          {/* 任意时刻整块频道区域可右键（空白处：创建/邀请；频道卡片自身菜单优先） */}
          <GuildChannelSpaceMenu
            guildId={selectedGuildId}
            className="min-h-full w-full"
          >
            {listBody}
          </GuildChannelSpaceMenu>
        </div>
      </div>
      {/* 下卡片：语音连接面板（独立占据底部） */}
      <VoicePanel />
    </aside>
  )
}
