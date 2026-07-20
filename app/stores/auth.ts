// 认证会话 store：当前用户 + 启动 gate 状态。
// access token 本体在 app/lib/api/http.ts 的模块级变量里（不进 store，避免被 devtools 泄露）。

import { create } from "zustand"

import * as authApi from "~/lib/api/auth"
import {
  ApiError,
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
  "loading" | "authenticated" | "unauthenticated"

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

/** bootstrap 单飞标记（跨 HMR store 重建也只允许一次在途引导） */
let bootstrapInFlight: Promise<void> | null = null

/** 兜底超时：网络/安全存储层意外挂起时不能让启动 gate 永远转圈 */
const BOOTSTRAP_TIMEOUT_MS = 12_000

async function doBootstrap(
  set: (state: Partial<Pick<AuthState, "status" | "user">>) => void
) {
  const timeout = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), BOOTSTRAP_TIMEOUT_MS)
  )
  const run = async (): Promise<void> => {
    // 先等安全存储异步读取（含 localStorage 旧值一次性迁移）完成，
    // 否则 hasRefreshToken 的内存镜像还是空的
    await initTokenStorage()
    if (!hasRefreshToken()) {
      set({ status: "unauthenticated", user: null })
      return
    }
    const ok = await refreshSession()
    if (!ok) {
      // 401（token 失效）由 doRefresh 内部清会话；网络失败/服务器暂不可达
      // 保留 refresh token，回欢迎界面后可「重新登录」或等服务恢复重启应用
      set({ status: "unauthenticated", user: null })
      return
    }
    try {
      const user = await authApi.getMe()
      set({ status: "authenticated", user })
    } catch (error) {
      // 仅确定性的认证失败才清会话；网络抖动保留 token 待下次重试
      if (error instanceof ApiError && error.status === 401) clearSession()
      set({ status: "unauthenticated", user: null })
    }
  }
  const result = await Promise.race([run(), timeout])
  if (result === "timeout") {
    console.error("auth: 会话恢复超时，回退到未登录界面")
    set({ status: "unauthenticated", user: null })
  }
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: "loading",
  user: null,

  bootstrap: () => {
    // 单飞去重：hook 可能因 HMR/重挂载多次触发，只允许一次引导在途
    bootstrapInFlight ??= doBootstrap(set).finally(() => {
      bootstrapInFlight = null
    })
    return bootstrapInFlight
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

// refresh 彻底失败（会话过期）→ 登出态；应用壳会渲染欢迎空态（可重新登录）
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
    import("./read-states"),
    import("./presence"),
  ]).then(([guilds, channels, members, messages, voice, ui, search, readStates, presence]) => {
    guilds.useGuildsStore.getState().reset()
    channels.useChannelsStore.getState().reset()
    members.useMembersStore.getState().reset()
    messages.useMessagesStore.getState().reset()
    voice.useVoiceStore.getState().reset()
    ui.useUIStore.getState().reset()
    search.useSearchStore.getState().reset()
    readStates.useReadStatesStore.getState().reset()
    presence.usePresenceStore.getState().reset()
  })
}
