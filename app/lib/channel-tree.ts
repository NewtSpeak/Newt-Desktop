// 频道树构建与排序结果计算（Discord 风格：根级 = 类别 + 无父频道）。

import type { Channel } from "~/lib/api/types"
import type { ChannelReorderItem } from "~/lib/api/guilds"

export type ChannelTreeNode =
  | {
      kind: "category"
      channel: Channel
      children: Channel[]
    }
  | {
      kind: "channel"
      channel: Channel
    }

function byPosition(a: Channel, b: Channel): number {
  return (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name)
}

/** 将扁平频道列表建成可渲染树（根级按 position 混排类别与无父频道） */
export function buildChannelTree(channels: Channel[]): ChannelTreeNode[] {
  const categories = channels
    .filter((c) => c.type === "CATEGORY")
    .slice()
    .sort(byPosition)
  const childrenByParent = new Map<string, Channel[]>()
  const rootChannels: Channel[] = []

  for (const channel of channels) {
    if (channel.type === "CATEGORY") continue
    const parent = channel.parent_id?.trim()
    if (parent) {
      const list = childrenByParent.get(parent) ?? []
      list.push(channel)
      childrenByParent.set(parent, list)
    } else {
      rootChannels.push(channel)
    }
  }

  for (const list of childrenByParent.values()) {
    list.sort(byPosition)
  }
  rootChannels.sort(byPosition)

  const rootItems: ChannelTreeNode[] = [
    ...categories.map(
      (channel): ChannelTreeNode => ({
        kind: "category",
        channel,
        children: childrenByParent.get(channel.id) ?? [],
      }),
    ),
    ...rootChannels.map(
      (channel): ChannelTreeNode => ({ kind: "channel", channel }),
    ),
  ]

  // 根级：类别与无父频道统一按 position 排序
  rootItems.sort(
    (a, b) =>
      (a.channel.position ?? 0) - (b.channel.position ?? 0) ||
      a.channel.name.localeCompare(b.channel.name),
  )
  return rootItems
}

/**
 * 在同一容器内重排 id 列表（fromIndex → toIndex）。
 */
export function moveInList(
  ids: string[],
  activeId: string,
  overId: string,
): string[] {
  const from = ids.indexOf(activeId)
  const to = ids.indexOf(overId)
  if (from < 0 || to < 0 || from === to) return ids
  const next = ids.slice()
  next.splice(from, 1)
  next.splice(to, 0, activeId)
  return next
}

/**
 * 根据根级顺序与各类别子频道顺序，生成提交给后端的 [{id, position, parent_id}]。
 * - 根级项 position 连续 0..n
 * - 各类别内子频道 position 连续 0..m，parent_id = 类别 id
 */
export function buildReorderPayload(
  rootOrder: string[],
  childrenByCategory: Record<string, string[]>,
  channelById: Map<string, Channel>,
): ChannelReorderItem[] {
  const items: ChannelReorderItem[] = []

  rootOrder.forEach((id, index) => {
    const channel = channelById.get(id)
    if (!channel) return
    if (channel.type === "CATEGORY") {
      items.push({ id, position: index, parent_id: null })
      const children = childrenByCategory[id] ?? []
      children.forEach((childId, childIndex) => {
        items.push({ id: childId, position: childIndex, parent_id: id })
      })
    } else {
      items.push({ id, position: index, parent_id: null })
    }
  })

  return items
}

/** 从树生成初始容器状态 */
export function treeToContainers(tree: ChannelTreeNode[]): {
  rootOrder: string[]
  childrenByCategory: Record<string, string[]>
} {
  const rootOrder: string[] = []
  const childrenByCategory: Record<string, string[]> = {}
  for (const node of tree) {
    rootOrder.push(node.channel.id)
    if (node.kind === "category") {
      childrenByCategory[node.channel.id] = node.children.map((c) => c.id)
    }
  }
  return { rootOrder, childrenByCategory }
}
