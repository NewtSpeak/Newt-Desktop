// 成员 store：按 guild 分组缓存成员列表。

import { create } from "zustand"

import { listMembers } from "~/lib/api/guilds"
import { isNotFound } from "~/lib/api/http"
import type { GuildMember } from "~/lib/api/types"

type MembersState = {
  byGuild: Record<string, GuildMember[]>
  /** 404 时返回 null 并清缓存 */
  fetchMembers: (guildId: string) => Promise<GuildMember[] | null>
  /** GUILD_MEMBER_ADD / UPDATE 增量维护（按 user_id 合并） */
  upsertMember: (guildId: string, member: Partial<GuildMember> & { user_id: string }) => void
  /** GUILD_MEMBER_REMOVE */
  removeMember: (guildId: string, userId: string) => void
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

  upsertMember: (guildId, member) =>
    set((state) => {
      const members = state.byGuild[guildId]
      // 尚未加载该服成员：忽略增量（选中时会全量拉取）
      if (!members) return state
      const index = members.findIndex((item) => item.user_id === member.user_id)
      const next = members.slice()
      if (index === -1) {
        next.push({
          id: member.id ?? member.user_id,
          user_id: member.user_id,
          username: member.username ?? "",
          nickname: member.nickname ?? "",
          is_owner: member.is_owner ?? false,
          role_ids: member.role_ids ?? [],
        })
      } else {
        next[index] = { ...next[index], ...member }
      }
      return { byGuild: { ...state.byGuild, [guildId]: next } }
    }),

  removeMember: (guildId, userId) =>
    set((state) => {
      const members = state.byGuild[guildId]
      if (!members) return state
      return {
        byGuild: {
          ...state.byGuild,
          [guildId]: members.filter((item) => item.user_id !== userId),
        },
      }
    }),

  removeGuild: (guildId) =>
    set((state) => {
      const { [guildId]: _, ...rest } = state.byGuild
      return { byGuild: rest }
    }),

  reset: () => set({ byGuild: {} }),
}))
