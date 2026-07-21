// 频道 store：按 guild 分组缓存可见频道。

import { create } from "zustand"

import { listChannels, type ChannelReorderItem } from "~/lib/api/guilds"
import { isNotFound } from "~/lib/api/http"
import type { Channel } from "~/lib/api/types"
import { useReadStatesStore } from "./read-states"

/** 频道对象携带 last_message_id：喂给未读 store 恢复离线未读白点 */
function seedReadStates(channels: Channel[]) {
  useReadStatesStore.getState().seedFromChannels(channels)
}

type ChannelsState = {
  /** guildId → 频道列表（已按 position、名称排序） */
  byGuild: Record<string, Channel[]>
  loadingGuilds: Record<string, boolean>
  /** 404 时返回 null 并清缓存（服务器已不可见），由调用方决定跳转 */
  fetchChannels: (guildId: string) => Promise<Channel[] | null>
  /** 整体替换某服频道列表（READY 快照 / GUILD_CREATE 事件喂入） */
  setChannels: (guildId: string, channels: Channel[]) => void
  /** CHANNEL_CREATE / CHANNEL_UPDATE 增量维护 */
  upsertChannel: (channel: Channel) => void
  /**
   * 拖拽排序乐观写入：按 items 合并 position / parent_id，再全局重排。
   * 失败时由调用方 fetchChannels 回滚。
   */
  applyReorder: (guildId: string, items: ChannelReorderItem[]) => void
  removeChannel: (guildId: string, channelId: string) => void
  removeGuild: (guildId: string) => void
  reset: () => void
}

function sortChannels(channels: Channel[]): Channel[] {
  return channels
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name))
}

export const useChannelsStore = create<ChannelsState>()((set, get) => ({
  byGuild: {},
  loadingGuilds: {},

  fetchChannels: async (guildId) => {
    set((state) => ({ loadingGuilds: { ...state.loadingGuilds, [guildId]: true } }))
    try {
      const channels = sortChannels(await listChannels(guildId))
      set((state) => ({
        byGuild: { ...state.byGuild, [guildId]: channels },
        loadingGuilds: { ...state.loadingGuilds, [guildId]: false },
      }))
      seedReadStates(channels)
      return channels
    } catch (error) {
      set((state) => ({ loadingGuilds: { ...state.loadingGuilds, [guildId]: false } }))
      if (isNotFound(error)) {
        // 服务器不可见：清掉该服的频道缓存与服务器缓存（docs 03 的 404 语义）
        get().removeGuild(guildId)
        void import("./guilds").then((m) => m.useGuildsStore.getState().removeGuild(guildId))
        return null
      }
      throw error
    }
  },

  setChannels: (guildId, channels) => {
    set((state) => ({
      byGuild: { ...state.byGuild, [guildId]: sortChannels(channels) },
    }))
    seedReadStates(channels)
  },

  upsertChannel: (channel) => {
    seedReadStates([channel])
    set((state) => {
      const channels = state.byGuild[channel.guild_id]
      // 该服频道列表尚未加载：忽略增量（选中时会全量拉取）
      if (!channels) return state
      const next = channels.filter((item) => item.id !== channel.id)
      next.push(channel)
      return {
        byGuild: { ...state.byGuild, [channel.guild_id]: sortChannels(next) },
      }
    })
  },

  applyReorder: (guildId, items) =>
    set((state) => {
      const channels = state.byGuild[guildId]
      if (!channels?.length) return state
      const patch = new Map(items.map((item) => [item.id, item]))
      const next = channels.map((channel) => {
        const entry = patch.get(channel.id)
        if (!entry) return channel
        return {
          ...channel,
          position: entry.position,
          parent_id:
            entry.parent_id === undefined
              ? channel.parent_id
              : entry.parent_id,
        }
      })
      return { byGuild: { ...state.byGuild, [guildId]: sortChannels(next) } }
    }),

  removeChannel: (guildId, channelId) =>
    set((state) => {
      const channels = state.byGuild[guildId]
      if (!channels) return state
      return {
        byGuild: {
          ...state.byGuild,
          [guildId]: channels.filter((channel) => channel.id !== channelId),
        },
      }
    }),

  removeGuild: (guildId) =>
    set((state) => {
      const { [guildId]: _, ...rest } = state.byGuild
      return { byGuild: rest }
    }),

  reset: () => set({ byGuild: {}, loadingGuilds: {} }),
}))
