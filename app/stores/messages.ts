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
import {
  isEphemeralMessage,
  type Message,
  type ReactionSummary,
} from "~/lib/api/types"
import {
  applyStreamDeltasBatch,
  mergeReconciledStreamMessage,
  shouldReconcileStreamGap,
} from "~/lib/message-stream"
import {
  forEachStreamBatch,
  StreamDeltaBatcher,
  toSeqDeltas,
} from "~/lib/stream-delta-batcher"
import { compareSnowflake } from "~/lib/snowflake"
import { countIdsAfterLastRead, useReadStatesStore } from "./read-states"
import type {
  MessageDeletePayload,
  MessageReactionPayload,
  MessageStreamDeltaPayload,
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
/** 流式缺片 / 未见占位时 REST 纠偏防抖 */
const STREAM_RECONCILE_DEBOUNCE_MS = 400
/** 同一消息纠偏最小间隔，避免刷爆 getMessage */
const STREAM_RECONCILE_COOLDOWN_MS = 2_000
/** 私信预览随流式正文更新的节流间隔 */
const STREAM_PREVIEW_THROTTLE_MS = 500

/** 占位反应者 ID 前缀：REST 只给 count/me 时补齐计数，不含真实用户 */
const UNKNOWN_REACTOR_PREFIX = "__reactor:"

/** 按频道消息缓存精确回写未读条数（拉历史 / 补缺口后调用） */
function syncUnreadCountFromCache(channelId: string) {
  const messages =
    useMessagesStore.getState().byChannel[channelId]?.messages ?? []
  if (messages.length === 0) return
  const lastRead = useReadStatesStore.getState().lastReadByChannel[channelId]
  // ephemeral 不计未读（与服务端 last_message_id 排除口径一致）
  const count = countIdsAfterLastRead(
    lastRead,
    messages
      .filter((message) => !isEphemeralMessage(message))
      .map((message) => message.id)
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
  /**
   * 已应用的最大 MESSAGE_STREAM_DELTA.seq（仅本地；REST 不返回）。
   * 用于去重与乱序缓冲。
   */
  streamSeq?: number
  /**
   * 乱序到达的 delta 暂存（seq → delta）；连上后按序拼入 content。
   * 仅 STREAMING 期间使用。
   */
  streamPendingDeltas?: Record<number, string>
  /**
   * 最近一次流式活动（START/DELTA/REST 纠偏）的本地时间戳 ms。
   * 用于 UI「生成较慢 / 可能已中断」判定。
   */
  streamLastActivityAt?: number
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
  /** 频道上锁且当前用户未解锁 */
  locked: boolean
}

const EMPTY_CHANNEL: ChannelMessagesState = {
  messages: [],
  loadedInitial: false,
  loadingInitial: false,
  loadingOlder: false,
  reachedStart: false,
  unavailable: false,
  locked: false,
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
  /** bot 流式：占位消息创建（等同 create，保留 stream_status） */
  applyMessageStreamStart: (message: Message) => void
  /** bot 流式：按 seq 拼接 delta（内部 rAF 批处理） */
  applyMessageStreamDelta: (payload: MessageStreamDeltaPayload) => void
  /** bot 流式：终态覆盖（无本地记录时 upsert） */
  applyMessageStreamEnd: (message: Message) => void
  /**
   * 手动 / 自动 REST 纠偏：拉取单条消息覆盖本地正文与 stream_status。
   * 用于乱序空洞过大或用户点击「刷新」。
   */
  reconcileStreamMessage: (
    channelId: string,
    messageId: string
  ) => Promise<void>

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
  const streaming = raw.stream_status === "STREAMING"
  return {
    ...rest,
    // omitempty 终态不带 stream_status：显式清掉本地 STREAMING
    stream_status: streaming ? "STREAMING" : raw.stream_status || undefined,
    // omitempty：更新事件省略 visible_to 时保留本地值（防 ephemeral 标记被冲掉）
    visible_to: raw.visible_to ?? previous?.visible_to,
    attachments: rawAttachments ?? previous?.attachments ?? [],
    reactions: hydrateReactions(raw, previous),
    // 终态 / 非流式：丢弃本地 seq 与乱序缓冲
    streamSeq: streaming ? previous?.streamSeq : undefined,
    streamPendingDeltas: streaming ? previous?.streamPendingDeltas : undefined,
    // 保留本地活动戳（delta 写入）；首见 STREAMING 不伪造 now，idle 回退 created_at
    streamLastActivityAt: streaming
      ? previous?.streamLastActivityAt
      : undefined,
  }
}

// ---------------------------------------------------------------------------
// 流式 delta 批处理 + REST 纠偏调度（模块级，跨 store action 共享）
// ---------------------------------------------------------------------------

const streamReconcileTimers = new Map<string, ReturnType<typeof setTimeout>>()
const streamReconcileCooldownUntil = new Map<string, number>()
const streamPreviewTimers = new Map<string, ReturnType<typeof setTimeout>>()

function streamReconcileKey(channelId: string, messageId: string): string {
  return `${channelId}\u0000${messageId}`
}

function scheduleStreamReconcile(channelId: string, messageId: string) {
  const key = streamReconcileKey(channelId, messageId)
  const cooldownUntil = streamReconcileCooldownUntil.get(key) ?? 0
  if (Date.now() < cooldownUntil) return
  if (streamReconcileTimers.has(key)) return
  const timer = setTimeout(() => {
    streamReconcileTimers.delete(key)
    streamReconcileCooldownUntil.set(key, Date.now() + STREAM_RECONCILE_COOLDOWN_MS)
    void useMessagesStore
      .getState()
      .reconcileStreamMessage(channelId, messageId)
      .catch(() => undefined)
  }, STREAM_RECONCILE_DEBOUNCE_MS)
  streamReconcileTimers.set(key, timer)
}

/** 私信侧栏预览：流式正文节流更新（避免每 token 写 private-channels） */
function scheduleStreamPreview(channelId: string, messageId: string) {
  const key = streamReconcileKey(channelId, messageId)
  if (streamPreviewTimers.has(key)) return
  const timer = setTimeout(() => {
    streamPreviewTimers.delete(key)
    const message = useMessagesStore
      .getState()
      .byChannel[channelId]?.messages.find((item) => item.id === messageId)
    if (!message) return
    void import("./private-channels").then(
      ({ isDmGuildId, usePrivateChannelsStore }) => {
        if (!isDmGuildId(message.guild_id)) return
        usePrivateChannelsStore.getState().noteMessage(channelId, {
          id: String(message.id),
          author_id: message.author_id,
          content: message.content ?? "",
          type: message.type,
          created_at: message.created_at,
        })
      }
    )
  }, STREAM_PREVIEW_THROTTLE_MS)
  streamPreviewTimers.set(key, timer)
}

function clearStreamReconcileSchedules() {
  for (const timer of streamReconcileTimers.values()) clearTimeout(timer)
  streamReconcileTimers.clear()
  streamReconcileCooldownUntil.clear()
  for (const timer of streamPreviewTimers.values()) clearTimeout(timer)
  streamPreviewTimers.clear()
}

/** 将批处理队列一次性写入 store（单次 set，减少重渲） */
function flushStreamDeltaBatches(
  batches: Map<
    string,
    Array<{
      channelId: string
      messageId: string
      seq: number
      delta: string
    }>
  >
) {
  const now = Date.now()
  const needReconcile: Array<{ channelId: string; messageId: string }> = []
  const needPreview: Array<{ channelId: string; messageId: string }> = []

  useMessagesStore.setState((state) => {
    let byChannel = state.byChannel
    let changed = false

    forEachStreamBatch(batches, (channelId, messageId, items) => {
      const channel = byChannel[channelId] ?? EMPTY_CHANNEL
      const index = channel.messages.findIndex((item) => item.id === messageId)
      if (index === -1) {
        // 本地尚无占位：防抖拉 REST（START 丢失 / 晚到）
        needReconcile.push({ channelId, messageId })
        return
      }
      const previous = channel.messages[index]
      // 已收束仍收到迟到 delta：忽略
      if (previous.stream_status !== "STREAMING") return

      const next = applyStreamDeltasBatch(previous, toSeqDeltas(items), now)
      if (!next) return

      if (byChannel === state.byChannel) {
        byChannel = { ...state.byChannel }
      }
      // 同一 channel 多次更新时基于最新 byChannel 切片
      const live = byChannel[channelId] ?? channel
      const messages = live.messages.slice()
      const liveIndex = messages.findIndex((item) => item.id === messageId)
      if (liveIndex === -1) return
      messages[liveIndex] = next
      byChannel[channelId] = { ...live, messages }
      changed = true

      needPreview.push({ channelId, messageId })
      if (shouldReconcileStreamGap(next)) {
        needReconcile.push({ channelId, messageId })
      }
    })

    if (!changed) return state
    return { byChannel }
  })

  for (const item of needPreview) {
    scheduleStreamPreview(item.channelId, item.messageId)
  }
  for (const item of needReconcile) {
    scheduleStreamReconcile(item.channelId, item.messageId)
  }
}

const streamDeltaBatcher = new StreamDeltaBatcher(flushStreamDeltaBatches)

/** REST 纠偏：normalize 服务端视图 + 与本地竞态安全合并 */
function mergeReconciledStream(
  previous: ChatMessage | undefined,
  remote: Message
): ChatMessage {
  const base = normalize(remote, previous)
  return mergeReconciledStreamMessage(previous, base)
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
      patchChannel(channelId, { loadingInitial: true, locked: false })
      try {
        const page = await listMessages(channelId, { limit: PAGE_SIZE })
        // 未读判定需要频道最新消息 ID（服务端降序返回，取最新的非 ephemeral，
        // 与服务端 last_message_id 排除口径一致，防本地 latest 指针超前漂移）
        const latestPublic = page.find((message) => !isEphemeralMessage(message))
        if (latestPublic) {
          useReadStatesStore
            .getState()
            .noteLatestMessage(channelId, latestPublic.guild_id, latestPublic.id)
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
                locked: false,
                reachedStart: page.length < PAGE_SIZE,
              },
            },
          }
        })
        // 用本页+缓存精确回写未读条数（离线多条未读不再卡在保底 1）
        syncUnreadCountFromCache(channelId)
      } catch (error) {
        if (error instanceof ApiError && error.code === "CHANNEL_LOCKED") {
          patchChannel(channelId, {
            loadingInitial: false,
            locked: true,
            loadedInitial: false,
          })
          return
        }
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
          const latestPublic = page.find(
            (message) => !isEphemeralMessage(message)
          )
          if (latestPublic) {
            useReadStatesStore
              .getState()
              .noteLatestMessage(
                channelId,
                latestPublic.guild_id,
                latestPublic.id
              )
          }
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
      // 流式终态会补发 MESSAGE_UPDATE；若本地从未处理 START（旧客户端/乱序），
      // 仅 update 会静默丢消息——改为不存在时 upsert。
      set((state) => {
        const channel = channelState(state, message.channel_id)
        const index = channel.messages.findIndex(
          (item) => item.id === message.id
        )
        if (index === -1) {
          const messages = mergeSorted(channel.messages, [message])
          let reachedStart = channel.reachedStart
          let nextMessages = messages
          if (nextMessages.length > CACHE_LIMIT) {
            nextMessages = nextMessages.slice(-CACHE_LIMIT)
            reachedStart = false
          }
          return {
            byChannel: {
              ...state.byChannel,
              [message.channel_id]: {
                ...channel,
                messages: nextMessages,
                reachedStart,
              },
            },
          }
        }
        const messages = channel.messages.slice()
        messages[index] = normalize(message, messages[index])
        return {
          byChannel: {
            ...state.byChannel,
            [message.channel_id]: { ...channel, messages },
          },
        }
      })
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

    // 流式占位：与 CREATE 同路径（按 id 幂等插入）；normalize 会打 streamLastActivityAt。
    applyMessageStreamStart: (message) => {
      get().applyMessageCreate({
        ...message,
        stream_status: message.stream_status || "STREAMING",
      })
    },

    applyMessageStreamDelta: (payload) => {
      const seq = Number(payload.seq)
      const delta = payload.delta ?? ""
      if (!Number.isFinite(seq) || seq < 1 || delta === "") return
      streamDeltaBatcher.enqueue({
        channelId: payload.channel_id,
        messageId: payload.id,
        seq,
        delta,
      })
    },

    applyMessageStreamEnd: (message) => {
      // 先冲刷未写出的 delta，再覆盖终态，避免末尾丢字
      streamDeltaBatcher.flushNow()
      get().applyMessageUpdate({
        ...message,
        stream_status: "",
      })
    },

    reconcileStreamMessage: async (channelId, messageId) => {
      // 请求前冲刷：尽量带上已到本地的 delta
      streamDeltaBatcher.flushNow()
      try {
        const remote = await getMessage(channelId, messageId)
        // 请求返回后再冲刷一次：合并往返期间到达的 delta，再与 REST 竞态合并
        streamDeltaBatcher.flushNow()
        const previous = get().byChannel[channelId]?.messages.find(
          (item) => item.id === messageId
        )
        const merged = mergeReconciledStream(previous, remote)
        set((state) => {
          const channel = channelState(state, channelId)
          const index = channel.messages.findIndex(
            (item) => item.id === messageId
          )
          if (index === -1) {
            let nextMessages = mergeSorted(channel.messages, [remote])
            nextMessages = nextMessages.map((item) =>
              item.id === messageId
                ? mergeReconciledStream(undefined, remote)
                : item
            )
            let reachedStart = channel.reachedStart
            if (nextMessages.length > CACHE_LIMIT) {
              nextMessages = nextMessages.slice(-CACHE_LIMIT)
              reachedStart = false
            }
            return {
              byChannel: {
                ...state.byChannel,
                [channelId]: {
                  ...channel,
                  messages: nextMessages,
                  reachedStart,
                },
              },
            }
          }
          const messages = channel.messages.slice()
          messages[index] = merged
          return {
            byChannel: {
              ...state.byChannel,
              [channelId]: { ...channel, messages },
            },
          }
        })
        // 纠偏后刷新私信预览（终态或累计正文）
        scheduleStreamPreview(channelId, messageId)
      } catch (error) {
        // 404：消息已删或不存在，静默
        if (
          isNotFound(error) ||
          (error instanceof ApiError && error.status === 404)
        ) {
          return
        }
        throw error
      }
    },

    reset: () => {
      streamDeltaBatcher.clear()
      clearStreamReconcileSchedules()
      // 按钮交互 pending 态随消息缓存一并清理（登出/切账号）
      void import("./interactions").then(({ useInteractionsStore }) => {
        useInteractionsStore.getState().reset()
      })
      set({ byChannel: {}, pendingByChannel: {}, typingByChannel: {} })
    },
  }
})
