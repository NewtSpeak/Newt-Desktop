// 服务器列表 store。

import { create } from "zustand"

import { listMyGuilds } from "~/lib/api/guilds"
import type { Guild, GuildBanner } from "~/lib/api/types"

type GuildsState = {
  guilds: Guild[]
  loaded: boolean
  loading: boolean
  fetchGuilds: () => Promise<Guild[]>
  /**
   * 合并写入服务器：字段浅合并；banners 仅在显式传入时整体替换
   *（GUILD_UPDATE 其他变更不带 banners 字段，需保留本地列表）。
   */
  upsertGuild: (guild: Guild, options?: { banners?: GuildBanner[] }) => void
  /** 404 语义：资源不可见即从缓存移除 */
  removeGuild: (guildId: string) => void
  reset: () => void
}

function mergeGuild(
  prev: Guild | undefined,
  incoming: Guild,
  banners?: GuildBanner[]
): Guild {
  const base = prev ? { ...prev, ...incoming } : { ...incoming }
  if (banners !== undefined) {
    base.banners = banners
  } else if (incoming.banners !== undefined) {
    base.banners = incoming.banners
  } else if (prev?.banners !== undefined) {
    base.banners = prev.banners
  }
  return base
}

export const useGuildsStore = create<GuildsState>()((set, get) => ({
  guilds: [],
  loaded: false,
  loading: false,

  fetchGuilds: async () => {
    set({ loading: true })
    try {
      const guilds = await listMyGuilds()
      // REST 列表已含 banners；与现有缓存合并，避免并发 WS 写入被整表覆盖丢字段
      set((state) => {
        const byId = new Map(state.guilds.map((g) => [g.id, g]))
        const next = guilds.map((g) => mergeGuild(byId.get(g.id), g))
        return { guilds: next, loaded: true, loading: false }
      })
      return get().guilds
    } catch (error) {
      set({ loading: false })
      throw error
    }
  },

  upsertGuild: (guild, options) =>
    set((state) => {
      const index = state.guilds.findIndex((item) => item.id === guild.id)
      if (index === -1) {
        return {
          guilds: [mergeGuild(undefined, guild, options?.banners), ...state.guilds],
        }
      }
      const next = state.guilds.slice()
      next[index] = mergeGuild(state.guilds[index], guild, options?.banners)
      return { guilds: next }
    }),

  removeGuild: (guildId) =>
    set((state) => ({ guilds: state.guilds.filter((item) => item.id !== guildId) })),

  reset: () => set({ guilds: [], loaded: false, loading: false }),
}))
