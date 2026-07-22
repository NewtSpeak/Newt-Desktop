// 频道访问密码解锁状态（客户端缓存）。
// 权威状态在服务端 ChannelUnlock 表；本地缓存用于避免重复弹窗与 UI 灰置。

import { create } from "zustand"

import { getChannelUnlockStatus, unlockChannel } from "~/lib/api/guilds"
import { ApiError } from "~/lib/api/http"

type ChannelUnlocksState = {
  /** channelId → 是否已解锁（未查询过不在 map 中） */
  unlocked: Record<string, boolean>
  /** 待解锁目标（打开密码弹窗） */
  pendingChannelId: string | null
  /** 解锁成功后可选回调（如继续进房） */
  pendingOnSuccess: (() => void) | null

  setUnlocked: (channelId: string, value: boolean) => void
  clearChannel: (channelId: string) => void
  /** 打开解锁弹窗；onSuccess 在密码正确后调用 */
  requestUnlock: (channelId: string, onSuccess?: () => void) => void
  closeUnlockDialog: () => void
  /** 拉取服务端解锁状态并写入缓存；返回是否已可访问 */
  ensureUnlocked: (channelId: string, locked?: boolean) => Promise<boolean>
  /** 提交密码 */
  submitPassword: (password: string) => Promise<void>
}

export const useChannelUnlocksStore = create<ChannelUnlocksState>((set, get) => ({
  unlocked: {},
  pendingChannelId: null,
  pendingOnSuccess: null,

  setUnlocked: (channelId, value) =>
    set((s) => ({ unlocked: { ...s.unlocked, [channelId]: value } })),

  clearChannel: (channelId) =>
    set((s) => {
      const next = { ...s.unlocked }
      delete next[channelId]
      return { unlocked: next }
    }),

  requestUnlock: (channelId, onSuccess) =>
    set({ pendingChannelId: channelId, pendingOnSuccess: onSuccess ?? null }),

  closeUnlockDialog: () =>
    set({ pendingChannelId: null, pendingOnSuccess: null }),

  ensureUnlocked: async (channelId, locked) => {
    // 明确未上锁：直接放行
    if (locked === false) {
      get().setUnlocked(channelId, true)
      return true
    }
    const cached = get().unlocked[channelId]
    if (cached === true) return true
    try {
      const status = await getChannelUnlockStatus(channelId)
      get().setUnlocked(channelId, status.unlocked)
      return status.unlocked || !status.locked
    } catch (error) {
      if (error instanceof ApiError && error.isNotFound) {
        get().setUnlocked(channelId, false)
        return false
      }
      // 网络失败：仅当缓存已明确解锁时放行
      return get().unlocked[channelId] === true
    }
  },

  submitPassword: async (password) => {
    const channelId = get().pendingChannelId
    if (!channelId) return
    await unlockChannel(channelId, password)
    get().setUnlocked(channelId, true)
    const onSuccess = get().pendingOnSuccess
    set({ pendingChannelId: null, pendingOnSuccess: null })
    onSuccess?.()
  },
}))
