// 服务器列表 store（支持多账号：按 account_id 合并并存）。

import { create } from "zustand"

import { listMyGuilds } from "~/lib/api/guilds"
import { getActiveAccountId } from "~/lib/api/http"
import type { Guild, GuildBanner } from "~/lib/api/types"

type GuildsState = {
  guilds: Guild[]
  loaded: boolean
  loading: boolean
  /** 拉取当前激活账号的服务器，与其他账号的缓存合并 */
  fetchGuilds: () => Promise<Guild[]>
  /**
   * 合并写入服务器：字段浅合并；banners 仅在显式传入时整体替换
   *（GUILD_UPDATE 其他变更不带 banners 字段，需保留本地列表）。
   * 匹配键：同 id + 同 account_id（多账号可各自持有同一 snowflake）。
   */
  upsertGuild: (guild: Guild, options?: { banners?: GuildBanner[] }) => void
  /** 404 语义：资源不可见即从缓存移除（当前激活账号上下文） */
  removeGuild: (guildId: string, accountId?: string | null) => void
  /** 移除某账号下全部服务器（退出该账号时） */
  removeAccountGuilds: (accountId: string) => void
  reset: () => void
}

function guildKey(guild: Pick<Guild, "id" | "account_id">): string {
  return `${guild.account_id ?? ""}:${guild.id}`
}

function mergeGuild(
  prev: Guild | undefined,
  incoming: Guild,
  banners?: GuildBanner[],
): Guild {
  const base = prev ? { ...prev, ...incoming } : { ...incoming }
  // 保留 account_id（incoming 未带时）
  if (!base.account_id && prev?.account_id) base.account_id = prev.account_id
  if (banners !== undefined) {
    base.banners = banners
  } else if (incoming.banners !== undefined) {
    base.banners = incoming.banners
  } else if (prev?.banners !== undefined) {
    base.banners = prev.banners
  }
  return base
}

function findIndex(
  guilds: Guild[],
  guildId: string,
  accountId?: string | null,
): number {
  if (accountId) {
    return guilds.findIndex(
      (item) => item.id === guildId && item.account_id === accountId,
    )
  }
  // 未指定账号：优先当前激活账号，否则第一个匹配 id
  const active = getActiveAccountId()
  if (active) {
    const idx = guilds.findIndex(
      (item) => item.id === guildId && item.account_id === active,
    )
    if (idx !== -1) return idx
  }
  return guilds.findIndex((item) => item.id === guildId)
}

export const useGuildsStore = create<GuildsState>()((set, get) => ({
  guilds: [],
  loaded: false,
  loading: false,

  fetchGuilds: async () => {
    set({ loading: true })
    try {
      const accountId = getActiveAccountId() ?? undefined
      const guilds = await listMyGuilds()
      const tagged = guilds.map((g) =>
        accountId ? { ...g, account_id: accountId } : g,
      )
      set((state) => {
        // 保持原有列表顺序：就地更新当前账号的服，去掉已退出的，新服追加到末尾。
        // 其他账号的服位置完全不动（多账号切换服务器时不重排）。
        const byKey = new Map(tagged.map((g) => [guildKey(g), g]))
        const seen = new Set<string>()
        const next: Guild[] = []

        for (const existing of state.guilds) {
          const isCurrentAccount = accountId
            ? existing.account_id === accountId
            : !existing.account_id
          if (isCurrentAccount) {
            const key = guildKey(existing)
            const incoming = byKey.get(key)
            if (incoming) {
              next.push(mergeGuild(existing, incoming))
              seen.add(key)
            }
            // 当前账号已退出的服：丢弃
          } else {
            next.push(existing)
          }
        }

        for (const g of tagged) {
          const key = guildKey(g)
          if (seen.has(key)) continue
          next.push(mergeGuild(undefined, g))
        }

        return {
          guilds: next,
          loaded: true,
          loading: false,
        }
      })
      return get().guilds
    } catch (error) {
      set({ loading: false })
      throw error
    }
  },

  upsertGuild: (guild, options) =>
    set((state) => {
      const accountId = guild.account_id ?? getActiveAccountId() ?? undefined
      const incoming = accountId ? { ...guild, account_id: accountId } : guild
      const index = findIndex(state.guilds, incoming.id, incoming.account_id)
      if (index === -1) {
        return {
          guilds: [
            mergeGuild(undefined, incoming, options?.banners),
            ...state.guilds,
          ],
        }
      }
      const next = state.guilds.slice()
      next[index] = mergeGuild(state.guilds[index], incoming, options?.banners)
      return { guilds: next }
    }),

  removeGuild: (guildId, accountId) =>
    set((state) => {
      const aid = accountId ?? getActiveAccountId()
      if (aid) {
        return {
          guilds: state.guilds.filter(
            (item) => !(item.id === guildId && item.account_id === aid),
          ),
        }
      }
      return {
        guilds: state.guilds.filter((item) => item.id !== guildId),
      }
    }),

  removeAccountGuilds: (accountId) =>
    set((state) => ({
      guilds: state.guilds.filter((item) => item.account_id !== accountId),
    })),

  reset: () => set({ guilds: [], loaded: false, loading: false }),
}))
