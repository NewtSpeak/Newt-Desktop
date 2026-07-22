// 私信频道列表（Server-16 BR.2）：READY 快照 + REST + get-or-create。

import { create } from "zustand"

import {
  createGroupDm,
  inviteToGroupDm,
  leaveGroupDm,
  listPrivateChannels,
  openDmChannel,
  patchDmRecipientMe,
  renameGroupDm,
  type PrivateChannel,
} from "~/lib/api/social"
import { useReadStatesStore } from "~/stores/read-states"

type PrivateChannelsState = {
  channels: PrivateChannel[]
  loaded: boolean
  setFromReady: (channels: PrivateChannel[]) => void
  refresh: () => Promise<void>
  upsert: (ch: PrivateChannel) => void
  remove: (channelId: string) => void
  openDm: (recipientId: string) => Promise<PrivateChannel>
  createGroup: (recipientIds: string[], name?: string) => Promise<PrivateChannel>
  invite: (channelId: string, userId: string) => Promise<PrivateChannel>
  acceptRequest: (channelId: string) => Promise<PrivateChannel>
  rejectRequest: (channelId: string) => Promise<void>
  closeChannel: (channelId: string) => Promise<void>
  leaveGroup: (channelId: string) => Promise<void>
  renameGroup: (channelId: string, name: string) => Promise<PrivateChannel>
  /** 实时消息：更新侧栏预览 */
  noteMessage: (
    channelId: string,
    msg: {
      id: string
      author_id: string
      content: string
      type?: string
      created_at?: string
    },
  ) => void
  reset: () => void
}

/** 将私信服务端精确已读快照合并到未读 store，guild 映射 @me */
function seedPrivateReadStates(channels: PrivateChannel[]) {
  const read = useReadStatesStore.getState()
  for (const ch of channels) {
    const hasExactSnapshot =
      ch.last_read_message_id !== undefined ||
      ch.mention_count !== undefined ||
      ch.unread_count !== undefined
    if (!hasExactSnapshot) {
      if (ch.last_message_id && ch.last_message_id !== "0") {
        read.noteLatestMessage(ch.id, "@me", ch.last_message_id)
      }
      continue
    }
    read.applyChannelSnapshot(
      {
        channel_id: ch.id,
        last_read_message_id: ch.last_read_message_id ?? "0",
        last_message_id: ch.last_message_id,
        mention_count: ch.mention_count ?? 0,
        unread_count: ch.unread_count,
      },
      "@me",
    )
  }
}

/** 1:1 DM 的对端 user id（服务端 recipients 已排除自己） */
function dmPeerId(ch: PrivateChannel): string | undefined {
  if (ch.type !== "DM") return undefined
  return ch.recipients[0]?.id
}

/** 雪花 / 时间戳字符串：更大则更新 */
function isNewerMessageId(a?: string, b?: string): boolean {
  const left = a || ""
  const right = b || ""
  if (!left) return false
  if (!right) return true
  if (left.length !== right.length) return left.length > right.length
  return left > right
}

/**
 * 在两条同对端 1:1 中选出应保留的会话。
 * 规则（与服务端一致）：
 * 1) 非请求箱优先；
 * 2) 有 last_message 的优先（绝不能丢掉有历史的会话去留空壳）；
 * 3) 都有消息时取更新的；
 * 4) 都无消息时保留更早创建的原始会话。
 */
function preferPrivateChannel(a: PrivateChannel, b: PrivateChannel): PrivateChannel {
  if (a.message_request !== b.message_request) {
    return a.message_request ? b : a
  }
  const aHas = Boolean(a.last_message_id && a.last_message_id !== "0")
  const bHas = Boolean(b.last_message_id && b.last_message_id !== "0")
  if (aHas !== bHas) return aHas ? a : b
  if (aHas && bHas) {
    return isNewerMessageId(a.last_message_id, b.last_message_id) ? a : b
  }
  // 都无消息：保留更早的
  return (a.created_at || "") <= (b.created_at || "") ? a : b
}

/**
 * 去重：
 * 1) 同 channel id 只留一条；
 * 2) 同一对端的多条 1:1 DM 只留「有历史」的权威会话。
 */
function dedupePrivateChannels(channels: PrivateChannel[]): PrivateChannel[] {
  const byId = new Map<string, PrivateChannel>()
  for (const ch of channels) {
    if (!ch?.id) continue
    const prev = byId.get(ch.id)
    byId.set(ch.id, prev ? preferPrivateChannel(prev, ch) : ch)
  }

  const byPeer = new Map<string, PrivateChannel>()
  const rest: PrivateChannel[] = []
  for (const ch of byId.values()) {
    if (ch.hidden) continue
    const peer = dmPeerId(ch)
    if (!peer) {
      rest.push(ch)
      continue
    }
    const prev = byPeer.get(peer)
    byPeer.set(peer, prev ? preferPrivateChannel(prev, ch) : ch)
  }

  return [...rest, ...byPeer.values()]
}

export const usePrivateChannelsStore = create<PrivateChannelsState>()(
  (set, get) => ({
    channels: [],
    loaded: false,

    setFromReady: (channels) => {
      const list = dedupePrivateChannels(channels ?? [])
      set({ channels: list, loaded: true })
      seedPrivateReadStates(list)
    },

    refresh: async () => {
      const channels = dedupePrivateChannels(await listPrivateChannels())
      set({ channels, loaded: true })
      seedPrivateReadStates(channels)
    },

    upsert: (ch) =>
      set((state) => {
        if (ch.hidden) {
          return {
            channels: state.channels.filter((c) => c.id !== ch.id),
          }
        }
        seedPrivateReadStates([ch])
        // 新会话置顶，并按 id + 1:1 对端去重
        const next = dedupePrivateChannels([
          ch,
          ...state.channels.filter((c) => c.id !== ch.id),
        ])
        // 确保刚 upsert 的会话在列表最前（去重后可能顺序被打乱）
        const head = next.find((c) => c.id === ch.id)
        if (!head) return { channels: next }
        return {
          channels: [head, ...next.filter((c) => c.id !== ch.id)],
        }
      }),

    remove: (channelId) =>
      set((state) => ({
        channels: state.channels.filter((c) => c.id !== channelId),
      })),

    openDm: async (recipientId) => {
      // 始终走服务端 get-or-create（会 unhide 权威会话并合并历史）；
      // upsert 按 id + 对端去重；清掉消息空缓存，避免误进空壳后永远不重拉。
      const ch = await openDmChannel(recipientId)
      get().upsert(ch)
      void import("~/stores/messages").then((m) => {
        m.useMessagesStore.getState().invalidateChannel(ch.id)
      })
      return ch
    },

    createGroup: async (recipientIds, name) => {
      const ch = await createGroupDm(recipientIds, name)
      get().upsert(ch)
      return ch
    },

    invite: async (channelId, userId) => {
      const ch = await inviteToGroupDm(channelId, userId)
      get().upsert(ch)
      return ch
    },

    acceptRequest: async (channelId) => {
      const ch = await patchDmRecipientMe(channelId, {
        message_request: false,
      })
      get().upsert(ch)
      return ch
    },

    rejectRequest: async (channelId) => {
      await patchDmRecipientMe(channelId, { hidden: true })
      get().remove(channelId)
    },

    closeChannel: async (channelId) => {
      // 关闭 = 仅对本用户 hidden，历史消息与 channel_id 永久保留；
      // 再次 openDm 会 unhide 同一会话并带回完整记录。
      await patchDmRecipientMe(channelId, { hidden: true })
      get().remove(channelId)
    },

    leaveGroup: async (channelId) => {
      await leaveGroupDm(channelId)
      get().remove(channelId)
    },

    renameGroup: async (channelId, name) => {
      const ch = await renameGroupDm(channelId, name)
      get().upsert(ch)
      return ch
    },

    noteMessage: (channelId, msg) =>
      set((state) => {
        const idx = state.channels.findIndex((c) => c.id === channelId)
        if (idx < 0) return state
        const prev = state.channels[idx]
        const content =
          msg.content.length > 80
            ? `${msg.content.slice(0, 80)}…`
            : msg.content
        const updated: PrivateChannel = {
          ...prev,
          last_message_id: msg.id,
          last_message: {
            id: msg.id,
            author_id: msg.author_id,
            content,
            type: msg.type,
            created_at: msg.created_at,
          },
          // 新消息置顶（非 hidden）
          hidden: false,
        }
        const rest = state.channels.filter((c) => c.id !== channelId)
        return { channels: [updated, ...rest] }
      }),

    reset: () => set({ channels: [], loaded: false }),
  }),
)

/** 正常私信（非请求箱） */
export function normalDmChannels(channels: PrivateChannel[]): PrivateChannel[] {
  return channels.filter((c) => !c.message_request && !c.hidden)
}

/** 消息请求箱 */
export function messageRequestChannels(
  channels: PrivateChannel[],
): PrivateChannel[] {
  return channels.filter((c) => c.message_request && !c.hidden)
}

/** 按最近消息时间降序（雪花 ID 可比） */
export function sortPrivateChannels(
  channels: PrivateChannel[],
): PrivateChannel[] {
  return [...channels].sort((a, b) => {
    const ai = a.last_message_id || a.last_message?.id || ""
    const bi = b.last_message_id || b.last_message?.id || ""
    if (!ai && !bi) {
      return (b.created_at || "").localeCompare(a.created_at || "")
    }
    if (!ai) return 1
    if (!bi) return -1
    // 雪花字符串大的更新
    if (ai.length !== bi.length) return bi.length - ai.length
    return bi.localeCompare(ai)
  })
}

/** 1:1 / 群组会话显示名 */
export function dmDisplayName(ch: PrivateChannel, selfId?: string): string {
  if (ch.name?.trim()) return ch.name.trim()
  if (ch.type === "GROUP_DM") {
    const names = ch.recipients
      .filter((r) => r.id !== selfId)
      .map((r) => r.display_name?.trim() || r.username)
      .filter(Boolean)
    if (names.length === 0) return "群组私信"
    if (names.length <= 3) return names.join("、")
    return `${names.slice(0, 2).join("、")} 等 ${names.length} 人`
  }
  const other = ch.recipients.find((r) => r.id !== selfId) ?? ch.recipients[0]
  if (!other) return "私信"
  return other.display_name?.trim() || other.username || "私信"
}

/** 判断 CHANNEL_* payload 是否为私信频道视图 */
export function isPrivateChannelPayload(
  payload: unknown,
): payload is PrivateChannel {
  if (!payload || typeof payload !== "object") return false
  const p = payload as Record<string, unknown>
  return (
    (p.type === "DM" || p.type === "GROUP_DM") &&
    typeof p.id === "string" &&
    Array.isArray(p.recipients)
  )
}

/** guild_id 是否为私信（零 UUID 或空） */
export function isDmGuildId(guildId: string | undefined | null): boolean {
  if (!guildId) return true
  return (
    guildId === "00000000-0000-0000-0000-000000000000" || guildId === "@me"
  )
}
