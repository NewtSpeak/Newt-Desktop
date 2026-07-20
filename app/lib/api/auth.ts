// 鉴权端点（POST /gapi/v1/auth/*、GET /gapi/v1/users/@me）。

import { api, apiPublic, clearSession, getRefreshToken, setSession } from "./http"
import type { TokenResponse, User } from "./types"

export type SignupInput = {
  /** 2-32 字符 */
  username: string
  email: string
  /** 8-128 字符 */
  password: string
}

/** 注册成功即持有会话（201）；403 SIGNUP_DISABLED、409 ACCOUNT_EXISTS */
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

/** 登出：吊销 refresh token（幂等，失败也照常清本地会话） */
export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken()
  if (refreshToken) {
    await apiPublic<void>("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    }).catch(() => undefined)
  }
  clearSession()
}

/** 当前登录用户 */
export const getMe = () => api<User>("/users/@me")
