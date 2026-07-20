// 频道 store：按 guild 分组缓存可见频道。

import { create } from "zustand"

import { listChannels } from "~/lib/api/guilds"
import { isNotFound } from "~/lib/api/http"
import type { Channel } from "~/lib/api/types"

type ChannelsState = {
  /** guildId → 频道列表（已按 position、名称排序） */
  byGuild: Record<string, Channel[]>
  loadingGuilds: Record<string, boolean>
  /** 404 时返回 null 并清缓存（服务器已不可见），由调用方决定跳转 */
  fetchChannels: (guildId: string) => Promise<Channel[] | null>
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
