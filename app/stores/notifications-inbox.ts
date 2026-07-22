// 系统通知收件箱（Server-16 BQ / Desktop 21）

import { create } from "zustand"

import {
  ackNotifications,
  deleteNotification,
  listNotifications,
  type NotificationItem,
} from "~/lib/api/social"

type InboxState = {
  items: NotificationItem[]
  unreadCount: number
  hasMore: boolean
  nextCursor?: string
  setUnreadCount: (n: number) => void
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
  ackAll: () => Promise<void>
  remove: (id: string) => Promise<void>
  prepend: (item: NotificationItem) => void
  removeLocal: (id: string) => void
  reset: () => void
}

export const useNotificationsStore = create<InboxState>()((set, get) => ({
  items: [],
  unreadCount: 0,
  hasMore: false,
  nextCursor: undefined,

  setUnreadCount: (n) => set({ unreadCount: Math.max(0, n) }),

  refresh: async () => {
    const res = await listNotifications({ limit: 20 })
    set({
      items: res.items,
      hasMore: res.has_more,
      nextCursor: res.next_cursor,
      unreadCount: res.unread_count,
    })
  },

  loadMore: async () => {
    const { nextCursor, hasMore, items } = get()
    if (!hasMore || !nextCursor) return
    const res = await listNotifications({ before: nextCursor, limit: 20 })
    set({
      items: [...items, ...res.items],
      hasMore: res.has_more,
      nextCursor: res.next_cursor,
    })
  },

  ackAll: async () => {
    const first = get().items[0]
    if (!first) {
      set({ unreadCount: 0 })
      return
    }
    const res = await ackNotifications(first.id)
    set({
      unreadCount: res.unread_count,
      items: get().items.map((i) => ({ ...i, read: true })),
    })
  },

  remove: async (id) => {
    await deleteNotification(id)
    get().removeLocal(id)
  },

  prepend: (item) =>
    set((state) => ({
      items: [item, ...state.items.filter((i) => i.id !== item.id)],
      unreadCount: state.unreadCount + (item.read ? 0 : 1),
    })),

  removeLocal: (id) =>
    set((state) => ({
      items: state.items.filter((i) => i.id !== id),
    })),

  reset: () =>
    set({ items: [], unreadCount: 0, hasMore: false, nextCursor: undefined }),
}))
