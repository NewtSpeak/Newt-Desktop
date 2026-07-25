// 进服着陆：解析默认欢迎频道 / 侧栏第一个可见文字频道。
// 设计：docs/design/2026-07-25-默认欢迎频道与进服着陆.md

import type { Channel, Guild } from "~/lib/api/types"
import { buildChannelTree } from "~/lib/channel-tree"

export type LandingGuild = Pick<Guild, "id" | "default_channel_id"> | null | undefined

/**
 * 解析进服应打开的文字频道 id。
 *
 * - 优先 guild.default_channel_id（须在 channels 中且 type 为 TEXT）
 * - 否则按侧栏树序取第一个 TEXT 频道
 * - 都没有返回 null
 *
 * 客户端 channels 列表通常已是对该用户可见的频道，故不再二次做 VIEW_CHANNEL 校验。
 */
export function resolveLandingChannelId(
  guild: LandingGuild,
  channels: Channel[] | null | undefined,
): string | null {
  if (!channels?.length) return null

  const guildId = guild?.id
  const textChannels = channels.filter(
    (c) => c.type === "TEXT" && (!guildId || c.guild_id === guildId),
  )
  if (textChannels.length === 0) return null

  const defaultId = guild?.default_channel_id?.trim()
  if (defaultId) {
    const hit = textChannels.find((c) => c.id === defaultId)
    if (hit) return hit.id
  }

  // 侧栏树序：根级（类别 + 无父频道）按 position，类别内子频道按 position
  const tree = buildChannelTree(
    guildId ? channels.filter((c) => c.guild_id === guildId) : channels,
  )
  for (const node of tree) {
    if (node.kind === "channel" && node.channel.type === "TEXT") {
      return node.channel.id
    }
    if (node.kind === "category") {
      for (const child of node.children) {
        if (child.type === "TEXT") return child.id
      }
    }
  }

  return textChannels[0]?.id ?? null
}
