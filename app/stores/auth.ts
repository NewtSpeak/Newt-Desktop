// 认证会话 store：当前用户 + 启动 gate 状态。
// access token 本体在 app/lib/api/http.ts 的模块级变量里（不进 store，避免被 devtools 泄露）。

import { create } from "zustand"

import * as authApi from "~/lib/api/auth"
import {
  clearSession,
  hasRefreshToken,
  initTokenStorage,
  refreshSession,
  setOnSessionExpired,
} from "~/lib/api/http"
import type { User } from "~/lib/api/types"
import { gateway } from "~/lib/gateway/client"

export type AuthStatus =
  /** 冷启动静默续期中（启动 gate 显示加载态） */
  | "loading"
  | "authenticated"
  | "unauthenticated"

type AuthState = {
  status: AuthStatus
  user: User | null
  /** 冷启动：有 refresh token 就静默续期自动登录 */
  bootstrap: () => Promise<void>
  login: (identifier: string, password: string) => Promise<void>
  signup: (input: authApi.SignupInput) => Promise<void>
  /** 吊销 refresh token + 断 Gateway + 清空全部 store */
  logout: () => Promise<void>
  setUser: (user: User) => void
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: "loading",
  user: null,

  bootstrap: async () => {
    // 先等安全存储异步读取（含 localStorage 旧值一次性迁移）完成，
    // 否则 hasRefreshToken 的内存镜像还是空的
    await initTokenStorage()
    if (!hasRefreshToken()) {
      set({ status: "unauthenticated", user: null })
      return
    }
    const ok = await refreshSession()
    if (!ok) {
      clearSession()
      set({ status: "unauthenticated", user: null })
      return
    }
    try {
      const user = await authApi.getMe()
      set({ status: "authenticated", user })
    } catch {
      clearSession()
      set({ status: "unauthenticated", user: null })
    }
  },

  login: async (identifier, password) => {
    const tokens = await authApi.login({ identifier, password })
    set({ status: "authenticated", user: tokens.user })
  },

  signup: async (input) => {
    const tokens = await authApi.signup(input)
    set({ status: "authenticated", user: tokens.user })
  },

  logout: async () => {
    gateway.disconnect()
    await authApi.logout()
    resetDataStores()
    set({ status: "unauthenticated", user: null })
  },

  setUser: (user) => set({ user }),
}))

// refresh 彻底失败（会话过期）→ 登出态；路由守卫会跳 /login
setOnSessionExpired(() => {
  gateway.disconnect()
  resetDataStores()
  useAuthStore.setState({ status: "unauthenticated", user: null })
})

/** 登出/会话失效时清空各数据域 store（延迟 import 避免模块环） */
function resetDataStores() {
  void Promise.all([
    import("./guilds"),
    import("./channels"),
    import("./members"),
    import("./messages"),
    import("./voice"),
    import("./ui"),
    import("./search"),
  ]).then(([guilds, channels, members, messages, voice, ui, search]) => {
    guilds.useGuildsStore.getState().reset()
    channels.useChannelsStore.getState().reset()
    members.useMembersStore.getState().reset()
    messages.useMessagesStore.getState().reset()
    voice.useVoiceStore.getState().reset()
    ui.useUIStore.getState().reset()
    search.useSearchStore.getState().reset()
  })
}
