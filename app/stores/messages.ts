// 消息 store：按频道缓存消息（雪花 ID 有序去重）、乐观发送队列（nonce 转正）、
// 表情反应增量维护、typing 集合（10s 过期）、断线重连 after 游标补缺口。
//
// 排序约定：内部 messages 数组恒按雪花 ID 升序（旧 → 新），渲染时新消息在下。
// 反应数据源：
//   1. REST list/get 的 messageView.reactions（{emoji,count,me}）— 刷新/首屏权威来源；
//   2. Gateway MESSAGE_REACTION_ADD/REMOVE — 实时增量，按 user_id 幂等去重；
//   3. MESSAGE_CREATE/UPDATE 也可能带 reactions（广播省略 me，合并时保留本地 me）。

import { create } from "zustand"

import {
  deleteMessage as apiDeleteMessage,
  editMessage as apiEditMessage,
  sendMessage as apiSendMessage,
  addReaction,
  getMessage,
  listMessages,
  removeReaction,
} from "~/lib/api/messages"
import { ApiError, isNotFound } from "~/lib/api/http"
import type { Message, ReactionSummary } from "~/lib/api/types"
import { compareSnowflake } from "~/lib/snowflake"
import { countIdsAfterLastRead, useReadStatesStore } from "./read-states"
import type {
  MessageDeletePayload,
  MessageReactionPayload,
  TypingStartPayload,
} from "~/lib/gateway/events"
import { useAuthStore } from "./auth"

// ---------------------------------------------------------------------------
// 常量与类型
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50
/** 每频道内存缓存上限（超出时丢弃最旧的，滚动到顶可重新拉） */
const CACHE_LIMIT = 200
/** typing 条目存活时间 */
const TYPING_TTL_MS = 10_000
/** 断线补缺口的单次上限；补拉打满说明缺口过大，直接清空重拉 */
const GAP_FILL_LIMIT = 100

/** 占位反应者 ID 前缀：REST 只给 count/me 时补齐计数，不含真实用户 */
const UNKNOWN_REACTOR_PREFIX = "__reactor:"

/** 按频道消息缓存精确回写未读条数（拉历史 / 补缺口后调用） */
function syncUnreadCountFromCache(channelId: string) {
  const messages =
    useMessagesStore.getState().byChannel[channelId]?.messages ?? []
  if (messages.length === 0) return
  const lastRead = useReadStatesStore.getState().lastReadByChannel[channelId]
  const count = countIdsAfterLastRead(
    lastRead,
    messages.map((message) => message.id)
  )
  // 取 max：在线事件已累加的值若更大（缓存被 CACHE_LIMIT 截断）则保留
  const tracked =
    useReadStatesStore.getState().unreadCountByChannel[channelId] ?? 0
  useReadStatesStore
    .getState()
    .setUnreadCountExact(channelId, Math.max(tracked, count))
}

export type ReactionEntry = {
  emoji: string
  /** 已反应用户 ID（Gateway 事件幂等去重；计数 = 长度） */
  userIds: string[]
}

/** 客户端消息 = 服务端 messageView，reactions 归一为本地 userIds 结构 */
export type ChatMessage = Omit<Message, "reactions"> & {
  reactions: ReactionEntry[]
}

export type PendingAttachmentMeta = {
  id: string
  filename: string
  mime: string
  size: number
}

/** 乐观消息（尚未收到服务端确认，或发送失败等待重试） */
export type PendingMessage = {
  nonce: string
  channelId: string
  content: string
  replyToId?: string
  attachmentIds: string[]
  attachments: PendingAttachmentMeta[]
  stickerItems?: { item_id: string }[]
  /** 乐观贴图预览（asset URL 等，发送确认后丢弃） */
  stickerPreview?: {
    item_id: string
    pack_id?: string
    mark?: string
    asset_url?: string
  }[]
  createdAt: string
  status: "sending" | "failed"
  errorMessage?: string
}

type ChannelMessagesState = {
  /** 恒按雪花 ID 升序 */
  messages: ChatMessage[]
  loadedInitial: boolean
  loadingInitial: boolean
  loadingOlder: boolean
  /** 向上翻页到头（渲染「频道的开始」欢迎块） */
  reachedStart: boolean
  /** 历史接口 404：频道不可用（无权限/被删，防扫频语义下不区分） */
  unavailable: boolean
}

const EMPTY_CHANNEL: ChannelMessagesState = {
  messages: [],
  loadedInitial: false,
  loadingInitial: false,
  loadingOlder: false,
  reachedStart: false,
  unavailable: false,
}

export type SendInput = {
  content: string
  replyToId?: string
  attachmentIds?: string[]
  attachments?: PendingAttachmentMeta[]
  /** 贴图消息：恰 1 张，与 content/attachments 互斥（docs 17） */
  stickerItems?: { item_id: string }[]
  stickerPreview?: PendingMessage["stickerPreview"]
  /** 不传则自动生成；调用方（composer）需要 nonce 用于失败后定向清理 */
  nonce?: string
}

type MessagesState = {
  byChannel: Record<string, ChannelMessagesState>
  pendingByChannel: Record<string, PendingMessage[]>
  /** channelId → userId → 过期时间戳（ms） */
  typingByChannel: Record<string, Record<string, number>>

  loadInitial: (channelId: string) => Promise<void>
  loadOlder: (channelId: string) => Promise<void>
  /** 丢弃频道消息缓存（私信重开后强制重拉） */
  invalidateChannel: (channelId: string) => void
  /**
   * 以目标消息为锚点加载其前后上下文（搜索结果跳转定位用）。
   * 返回 false 表示消息不可用（已删除/无权限），调用方 toast「无法定位该消息」。
   */
  loadAround: (channelId: string, messageId: string) => Promise<boolean>
  /** Gateway 重连后对打开中的频道补缺口 */
  fillGap: (channelId: string) => Promise<void>

  /** 返回本次发送的 nonce */
  send: (channelId: string, input: SendInput) => Promise<string>
  retryPending: (channelId: string, nonce: string) => Promise<void>
  discardPending: (channelId: string, nonce: string) => void

  edit: (channelId: string, messageId: string, content: string) => Promise<void>
  remove: (channelId: string, messageId: string) => Promise<void>
  toggleReaction: (
    channelId: string,
    messageId: string,
    emoji: string
  ) => Promise<void>

  applyMessageCreate: (message: Message) => void
  applyMessageUpdate: (message: Message) => void
  applyMessageDelete: (payload: MessageDeletePayload) => void
  applyReactionAdd: (payload: MessageReactionPayload) => void
  applyReactionRemove: (payload: MessageReactionPayload) => void
  applyTypingStart: (payload: TypingStartPayload) => void

  reset: () => void
}

// ---------------------------------------------------------------------------
// 雪花 ID 与排序工具
// ---------------------------------------------------------------------------

export { compareSnowflake }

function isUnknownReactor(id: string): boolean {
  return id.startsWith(UNKNOWN_REACTOR_PREFIX)
}

/**
 * 将服务端 {emoji,count,me} 转为本地 {emoji,userIds}。
 * - 优先保留 Gateway 已累积的真实 user_id；
 * - count 不足时用稳定占位符补齐（保证刷新后计数正确）；
 * - me 为 boolean 时（REST 带 viewer）权威；省略时（Gateway 广播）保留本地 me。
 */
function userIdsFromSummary(
  summary: ReactionSummary,
  previous: ReactionEntry | undefined,
  selfId: string | undefined
): string[] {
  const count = Math.max(0, Number(summary.count) || 0)
  if (count === 0) return []

  const previousMe = Boolean(selfId && previous?.userIds.includes(selfId))
  const me = typeof summary.me === "boolean" ? summary.me : previousMe

  const realIds = (previous?.userIds ?? []).filter(
    (id) => !isUnknownReactor(id)
  )
  let userIds = [...realIds]

  if (selfId) {
    if (me && !userIds.includes(selfId)) userIds = [selfId, ...userIds]
    if (!me) userIds = userIds.filter((id) => id !== selfId)
  }

  if (userIds.length > count) {
    const self = selfId && userIds.includes(selfId) ? [selfId] : []
    const others = userIds.filter((id) => id !== selfId)
    userIds = [...self, ...others].slice(0, count)
  }

  let pad = 0
  while (userIds.length < count) {
    userIds.push(`${UNKNOWN_REACTOR_PREFIX}${summary.emoji}:${pad++}`)
  }
  return userIds
}

function hydrateReactions(
  raw: Message,
  previous?: ChatMessage
): ReactionEntry[] {
  // 服务端 messageView 始终附带 reactions（可为空数组）；缺字段时才回退本地
  if (raw.reactions === undefined) {
    return previous?.reactions ?? []
  }
  const selfId = useAuthStore.getState().user?.id
  return raw.reactions.map((summary) => {
    const prev = previous?.reactions.find(
      (entry) => entry.emoji === summary.emoji
    )
    return {
      emoji: summary.emoji,
      userIds: userIdsFromSummary(summary, prev, selfId),
    }
  })
}

function normalize(raw: Message, previous?: ChatMessage): ChatMessage {
  const {
    reactions: _serverReactions,
    attachments: rawAttachments,
    ...rest
  } = raw
  // 部分 Gateway payload（如管理员临场发言）可能省略 attachments；
  // 缺字段时保留本地已有列表，否则回落空数组，避免渲染层读 .length 崩溃。
  return {
    ...rest,
    attachments: rawAttachments ?? previous?.attachments ?? [],
    reactions: hydrateReactions(raw, previous),
  }
}

/** 合并进有序数组：按 ID 去重（保留新数据、合并 reactions），恒升序 */
function mergeSorted(
  existing: ChatMessage[],
  incoming: Message[]
): ChatMessage[] {
  if (incoming.length === 0) return existing
  const byId = new Map<string, ChatMessage>()
  for (const message of existing) byId.set(message.id, message)
  for (const raw of incoming) byId.set(raw.id, normalize(raw, byId.get(raw.id)))
  return [...byId.values()].sort((a, b) => compareSnowflake(a.id, b.id))
}

function channelState(
  state: MessagesState,
  channelId: string
): ChannelMessagesState {
  return state.byChannel[channelId] ?? EMPTY_CHANNEL
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

export const useMessagesStore = create<MessagesState>()((set, get) => {
  /** 更新单个频道的分片状态 */
  const patchChannel = (
    channelId: string,
    patch: Partial<ChannelMessagesState>
  ) =>
    set((state) => ({
      byChannel: {
        ...state.byChannel,
        [channelId]: { ...channelState(state, channelId), ...patch },
      },
    }))

  /** 历史 404：标记频道不可用并从 channels store 移除（防扫频语义） */
  const markUnavailable = (channelId: string) => {
    patchChannel(channelId, {
      unavailable: true,
      loadingInitial: false,
      loadingOlder: false,
    })
    void import("./channels").then((m) => {
      const byGuild = m.useChannelsStore.getState().byGuild
      for (const [guildId, channels] of Object.entries(byGuild)) {
        if (channels.some((channel) => channel.id === channelId)) {
          m.useChannelsStore.getState().removeChannel(guildId, channelId)
          return
        }
      }
    })
  }

  const updateMessage = (
    channelId: string,
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage
  ) =>
    set((state) => {
      const channel = channelState(state, channelId)
      const index = channel.messages.findIndex(
        (message) => message.id === messageId
      )
      if (index === -1) return state
      const messages = channel.messages.slice()
      messages[index] = updater(messages[index])
      return {
        byChannel: {
          ...state.byChannel,
          [channelId]: { ...channel, messages },
        },
      }
    })

  const patchPending = (
    channelId: string,
    nonce: string,
    patch: Partial<PendingMessage>
  ) =>
    set((state) => {
      const queue = state.pendingByChannel[channelId]
      if (!queue) return state
      return {
        pendingByChannel: {
          ...state.pendingByChannel,
          [channelId]: queue.map((item) =>
            item.nonce === nonce ? { ...item, ...patch } : item
          ),
        },
      }
    })

  const removePendingEntry = (channelId: string, nonce: string) =>
    set((state) => {
      const queue = state.pendingByChannel[channelId]
      if (!queue?.some((item) => item.nonce === nonce)) return state
      return {
        pendingByChannel: {
          ...state.pendingByChannel,
          [channelId]: queue.filter((item) => item.nonce !== nonce),
        },
      }
    })

  /** 乐观消息转正：单次 set 内删 pending + 插入正式消息，避免中间帧空白/头像闪烁 */
  const ackPending = (_channelId: string, _nonce: string, message: Message) => {
    // applyMessageCreate 会在同一快照中清 nonce 对应 pending 并写入消息
    get().applyMessageCreate(message)
  }

  /** 发送请求主体（send 与 retryPending 共用，nonce 保持不变以幂等去重） */
  const dispatchSend = async (channelId: string, pending: PendingMessage) => {
    try {
      const isSticker =
        pending.stickerItems != null && pending.stickerItems.length > 0
      const message = await apiSendMessage(channelId, {
        content: isSticker ? "" : pending.content || undefined,
        reply_to_id: pending.replyToId,
        attachment_ids:
          !isSticker && pending.attachmentIds.length > 0
            ? pending.attachmentIds
            : undefined,
        sticker_items: isSticker ? pending.stickerItems : undefined,
        nonce: pending.nonce,
      })
      ackPending(channelId, pending.nonce, message)
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "发送失败，请检查网络后重试"
      patchPending(channelId, pending.nonce, {
        status: "failed",
        errorMessage: message,
      })
      throw error
    }
  }

  return {
    byChannel: {},
    pendingByChannel: {},
    typingByChannel: {},

    // -----------------------------------------------------------------------
    // 历史加载
    // -----------------------------------------------------------------------

    loadInitial: async (channelId) => {
      const channel = channelState(get(), channelId)
      // 已有缓存直接复用（Gateway 事件保持其新鲜；断线由 fillGap 兜底）。
      // 例外：空缓存且曾 loadedInitial（例如误进空壳私信）允许强制重拉。
      if (channel.loadingInitial || channel.unavailable) return
      if (channel.loadedInitial && channel.messages.length > 0) return
      // 空的 loadedInitial 仍重试一次，避免「进了会话但消息永远空」
      if (channel.loadedInitial && channel.messages.length === 0) {
        patchChannel(channelId, { loadedInitial: false })
      }
      patchChannel(channelId, { loadingInitial: true })
      try {
        const page = await listMessages(channelId, { limit: PAGE_SIZE })
        // 未读判定需要频道最新消息 ID（服务端降序返回，page[0] 最新）
        if (page.length > 0) {
          useReadStatesStore
            .getState()
            .noteLatestMessage(channelId, page[0].guild_id, page[0].id)
        }
        set((state) => {
          const current = channelState(state, channelId)
          return {
            byChannel: {
              ...state.byChannel,
              [channelId]: {
                ...current,
                // 服务端降序返回；merge 内部会重排升序。与已到的实时消息合并去重。
                messages: mergeSorted(current.messages, page),
                loadedInitial: true,
                loadingInitial: false,
                reachedStart: page.length < PAGE_SIZE,
              },
            },
          }
        })
        // 用本页+缓存精确回写未读条数（离线多条未读不再卡在保底 1）
        syncUnreadCountFromCache(channelId)
      } catch (error) {
        patchChannel(channelId, { loadingInitial: false })
        if (isNotFound(error)) {
          markUnavailable(channelId)
          return
        }
        throw error
      }
    },

    /** 丢弃频道消息缓存（私信重开到权威会话后强制重拉历史） */
    invalidateChannel: (channelId: string) => {
      set((state) => {
        if (!state.byChannel[channelId]) return state
        const next = { ...state.byChannel }
        delete next[channelId]
        return { byChannel: next }
      })
    },

    loadOlder: async (channelId) => {
      const channel = channelState(get(), channelId)
      if (
        !channel.loadedInitial ||
        channel.loadingOlder ||
        channel.reachedStart ||
        channel.unavailable ||
        channel.messages.length === 0
      ) {
        return
      }
      patchChannel(channelId, { loadingOlder: true })
      const oldest = channel.messages[0].id
      try {
        const page = await listMessages(channelId, {
          before: oldest,
          limit: PAGE_SIZE,
        })
        set((state) => {
          const current = channelState(state, channelId)
          return {
            byChannel: {
              ...state.byChannel,
              [channelId]: {
                ...current,
                messages: mergeSorted(current.messages, page),
                loadingOlder: false,
                reachedStart: page.length < PAGE_SIZE,
              },
            },
          }
        })
      } catch (error) {
        patchChannel(channelId, { loadingOlder: false })
        if (isNotFound(error)) {
          markUnavailable(channelId)
          return
        }
        throw error
      }
    },

    loadAround: async (channelId, messageId) => {
      const channel = channelState(get(), channelId)
      if (channel.unavailable) return false
      // 目标已在缓存内：直接定位，无需重拉
      if (channel.messages.some((message) => message.id === messageId))
        return true
      patchChannel(channelId, { loadingInitial: true })
      try {
        // 目标消息 + 前后各一页上下文（FR-18：before/after 各拉一页）
        const [target, beforePage, afterPage] = await Promise.all([
          getMessage(channelId, messageId),
          listMessages(channelId, { before: messageId, limit: PAGE_SIZE }),
          listMessages(channelId, { after: messageId, limit: PAGE_SIZE }),
        ])
        set((state) => {
          const current = channelState(state, channelId)
          return {
            byChannel: {
              ...state.byChannel,
              [channelId]: {
                ...current,
                // 以目标为中心重建缓存窗口（丢弃原缓存，避免窗口间出现缺口；
                // 若目标之后还有 >PAGE_SIZE 条更新消息，向下滚动暂不能续拉，
                // 重进频道或 fillGap 会恢复到最新——P0 可接受的边界）
                messages: mergeSorted(
                  [],
                  [...beforePage, target, ...afterPage]
                ),
                loadedInitial: true,
                loadingInitial: false,
                reachedStart: beforePage.length < PAGE_SIZE,
              },
            },
          }
        })
        return true
      } catch (error) {
        patchChannel(channelId, { loadingInitial: false })
        if (isNotFound(error)) return false
        throw error
      }
    },

    fillGap: async (channelId) => {
      const channel = channelState(get(), channelId)
      if (channel.unavailable) return
      // 从未加载或缓存为空：走正常初始加载
      if (!channel.loadedInitial || channel.messages.length === 0) {
        patchChannel(channelId, { loadedInitial: false })
        return get().loadInitial(channelId)
      }
      const latest = channel.messages[channel.messages.length - 1].id
      try {
        const page = await listMessages(channelId, {
          after: latest,
          limit: GAP_FILL_LIMIT,
        })
        if (page.length >= GAP_FILL_LIMIT) {
          // 缺口过大：丢弃缓存，重拉最近一页
          patchChannel(channelId, { ...EMPTY_CHANNEL })
          return get().loadInitial(channelId)
        }
        if (page.length > 0) {
          useReadStatesStore
            .getState()
            .noteLatestMessage(channelId, page[0].guild_id, page[0].id)
          set((state) => {
            const current = channelState(state, channelId)
            return {
              byChannel: {
                ...state.byChannel,
                [channelId]: {
                  ...current,
                  messages: mergeSorted(current.messages, page).slice(
                    -CACHE_LIMIT
                  ),
                },
              },
            }
          })
          syncUnreadCountFromCache(channelId)
        }
      } catch (error) {
        if (isNotFound(error)) {
          markUnavailable(channelId)
          return
        }
        // 补缺口失败不致命：保留现有缓存，等下次重连或用户手动滚动触发
      }
    },

    // -----------------------------------------------------------------------
    // 发送（乐观回显 + nonce 幂等重试）
    // -----------------------------------------------------------------------

    send: async (channelId, input) => {
      const pending: PendingMessage = {
        nonce: input.nonce ?? crypto.randomUUID(),
        channelId,
        content: input.content,
        replyToId: input.replyToId,
        attachmentIds: input.attachmentIds ?? [],
        attachments: input.attachments ?? [],
        stickerItems: input.stickerItems,
        stickerPreview: input.stickerPreview,
        createdAt: new Date().toISOString(),
        status: "sending",
      }
      set((state) => ({
        pendingByChannel: {
          ...state.pendingByChannel,
          [channelId]: [...(state.pendingByChannel[channelId] ?? []), pending],
        },
      }))
      await dispatchSend(channelId, pending)
      return pending.nonce
    },

    retryPending: async (channelId, nonce) => {
      const pending = get().pendingByChannel[channelId]?.find(
        (item) => item.nonce === nonce
      )
      if (!pending || pending.status === "sending") return
      patchPending(channelId, nonce, {
        status: "sending",
        errorMessage: undefined,
      })
      await dispatchSend(channelId, { ...pending, status: "sending" })
    },

    discardPending: removePendingEntry,

    // -----------------------------------------------------------------------
    // 编辑 / 删除 / 反应
    // -----------------------------------------------------------------------

    edit: async (channelId, messageId, content) => {
      const updated = await apiEditMessage(channelId, messageId, content)
      get().applyMessageUpdate(updated)
    },

    remove: async (channelId, messageId) => {
      await apiDeleteMessage(channelId, messageId)
      get().applyMessageDelete({
        id: messageId,
        channel_id: channelId,
        guild_id: "",
      })
    },

    toggleReaction: async (channelId, messageId, emoji) => {
      const userId = useAuthStore.getState().user?.id
      if (!userId) return
      const message = channelState(get(), channelId).messages.find(
        (item) => item.id === messageId
      )
      const reacted = Boolean(
        message?.reactions
          .find((entry) => entry.emoji === emoji)
          ?.userIds.includes(userId)
      )
      // 乐观更新，失败回滚（PUT/DELETE 幂等，重复请求无副作用）
      const payload = {
        message_id: messageId,
        channel_id: channelId,
        guild_id: "",
        user_id: userId,
        emoji,
      }
      if (reacted) {
        get().applyReactionRemove(payload)
      } else {
        get().applyReactionAdd(payload)
      }
      try {
        if (reacted) await removeReaction(channelId, messageId, emoji)
        else await addReaction(channelId, messageId, emoji)
      } catch (error) {
        if (reacted) get().applyReactionAdd(payload)
        else get().applyReactionRemove(payload)
        throw error
      }
    },

    // -----------------------------------------------------------------------
    // Gateway 事件
    // -----------------------------------------------------------------------

    applyMessageCreate: (message) => {
      const selfId = useAuthStore.getState().user?.id
      set((state) => {
        const channel = channelState(state, message.channel_id)
        const alreadyExists = channel.messages.some(
          (item) => item.id === message.id
        )
        // 收到该用户消息即清除其 typing 条目
        const typing = state.typingByChannel[message.channel_id]
        const nextTyping =
          typing && message.author_id in typing
            ? {
                ...state.typingByChannel,
                [message.channel_id]: Object.fromEntries(
                  Object.entries(typing).filter(
                    ([userId]) => userId !== message.author_id
                  )
                ),
              }
            : state.typingByChannel
        // REST 首屏与 Gateway 重放可能包含同一条 MESSAGE_CREATE。
        // CREATE 按消息 ID 幂等：已存在时保持数组引用，避免每条重放都触发整表渲染。
        let messages = alreadyExists
          ? channel.messages
          : mergeSorted(channel.messages, [message])
        let reachedStart = channel.reachedStart
        if (messages.length > CACHE_LIMIT) {
          messages = messages.slice(-CACHE_LIMIT)
          reachedStart = false
        }
        // 与消息写入同一帧清掉对应 pending，避免「pending 消失 → 正式消息出现」两帧闪烁
        let pendingByChannel = state.pendingByChannel
        if (message.nonce && message.author_id === selfId) {
          const queue = state.pendingByChannel[message.channel_id]
          if (queue?.some((item) => item.nonce === message.nonce)) {
            pendingByChannel = {
              ...state.pendingByChannel,
              [message.channel_id]: queue.filter(
                (item) => item.nonce !== message.nonce
              ),
            }
          }
        }
        if (
          messages === channel.messages &&
          nextTyping === state.typingByChannel &&
          pendingByChannel === state.pendingByChannel
        ) {
          return state
        }
        return {
          typingByChannel: nextTyping,
          pendingByChannel,
          byChannel: {
            ...state.byChannel,
            [message.channel_id]: { ...channel, messages, reachedStart },
          },
        }
      })
    },

    applyMessageUpdate: (message) => {
      updateMessage(message.channel_id, message.id, (previous) =>
        normalize(message, previous)
      )
    },

    applyMessageDelete: (payload) => {
      set((state) => {
        const channel = channelState(state, payload.channel_id)
        if (!channel.messages.some((message) => message.id === payload.id))
          return state
        return {
          byChannel: {
            ...state.byChannel,
            [payload.channel_id]: {
              ...channel,
              messages: channel.messages.filter(
                (message) => message.id !== payload.id
              ),
            },
          },
        }
      })
    },

    applyReactionAdd: (payload) => {
      updateMessage(payload.channel_id, payload.message_id, (message) => {
        const entry = message.reactions.find(
          (item) => item.emoji === payload.emoji
        )
        if (entry) {
          if (entry.userIds.includes(payload.user_id)) return message
          return {
            ...message,
            reactions: message.reactions.map((item) =>
              item.emoji === payload.emoji
                ? { ...item, userIds: [...item.userIds, payload.user_id] }
                : item
            ),
          }
        }
        return {
          ...message,
          reactions: [
            ...message.reactions,
            { emoji: payload.emoji, userIds: [payload.user_id] },
          ],
        }
      })
    },

    applyReactionRemove: (payload) => {
      updateMessage(payload.channel_id, payload.message_id, (message) => {
        const entry = message.reactions.find(
          (item) => item.emoji === payload.emoji
        )
        if (!entry || !entry.userIds.includes(payload.user_id)) return message
        const userIds = entry.userIds.filter(
          (userId) => userId !== payload.user_id
        )
        return {
          ...message,
          reactions:
            userIds.length === 0
              ? message.reactions.filter((item) => item.emoji !== payload.emoji)
              : message.reactions.map((item) =>
                  item.emoji === payload.emoji ? { ...item, userIds } : item
                ),
        }
      })
    },

    applyTypingStart: (payload) => {
      const selfId = useAuthStore.getState().user?.id
      if (payload.user_id === selfId) return
      set((state) => ({
        typingByChannel: {
          ...state.typingByChannel,
          [payload.channel_id]: {
            ...state.typingByChannel[payload.channel_id],
            [payload.user_id]: Date.now() + TYPING_TTL_MS,
          },
        },
      }))
    },

    reset: () =>
      set({ byChannel: {}, pendingByChannel: {}, typingByChannel: {} }),
  }
})
