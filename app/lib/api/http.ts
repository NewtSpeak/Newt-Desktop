// fetch 封装 + 多账号会话（token）管理。
//
// 会话模型（docs 01 + 多账号 FR-11）：
//   - 可同时保存多个账号；每个账号独立 access/refresh 与服务器基址；
//   - access token 只存内存；refresh token 与账号元数据落 OS 安全存储；
//   - 请求默认使用「当前激活账号」的 Bearer + 其服务器基址；
//   - 401 时对该账号 refresh 并重试；彻底失败触发 onSessionExpired（仅移除该账号）。

import {
  isTauriRuntime,
  secureDelete,
  secureGet,
  secureSet,
} from "~/lib/secure-storage"
import { getServerBaseUrl } from "~/lib/server-connection"

import type { TokenResponse, User } from "./types"

const API_PREFIX = "/gapi/v1"

/** 旧版单账号 refresh（迁移用） */
const LEGACY_REFRESH_TOKEN_KEY = "owl.refresh_token"
/** 多账号持久化：JSON 数组 PersistedAccount[] */
const ACCOUNTS_STORAGE_KEY = "owl.accounts.v1"
/** 当前激活账号 id */
const ACTIVE_ACCOUNT_KEY = "owl.active_account_id"

/**
 * 当前 API 基址：{运行时服务器基址}/gapi/v1。
 * 未连接任何服务器时退回相对路径（仅浏览器 dev 下经 vite 代理可用）。
 */
export function apiBaseURL(): string {
  const base = getServerBaseUrl()
  return base ? `${base}${API_PREFIX}` : API_PREFIX
}

/**
 * 把服务端返回的相对路径解析为完整 URL；可指定服务器基址（多账号头像等）。
 * 绝对 URL 原样返回。
 */
export function resolveApiUrl(
  path: string,
  serverBaseUrl?: string | null,
): string {
  if (/^https?:\/\//i.test(path)) return path
  const base = serverBaseUrl ?? getServerBaseUrl()
  return base ? `${base}${path}` : path
}

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  /** HTTP 状态码；网络层失败时为 0 */
  readonly status: number
  /** 服务端错误码（如 ACCOUNT_EXISTS / LOGIN_RATE_LIMITED），网络失败为 NETWORK_ERROR */
  readonly code: string
  /** 429 时的 Retry-After 秒数 */
  readonly retryAfterSeconds?: number

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }

  /**
   * 404 语义（docs 03）：无权限资源一律 404，客户端按「不存在」处理，
   * 调用方据此把对应资源从缓存移除，不要弹「无权限」提示。
   */
  get isNotFound() {
    return this.status === 404
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.isNotFound
}

// ---------------------------------------------------------------------------
// 多账号会话状态
// ---------------------------------------------------------------------------

export type PersistedAccount = {
  id: string
  user: User
  serverBaseUrl: string
  serverName: string | null
  refreshToken: string
}

type MemorySession = {
  accessToken: string | null
  accessExpiresAt: number
  refreshToken: string | null
}

/** accountId → 内存会话（含 access） */
const sessions = new Map<string, MemorySession>()

/** 已持久化的账号元数据（含 refresh；与安全存储同步） */
let persistedAccounts: PersistedAccount[] = []

let activeAccountId: string | null = null
let tokenStorageInit: Promise<void> | null = null

function emptySession(): MemorySession {
  return { accessToken: null, accessExpiresAt: 0, refreshToken: null }
}

function getOrCreateSession(accountId: string): MemorySession {
  let session = sessions.get(accountId)
  if (!session) {
    session = emptySession()
    sessions.set(accountId, session)
  }
  return session
}

function activeSession(): MemorySession | null {
  if (!activeAccountId) return null
  return sessions.get(activeAccountId) ?? null
}

/** 冷启动初始化：加载多账号列表；兼容旧单 refresh_token 键 */
export function initTokenStorage(): Promise<void> {
  tokenStorageInit ??= (async () => {
    if (typeof window === "undefined") return

    const raw = await secureGet(ACCOUNTS_STORAGE_KEY)
    if (raw) {
      try {
        const list = JSON.parse(raw) as PersistedAccount[]
        if (Array.isArray(list)) {
          persistedAccounts = list.filter(
            (a) => a?.id && a?.refreshToken && a?.serverBaseUrl && a?.user?.id,
          )
          for (const account of persistedAccounts) {
            const session = getOrCreateSession(account.id)
            session.refreshToken = account.refreshToken
          }
        }
      } catch {
        persistedAccounts = []
      }
    }

    // 迁移：旧版单 refresh_token → 暂存为占位，bootstrap 里用 getMe 补全元数据
    const legacyRefresh =
      (await secureGet(LEGACY_REFRESH_TOKEN_KEY)) ??
      (isTauriRuntime()
        ? localStorage.getItem(LEGACY_REFRESH_TOKEN_KEY)
        : null)
    if (legacyRefresh && persistedAccounts.length === 0) {
      const pendingId = "__legacy__"
      const session = getOrCreateSession(pendingId)
      session.refreshToken = legacyRefresh
      activeAccountId = pendingId
      // 立刻删旧键，避免重复迁移
      await secureDelete(LEGACY_REFRESH_TOKEN_KEY)
      if (isTauriRuntime()) localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY)
    }

    const savedActive = await secureGet(ACTIVE_ACCOUNT_KEY)
    if (
      savedActive &&
      persistedAccounts.some((a) => a.id === savedActive)
    ) {
      activeAccountId = savedActive
    } else if (persistedAccounts.length > 0 && !activeAccountId) {
      activeAccountId = persistedAccounts[0]!.id
    }

    // 确保激活账号的 refresh 在内存
    if (activeAccountId) {
      const account = persistedAccounts.find((a) => a.id === activeAccountId)
      if (account) {
        getOrCreateSession(activeAccountId).refreshToken = account.refreshToken
      }
    }
  })()
  return tokenStorageInit
}

async function persistAccountsToStorage() {
  if (typeof window === "undefined") return
  if (persistedAccounts.length === 0) {
    await secureDelete(ACCOUNTS_STORAGE_KEY)
    await secureDelete(ACTIVE_ACCOUNT_KEY)
    return
  }
  await secureSet(ACCOUNTS_STORAGE_KEY, JSON.stringify(persistedAccounts))
  if (activeAccountId && activeAccountId !== "__legacy__") {
    await secureSet(ACTIVE_ACCOUNT_KEY, activeAccountId)
  }
}

/** 已持久化账号列表（只读快照） */
export function getPersistedAccounts(): readonly PersistedAccount[] {
  return persistedAccounts
}

export function getActiveAccountId(): string | null {
  return activeAccountId
}

/** refresh 失败（当前激活账号会话彻底失效）时的回调 */
let onSessionExpired: ((accountId: string | null) => void) | null = null

export function setOnSessionExpired(
  handler: ((accountId: string | null) => void) | null,
) {
  onSessionExpired = handler
}

export function getRefreshToken(accountId?: string | null): string | null {
  const id = accountId ?? activeAccountId
  if (!id) return null
  return sessions.get(id)?.refreshToken ?? null
}

/**
 * 为「添加账号」预留 pending 槽：后续 login/signup 的 setSession 不会覆盖
 * 已有账号的 token。
 */
export function beginAdditionalLogin() {
  activeAccountId = "__pending__"
  getOrCreateSession("__pending__")
}

/**
 * 登录/注册/refresh 成功：写入当前激活账号（若无激活 id 则写入临时槽，
 * 随后由 registerAccountSession 绑定正式 accountId）。
 */
export function setSession(tokens: TokenResponse) {
  const id = activeAccountId ?? "__pending__"
  if (!activeAccountId) activeAccountId = id
  const session = getOrCreateSession(id)
  session.accessToken = tokens.access_token
  session.accessExpiresAt = new Date(tokens.access_expires_at).getTime()
  session.refreshToken = tokens.refresh_token
}

/**
 * 将当前（或指定）会话登记为正式账号并持久化。
 * 用于 login/signup 成功后，或 bootstrap 从 legacy 迁移。
 */
export function registerAccountSession(input: {
  accountId: string
  user: User
  serverBaseUrl: string
  serverName: string | null
  /** 若不传则沿用当前 active 会话的 refresh */
  tokens?: TokenResponse
}): void {
  const { accountId, user, serverBaseUrl, serverName, tokens } = input
  const prevId = activeAccountId

  // 把 pending/legacy 会话迁到正式 id
  if (tokens) {
    const session = getOrCreateSession(accountId)
    session.accessToken = tokens.access_token
    session.accessExpiresAt = new Date(tokens.access_expires_at).getTime()
    session.refreshToken = tokens.refresh_token
    if (prevId && prevId !== accountId && (prevId === "__pending__" || prevId === "__legacy__")) {
      sessions.delete(prevId)
    }
  } else if (prevId && prevId !== accountId) {
    const prev = sessions.get(prevId)
    if (prev) {
      sessions.set(accountId, { ...prev })
      if (prevId === "__pending__" || prevId === "__legacy__") {
        sessions.delete(prevId)
      }
    }
  }

  const session = getOrCreateSession(accountId)
  const refreshToken = session.refreshToken
  if (!refreshToken) {
    console.error("registerAccountSession: 缺少 refresh token", accountId)
    return
  }

  const record: PersistedAccount = {
    id: accountId,
    user,
    serverBaseUrl,
    serverName,
    refreshToken,
  }
  const index = persistedAccounts.findIndex((a) => a.id === accountId)
  if (index === -1) persistedAccounts = [...persistedAccounts, record]
  else {
    const next = persistedAccounts.slice()
    next[index] = record
    persistedAccounts = next
  }

  activeAccountId = accountId
  void persistAccountsToStorage()
}

/** 更新已保存账号的用户资料（资料编辑后） */
export function updatePersistedAccountUser(accountId: string, user: User) {
  const index = persistedAccounts.findIndex((a) => a.id === accountId)
  if (index === -1) return
  const next = persistedAccounts.slice()
  next[index] = { ...next[index]!, user }
  persistedAccounts = next
  void persistAccountsToStorage()
}

/** 切换激活账号（不改 token；调用方负责切服务器基址与 Gateway） */
export function activateAccount(accountId: string): boolean {
  const account = persistedAccounts.find((a) => a.id === accountId)
  if (!account) return false
  activeAccountId = accountId
  const session = getOrCreateSession(accountId)
  session.refreshToken = account.refreshToken
  void persistAccountsToStorage()
  return true
}

/** 从内存与持久化移除账号（不调服务端 logout） */
export function dropAccountSession(accountId: string) {
  sessions.delete(accountId)
  persistedAccounts = persistedAccounts.filter((a) => a.id !== accountId)
  if (activeAccountId === accountId) {
    activeAccountId = persistedAccounts[0]?.id ?? null
    if (activeAccountId) {
      const next = persistedAccounts.find((a) => a.id === activeAccountId)
      if (next) {
        getOrCreateSession(activeAccountId).refreshToken = next.refreshToken
      }
    }
  }
  void persistAccountsToStorage()
}

/** 清空全部本地会话（不调服务端） */
export function clearSession() {
  sessions.clear()
  persistedAccounts = []
  activeAccountId = null
  void persistAccountsToStorage()
}

export function hasRefreshToken(accountId?: string | null): boolean {
  return Boolean(getRefreshToken(accountId))
}

function accessTokenUsable(session: MemorySession | null): boolean {
  if (!session?.accessToken) return false
  return session.accessExpiresAt - 10_000 > Date.now()
}

// ---------------------------------------------------------------------------
// refresh 单飞（按账号）
// ---------------------------------------------------------------------------

/**
 * refresh 结果：
 * - ok：续期成功
 * - invalid：凭证失效（401/403 等）——可移除本地会话
 * - transient：网络/服务端瞬时故障 —— **绝不能**清登录态
 * - missing：本地无 refresh token
 */
export type RefreshResult =
  | { status: "ok" }
  | { status: "invalid" }
  | { status: "transient" }
  | { status: "missing" }

const refreshInFlight = new Map<string, Promise<RefreshResult>>()

function invalidateAccountLocally(accountId: string) {
  sessions.delete(accountId)
  persistedAccounts = persistedAccounts.filter((a) => a.id !== accountId)
  if (activeAccountId === accountId) {
    activeAccountId = persistedAccounts[0]?.id ?? null
    if (activeAccountId) {
      const next = persistedAccounts.find((a) => a.id === activeAccountId)
      if (next) {
        getOrCreateSession(activeAccountId).refreshToken = next.refreshToken
      }
    }
  }
  void persistAccountsToStorage()
}

async function doRefresh(accountId: string): Promise<RefreshResult> {
  const session = sessions.get(accountId)
  const refreshToken = session?.refreshToken
  if (!refreshToken) return { status: "missing" }

  const account = persistedAccounts.find((a) => a.id === accountId)
  // legacy/pending 用当前 runtime 基址；正式账号用其 serverBaseUrl
  const base =
    account?.serverBaseUrl ?? getServerBaseUrl() ?? null
  const baseUrl = base ? `${base}${API_PREFIX}` : API_PREFIX

  try {
    const response = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!response.ok) {
      // 仅凭证类错误才视为会话失效；5xx / 429 / 其它 HTTP 保持本地登录
      if (response.status === 401 || response.status === 403) {
        invalidateAccountLocally(accountId)
        return { status: "invalid" }
      }
      return { status: "transient" }
    }
    const tokens = (await response.json()) as TokenResponse
    const next = getOrCreateSession(accountId)
    next.accessToken = tokens.access_token
    next.accessExpiresAt = new Date(tokens.access_expires_at).getTime()
    next.refreshToken = tokens.refresh_token
    // 同步 refresh 到持久化
    const idx = persistedAccounts.findIndex((a) => a.id === accountId)
    if (idx >= 0) {
      const list = persistedAccounts.slice()
      list[idx] = { ...list[idx]!, refreshToken: tokens.refresh_token }
      if (tokens.user) list[idx] = { ...list[idx]!, user: tokens.user }
      persistedAccounts = list
      void persistAccountsToStorage()
    }
    return { status: "ok" }
  } catch {
    // 断网 / CORS / 服务器未启动：保留 refresh token
    return { status: "transient" }
  }
}

/** 静默续期（含原因）：按账号并发去重 */
export function refreshSessionResult(
  accountId?: string | null,
): Promise<RefreshResult> {
  const id = accountId ?? activeAccountId
  if (!id) return Promise.resolve({ status: "missing" })
  let flight = refreshInFlight.get(id)
  if (!flight) {
    flight = doRefresh(id).finally(() => {
      refreshInFlight.delete(id)
    })
    refreshInFlight.set(id, flight)
  }
  return flight
}

/** 静默续期：成功返回 true；网络失败也返回 false（不区分原因时用 Result 版） */
export async function refreshSession(
  accountId?: string | null,
): Promise<boolean> {
  const result = await refreshSessionResult(accountId)
  return result.status === "ok"
}

/**
 * 确保拿到可用的 access token（Gateway IDENTIFY 也用它）。
 * 返回 null 表示当前无有效会话。
 */
export async function ensureAccessToken(
  accountId?: string | null,
): Promise<string | null> {
  const id = accountId ?? activeAccountId
  if (!id) return null
  const session = sessions.get(id) ?? null
  if (accessTokenUsable(session)) return session!.accessToken
  if (await refreshSession(id)) {
    return sessions.get(id)?.accessToken ?? null
  }
  return null
}

function sessionExpired(accountId: string | null) {
  if (accountId) dropAccountSession(accountId)
  else clearSession()
  onSessionExpired?.(accountId)
}

// ---------------------------------------------------------------------------
// 请求封装
// ---------------------------------------------------------------------------

async function parseError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string }
  }
  let retryAfterSeconds: number | undefined
  const retryAfter = response.headers.get("Retry-After")
  if (retryAfter) {
    const parsed = Number.parseInt(retryAfter, 10)
    if (Number.isFinite(parsed)) retryAfterSeconds = parsed
  }
  return new ApiError(
    response.status,
    body.error?.code ?? "UNKNOWN_ERROR",
    body.error?.message ?? `请求失败（${response.status}）`,
    retryAfterSeconds,
  )
}

export type ApiInit = Omit<RequestInit, "body"> & { body?: BodyInit | null }

/**
 * 认证请求主入口：自动带 Bearer、access 过期先静默续期、401 refresh 后重试一次。
 * 204 返回 undefined。
 */
export async function api<T>(
  path: string,
  init: ApiInit = {},
  retry = true,
): Promise<T> {
  const accountId = activeAccountId
  const session = activeSession()
  if (!accessTokenUsable(session) && hasRefreshToken(accountId)) {
    await refreshSession(accountId)
  }
  const headers = new Headers(init.headers)
  if (
    init.body != null &&
    !headers.has("Content-Type") &&
    !(typeof FormData !== "undefined" && init.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json")
  }
  const token = activeSession()?.accessToken
  if (token) headers.set("Authorization", `Bearer ${token}`)

  let response: Response
  try {
    response = await fetch(`${apiBaseURL()}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "网络请求失败，请检查网络连接",
      undefined,
    )
  }

  if (response.status === 401 && retry) {
    const refreshed = await refreshSessionResult(accountId)
    if (refreshed.status === "ok") {
      return api<T>(path, init, false)
    }
    // 仅凭证失效时踢下线；网络/5xx 等瞬时失败保留登录态
    if (refreshed.status === "invalid" || refreshed.status === "missing") {
      sessionExpired(accountId)
    }
    throw await parseError(response)
  }
  if (!response.ok) {
    throw await parseError(response)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** 无需登录态的请求（signup/login/refresh/logout 等） */
export async function apiPublic<T>(
  path: string,
  init: ApiInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  if (
    init.body != null &&
    !headers.has("Content-Type") &&
    !(typeof FormData !== "undefined" && init.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json")
  }
  let response: Response
  try {
    response = await fetch(`${apiBaseURL()}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "网络请求失败，请检查网络连接",
      undefined,
    )
  }
  if (!response.ok) {
    throw await parseError(response)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 组装查询串；undefined/null/空串跳过 */
export function qs(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value))
    }
  }
  const text = search.toString()
  return text ? `?${text}` : ""
}

/**
 * Gateway WebSocket 地址：优先由运行时服务器基址推导（http→ws / https→wss）；
 * 未连接服务器时回退当前 host（浏览器 dev 下由 vite 代理转发）。
 */
export function gatewayURL(): string {
  const base = getServerBaseUrl()
  if (base) return `${base.replace(/^http/i, "ws")}${API_PREFIX}/gateway`
  if (typeof window === "undefined") return ""
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${window.location.host}${API_PREFIX}/gateway`
}
