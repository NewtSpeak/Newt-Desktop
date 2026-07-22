// 好友/屏蔽关系 store（Server-16）：READY 注入 + REST 刷新 + Gateway 增量。

import { create } from "zustand"

import {
  acceptFriendRequest,
  blockUser,
  deleteRelationship,
  listRelationships,
  sendFriendRequest,
  type Relationship,
} from "~/lib/api/social"

type RelationshipsState = {
  items: Relationship[]
  loaded: boolean
  setFromReady: (items: Relationship[]) => void
  refresh: () => Promise<void>
  upsert: (rel: Relationship) => void
  remove: (userId: string, type?: string) => void
  sendRequest: (
    usernameOrOpts: string | { username?: string; user_id?: string },
  ) => Promise<Relationship>
  accept: (userId: string) => Promise<void>
  ignoreOrCancel: (userId: string) => Promise<void>
  block: (userId: string) => Promise<void>
  unblock: (userId: string) => Promise<void>
  removeFriend: (userId: string) => Promise<void>
  reset: () => void
}

export const useRelationshipsStore = create<RelationshipsState>()((set, get) => ({
  items: [],
  loaded: false,

  setFromReady: (items) => set({ items: items ?? [], loaded: true }),

  refresh: async () => {
    const items = await listRelationships()
    set({ items, loaded: true })
  },

  upsert: (rel) =>
    set((state) => {
      // 本地已是 blocked 时，拒绝被 friend/pending 覆盖（屏蔽压倒一切）
      if (
        rel.type !== "blocked" &&
        state.items.some((r) => r.user.id === rel.user.id && r.type === "blocked")
      ) {
        return state
      }
      // blocked：清掉该用户全部旧关系；friend：替换 pending；同 type 覆盖
      const next = state.items.filter((r) => {
        if (r.user.id !== rel.user.id) return true
        if (rel.type === "blocked") return false
        if (r.type === rel.type) return false
        if (
          rel.type === "friend" &&
          (r.type === "pending_incoming" || r.type === "pending_outgoing")
        ) {
          return false
        }
        return true
      })
      next.unshift(rel)
      return { items: next }
    }),

  remove: (userId, type) =>
    set((state) => ({
      items: state.items.filter((r) => {
        if (r.user.id !== userId) return true
        if (type && r.type !== type) return true
        return false
      }),
    })),

  sendRequest: async (usernameOrOpts) => {
    const input =
      typeof usernameOrOpts === "string"
        ? { username: usernameOrOpts.trim() }
        : {
            username: usernameOrOpts.username?.trim(),
            user_id: usernameOrOpts.user_id,
          }
    const rel = await sendFriendRequest(input)
    get().upsert(rel)
    return rel
  },

  accept: async (userId) => {
    const rel = await acceptFriendRequest(userId)
    get().upsert(rel)
  },

  ignoreOrCancel: async (userId) => {
    await deleteRelationship(userId)
    get().remove(userId)
  },

  block: async (userId) => {
    const rel = await blockUser(userId)
    // 拉黑后与该用户只保留 blocked 一条（清 friend / pending）
    set((state) => ({
      items: [rel, ...state.items.filter((r) => r.user.id !== userId)],
    }))
    // 刷新私信列表以更新 block_state（输入区锁态）
    void import("~/stores/private-channels").then((m) =>
      m.usePrivateChannelsStore.getState().refresh().catch(() => undefined),
    )
  },

  unblock: async (userId) => {
    await deleteRelationship(userId)
    // 服务端解除拉黑会自动恢复双向好友；本地先清 blocked，再刷新拿 friend
    get().remove(userId, "blocked")
    void get().refresh().catch(() => undefined)
    void import("~/stores/private-channels").then((m) =>
      m.usePrivateChannelsStore.getState().refresh().catch(() => undefined),
    )
  },

  removeFriend: async (userId) => {
    await deleteRelationship(userId)
    get().remove(userId, "friend")
  },

  reset: () => set({ items: [], loaded: false }),
}))

export function friendsOf(items: Relationship[]): Relationship[] {
  return items.filter((r) => r.type === "friend")
}

export function pendingIncomingOf(items: Relationship[]): Relationship[] {
  return items.filter((r) => r.type === "pending_incoming")
}

export function pendingOutgoingOf(items: Relationship[]): Relationship[] {
  return items.filter((r) => r.type === "pending_outgoing")
}

export function blockedOf(items: Relationship[]): Relationship[] {
  return items.filter((r) => r.type === "blocked")
}

/** 我是否拉黑了该用户 */
export function isBlockedByMe(
  items: Relationship[],
  userId: string | undefined,
): boolean {
  if (!userId) return false
  return items.some((r) => r.type === "blocked" && r.user.id === userId)
}
