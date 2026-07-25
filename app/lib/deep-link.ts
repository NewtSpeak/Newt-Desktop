// 解析 owlspeak:// 深链，导航到对应路由。
// 支持：oauth/device、oauth/authorize、register、invite（既有）。

import {
  parseInviteLink,
  setRuntimeServerBaseUrl,
} from "~/lib/server-connection"

export type DeepLinkAction =
  | { kind: "oauth-device"; userCode: string; server?: string | null }
  | { kind: "oauth-authorize"; search: string; server?: string | null }
  | { kind: "invite"; href: string }
  | { kind: "navigate"; path: string }
  | null

/**
 * 解析任意深链 URL（owlspeak://… 或 https 邀请链）。
 * 返回前端应执行的导航动作。
 */
export function parseDeepLink(raw: string): DeepLinkAction {
  const input = raw.trim()
  if (!input) return null

  // 先尝试邀请/注册（含 owlspeak://invite|register）
  const invite = parseInviteLink(input)
  if (invite) {
    // 交给现有添加服务器流程：用 query 传参到首页
    const q = new URLSearchParams({
      invite: invite.code,
      server: invite.serverBaseUrl,
      kind: invite.kind,
    })
    return { kind: "navigate", path: `/?${q.toString()}` }
  }

  // owlspeak://oauth/device?user_code=&server=
  const oauthDevice = input.match(
    /^(?!https?:)[a-z][a-z0-9+.-]*:\/\/oauth\/device\/?(?:\?(.*))?$/i,
  )
  if (oauthDevice) {
    const params = new URLSearchParams(oauthDevice[1] ?? "")
    const userCode = (params.get("user_code") ?? "").toUpperCase()
    const server = params.get("server")
    if (!userCode) return null
    return { kind: "oauth-device", userCode, server }
  }

  // owlspeak://oauth/authorize?... 原样带到 /oauth/authorize
  const oauthAuth = input.match(
    /^(?!https?:)[a-z][a-z0-9+.-]*:\/\/oauth\/authorize\/?(?:\?(.*))?$/i,
  )
  if (oauthAuth) {
    const qs = oauthAuth[1] ?? ""
    const params = new URLSearchParams(qs)
    return {
      kind: "oauth-authorize",
      search: qs ? `?${qs}` : "",
      server: params.get("server"),
    }
  }

  return null
}

/** 应用深链：设置服务器基址（若有）并返回应 navigate 的 path */
export function resolveDeepLinkPath(raw: string): string | null {
  const action = parseDeepLink(raw)
  if (!action) return null
  switch (action.kind) {
    case "oauth-device":
      if (action.server) {
        try {
          const base = new URL(action.server).origin
          setRuntimeServerBaseUrl(base)
        } catch {
          // ignore
        }
      }
      return `/oauth/device?user_code=${encodeURIComponent(action.userCode)}`
    case "oauth-authorize":
      if (action.server) {
        try {
          setRuntimeServerBaseUrl(new URL(action.server).origin)
        } catch {
          // ignore
        }
      }
      return `/oauth/authorize${action.search}`
    case "navigate":
      return action.path
    case "invite":
      return action.href
    default:
      return null
  }
}
