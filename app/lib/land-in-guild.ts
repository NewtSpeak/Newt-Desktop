// 进服着陆：选中服务器后打开默认欢迎频道 / 第一个可见 TEXT。
// 设计：docs/design/2026-07-25-默认欢迎频道与进服着陆.md

import { resolveLandingChannelId } from "~/lib/guild-landing"
import { useChannelsStore } from "~/stores/channels"
import { useGuildsStore } from "~/stores/guilds"
import { useUIStore } from "~/stores/ui"

/**
 * 选中服务器并导航到着陆文字频道。
 * 频道未缓存时会先 fetch；无可见 TEXT 时落在 `/` 空态。
 */
export async function landInGuild(
  guildId: string,
  navigate: (to: string, opts?: { replace?: boolean }) => void,
): Promise<string | null> {
  const ui = useUIStore.getState()

  if (ui.selectedGuildId !== guildId) {
    // 切服会顺带清空 selectedChannelId
    ui.selectGuild(guildId)
  } else if (ui.selectedChannelId) {
    // 已在该服某频道：不打断
    return ui.selectedChannelId
  }
  // 同服但 selectedChannelId == null（卡在「选择一个频道」）：继续着陆

  let channels = useChannelsStore.getState().byGuild[guildId] ?? []
  if (!channels.length) {
    const fetched = await useChannelsStore
      .getState()
      .fetchChannels(guildId)
      .catch(() => null)
    channels = fetched ?? []
  }

  // 着陆过程中用户可能已手动点了频道
  const latest = useUIStore.getState()
  if (latest.selectedGuildId !== guildId) return null
  if (latest.selectedChannelId) return latest.selectedChannelId

  const guild = useGuildsStore.getState().guilds.find((g) => g.id === guildId)
  const landingId = resolveLandingChannelId(guild, channels)
  if (!landingId) {
    navigate("/", { replace: true })
    return null
  }

  useUIStore.getState().selectChannel(guildId, landingId)
  navigate(`/channels/${guildId}/${landingId}`, { replace: true })
  return landingId
}
