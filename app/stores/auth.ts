// 认证会话 store：多账号并存 + 当前激活用户 + 启动 gate。
// access token 在 app/lib/api/http.ts；本 store 持有账号元数据与 UI 态。

import { create } from "zustand"

import { makeAccountId } from "~/lib/account-id"
import * as authApi from "~/lib/api/auth"
import {
  activateAccount,
  ApiError,
  beginAdditionalLogin,
  clearSession,
  dropAccountSession,
  getActiveAccountId,
  getPersistedAccounts,
  getRefreshToken,
  hasRefreshToken,
  initTokenStorage,
  registerAccountSession,
  refreshSession,
  refreshSessionResult,
  setOnSessionExpired,
  updatePersistedAccountUser,
  type PersistedAccount,
} from "~/lib/api/http"

/** 退出账号被网络阻断时的统一文案 */
export const LOGOUT_OFFLINE_MESSAGE =
  "当前无法连接服务器，请恢复网络后再退出账号"
import type { TokenResponse, User } from "~/lib/api/types"
import { gateway } from "~/lib/gateway/client"
import {
  applyAccountServer,
  getServerBaseUrl,
  getSavedServer,
  persistServerConnection,
  setRuntimeServerBaseUrl,
} from "~/lib/server-connection"

export type AuthStatus =
  /** 冷启动静默续期中（启动 gate 显示加载态） */
  "loading" | "authenticated" | "unauthenticated"

/** UI 展示用账号摘要（无 refresh token） */
export type AccountSummary = {
  id: string
  user: User
  serverBaseUrl: string
  serverName: string | null
}

type AuthState = {
  status: AuthStatus
  /** 当前激活账号的用户 */
  user: User | null
  activeAccountId: string | null
  /** 全部已登录账号（含激活） */
  accounts: AccountSummary[]
  /** 冷启动：恢复全部账号会话，激活上次账号 */
  bootstrap: () => Promise<void>
  login: (identifier: string, password: string) => Promise<void>
  signup: (input: authApi.SignupInput) => Promise<void>
  /**
   * 已登录态下追加账号：保留旧账号 token 与服务器数据，
   * 登录成功后切换到新账号。
   */
  addAccountLogin: (identifier: string, password: string) => Promise<void>
  addAccountSignup: (input: authApi.SignupInput) => Promise<void>
  /** 切换激活账号（Gateway 重连、服务器基址切换；保留其他账号的 guild 缓存） */
  switchAccount: (accountId: string) => Promise<void>
  /**
   * 静默切换身份（选中其他账号的服务器时）：
   * 只换 token / 服务器基址 / 左下角头像，不断开业务 UI、不重排服务器列表。
   */
  silentActivateAccount: (accountId: string) => Promise<void>
  /** 退出指定账号；若为最后一个则回到未登录 */
  removeAccount: (accountId: string) => Promise<void>
  /** 退出当前激活账号（兼容设置页「退出登录」） */
  logout: () => Promise<void>
  /** 退出全部账号 */
  logoutAll: () => Promise<void>
  setUser: (user: User) => void
}

/** bootstrap 单飞标记（跨 HMR store 重建也只允许一次在途引导） */
let bootstrapInFlight: Promise<void> | null = null

/** 兜底超时：网络/安全存储层意外挂起时不能让启动 gate 永远转圈 */
const BOOTSTRAP_TIMEOUT_MS = 12_000

function toSummary(account: PersistedAccount): AccountSummary {
  return {
    id: account.id,
    user: account.user,
    serverBaseUrl: account.serverBaseUrl,
    serverName: account.serverName,
  }
}

function summariesFromPersisted(): AccountSummary[] {
  return getPersistedAccounts().map(toSummary)
}

function requireServerBaseUrl(): string {
  const base = getServerBaseUrl()
  if (!base) throw new Error("未连接服务器")
  return base
}

/** 登录/注册成功后登记账号并置为激活 */
function commitAuthenticated(
  tokens: TokenResponse,
  serverName: string | null,
  set: (state: Partial<AuthState>) => void,
) {
  const serverBaseUrl = requireServerBaseUrl()
  const accountId = makeAccountId(serverBaseUrl, tokens.user.id)
  registerAccountSession({
    accountId,
    user: tokens.user,
    serverBaseUrl,
    serverName,
    tokens,
  })
  persistServerConnection(serverName)
  set({
    status: "authenticated",
    user: tokens.user,
    activeAccountId: accountId,
    accounts: summariesFromPersisted(),
  })
}

/** 用本地缓存账号恢复为已登录（服务端暂不可达时保留会话） */
function restoreFromCachedAccount(
  account: PersistedAccount,
  set: (state: Partial<AuthState>) => void,
) {
  applyAccountServer(account.serverBaseUrl, account.serverName)
  activateAccount(account.id)
  set({
    status: "authenticated",
    user: account.user,
    activeAccountId: account.id,
    accounts: summariesFromPersisted(),
  })
}

async function doBootstrap(set: (state: Partial<AuthState>) => void) {
  const timeout = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), BOOTSTRAP_TIMEOUT_MS),
  )
  const run = async (): Promise<void> => {
    await initTokenStorage()

    const persisted = getPersistedAccounts()
    if (persisted.length === 0 && !hasRefreshToken()) {
      set({
        status: "unauthenticated",
        user: null,
        activeAccountId: null,
        accounts: [],
      })
      return
    }

    const activeId = getActiveAccountId()
    const activeRecord =
      persisted.find((a) => a.id === activeId) ?? persisted[0] ?? null
    if (activeRecord) {
      applyAccountServer(activeRecord.serverBaseUrl, activeRecord.serverName)
      activateAccount(activeRecord.id)
    } else {
      const saved = getSavedServer()
      if (saved) setRuntimeServerBaseUrl(saved.baseUrl)
    }

    // 1) 续期当前账号；网络失败时绝不清会话
    const primary = await refreshSessionResult()
    if (primary.status === "ok") {
      // fallthrough → getMe 同步最新资料
    } else if (primary.status === "transient") {
      // 断网 / CORS / 服务端未就绪：用本地缓存用户保持登录
      const cached =
        getPersistedAccounts().find((a) => a.id === getActiveAccountId()) ??
        activeRecord
      if (cached) {
        console.warn(
          "auth: 续期失败（网络/服务暂不可用），保留本地登录态",
        )
        restoreFromCachedAccount(cached, set)
        return
      }
    } else {
      // invalid / missing：尝试其它账号（仅凭证失效才 drop）
      const others = getPersistedAccounts().filter(
        (a) => a.id !== getActiveAccountId(),
      )
      let recovered: PersistedAccount | null = null
      let sawTransient = false
      for (const account of others) {
        applyAccountServer(account.serverBaseUrl, account.serverName)
        activateAccount(account.id)
        const r = await refreshSessionResult(account.id)
        if (r.status === "ok") {
          recovered = account
          break
        }
        if (r.status === "transient") {
          sawTransient = true
          // 网络抖动：保留该账号，继续试下一个可在线的
          continue
        }
        // invalid / missing 才移除
        dropAccountSession(account.id)
      }
      if (!recovered) {
        if (sawTransient) {
          const fallback =
            getPersistedAccounts()[0] ?? activeRecord ?? null
          if (fallback) {
            console.warn(
              "auth: 全部账号续期遇网络问题，保留本地登录态",
            )
            restoreFromCachedAccount(fallback, set)
            return
          }
        }
        if (!hasRefreshToken() && getPersistedAccounts().length === 0) {
          clearSession()
          set({
            status: "unauthenticated",
            user: null,
            activeAccountId: null,
            accounts: [],
          })
          return
        }
        // 还有本地账号但 refresh 全失败且无网络线索：仍尽量保留缓存登录
        const fallback = getPersistedAccounts()[0] ?? null
        if (fallback) {
          restoreFromCachedAccount(fallback, set)
          return
        }
        clearSession()
        set({
          status: "unauthenticated",
          user: null,
          activeAccountId: null,
          accounts: [],
        })
        return
      }
    }

    try {
      const user = await authApi.getMe()
      const serverBaseUrl = requireServerBaseUrl()
      const accountId = makeAccountId(serverBaseUrl, user.id)
      const saved = getSavedServer()
      registerAccountSession({
        accountId,
        user,
        serverBaseUrl,
        serverName: saved?.name ?? null,
      })
      if (getActiveAccountId() === "__legacy__") {
        dropAccountSession("__legacy__")
        activateAccount(accountId)
      }
      set({
        status: "authenticated",
        user,
        activeAccountId: accountId,
        accounts: summariesFromPersisted(),
      })
    } catch (error) {
      // 仅 401 视为会话失效；网络错误用缓存用户保持登录
      const isAuthFail =
        error instanceof ApiError && error.status === 401
      const isNetwork =
        error instanceof ApiError &&
        (error.status === 0 || error.code === "NETWORK_ERROR")

      if (isAuthFail) {
        const id = getActiveAccountId()
        if (id) dropAccountSession(id)
      } else if (isNetwork || !(error instanceof ApiError)) {
        const cached =
          getPersistedAccounts().find((a) => a.id === getActiveAccountId()) ??
          getPersistedAccounts()[0] ??
          activeRecord
        if (cached) {
          console.warn("auth: getMe 失败（网络），保留本地登录态")
          restoreFromCachedAccount(cached, set)
          return
        }
      }

      const list = getPersistedAccounts()
      for (const next of list) {
        applyAccountServer(next.serverBaseUrl, next.serverName)
        activateAccount(next.id)
        const r = await refreshSessionResult(next.id)
        if (r.status === "transient") {
          restoreFromCachedAccount(next, set)
          return
        }
        if (r.status !== "ok") {
          if (r.status === "invalid" || r.status === "missing") {
            dropAccountSession(next.id)
          }
          continue
        }
        try {
          const user = await authApi.getMe()
          registerAccountSession({
            accountId: next.id,
            user,
            serverBaseUrl: next.serverBaseUrl,
            serverName: next.serverName,
          })
          set({
            status: "authenticated",
            user,
            activeAccountId: next.id,
            accounts: summariesFromPersisted(),
          })
          return
        } catch (inner) {
          if (
            inner instanceof ApiError &&
            (inner.status === 0 || inner.code === "NETWORK_ERROR")
          ) {
            restoreFromCachedAccount(next, set)
            return
          }
          if (inner instanceof ApiError && inner.status === 401) {
            dropAccountSession(next.id)
          }
        }
      }

      // 仍有本地账号则保留；否则才回欢迎页
      const remaining = getPersistedAccounts()
      if (remaining.length > 0) {
        restoreFromCachedAccount(remaining[0]!, set)
        return
      }
      clearSession()
      set({
        status: "unauthenticated",
        user: null,
        activeAccountId: null,
        accounts: [],
      })
    }
  }
  const result = await Promise.race([run(), timeout])
  if (result === "timeout") {
    // 超时也不清本地账号：有缓存就保持登录界面
    const list = getPersistedAccounts()
    const activeId = getActiveAccountId()
    const cached =
      list.find((a) => a.id === activeId) ?? list[0] ?? null
    if (cached) {
      console.warn("auth: 会话恢复超时，使用本地缓存保持登录")
      restoreFromCachedAccount(cached, set)
    } else {
      console.error("auth: 会话恢复超时且无本地账号")
      set({
        status: "unauthenticated",
        user: null,
        activeAccountId: null,
        accounts: [],
      })
    }
  }
}

/** 切换账号时：断 Gateway，清会话绑定状态；保留多账号 guild 缓存 */
async function prepareAccountSwitch() {
  gateway.disconnect()
  await Promise.all([
    import("./voice"),
    import("./messages"),
    import("./search"),
    import("./private-channels"),
    import("./relationships"),
    import("./notifications-inbox"),
    import("./presence"),
    import("./stickers"),
    import("./ui"),
  ]).then(
    ([
      voice,
      messages,
      search,
      privateChannels,
      relationships,
      notifications,
      presence,
      stickers,
      ui,
    ]) => {
      voice.useVoiceStore.getState().reset()
      messages.useMessagesStore.getState().reset()
      search.useSearchStore.getState().reset()
      privateChannels.usePrivateChannelsStore.getState().reset()
      relationships.useRelationshipsStore.getState().reset()
      notifications.useNotificationsStore.getState().reset()
      presence.usePresenceStore.getState().reset()
      stickers.useStickersStore.getState().reset()
      ui.useUIStore.getState().selectGuild(null)
    },
  )
}

async function activateAndLoad(
  accountId: string,
  serverBaseUrl: string,
  serverName: string | null,
  fallbackUser: User,
  set: (state: Partial<AuthState>) => void,
) {
  applyAccountServer(serverBaseUrl, serverName)
  activateAccount(accountId)
  const refreshed = await refreshSessionResult(accountId)
  if (refreshed.status === "invalid" || refreshed.status === "missing") {
    throw new Error("该账号会话已失效，请重新登录")
  }
  // transient：网络抖动仍用本地资料切号，后续请求会再试 refresh
  try {
    const user = await authApi.getMe()
    registerAccountSession({
      accountId,
      user,
      serverBaseUrl,
      serverName,
    })
    set({
      status: "authenticated",
      user,
      activeAccountId: accountId,
      accounts: summariesFromPersisted(),
    })
  } catch {
    set({
      status: "authenticated",
      user: fallbackUser,
      activeAccountId: accountId,
      accounts: summariesFromPersisted(),
    })
  }
  void import("./guilds").then((m) =>
    m.useGuildsStore.getState().fetchGuilds().catch(() => undefined),
  )
  if (refreshed.status === "ok") {
    gateway.connect()
  }
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: "loading",
  user: null,
  activeAccountId: null,
  accounts: [],

  bootstrap: () => {
    bootstrapInFlight ??= doBootstrap(set).finally(() => {
      bootstrapInFlight = null
    })
    return bootstrapInFlight
  },

  login: async (identifier, password) => {
    const tokens = await authApi.login({ identifier, password })
    commitAuthenticated(tokens, getSavedServer()?.name ?? null, set)
  },

  signup: async (input) => {
    const tokens = await authApi.signup(input)
    commitAuthenticated(tokens, getSavedServer()?.name ?? null, set)
  },

  addAccountLogin: async (identifier, password) => {
    const previousId = get().activeAccountId
    const previousAccount = get().accounts.find((a) => a.id === previousId)
    beginAdditionalLogin()
    try {
      const tokens = await authApi.login({ identifier, password })
      const serverBaseUrl = requireServerBaseUrl()
      const accountId = makeAccountId(serverBaseUrl, tokens.user.id)
      if (previousId && previousId !== accountId) {
        await prepareAccountSwitch()
      }
      commitAuthenticated(tokens, getSavedServer()?.name ?? null, set)
      void import("./guilds").then((m) =>
        m.useGuildsStore.getState().fetchGuilds().catch(() => undefined),
      )
      gateway.connect()
    } catch (error) {
      // 登录失败：恢复原先激活账号，避免卡在 pending 槽
      if (previousId && previousAccount) {
        applyAccountServer(
          previousAccount.serverBaseUrl,
          previousAccount.serverName,
        )
        activateAccount(previousId)
      }
      throw error
    }
  },

  addAccountSignup: async (input) => {
    const previousId = get().activeAccountId
    const previousAccount = get().accounts.find((a) => a.id === previousId)
    beginAdditionalLogin()
    try {
      const tokens = await authApi.signup(input)
      const serverBaseUrl = requireServerBaseUrl()
      const accountId = makeAccountId(serverBaseUrl, tokens.user.id)
      if (previousId && previousId !== accountId) {
        await prepareAccountSwitch()
      }
      commitAuthenticated(tokens, getSavedServer()?.name ?? null, set)
      void import("./guilds").then((m) =>
        m.useGuildsStore.getState().fetchGuilds().catch(() => undefined),
      )
      gateway.connect()
    } catch (error) {
      if (previousId && previousAccount) {
        applyAccountServer(
          previousAccount.serverBaseUrl,
          previousAccount.serverName,
        )
        activateAccount(previousId)
      }
      throw error
    }
  },

  switchAccount: async (accountId) => {
    if (accountId === get().activeAccountId) return
    const target = get().accounts.find((a) => a.id === accountId)
    if (!target) throw new Error("账号不存在")

    await prepareAccountSwitch()
    try {
      await activateAndLoad(
        accountId,
        target.serverBaseUrl,
        target.serverName,
        target.user,
        set,
      )
    } catch (error) {
      dropAccountSession(accountId)
      void import("./guilds").then((m) =>
        m.useGuildsStore.getState().removeAccountGuilds(accountId),
      )
      const rest = getPersistedAccounts()
      if (rest.length === 0) {
        set({
          status: "unauthenticated",
          user: null,
          activeAccountId: null,
          accounts: [],
        })
      } else {
        const fallback = rest[0]!
        try {
          await activateAndLoad(
            fallback.id,
            fallback.serverBaseUrl,
            fallback.serverName,
            fallback.user,
            set,
          )
        } catch {
          clearSession()
          resetAllDataStores()
          set({
            status: "unauthenticated",
            user: null,
            activeAccountId: null,
            accounts: [],
          })
        }
      }
      throw error instanceof Error
        ? error
        : new Error("该账号会话已失效，请重新登录")
    }
  },

  silentActivateAccount: async (accountId) => {
    if (accountId === get().activeAccountId) return
    const target = get().accounts.find((a) => a.id === accountId)
    if (!target) throw new Error("账号不存在")

    // 不同账号不能共用语音会话，静默离开
    try {
      const voice = await import("./voice")
      if (voice.useVoiceStore.getState().session) {
        const { voiceConnection } = await import("~/lib/voice/connection")
        await voiceConnection.leave().catch(() => undefined)
      }
    } catch {
      // 忽略
    }

    // 仅重连 Gateway + 换 token，不 clear 选中服、不重置 guild 列表
    gateway.disconnect()
    applyAccountServer(target.serverBaseUrl, target.serverName)
    if (!activateAccount(accountId)) throw new Error("无法激活账号")

    const ok = await refreshSession(accountId)
    if (!ok) throw new Error("该账号会话已失效，请重新登录")

    try {
      const user = await authApi.getMe()
      registerAccountSession({
        accountId,
        user,
        serverBaseUrl: target.serverBaseUrl,
        serverName: target.serverName,
      })
      set({
        status: "authenticated",
        user,
        activeAccountId: accountId,
        // 账号列表顺序保持不变
        accounts: get().accounts.map((a) =>
          a.id === accountId ? { ...a, user } : a,
        ),
      })
    } catch {
      set({
        status: "authenticated",
        user: target.user,
        activeAccountId: accountId,
      })
    }

    gateway.connect()
    // 故意不 fetchGuilds：避免重排服务器列表
  },

  removeAccount: async (accountId) => {
    const state = get()
    const target = state.accounts.find((a) => a.id === accountId)
    if (!target) return

    // 连不上服务器时禁止退出（否则本地会话被清掉、服务端 refresh 仍有效）
    await assertCanLogout(target.serverBaseUrl, accountId === state.activeAccountId)

    const wasActive = state.activeAccountId === accountId
    const refreshToken =
      getRefreshToken(accountId) ??
      getPersistedAccounts().find((a) => a.id === accountId)?.refreshToken

    if (refreshToken) {
      try {
        await authApi.logoutAccount(refreshToken, target.serverBaseUrl)
      } catch (error) {
        if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
          throw new Error(LOGOUT_OFFLINE_MESSAGE)
        }
        throw error instanceof Error
          ? error
          : new Error(LOGOUT_OFFLINE_MESSAGE)
      }
    }

    dropAccountSession(accountId)
    void import("./guilds").then((m) =>
      m.useGuildsStore.getState().removeAccountGuilds(accountId),
    )

    const remaining = summariesFromPersisted()
    if (remaining.length === 0) {
      gateway.disconnect()
      clearSession()
      resetAllDataStores()
      set({
        status: "unauthenticated",
        user: null,
        activeAccountId: null,
        accounts: [],
      })
      return
    }

    if (wasActive) {
      const next = remaining[0]!
      await prepareAccountSwitch()
      try {
        await activateAndLoad(
          next.id,
          next.serverBaseUrl,
          next.serverName,
          next.user,
          set,
        )
      } catch {
        clearSession()
        resetAllDataStores()
        set({
          status: "unauthenticated",
          user: null,
          activeAccountId: null,
          accounts: [],
        })
      }
    } else {
      set({ accounts: remaining })
    }
  },

  logout: async () => {
    const accountId = get().activeAccountId
    if (accountId) {
      await get().removeAccount(accountId)
      return
    }
    await assertCanLogout(requireServerBaseUrl(), true)
    try {
      await authApi.logout()
    } catch (error) {
      if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
        throw new Error(LOGOUT_OFFLINE_MESSAGE)
      }
      throw error
    }
    gateway.disconnect()
    resetAllDataStores()
    set({
      status: "unauthenticated",
      user: null,
      activeAccountId: null,
      accounts: [],
    })
  },

  logoutAll: async () => {
    const list = [...getPersistedAccounts()]
    for (const account of list) {
      await assertCanLogout(
        account.serverBaseUrl,
        account.id === get().activeAccountId,
      )
    }
    // 全部可达后再逐个吊销；任一失败则中止且不 clearSession
    for (const account of list) {
      const token = getRefreshToken(account.id) ?? account.refreshToken
      if (token) {
        try {
          await authApi.logoutAccount(token, account.serverBaseUrl)
        } catch (error) {
          if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
            throw new Error(LOGOUT_OFFLINE_MESSAGE)
          }
          throw error instanceof Error
            ? error
            : new Error(LOGOUT_OFFLINE_MESSAGE)
        }
      }
    }
    gateway.disconnect()
    clearSession()
    resetAllDataStores()
    set({
      status: "unauthenticated",
      user: null,
      activeAccountId: null,
      accounts: [],
    })
  },

  setUser: (user) => {
    const accountId = get().activeAccountId
    if (accountId) updatePersistedAccountUser(accountId, user)
    set({
      user,
      accounts: summariesFromPersisted(),
    })
  },
}))

// refresh 彻底失败 → 仅移除失效账号；无剩余则回欢迎界面
setOnSessionExpired((accountId) => {
  gateway.disconnect()
  if (accountId) {
    dropAccountSession(accountId)
    void import("./guilds").then((m) =>
      m.useGuildsStore.getState().removeAccountGuilds(accountId),
    )
  }
  const remaining = getPersistedAccounts()
  if (remaining.length === 0) {
    clearSession()
    resetAllDataStores()
    useAuthStore.setState({
      status: "unauthenticated",
      user: null,
      activeAccountId: null,
      accounts: [],
    })
    return
  }
  const next = remaining[0]!
  applyAccountServer(next.serverBaseUrl, next.serverName)
  activateAccount(next.id)
  useAuthStore.setState({
    status: "authenticated",
    user: next.user,
    activeAccountId: next.id,
    accounts: summariesFromPersisted(),
  })
  void refreshSession(next.id).then((ok) => {
    if (ok) gateway.connect()
  })
})

/**
 * 退出账号前确认服务器可达。
 * - 当前激活账号：以 Gateway 已连接为准（连不上即禁止退出）
 * - 其它账号：探测目标服务器是否响应
 */
async function assertCanLogout(
  serverBaseUrl: string,
  isActiveAccount: boolean,
): Promise<void> {
  if (isActiveAccount) {
    const { useUIStore } = await import("./ui")
    if (useUIStore.getState().gatewayStatus !== "connected") {
      throw new Error(LOGOUT_OFFLINE_MESSAGE)
    }
    return
  }
  const reachable = await probeServerReachable(serverBaseUrl)
  if (!reachable) throw new Error(LOGOUT_OFFLINE_MESSAGE)
}

/** 轻量探测：任意 HTTP 响应（含 401/404）视为可达；超时/网络错误视为不可达 */
async function probeServerReachable(
  serverBaseUrl: string,
  timeoutMs = 4_000,
): Promise<boolean> {
  const base = serverBaseUrl.replace(/\/+$/, "")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetch(`${base}/gapi/v1/users/@me`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** 全部清空（退出所有账号 / 无可用会话） */
function resetAllDataStores() {
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
    import("./relationships"),
    import("./notifications-inbox"),
    import("./private-channels"),
    import("./stickers"),
  ]).then(
    ([
      guilds,
      channels,
      members,
      messages,
      voice,
      ui,
      search,
      readStates,
      presence,
      relationships,
      notifications,
      privateChannels,
      stickers,
    ]) => {
      guilds.useGuildsStore.getState().reset()
      channels.useChannelsStore.getState().reset()
      members.useMembersStore.getState().reset()
      messages.useMessagesStore.getState().reset()
      voice.useVoiceStore.getState().reset()
      ui.useUIStore.getState().reset()
      search.useSearchStore.getState().reset()
      readStates.useReadStatesStore.getState().reset()
      presence.usePresenceStore.getState().reset()
      relationships.useRelationshipsStore.getState().reset()
      notifications.useNotificationsStore.getState().reset()
      privateChannels.usePrivateChannelsStore.getState().reset()
      stickers.useStickersStore.getState().reset()
      void import("~/lib/public-profile-cache").then((m) =>
        m.clearPublicProfileCache(),
      )
    },
  )
}
