// 频道列表栏：banner + 可排序频道树 / 空态右键创建 + 底部语音面板。
// Home / 好友 / @me：Discord 风格私信侧栏（dm-sidebar）。

import { useEffect } from "react"
import { EyeIcon, HashIcon, XIcon } from "lucide-react"
import { useNavigate } from "react-router"

import { DmSidebar } from "~/components/dm-sidebar"
import { GuildChannelSpaceMenu } from "~/components/guild-channel-space-menu"
import { SortableChannelTree } from "~/components/sortable-channel-tree"
import { GuildBannerCarousel } from "~/components/guild-banner"
import { PanelResizeHandle } from "~/components/panel-resize-handle"
import { VoicePanel } from "~/components/voice-panel"
import { Button } from "~/components/ui/button"
import { resolveLandingChannelId } from "~/lib/guild-landing"
import { dragWindowOnMouseDown } from "~/lib/window-drag"
import { cn } from "~/lib/utils"
import { useChannelsStore } from "~/stores/channels"
import { useGuildsStore } from "~/stores/guilds"
import { useMembersStore } from "~/stores/members"
import { useRolesStore } from "~/stores/roles"
import { useUIStore } from "~/stores/ui"
import { useViewAsStore, viewAsLabel } from "~/stores/view-as"

export function ChannelList({
  mobileMode = false,
}: {
  /** 移动端抽屉：占满父宽、隐藏拖拽条 */
  mobileMode?: boolean
}) {
  const navigate = useNavigate()
  const selectedGuildId = useUIStore((state) => state.selectedGuildId)
  const selectedChannelId = useUIStore((state) => state.selectedChannelId)
  const channelListWidth = useUIStore((state) => state.channelListWidth)
  const setChannelListWidth = useUIStore((state) => state.setChannelListWidth)
  const isHomeOrDm = !selectedGuildId || selectedGuildId === "@me"
  const guild = useGuildsStore((state) =>
    state.guilds.find((item) => item.id === selectedGuildId),
  )
  const channels = useChannelsStore((state) =>
    selectedGuildId && !isHomeOrDm ? state.byGuild[selectedGuildId] : undefined,
  )
  const loading = useChannelsStore((state) =>
    selectedGuildId && !isHomeOrDm
      ? Boolean(state.loadingGuilds[selectedGuildId])
      : false,
  )
  const viewAs = useViewAsStore((s) => s.session)
  const viewAsLoading = viewAs?.loading === true

  useEffect(() => {
    if (!selectedGuildId || isHomeOrDm) return
    void useChannelsStore.getState().fetchChannels(selectedGuildId)
    void useMembersStore
      .getState()
      .fetchMembers(selectedGuildId)
      .catch(() => undefined)
    void useRolesStore
      .getState()
      .fetchRoles(selectedGuildId)
      .catch(() => undefined)
  }, [selectedGuildId, isHomeOrDm])

  // 进服着陆兜底：选中服务器且尚无频道时（例如 READY 后频道才到齐、
  // 或其它入口只 selectGuild 未 landInGuild），打开默认欢迎频道 / 第一个 TEXT。
  useEffect(() => {
    if (!selectedGuildId || isHomeOrDm) return
    if (selectedChannelId) return
    if (!channels?.length) return

    const landingId = resolveLandingChannelId(guild, channels)
    if (!landingId) return

    const ui = useUIStore.getState()
    if (ui.selectedGuildId !== selectedGuildId || ui.selectedChannelId) return

    ui.selectChannel(selectedGuildId, landingId)
    navigate(`/channels/${selectedGuildId}/${landingId}`, { replace: true })
  }, [
    selectedGuildId,
    selectedChannelId,
    channels,
    guild,
    isHomeOrDm,
    navigate,
  ])

  useEffect(() => {
    const session = useViewAsStore.getState().session
    if (session && selectedGuildId && session.guildId !== selectedGuildId) {
      useViewAsStore.getState().stop()
    }
    if (isHomeOrDm && session) {
      useViewAsStore.getState().stop()
    }
  }, [selectedGuildId, isHomeOrDm])

  // Discord：主页 / 私信时左侧常驻私信侧栏
  if (isHomeOrDm) return <DmSidebar mobileMode={mobileMode} />

  const hasChannels = (channels?.length ?? 0) > 0
  const isEmpty = channels !== undefined && !loading && !hasChannels
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
      className={cn(
        "relative flex shrink-0 flex-col gap-2 overflow-visible bg-transparent",
        mobileMode && "h-full w-full min-w-0",
      )}
      style={mobileMode ? undefined : { width: channelListWidth }}
      onMouseDown={mobileMode ? undefined : dragWindowOnMouseDown}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white text-foreground dark:bg-card dark:text-card-foreground">
        {guild && <GuildBannerCarousel guild={guild} />}
        {viewAs && viewAs.guildId === selectedGuildId && (
          <div className="flex items-center gap-2 border-b border-amber-600/30 bg-amber-500/15 px-2 py-1.5 text-amber-900 dark:text-amber-200">
            <EyeIcon className="size-3.5 shrink-0" />
            <p className="min-w-0 flex-1 truncate text-[11px] font-medium">
              {viewAsLoading
                ? "正在加载视角…"
                : `正在以「${viewAsLabel(viewAs)}」视角查看`}
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 px-1.5 text-amber-900 hover:bg-amber-500/20 dark:text-amber-200"
              onClick={() => useViewAsStore.getState().stop()}
            >
              <XIcon className="size-3.5" />
              退出
            </Button>
          </div>
        )}
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-2 pb-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
            !hasBanner && "pt-2",
          )}
        >
          <GuildChannelSpaceMenu
            guildId={selectedGuildId}
            className="min-h-full w-full"
          >
            {listBody}
          </GuildChannelSpaceMenu>
        </div>
      </div>
      <VoicePanel />
      {!mobileMode ? (
        <PanelResizeHandle
          edge="end"
          width={channelListWidth}
          onWidthChange={setChannelListWidth}
          label="调整频道列表宽度"
        />
      ) : null}
    </aside>
  )
}
