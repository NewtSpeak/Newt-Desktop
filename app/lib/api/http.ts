// fetch 封装 + 会话（token）管理。
//
// 会话模型（docs 01）：
//   - access token（TTL 15 分钟）只存内存（模块级变量），不落盘；
//   - refresh token 持久化在 OS 级安全存储（Tauri keyring：macOS Keychain /
//     Windows Credential Manager / Linux Secret Service；浏览器 dev 回退
//     localStorage）。运行期在内存镜像一份，读为同步、写异步落盘；
//     冷启动必须先 await initTokenStorage()（auth store bootstrap 调用），
//     其中包含旧 localStorage 值的一次性迁移。
//   - 请求带 Authorization: Bearer；401 时自动 refresh 并重试一次，
//     refresh 也失败则触发 onSessionExpired（auth store 登出，回到欢迎界面）。
//   - API 基址不再硬编码：由运行时「当前服务器」状态（lib/server-connection.ts）
//     解析，见 apiBaseURL()。

import {
  isTauriRuntime,
  secureDelete,
  secureGet,
  secureSet,
} from "~/lib/secure-storage"
import { getServerBaseUrl } from "~/lib/server-connection"

import type { TokenResponse } from "./types"

const API_PREFIX = "/gapi/v1"
const REFRESH_TOKEN_KEY = "owl.refresh_token"

/**
 * 当前 API 基址：{运行时服务器基址}/gapi/v1。
 * 未连接任何服务器时退回相对路径（仅浏览器 dev 下经 vite 代理可用）。
 */
export function apiBaseURL(): string {
  const base = getServerBaseUrl()
  return base ? `${base}${API_PREFIX}` : API_PREFIX
}

/**
 * 把服务端返回的相对路径（如附件 download_url / upload_url，已含 /gapi/v1
 * 前缀）解析为指向当前服务器的完整 URL；绝对 URL 原样返回。
 */
export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const base = getServerBaseUrl()
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
    retryAfterSeconds?: number
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
// token 状态（access 存内存；refresh 安全存储 + 内存镜像）
// ---------------------------------------------------------------------------

let accessToken: string | null = null
let accessExpiresAt = 0

/** refresh token 内存镜像：initTokenStorage 完成后与安全存储保持一致 */
let refreshTokenCache: string | null = null
let tokenStorageInit: Promise<void> | null = null

/**
 * 冷启动初始化：从安全存储读取 refresh token 到内存镜像。
 * 一次性迁移：localStorage 里有旧值（首期过渡方案）就搬进安全存储后删除。
 * 幂等（并发去重），auth store bootstrap 必须先 await 它。
 */
export function initTokenStorage(): Promise<void> {
  tokenStorageInit ??= (async () => {
    if (typeof window === "undefined") return
    // 一次性迁移：仅 Tauri 环境需要（浏览器 dev 下安全存储本身就是 localStorage）
    if (isTauriRuntime()) {
      const legacy = localStorage.getItem(REFRESH_TOKEN_KEY)
      if (legacy) {
        await secureSet(REFRESH_TOKEN_KEY, legacy)
        localStorage.removeItem(REFRESH_TOKEN_KEY)
      }
    }
    refreshTokenCache = await secureGet(REFRESH_TOKEN_KEY)
  })()
  return tokenStorageInit
}

/** refresh 失败（会话彻底失效）时的回调，由 auth store 注册，用于登出跳转 */
let onSessionExpired: (() => void) | null = null

export function setOnSessionExpired(handler: (() => void) | null) {
  onSessionExpired = handler
}

export function getRefreshToken(): string | null {
  return refreshTokenCache
}

function saveRefreshToken(token: string | null) {
  refreshTokenCache = token
  if (typeof window === "undefined") return
  // 异步落盘安全存储；内存镜像已同步更新，调用方无需等待
  if (token) void secureSet(REFRESH_TOKEN_KEY, token)
  else void secureDelete(REFRESH_TOKEN_KEY)
}

/** 登录/注册/refresh 成功后写入新 token 对 */
export function setSession(tokens: TokenResponse) {
  accessToken = tokens.access_token
  accessExpiresAt = new Date(tokens.access_expires_at).getTime()
  saveRefreshToken(tokens.refresh_token)
}

/** 清空本地会话（不调服务端；吊销走 auth.logout） */
export function clearSession() {
  accessToken = null
  accessExpiresAt = 0
  saveRefreshToken(null)
}

export function hasRefreshToken(): boolean {
  return Boolean(getRefreshToken())
}

function accessTokenUsable(): boolean {
  // 提前 10 秒视为过期，避免边界上带着将过期的 token 出门
  return Boolean(accessToken) && accessExpiresAt - 10_000 > Date.now()
}

// ---------------------------------------------------------------------------
// refresh 单飞（并发请求只触发一次轮换：refresh token 轮换语义下重复调用会互相作废）
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<boolean> | null = null

async function doRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false
  try {
    const response = await fetch(`${apiBaseURL()}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!response.ok) {
      // 401 = refresh token 失效，清会话；5xx/网络抖动不清（下次还能再试）
      if (response.status === 401) clearSession()
      return false
    }
    const tokens = (await response.json()) as TokenResponse
    setSession(tokens)
    return true
  } catch {
    return false
  }
}

/** 静默续期：并发去重，返回是否成功 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

/**
 * 确保拿到可用的 access token（Gateway IDENTIFY 也用它）。
 * 返回 null 表示当前无有效会话。
 */
export async function ensureAccessToken(): Promise<string | null> {
  if (accessTokenUsable()) return accessToken
  if (await refreshSession()) return accessToken
  return null
}

function sessionExpired() {
  clearSession()
  onSessionExpired?.()
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
    retryAfterSeconds
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
  retry = true
): Promise<T> {
  if (!accessTokenUsable() && hasRefreshToken()) {
    await refreshSession()
  }
  const headers = new Headers(init.headers)
  // FormData 必须由浏览器自动带 multipart boundary，禁止强制 application/json
  if (
    init.body != null &&
    !headers.has("Content-Type") &&
    !(typeof FormData !== "undefined" && init.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json")
  }
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`)

  let response: Response
  try {
    response = await fetch(`${apiBaseURL()}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "网络请求失败，请检查网络连接",
      undefined
    )
  }

  if (response.status === 401 && retry) {
    if (await refreshSession()) {
      return api<T>(path, init, false)
    }
    sessionExpired()
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
  init: ApiInit = {}
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
      undefined
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
  params: Record<string, string | number | boolean | undefined | null>
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
