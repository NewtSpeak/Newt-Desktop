// 未读 / 提及计数 store（docs 15 §3.1 / §8.1）。
//
// 数据流：
//   - READY read_states 快照重建（服务端为准，防漂移 FR-05）；
//   - READ_STATE_UPDATE 定向事件对齐（本人他端 ack / 被提及计数增长，绝对值覆盖）；
//   - MESSAGE_CREATE 本地推进：跟踪每频道最新消息 ID（未读判定的另一半）、
//     未读消息数 +1、自己发的消息自动已读、被提及本地乐观 +1；
//   - ack 上报：本地立即推进 + 1s 节流调 POST /channels/:id/ack。
//
// 未读判定（FR-01）= 频道最新已知消息 ID > last_read_message_id（雪花字符串比较）。
// 频道对象（READY guilds 内嵌 / REST listChannels / CHANNEL_* 事件）携带
// last_message_id（无消息为 "0"），冷启动/重连后据此恢复离线期间的普通未读。
// 未读条数：READY 快照提供精确值，在线 MESSAGE_CREATE 继续增量推进；
// 兼容旧服务端时，冷启动仅知「有未读」才保底为 1。

import { create } from "zustand"

import { ackChannel as apiAckChannel, ackGuild as apiAckGuild } from "~/lib/api/users"
import {
  isGroupDmSystemMessage,
  MESSAGE_TYPE_SYSTEM_ADMIN,
  type Channel,
  type Message,
} from "~/lib/api/types"
import type { ReadStateUpdatePayload, ReadyReadState } from "~/lib/gateway/events"
import { compareSnowflake } from "~/lib/snowflake"

const ACK_THROTTLE_MS = 1_000

type ReadStatesState = {
  /** channelId → 本人已读游标（雪花字符串） */
  lastReadByChannel: Record<string, string>
  /** channelId → 未读提及数 */
  mentionsByChannel: Record<string, number>
  /** channelId → 未读消息条数（频道列表红色数字胶囊；在线事件精确累加） */
  unreadCountByChannel: Record<string, number>
  /** channelId → 已知最新消息 ID（MESSAGE_CREATE / 消息加载路径喂入） */
  latestByChannel: Record<string, string>
  /** channelId → guildId（服务器栏聚合用；READY 快照与消息事件喂入） */
  guildByChannel: Record<string, string>

  /** READY 快照：整体重建已读表（服务端为准） */
  applySnapshot: (states: ReadyReadState[], guildByChannel: Record<string, string>) => void
  /** REST/READY 内嵌频道快照：只合并一个频道，不影响其他频道 */
  applyChannelSnapshot: (state: ReadyReadState, guildId: string) => void
  /** READ_STATE_UPDATE 事件：绝对值覆盖 */
  applyReadStateUpdate: (payload: ReadStateUpdatePayload) => void
  /** MESSAGE_CREATE：推进最新消息 ID；自己发的自动已读；被提及乐观 +1 */
  noteMessageCreate: (message: Message, selfId: string | undefined, mentioned: boolean) => void
  /** 消息加载路径喂入最新消息 ID（打开频道 / 补缺口后校正未读判定） */
  noteLatestMessage: (channelId: string, guildId: string, messageId: string) => void
  /** 频道对象播种 last_message_id（READY / listChannels / CHANNEL_* 事件路径） */
  seedFromChannels: (channels: Channel[]) => void
  /** 频道删除 / 不可见：清计数（docs 15 US-8 兜底） */
  removeChannel: (channelId: string) => void
  /**
   * 按消息缓存精确回写未读条数（MESSAGE_CREATE / 拉历史后调用）。
   * count≤0 时清除；用于修正「只保底 1」或累加漂移。
   */
  setUnreadCountExact: (channelId: string, count: number) => void

  /** 已读推进：本地立即生效 + 节流上报服务端 */
  ack: (channelId: string) => void
  /** 全服已读（Shift+Esc）：本地清零 + POST /guilds/:id/ack */
  ackGuild: (guildId: string) => void

  reset: () => void
}

/** 是否系统管理员临场消息（不走「自己发的自动已读」） */
export function isSystemAdminMessageType(type: string | undefined): boolean {
  return type === MESSAGE_TYPE_SYSTEM_ADMIN
}

/** 统计 messageIds 中严格晚于 lastRead 的条数 */
export function countIdsAfterLastRead(
  lastRead: string | undefined,
  messageIds: Iterable<string>,
): number {
  let count = 0
  for (const id of messageIds) {
    const messageId = String(id)
    if (!messageId) continue
    if (!lastRead || compareSnowflake(messageId, lastRead) > 0) count += 1
  }
  return count
}

/** 频道是否未读（不含提及语义） */
export function isChannelUnread(
  state: Pick<ReadStatesState, "lastReadByChannel" | "latestByChannel">,
  channelId: string,
): boolean {
  const latest = state.latestByChannel[channelId]
  if (!latest) return false
  const lastRead = state.lastReadByChannel[channelId]
  if (!lastRead) return true
  return compareSnowflake(latest, lastRead) > 0
}

/** 未读角标数字：超过 9999 显示 9999+ */
export function formatUnreadBadge(count: number): string {
  if (count > 9999) return "9999+"
  return String(count)
}

/** 频道未读消息条数（用于列表红色胶囊） */
export function channelUnreadCount(
  state: Pick<ReadStatesState, "unreadCountByChannel" | "lastReadByChannel" | "latestByChannel">,
  channelId: string,
): number {
  if (Object.hasOwn(state.unreadCountByChannel, channelId)) {
    return state.unreadCountByChannel[channelId] ?? 0
  }
  // 冷启动/仅 last_message_id 播种：知有未读但无精确条数 → 保底 1
  return isChannelUnread(state, channelId) ? 1 : 0
}

// ack 节流状态（模块级，不进 store）
const lastAckAt: Record<string, number> = {}
const ackTimers: Record<string, ReturnType<typeof setTimeout>> = {}

export const useReadStatesStore = create<ReadStatesState>()((set, get) => {
  /** 发送 ack 到服务端（取当下最新已知消息 ID） */
  const sendAck = (channelId: string) => {
    const latest = get().latestByChannel[channelId]
    if (!latest) return
    lastAckAt[channelId] = Date.now()
    void apiAckChannel(channelId, latest).catch(() => {
      // 失败不回滚本地状态：下次滚动/切频会再次尝试，服务端游标只前进不后退
    })
  }

  return {
    lastReadByChannel: {},
    mentionsByChannel: {},
    unreadCountByChannel: {},
    latestByChannel: {},
    guildByChannel: {},

    applySnapshot: (states, guildByChannel) =>
      set((state) => {
        const lastReadByChannel: Record<string, string> = {}
        const mentionsByChannel: Record<string, number> = {}
        const latestByChannel = { ...state.latestByChannel }
        const prevUnread = state.unreadCountByChannel
        const snapshotUnreadByChannel: Record<string, number> = {}
        for (const entry of states) {
          lastReadByChannel[entry.channel_id] = entry.last_read_message_id
          if (entry.mention_count > 0) {
            mentionsByChannel[entry.channel_id] = entry.mention_count
          }
          // 快照条目携带频道最新消息 ID：恢复离线期间的普通未读
          if (entry.last_message_id && entry.last_message_id !== "0") {
            const current = latestByChannel[entry.channel_id]
            if (!current || compareSnowflake(entry.last_message_id, current) > 0) {
              latestByChannel[entry.channel_id] = entry.last_message_id
            }
          }
          if (
            typeof entry.unread_count === "number" &&
            Number.isSafeInteger(entry.unread_count) &&
            entry.unread_count >= 0
          ) {
            snapshotUnreadByChannel[entry.channel_id] = entry.unread_count
          }
        }
        // READY 的 unread_count 是服务端权威快照；旧服务端不带该字段时才保留
        // 本地在线计数或退化为 1。
        const unreadCountByChannel: Record<string, number> = {}
        const mergedGuild = { ...state.guildByChannel, ...guildByChannel }
        const channelIds = new Set([
          ...Object.keys(latestByChannel),
          ...Object.keys(lastReadByChannel),
          ...Object.keys(prevUnread),
        ])
        for (const channelId of channelIds) {
          if (Object.hasOwn(snapshotUnreadByChannel, channelId)) {
            unreadCountByChannel[channelId] = snapshotUnreadByChannel[channelId]
            continue
          }
          const probe = { lastReadByChannel, latestByChannel, unreadCountByChannel: {} }
          if (!isChannelUnread(probe, channelId)) continue
          const prev = prevUnread[channelId] ?? 0
          unreadCountByChannel[channelId] = prev > 0 ? prev : 1
        }
        return {
          lastReadByChannel,
          mentionsByChannel,
          unreadCountByChannel,
          latestByChannel,
          guildByChannel: mergedGuild,
        }
      }),

    applyChannelSnapshot: (entry, guildId) =>
      set((state) => {
        const channelId = entry.channel_id
        if (!channelId) return state

        const incomingRead = entry.last_read_message_id || "0"
        const currentRead = state.lastReadByChannel[channelId]
        const mergedRead =
          !currentRead || compareSnowflake(incomingRead, currentRead) > 0
            ? incomingRead
            : currentRead
        const incomingLatest = entry.last_message_id
        const currentLatest = state.latestByChannel[channelId]
        const mergedLatest =
          incomingLatest &&
          (!currentLatest || compareSnowflake(incomingLatest, currentLatest) > 0)
            ? incomingLatest
            : currentLatest

        const lastReadByChannel = {
          ...state.lastReadByChannel,
          [channelId]: mergedRead,
        }
        const latestByChannel = { ...state.latestByChannel }
        if (mergedLatest && mergedLatest !== "0") {
          latestByChannel[channelId] = mergedLatest
        }
        const guildByChannel = {
          ...state.guildByChannel,
          [channelId]: guildId,
        }

        // REST refresh 可能晚于 MESSAGE_CREATE/本地 ack 返回。只有快照的消息头和
        // 已读游标都不落后于本地时，才允许其绝对计数覆盖，防止已清零角标复活。
        const latestNotStale =
          !currentLatest ||
          (Boolean(incomingLatest) &&
            compareSnowflake(incomingLatest!, currentLatest) >= 0)
        const readNotStale =
          !currentRead || compareSnowflake(incomingRead, currentRead) >= 0
        const exactCountValid =
          typeof entry.unread_count === "number" &&
          Number.isSafeInteger(entry.unread_count) &&
          entry.unread_count >= 0
        const exactMentionValid =
          typeof entry.mention_count === "number" &&
          Number.isSafeInteger(entry.mention_count) &&
          entry.mention_count >= 0

        const unreadCountByChannel = { ...state.unreadCountByChannel }
        const mentionsByChannel = { ...state.mentionsByChannel }
        if (latestNotStale && readNotStale && exactCountValid) {
          // 显式保留 0；否则 last_message > last_read 时会再次退化成保底 1。
          unreadCountByChannel[channelId] = entry.unread_count!
        } else if (!Object.hasOwn(unreadCountByChannel, channelId)) {
          const probe = { lastReadByChannel, latestByChannel }
          if (isChannelUnread(probe, channelId)) unreadCountByChannel[channelId] = 1
        }
        if (latestNotStale && readNotStale && exactMentionValid) {
          if (entry.mention_count! > 0) {
            mentionsByChannel[channelId] = entry.mention_count!
          } else {
            delete mentionsByChannel[channelId]
          }
        }

        return {
          lastReadByChannel,
          latestByChannel,
          guildByChannel,
          unreadCountByChannel,
          mentionsByChannel,
        }
      }),

    applyReadStateUpdate: (payload) =>
      set((state) => {
        const mentions = { ...state.mentionsByChannel }
        if (payload.mention_count > 0) mentions[payload.channel_id] = payload.mention_count
        else delete mentions[payload.channel_id]
        // 游标只前进不后退（与服务端 GREATEST 语义一致，防乱序事件回退）
        const current = state.lastReadByChannel[payload.channel_id]
        const advanced =
          !current || compareSnowflake(payload.last_read_message_id, current) > 0
            ? payload.last_read_message_id
            : current
        const lastReadByChannel = {
          ...state.lastReadByChannel,
          [payload.channel_id]: advanced,
        }
        const unreadCountByChannel = { ...state.unreadCountByChannel }
        // 他端/本端 ack 推进到最新后清未读条数
        const latest = state.latestByChannel[payload.channel_id]
        if (!latest || compareSnowflake(advanced, latest) >= 0) {
          delete unreadCountByChannel[payload.channel_id]
        }
        return {
          mentionsByChannel: mentions,
          lastReadByChannel,
          unreadCountByChannel,
        }
      }),

    noteMessageCreate: (message, selfId, mentioned) => {
      // 自己发的消息：set 结束后强制 ack 服务端（避免本地已追上时 ack() 短路，
      // 刷新后 READY 仍把本人消息算未读）。服务端 createMessage 也会自动推进；
      // 再 ack 一次幂等（GREATEST 只前进），兼容旧服务端。
      const ownAck: { current?: { channelId: string; messageId: string } } = {}

      set((state) => {
        const channelId = String(message.channel_id)
        const messageId = String(message.id)
        if (!channelId || !messageId) return state

        const prevLatest = state.latestByChannel[channelId]
        const latestByChannel = {
          ...state.latestByChannel,
          // 最新 ID 只前进不后退（防乱序 DISPATCH）
          [channelId]:
            !prevLatest || compareSnowflake(messageId, prevLatest) > 0
              ? messageId
              : prevLatest,
        }
        // 私信 guild_id 为零 UUID：映射到 @me，便于 Home 聚合未读
        const zeroGuild = "00000000-0000-0000-0000-000000000000"
        const rawGuild = message.guild_id ? String(message.guild_id) : ""
        const mappedGuild =
          !rawGuild || rawGuild === zeroGuild ? "@me" : rawGuild
        const next: Partial<ReadStatesState> = {
          latestByChannel,
          guildByChannel: {
            ...state.guildByChannel,
            [channelId]: mappedGuild,
          },
        }
        // 普通消息：自己发的自动已读。系统管理员临场发言（SYSTEM_ADMIN，后台控制台
        // PostAsUser）虽 author_id 为本人，但对客户端是「广播公告」语义——须照常
        // 点亮频道/服务器未读，等打开频道或滚到底部再 ack（与 docs 15 FR-01/FR-02 对齐）。
        const isOwnComposerMessage =
          Boolean(selfId) &&
          message.author_id === selfId &&
          !isSystemAdminMessageType(message.type)
        // 群组私信系统灰条：只更新 latest，不计未读/提及
        const isGreySystem = isGroupDmSystemMessage(message.type)
        if (isOwnComposerMessage) {
          next.lastReadByChannel = {
            ...state.lastReadByChannel,
            [channelId]: messageId,
          }
          const mentions = { ...state.mentionsByChannel }
          delete mentions[channelId]
          next.mentionsByChannel = mentions
          const unread = { ...state.unreadCountByChannel }
          delete unread[channelId]
          next.unreadCountByChannel = unread
          ownAck.current = { channelId, messageId }
        } else if (isGreySystem) {
          // 灰条：若此前已读完（lastRead 已追上旧 latest），同步推进 last_read，避免白点被点亮
          const lastRead = state.lastReadByChannel[channelId]
          if (
            !prevLatest ||
            !lastRead ||
            compareSnowflake(lastRead, prevLatest) >= 0
          ) {
            next.lastReadByChannel = {
              ...state.lastReadByChannel,
              [channelId]: messageId,
            }
          }
        } else {
          // 仅当本条严格新于 last_read、且严格新于此前 latest 时 +1
          const lastRead = state.lastReadByChannel[channelId]
          const afterRead = !lastRead || compareSnowflake(messageId, lastRead) > 0
          const isNewHead = !prevLatest || compareSnowflake(messageId, prevLatest) > 0
          if (afterRead && isNewHead) {
            next.unreadCountByChannel = {
              ...state.unreadCountByChannel,
              [channelId]: (state.unreadCountByChannel[channelId] ?? 0) + 1,
            }
          }
          if (mentioned) {
            next.mentionsByChannel = {
              ...state.mentionsByChannel,
              [channelId]: (state.mentionsByChannel[channelId] ?? 0) + 1,
            }
          }
        }
        return next as ReadStatesState
      })

      if (ownAck.current) {
        apiAckChannel(ownAck.current.channelId, ownAck.current.messageId).catch(
          () => undefined,
        )
      }
    },

    setUnreadCountExact: (channelId, count) =>
      set((state) => {
        const unreadCountByChannel = { ...state.unreadCountByChannel }
        if (count <= 0) delete unreadCountByChannel[channelId]
        else unreadCountByChannel[channelId] = count
        return { unreadCountByChannel }
      }),

    noteLatestMessage: (channelId, guildId, messageId) =>
      set((state) => {
        const current = state.latestByChannel[channelId]
        if (current && compareSnowflake(current, messageId) >= 0) return state
        // 仅校正最新 ID，不改未读条数（历史加载/补缺口路径，条数由 MESSAGE_CREATE 维护）
        const latestByChannel = { ...state.latestByChannel, [channelId]: messageId }
        const lastRead = state.lastReadByChannel[channelId]
        const unreadCountByChannel = { ...state.unreadCountByChannel }
        if (
          lastRead &&
          compareSnowflake(messageId, lastRead) > 0 &&
          !Object.hasOwn(unreadCountByChannel, channelId)
        ) {
          unreadCountByChannel[channelId] = 1
        }
        return {
          latestByChannel,
          unreadCountByChannel,
          guildByChannel: guildId
            ? { ...state.guildByChannel, [channelId]: guildId }
            : state.guildByChannel,
        }
      }),

    seedFromChannels: (channels) =>
      set((state) => {
        let changed = false
        const latestByChannel = { ...state.latestByChannel }
        const guildByChannel = { ...state.guildByChannel }
        const unreadCountByChannel = { ...state.unreadCountByChannel }
        for (const channel of channels) {
          if (channel.guild_id && guildByChannel[channel.id] !== channel.guild_id) {
            guildByChannel[channel.id] = channel.guild_id
            changed = true
          }
          const latest = channel.last_message_id
          if (!latest || latest === "0") continue
          const current = latestByChannel[channel.id]
          if (!current || compareSnowflake(latest, current) > 0) {
            latestByChannel[channel.id] = latest
            changed = true
          }
          // 有 last_message 且超过 last_read、尚无计数 → 保底 1，便于冷启动显示红色数字
          const lastRead = state.lastReadByChannel[channel.id]
          if (
            (!lastRead || compareSnowflake(latest, lastRead) > 0) &&
            !Object.hasOwn(unreadCountByChannel, channel.id)
          ) {
            unreadCountByChannel[channel.id] = 1
            changed = true
          }
        }
        return changed ? { latestByChannel, guildByChannel, unreadCountByChannel } : state
      }),

    removeChannel: (channelId) =>
      set((state) => {
        const omit = <T>(record: Record<string, T>): Record<string, T> => {
          const { [channelId]: _, ...rest } = record
          return rest
        }
        return {
          lastReadByChannel: omit(state.lastReadByChannel),
          mentionsByChannel: omit(state.mentionsByChannel),
          unreadCountByChannel: omit(state.unreadCountByChannel),
          latestByChannel: omit(state.latestByChannel),
          guildByChannel: omit(state.guildByChannel),
        }
      }),

    ack: (channelId) => {
      const state = get()
      const latest = state.latestByChannel[channelId]
      if (!latest) return
      const lastRead = state.lastReadByChannel[channelId]
      const hasMentions = (state.mentionsByChannel[channelId] ?? 0) > 0
      const hasUnread = (state.unreadCountByChannel[channelId] ?? 0) > 0
      // 已是最新且无提及/未读：无事可做（避免空转请求）
      if (!hasMentions && !hasUnread && lastRead && compareSnowflake(lastRead, latest) >= 0) return

      // 本地立即生效（白点/角标秒清），上报按 1s 节流合并
      set((current) => {
        const mentions = { ...current.mentionsByChannel }
        delete mentions[channelId]
        const unread = { ...current.unreadCountByChannel }
        delete unread[channelId]
        return {
          lastReadByChannel: { ...current.lastReadByChannel, [channelId]: latest },
          mentionsByChannel: mentions,
          unreadCountByChannel: unread,
        }
      })

      const elapsed = Date.now() - (lastAckAt[channelId] ?? 0)
      if (elapsed >= ACK_THROTTLE_MS) {
        sendAck(channelId)
      } else if (!ackTimers[channelId]) {
        ackTimers[channelId] = setTimeout(() => {
          delete ackTimers[channelId]
          sendAck(channelId)
        }, ACK_THROTTLE_MS - elapsed)
      }
    },

    ackGuild: (guildId) => {
      // 本地：该服全部已知频道推进到最新并清提及/未读条数
      set((state) => {
        const lastRead = { ...state.lastReadByChannel }
        const mentions = { ...state.mentionsByChannel }
        const unread = { ...state.unreadCountByChannel }
        for (const [channelId, channelGuild] of Object.entries(state.guildByChannel)) {
          if (channelGuild !== guildId) continue
          const latest = state.latestByChannel[channelId]
          if (latest) lastRead[channelId] = latest
          delete mentions[channelId]
          delete unread[channelId]
        }
        return {
          lastReadByChannel: lastRead,
          mentionsByChannel: mentions,
          unreadCountByChannel: unread,
        }
      })
      void apiAckGuild(guildId).catch(() => undefined)
    },

    reset: () => {
      for (const timer of Object.values(ackTimers)) clearTimeout(timer)
      for (const key of Object.keys(ackTimers)) delete ackTimers[key]
      set({
        lastReadByChannel: {},
        mentionsByChannel: {},
        unreadCountByChannel: {},
        latestByChannel: {},
        guildByChannel: {},
      })
    },
  }
})

/** 消息是否提及本人（直接 @、角色 @ 含本人角色、@everyone/@here） */
export function messageMentionsSelf(
  message: Message,
  selfId: string | undefined,
  selfRoleIds: string[] | undefined,
): boolean {
  if (!selfId || message.author_id === selfId) return false
  if (message.mention_everyone) return true
  if (message.mentions?.includes(selfId)) return true
  if (selfRoleIds?.length && message.mention_roles?.length) {
    return message.mention_roles.some((roleId) => selfRoleIds.includes(roleId))
  }
  return false
}
