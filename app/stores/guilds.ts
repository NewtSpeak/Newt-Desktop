// 服务器列表 store。

import { create } from "zustand"

import { listMyGuilds } from "~/lib/api/guilds"
import type { Guild } from "~/lib/api/types"

type GuildsState = {
  guilds: Guild[]
  loaded: boolean
  loading: boolean
  fetchGuilds: () => Promise<Guild[]>
  upsertGuild: (guild: Guild) => void
  /** 404 语义：资源不可见即从缓存移除 */
  removeGuild: (guildId: string) => void
  reset: () => void
}

export const useGuildsStore = create<GuildsState>()((set, get) => ({
  guilds: [],
  loaded: false,
  loading: false,

  fetchGuilds: async () => {
    set({ loading: true })
    try {
      const guilds = await listMyGuilds()
      set({ guilds, loaded: true, loading: false })
      return guilds
    } catch (error) {
      set({ loading: false })
      throw error
    }
  },

  upsertGuild: (guild) =>
    set((state) => {
      const index = state.guilds.findIndex((item) => item.id === guild.id)
      if (index === -1) return { guilds: [guild, ...state.guilds] }
      const next = state.guilds.slice()
      next[index] = guild
      return { guilds: next }
    }),

  removeGuild: (guildId) =>
    set((state) => ({ guilds: state.guilds.filter((item) => item.id !== guildId) })),

  reset: () => set({ guilds: [], loaded: false, loading: false }),
}))
