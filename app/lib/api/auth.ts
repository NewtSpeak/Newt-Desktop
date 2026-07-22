// 鉴权端点（POST /gapi/v1/auth/*、GET /gapi/v1/users/@me）。

import {
  api,
  ApiError,
  apiPublic,
  clearSession,
  dropAccountSession,
  getActiveAccountId,
  getRefreshToken,
  setSession,
} from "./http"
import type { TokenResponse, User } from "./types"

export type SignupInput = {
  /** 2-32 字符 */
  username: string
  email: string
  /** 8-128 字符 */
  password: string
  /** 注册邀请码（通过注册邀请链接连接服务器时必带；与 guild_invite_code 互斥） */
  invite_code?: string
  /** 社区邀请码（通过社区邀请链接注册时携带，同样绕过注册开关；注册后需另行 join） */
  guild_invite_code?: string
}

/** 注册成功即持有会话（201）；403 SIGNUP_DISABLED / INVITE_INVALID、409 ACCOUNT_EXISTS */
export async function signup(input: SignupInput): Promise<TokenResponse> {
  const tokens = await apiPublic<TokenResponse>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(input),
  })
  setSession(tokens)
  return tokens
}

export type LoginInput = {
  /** 用户名或邮箱 */
  identifier: string
  password: string
}

/** 401 INVALID_CREDENTIALS；429 LOGIN_RATE_LIMITED（ApiError.retryAfterSeconds） */
export async function login(input: LoginInput): Promise<TokenResponse> {
  const tokens = await apiPublic<TokenResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  })
  setSession(tokens)
  return tokens
}

/**
 * 吊销指定 refresh token（可指定服务器基址；不修改本地多账号表）。
 * 用于退出某一个账号。
 * 网络不可达时抛出 NETWORK_ERROR，调用方不得清本地会话。
 */
export async function logoutAccount(
  refreshToken: string,
  serverBaseUrl: string,
): Promise<void> {
  const base = `${serverBaseUrl.replace(/\/+$/, "")}/gapi/v1`
  let response: Response
  try {
    response = await fetch(`${base}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "无法连接服务器，请恢复网络后再退出账号",
    )
  }
  // 服务端有响应（含 4xx）即视为可达；仅网络层失败阻断退出
  void response
}

/**
 * 登出当前激活账号：吊销其 refresh 并仅移除该账号本地会话。
 * 网络失败时抛错且不清本地。若需清空全部账号请用 auth store 的 logoutAll。
 */
export async function logout(): Promise<void> {
  const accountId = getActiveAccountId()
  const refreshToken = getRefreshToken(accountId)
  if (refreshToken) {
    try {
      await apiPublic<void>("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
    } catch (error) {
      if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
        throw new ApiError(
          0,
          "NETWORK_ERROR",
          "无法连接服务器，请恢复网络后再退出账号",
        )
      }
      // 其它 HTTP 错误（如 token 已失效）仍允许清本地
    }
  }
  if (accountId) dropAccountSession(accountId)
  else clearSession()
}

/** 当前登录用户 */
export const getMe = () => api<User>("/users/@me")
