// 邀请免登录预检（/invite-api/* 端点）。
// 注意：这些端点不在 /gapi/v1 前缀下，且在提交邀请链接、尚未持久化基址时调用，
// 因此显式传入 serverBaseUrl 而不走 api() 封装。

import { ApiError } from "./http"

async function precheckFetch<T>(url: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "无法连接服务器，请检查链接或网络",
      undefined
    )
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string }
    }
    throw new ApiError(
      response.status,
      body.error?.code ?? "INVITE_CHECK_FAILED",
      body.error?.message ?? `邀请校验失败（${response.status}）`
    )
  }
  return (await response.json()) as T
}

export type RegistrationInviteInfo = {
  code: string
  server_name: string
  expires_at: string | null
  remaining_uses: number | null
}

/** 注册邀请预检；404 = 邀请无效；410 = 已过期/用尽/撤销；网络失败 NETWORK_ERROR */
export async function precheckRegistrationInvite(
  serverBaseUrl: string,
  code: string
): Promise<RegistrationInviteInfo> {
  return precheckFetch<RegistrationInviteInfo>(
    `${serverBaseUrl}/invite-api/registration/${encodeURIComponent(code)}`
  )
}

export type GuildInviteInfo = {
  code: string
  expires_at: string | null
  guild: {
    id: string
    name: string
    member_count: number
  }
  description: string
  portal: {
    app_name: string
  }
  signup_enabled: boolean
}

/** 社区（guild）邀请预检；404 = 不存在或已失效；网络失败 NETWORK_ERROR */
export async function precheckGuildInvite(
  serverBaseUrl: string,
  code: string
): Promise<GuildInviteInfo> {
  return precheckFetch<GuildInviteInfo>(
    `${serverBaseUrl}/invite-api/invites/${encodeURIComponent(code)}`
  )
}
