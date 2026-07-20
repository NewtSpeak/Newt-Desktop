// 成员 store：按 guild 分组缓存成员列表。

import { create } from "zustand"

import { listMembers } from "~/lib/api/guilds"
import { isNotFound } from "~/lib/api/http"
import type { GuildMember } from "~/lib/api/types"

type MembersState = {
  byGuild: Record<string, GuildMember[]>
  /** 404 时返回 null 并清缓存 */
  fetchMembers: (guildId: string) => Promise<GuildMember[] | null>
  removeGuild: (guildId: string) => void
  reset: () => void
}

export const useMembersStore = create<MembersState>()((set, get) => ({
  byGuild: {},

  fetchMembers: async (guildId) => {
    try {
      const members = await listMembers(guildId)
      set((state) => ({ byGuild: { ...state.byGuild, [guildId]: members } }))
      return members
    } catch (error) {
      if (isNotFound(error)) {
        get().removeGuild(guildId)
        return null
      }
      throw error
    }
  },

  removeGuild: (guildId) =>
    set((state) => {
      const { [guildId]: _, ...rest } = state.byGuild
      return { byGuild: rest }
    }),

  reset: () => set({ byGuild: {} }),
}))
