// 消息搜索过滤语法（docs 06 FR-06/09）：
//   from:@用户 → author_id；in:#频道 → channel_id；before:/after:YYYY-MM-DD → 雪花游标。
// 无法解析的前缀按普通文本处理，不报错阻断（FR-09）。
//
// before/after 的服务端参数是雪花消息 ID 游标：按 Owl-Server 雪花布局
// （41bit 毫秒 @ 纪元 2026-01-01 UTC，左移 22 位）把日期换算成该时刻的最小 ID。

import { useChannelsStore } from "~/stores/channels"
import { useGuildsStore } from "~/stores/guilds"
import { useMembersStore } from "~/stores/members"

// ---------------------------------------------------------------------------
// 过滤器胶囊类型
// ---------------------------------------------------------------------------

export type SearchFilterPill =
  | { kind: "from"; label: string; authorId: string }
  | { kind: "in"; label: string; channelId: string; guildId: string }
  | { kind: "before"; label: string; date: string }
  | { kind: "after"; label: string; date: string }

// ---------------------------------------------------------------------------
// 雪花游标换算
// ---------------------------------------------------------------------------

/** 与 Owl-Server message/snowflake.go 一致：2026-01-01 00:00:00 UTC */
const SNOWFLAKE_EPOCH_MS = 1767225600000n
const TIMESTAMP_SHIFT = 22n

export function msToSnowflake(ms: number): string {
  const relative = BigInt(Math.max(0, Math.trunc(ms))) - SNOWFLAKE_EPOCH_MS
  const clamped = relative < 0n ? 0n : relative
  return (clamped << TIMESTAMP_SHIFT).toString()
}

/** before:该日期之前 → 当天 00:00 UTC 的最小雪花 ID */
export function beforeDateCursor(date: string): string {
  return msToSnowflake(Date.parse(`${date}T00:00:00Z`))
}

/** after:该日期之后 → 当天 24:00 UTC（次日零点）的最小雪花 ID */
export function afterDateCursor(date: string): string {
  return msToSnowflake(Date.parse(`${date}T00:00:00Z`) + 86_400_000)
}

// ---------------------------------------------------------------------------
// token 解析（基于 store 里可见实体做名称解析）
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function resolveMember(name: string): { userId: string; label: string } | null {
  const query = name.replace(/^@/, "").toLowerCase()
  if (!query) return null
  const byGuild = useMembersStore.getState().byGuild
  let prefixHit: { userId: string; label: string } | null = null
  for (const members of Object.values(byGuild)) {
    for (const member of members) {
      const username = member.username.toLowerCase()
      const nickname = (member.nickname ?? "").toLowerCase()
      const display = (member.display_name ?? "").toLowerCase()
      const label =
        member.nickname?.trim() || member.display_name?.trim() || member.username
      if (username === query || nickname === query || display === query) {
        return { userId: member.user_id, label }
      }
      if (
        !prefixHit &&
        (username.startsWith(query) ||
          (nickname && nickname.startsWith(query)) ||
          (display && display.startsWith(query)))
      ) {
        prefixHit = { userId: member.user_id, label }
      }
    }
  }
  return prefixHit
}

function resolveChannel(
  name: string,
): { channelId: string; guildId: string; label: string } | null {
  const query = name.replace(/^#/, "").toLowerCase()
  if (!query) return null
  const byGuild = useChannelsStore.getState().byGuild
  let prefixHit: { channelId: string; guildId: string; label: string } | null = null
  for (const [guildId, channels] of Object.entries(byGuild)) {
    for (const channel of channels) {
      if (channel.type !== "TEXT") continue
      const channelName = channel.name.toLowerCase()
      if (channelName === query) {
        return { channelId: channel.id, guildId, label: channel.name }
      }
      if (!prefixHit && channelName.startsWith(query)) {
        prefixHit = { channelId: channel.id, guildId, label: channel.name }
      }
    }
  }
  return prefixHit
}

/**
 * 尝试把一个完整 token（如 `from:@Alice`）解析成过滤器胶囊。
 * 返回 null 表示不是可解析的过滤器，应按普通文本保留。
 */
export function parseFilterToken(token: string): SearchFilterPill | null {
  const colon = token.indexOf(":")
  if (colon <= 0) return null
  const key = token.slice(0, colon).toLowerCase()
  const value = token.slice(colon + 1)
  if (!value) return null

  switch (key) {
    case "from": {
      const member = resolveMember(value)
      return member ? { kind: "from", label: member.label, authorId: member.userId } : null
    }
    case "in": {
      const channel = resolveChannel(value)
      return channel
        ? { kind: "in", label: channel.label, channelId: channel.channelId, guildId: channel.guildId }
        : null
    }
    case "before":
      return DATE_RE.test(value) ? { kind: "before", label: value, date: value } : null
    case "after":
      return DATE_RE.test(value) ? { kind: "after", label: value, date: value } : null
    default:
      return null
  }
}

/**
 * 从整段输入里抽取所有可解析的过滤器 token，剩余部分作为纯文本查询词。
 * 同类过滤器仅保留最后一个（FR-08 重复键入时替换旧值）。
 */
export function extractFilters(input: string): { text: string; filters: SearchFilterPill[] } {
  const filters: SearchFilterPill[] = []
  const textParts: string[] = []
  for (const token of input.split(/\s+/)) {
    if (!token) continue
    const pill = parseFilterToken(token)
    if (pill) {
      const existing = filters.findIndex((item) => item.kind === pill.kind)
      if (existing !== -1) filters.splice(existing, 1)
      filters.push(pill)
    } else {
      textParts.push(token)
    }
  }
  return { text: textParts.join(" "), filters }
}

/** 合并胶囊：同类替换旧值（FR-08 首期同类仅允许一个） */
export function mergePills(
  existing: SearchFilterPill[],
  incoming: SearchFilterPill[],
): SearchFilterPill[] {
  const merged = [...existing]
  for (const pill of incoming) {
    const index = merged.findIndex((item) => item.kind === pill.kind)
    if (index !== -1) merged.splice(index, 1)
    merged.push(pill)
  }
  return merged
}

/** 展示用：胶囊还原成语法文本（历史重放等） */
export function pillToToken(pill: SearchFilterPill): string {
  switch (pill.kind) {
    case "from":
      return `from:@${pill.label}`
    case "in":
      return `in:#${pill.label}`
    case "before":
      return `before:${pill.date}`
    case "after":
      return `after:${pill.date}`
  }
}

/** 结果卡片面包屑：服务器/频道名（缓存缺失时降级为 ID 片段） */
export function breadcrumbFor(guildId: string, channelId: string): { guild: string; channel: string } {
  const guild = useGuildsStore.getState().guilds.find((item) => item.id === guildId)
  const channels = useChannelsStore.getState().byGuild[guildId]
  const channel = channels?.find((item) => item.id === channelId)
  return {
    guild: guild?.name ?? "未知服务器",
    channel: channel?.name ?? "未知频道",
  }
}
