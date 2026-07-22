// 成员 store：按 guild 分组缓存成员列表。

import { create } from "zustand"

import { listMembers } from "~/lib/api/guilds"
import { isNotFound } from "~/lib/api/http"
import type { GuildMember } from "~/lib/api/types"
import { reconcileList } from "~/lib/reconcile-list"

/** USER_UPDATE 带来的全局资料片段（按 user_id 合并进各服缓存） */
export type MemberProfilePatch = {
  username?: string
  display_name?: string
  avatar_url?: string
  avatar_animated?: boolean
  banner_url?: string
  bio?: string
}

type MembersState = {
  byGuild: Record<string, GuildMember[]>
  /** 404 时返回 null 并清缓存 */
  fetchMembers: (guildId: string) => Promise<GuildMember[] | null>
  /** GUILD_MEMBER_ADD / UPDATE 增量维护（按 user_id 合并） */
  upsertMember: (guildId: string, member: Partial<GuildMember> & { user_id: string }) => void
  /** USER_UPDATE：跨服更新该用户的全局展示字段 */
  applyUserProfile: (userId: string, profile: MemberProfilePatch) => void
  /** GUILD_MEMBER_REMOVE */
  removeMember: (guildId: string, userId: string) => void
  removeGuild: (guildId: string) => void
  reset: () => void
}

const fetchesByGuild = new Map<string, Promise<GuildMember[] | null>>()

function sameRoleIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((roleId) => b.includes(roleId))
}

function sameMember(a: GuildMember, b: GuildMember): boolean {
  return (
    a.id === b.id &&
    a.user_id === b.user_id &&
    a.username === b.username &&
    a.display_name === b.display_name &&
    a.nickname === b.nickname &&
    a.avatar_url === b.avatar_url &&
    a.avatar_animated === b.avatar_animated &&
    a.banner_url === b.banner_url &&
    a.bio === b.bio &&
    a.is_owner === b.is_owner &&
    sameRoleIds(a.role_ids, b.role_ids) &&
    (a.name_style_role_id ?? null) === (b.name_style_role_id ?? null)
  )
}

export const useMembersStore = create<MembersState>()((set, get) => ({
  byGuild: {},

  fetchMembers: (guildId) => {
    const active = fetchesByGuild.get(guildId)
    if (active) return active

    const request = (async () => {
      try {
        const members = await listMembers(guildId)
        set((state) => {
          const previous = state.byGuild[guildId]
          const next = reconcileList(
            previous,
            members,
            (member) => member.user_id,
            sameMember
          )
          if (next === previous) return state
          return { byGuild: { ...state.byGuild, [guildId]: next } }
        })
        return get().byGuild[guildId] ?? members
      } catch (error) {
        if (isNotFound(error)) {
          get().removeGuild(guildId)
          return null
        }
        throw error
      } finally {
        fetchesByGuild.delete(guildId)
      }
    })()

    fetchesByGuild.set(guildId, request)
    return request
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
          display_name: member.display_name ?? "",
          nickname: member.nickname ?? "",
          avatar_url: member.avatar_url ?? "",
          avatar_animated: member.avatar_animated ?? false,
          banner_url: member.banner_url ?? "",
          bio: member.bio ?? "",
          is_owner: member.is_owner ?? false,
          role_ids: member.role_ids ?? [],
        })
      } else {
        next[index] = { ...next[index], ...member }
      }
      return { byGuild: { ...state.byGuild, [guildId]: next } }
    }),

  applyUserProfile: (userId, profile) =>
    set((state) => {
      let changed = false
      const byGuild: Record<string, GuildMember[]> = {}
      for (const [guildId, members] of Object.entries(state.byGuild)) {
        let guildChanged = false
        const next = members.map((member) => {
          if (member.user_id !== userId) return member
          guildChanged = true
          return {
            ...member,
            ...(profile.username !== undefined ? { username: profile.username } : {}),
            ...(profile.display_name !== undefined
              ? { display_name: profile.display_name }
              : {}),
            ...(profile.avatar_url !== undefined ? { avatar_url: profile.avatar_url } : {}),
            ...(profile.avatar_animated !== undefined
              ? { avatar_animated: profile.avatar_animated }
              : {}),
            ...(profile.banner_url !== undefined ? { banner_url: profile.banner_url } : {}),
            ...(profile.bio !== undefined ? { bio: profile.bio } : {}),
          }
        })
        byGuild[guildId] = guildChanged ? next : members
        if (guildChanged) changed = true
      }
      return changed ? { byGuild } : state
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
