// OAuth2 设备授权 API（/oauth/v1/*，与 /gapi 平级）。
// 授权页用 aud=client 会话调用 approve/deny；device 信息可公开读取。

import { getServerBaseUrl } from "~/lib/server-connection"
import { parseJsonPreservingLargeInts } from "~/lib/snowflake"

import { ApiError, api, type ApiInit } from "./http"

function oauthBaseURL(): string {
  const base = getServerBaseUrl()
  return base ? `${base}/oauth/v1` : "/oauth/v1"
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!text) return undefined as T
  return parseJsonPreservingLargeInts<T>(text)
}

async function parseError(response: Response): Promise<ApiError> {
  let code = "UNKNOWN"
  let message = `请求失败（${response.status}）`
  try {
    const body = await readJson<{
      error?: { code?: string; message?: string } | string
      error_description?: string
    }>(response)
    if (body && typeof body.error === "object" && body.error) {
      code = body.error.code ?? code
      message = body.error.message ?? message
    } else if (typeof body?.error === "string") {
      code = body.error
      message = body.error_description ?? message
    }
  } catch {
    // ignore
  }
  return new ApiError(response.status, code, message)
}

async function oauthPublic<T>(path: string, init: ApiInit = {}): Promise<T> {
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
    response = await fetch(`${oauthBaseURL()}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "网络请求失败，请检查网络连接")
  }
  if (!response.ok) throw await parseError(response)
  if (response.status === 204) return undefined as T
  return readJson<T>(response)
}

/** 用 gapi 会话调 OAuth 需登录接口（approve/deny）。路径仍走 oauth 基址。 */
async function oauthAuthed<T>(path: string, init: ApiInit = {}): Promise<T> {
  // 复用 api() 的 refresh 逻辑：先拿一个 gapi 探测路径无意义，直接带 token 请求。
  // 这里手工带 Authorization，避免 api() 拼 /gapi 前缀。
  const { getAccessTokenForOAuth } = await import("./http")
  const token = await getAccessTokenForOAuth()
  const headers = new Headers(init.headers)
  if (
    init.body != null &&
    !headers.has("Content-Type") &&
    !(typeof FormData !== "undefined" && init.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json")
  }
  if (token) headers.set("Authorization", `Bearer ${token}`)

  let response: Response
  try {
    response = await fetch(`${oauthBaseURL()}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "网络请求失败，请检查网络连接")
  }
  if (response.status === 401) {
    // 再试一次：触发 gapi refresh
    try {
      await api("/users/@me")
    } catch {
      // ignore
    }
    const retryToken = await getAccessTokenForOAuth()
    if (retryToken) headers.set("Authorization", `Bearer ${retryToken}`)
    try {
      response = await fetch(`${oauthBaseURL()}${path}`, { ...init, headers })
    } catch {
      throw new ApiError(0, "NETWORK_ERROR", "网络请求失败，请检查网络连接")
    }
  }
  if (!response.ok) throw await parseError(response)
  if (response.status === 204) return undefined as T
  return readJson<T>(response)
}

export type DeviceInfo = {
  user_code: string
  client_id: string
  client_name: string
  description: string
  scope: string
  status: string
  expires_at: string
  expires_in: number
}

export type DeviceApproveResult = {
  status: string
  client_id: string
  client_name: string
  granted_scope: string
  user_id: string
  username: string
}

export async function getDeviceInfo(userCode: string): Promise<DeviceInfo> {
  const code = encodeURIComponent(userCode.trim().toUpperCase())
  return oauthPublic<DeviceInfo>(`/device/${code}`)
}

export async function approveDevice(
  userCode: string,
  scope?: string,
): Promise<DeviceApproveResult> {
  return oauthAuthed<DeviceApproveResult>("/device/approve", {
    method: "POST",
    body: JSON.stringify({
      user_code: userCode.trim().toUpperCase(),
      ...(scope ? { scope } : {}),
    }),
  })
}

export async function denyDevice(userCode: string): Promise<void> {
  await oauthAuthed("/device/deny", {
    method: "POST",
    body: JSON.stringify({ user_code: userCode.trim().toUpperCase() }),
  })
}

export type AuthorizeApproveInput = {
  client_id: string
  redirect_uri: string
  scope?: string
  code_challenge: string
  code_challenge_method?: string
  state?: string
}

export type AuthorizeApproveResult = {
  code: string
  expires_in: number
  redirect_uri: string
  scope: string
  state?: string
  client_id: string
}

/** PKCE：用户同意后签发 authorization code，并返回可跳转的 redirect_uri */
export async function approveAuthorize(
  input: AuthorizeApproveInput,
): Promise<AuthorizeApproveResult> {
  return oauthAuthed<AuthorizeApproveResult>("/authorize/approve", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      code_challenge_method: input.code_challenge_method ?? "S256",
    }),
  })
}

export type OAuthGrant = {
  session_id: string
  client_id: string
  client_name: string
  scope: string
  device_name?: string
  platform?: string
  ip_address?: string
  created_at: string
  session_created_at: string
  expires_at: string
}

export async function listOAuthGrants(): Promise<OAuthGrant[]> {
  const raw = await oauthAuthed<{ grants?: OAuthGrant[] }>("/grants")
  return raw.grants ?? []
}

export async function revokeOAuthGrant(sessionId: string): Promise<void> {
  await oauthAuthed(`/grants/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  })
}

export async function revokeAllOAuthGrants(): Promise<number> {
  const raw = await oauthAuthed<{ revoked?: number }>("/grants/revoke-all", {
    method: "POST",
    body: JSON.stringify({}),
  })
  return raw.revoked ?? 0
}

/** scope 人话说明 */
export const SCOPE_LABELS: Record<string, string> = {
  openid: "验证你的身份",
  profile: "读取你的用户名与资料",
  offline_access: "在你关闭 CLI 后仍保持登录（刷新令牌）",
  "gapi.full": "代表你使用 OwlSpeak 全部用户端能力（消息、服管等）",
  "gapi.read": "只读访问你的服务器与消息",
  "gapi.guilds.manage": "管理你有权限的服务器（频道、角色、成员等）",
  "platform.read": "读取平台管理信息（仅系统管理员）",
  "platform.admin": "执行平台管理操作（仅系统管理员，高风险）",
}

export function describeScopes(scope: string): { id: string; label: string; danger: boolean }[] {
  return scope
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => ({
      id,
      label: SCOPE_LABELS[id] ?? id,
      danger: id.startsWith("platform."),
    }))
}
