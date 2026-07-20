// 未读 / 提及计数 store（docs 15 §3.1 / §8.1）。
//
// 数据流：
//   - READY read_states 快照重建（服务端为准，防漂移 FR-05）；
//   - READ_STATE_UPDATE 定向事件对齐（本人他端 ack / 被提及计数增长，绝对值覆盖）；
//   - MESSAGE_CREATE 本地推进：跟踪每频道最新消息 ID（未读判定的另一半）、
//     自己发的消息自动已读、被提及本地乐观 +1（随后被服务端事件的绝对值覆盖）；
//   - ack 上报：本地立即推进 + 1s 节流调 POST /channels/:id/ack。
//
// 未读判定（FR-01）= 频道最新已知消息 ID > last_read_message_id（雪花字符串比较）。
// 频道对象（READY guilds 内嵌 / REST listChannels / CHANNEL_* 事件）携带
// last_message_id（无消息为 "0"），冷启动/重连后据此恢复离线期间的普通未读。

import { create } from "zustand"

import { ackChannel as apiAckChannel, ackGuild as apiAckGuild } from "~/lib/api/users"
import type { Channel, Message } from "~/lib/api/types"
import type { ReadStateUpdatePayload, ReadyReadState } from "~/lib/gateway/events"
import { compareSnowflake } from "~/lib/snowflake"

const ACK_THROTTLE_MS = 1_000

type ReadStatesState = {
  /** channelId → 本人已读游标（雪花字符串） */
  lastReadByChannel: Record<string, string>
  /** channelId → 未读提及数 */
  mentionsByChannel: Record<string, number>
  /** channelId → 已知最新消息 ID（MESSAGE_CREATE / 消息加载路径喂入） */
  latestByChannel: Record<string, string>
  /** channelId → guildId（服务器栏聚合用；READY 快照与消息事件喂入） */
  guildByChannel: Record<string, string>

  /** READY 快照：整体重建已读表（服务端为准） */
  applySnapshot: (states: ReadyReadState[], guildByChannel: Record<string, string>) => void
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

  /** 已读推进：本地立即生效 + 节流上报服务端 */
  ack: (channelId: string) => void
  /** 全服已读（Shift+Esc）：本地清零 + POST /guilds/:id/ack */
  ackGuild: (guildId: string) => void

  reset: () => void
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
    latestByChannel: {},
    guildByChannel: {},

    applySnapshot: (states, guildByChannel) =>
      set((state) => {
        const lastReadByChannel: Record<string, string> = {}
        const mentionsByChannel: Record<string, number> = {}
        const latestByChannel = { ...state.latestByChannel }
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
        }
        return {
          lastReadByChannel,
          mentionsByChannel,
          latestByChannel,
          guildByChannel: { ...state.guildByChannel, ...guildByChannel },
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
        return {
          mentionsByChannel: mentions,
          lastReadByChannel: { ...state.lastReadByChannel, [payload.channel_id]: advanced },
        }
      }),

    noteMessageCreate: (message, selfId, mentioned) =>
      set((state) => {
        const channelId = message.channel_id
        const next: Partial<ReadStatesState> = {
          latestByChannel: { ...state.latestByChannel, [channelId]: message.id },
          guildByChannel: message.guild_id
            ? { ...state.guildByChannel, [channelId]: message.guild_id }
            : state.guildByChannel,
        }
        if (selfId && message.author_id === selfId) {
          // 自己发的消息自动已读（本地推进即可；服务端游标由下一次 ack 对齐）
          next.lastReadByChannel = {
            ...state.lastReadByChannel,
            [channelId]: message.id,
          }
          if (state.mentionsByChannel[channelId]) {
            const mentions = { ...state.mentionsByChannel }
            delete mentions[channelId]
            next.mentionsByChannel = mentions
          }
        } else if (mentioned) {
          // 本地乐观 +1；服务端随后的 READ_STATE_UPDATE 会以绝对值覆盖
          next.mentionsByChannel = {
            ...state.mentionsByChannel,
            [channelId]: (state.mentionsByChannel[channelId] ?? 0) + 1,
          }
        }
        return next as ReadStatesState
      }),

    noteLatestMessage: (channelId, guildId, messageId) =>
      set((state) => {
        const current = state.latestByChannel[channelId]
        if (current && compareSnowflake(current, messageId) >= 0) return state
        return {
          latestByChannel: { ...state.latestByChannel, [channelId]: messageId },
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
        }
        return changed ? { latestByChannel, guildByChannel } : state
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
      // 已是最新且无提及：无事可做（避免空转请求）
      if (!hasMentions && lastRead && compareSnowflake(lastRead, latest) >= 0) return

      // 本地立即生效（白点/角标秒清），上报按 1s 节流合并
      set((current) => {
        const mentions = { ...current.mentionsByChannel }
        delete mentions[channelId]
        return {
          lastReadByChannel: { ...current.lastReadByChannel, [channelId]: latest },
          mentionsByChannel: mentions,
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
      // 本地：该服全部已知频道推进到最新并清提及
      set((state) => {
        const lastRead = { ...state.lastReadByChannel }
        const mentions = { ...state.mentionsByChannel }
        for (const [channelId, channelGuild] of Object.entries(state.guildByChannel)) {
          if (channelGuild !== guildId) continue
          const latest = state.latestByChannel[channelId]
          if (latest) lastRead[channelId] = latest
          delete mentions[channelId]
        }
        return { lastReadByChannel: lastRead, mentionsByChannel: mentions }
      })
      void apiAckGuild(guildId).catch(() => undefined)
    },

    reset: () => {
      for (const timer of Object.values(ackTimers)) clearTimeout(timer)
      for (const key of Object.keys(ackTimers)) delete ackTimers[key]
      set({
        lastReadByChannel: {},
        mentionsByChannel: {},
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
