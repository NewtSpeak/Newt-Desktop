// 运行时「当前服务器」连接状态。
//
// 桌面端不预置任何服务端信息：服务器基址由用户提供的邀请链接（注册邀请或
// 社区邀请）在运行时解析得出。基址/服务器名本身不敏感，持久化在 localStorage；refresh token
// 仍走 OS 级安全存储（见 lib/api/http.ts / lib/secure-storage.ts）。
//
// 认证流程中先切换「运行时基址」（不落盘），登录/注册成功后再持久化；
// 取消认证时回退到已保存的基址。

const SERVER_BASE_URL_KEY = "owl.server.base_url"
const SERVER_NAME_KEY = "owl.server.name"

export type SavedServer = {
  baseUrl: string
  name: string | null
}

function readSaved(): SavedServer | null {
  if (typeof window === "undefined") return null
  const baseUrl = localStorage.getItem(SERVER_BASE_URL_KEY)
  if (!baseUrl) return null
  return { baseUrl, name: localStorage.getItem(SERVER_NAME_KEY) }
}

/** 运行时生效的服务器基址；undefined = 尚未从 localStorage 懒加载 */
let runtimeBaseUrl: string | null | undefined

/** 当前生效的服务器基址（无尾斜杠）；null = 尚未连接任何服务器 */
export function getServerBaseUrl(): string | null {
  if (runtimeBaseUrl === undefined)
    runtimeBaseUrl = readSaved()?.baseUrl ?? null
  return runtimeBaseUrl
}

/** 认证流程用：切换运行时基址但不落盘（后续 signup/login 请求指向新服务器） */
export function setRuntimeServerBaseUrl(baseUrl: string | null) {
  runtimeBaseUrl = baseUrl
}

/** 认证流程取消时：回退到已持久化的服务器基址 */
export function restoreSavedServerBaseUrl() {
  runtimeBaseUrl = readSaved()?.baseUrl ?? null
}

/** 登录/注册成功后：持久化当前运行时基址与服务器名（默认服务器，供欢迎页重登） */
export function persistServerConnection(name: string | null) {
  if (typeof window === "undefined") return
  const baseUrl = getServerBaseUrl()
  if (!baseUrl) return
  localStorage.setItem(SERVER_BASE_URL_KEY, baseUrl)
  if (name) localStorage.setItem(SERVER_NAME_KEY, name)
  else localStorage.removeItem(SERVER_NAME_KEY)
}

/**
 * 切换激活账号时同步运行时基址（并更新「默认服务器」以便欢迎页重登）。
 * 不改动已保存账号列表。
 */
export function applyAccountServer(baseUrl: string, name: string | null) {
  runtimeBaseUrl = baseUrl
  if (typeof window === "undefined") return
  localStorage.setItem(SERVER_BASE_URL_KEY, baseUrl)
  if (name) localStorage.setItem(SERVER_NAME_KEY, name)
  else localStorage.removeItem(SERVER_NAME_KEY)
}

/** 已持久化的服务器（登出/会话过期后用于「重新登录」入口） */
export function getSavedServer(): SavedServer | null {
  return readSaved()
}

// ---------------------------------------------------------------------------
// 邀请链接解析（注册邀请 / 社区邀请）
// ---------------------------------------------------------------------------

export type ParsedInviteLink =
  | {
      kind: "registration"
      /** 服务器基址（含协议，无尾斜杠） */
      serverBaseUrl: string
      code: string
    }
  | {
      kind: "guild"
      /** 服务器基址（含协议，无尾斜杠） */
      serverBaseUrl: string
      code: string
      /** 深链形态可携带的目标社区 id；分享链接形态没有 */
      guildId: string | null
    }

/** 去除粘贴常见的隐形字符（零宽字符/BOM/不换行空格）与首尾空白 */
function sanitizeInput(input: string): string {
  return input.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "").trim()
}

/** 校验并规范化服务器基址：仅接受 http(s)，去掉尾斜杠 */
function normalizeBaseUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  const path = url.pathname.replace(/\/+$/, "")
  return `${url.origin}${path}`
}

/**
 * 解析邀请链接，支持注册邀请与社区（guild）邀请两类：
 *   注册邀请：
 *     1. https://{服务器域名}/register/{code} —— origin 即服务器基址；
 *     2. {服务器域名}/register/{code} —— 无协议时本地地址补 http，其余补 https；
 *     3. {scheme}://register?server={url编码的服务器基址}&code={code} 深链。
 *   社区邀请：
 *     1. https://{服务器域名}/invite/{code}（分享落地页链接）；
 *     2. {服务器域名}/invite/{code} —— 无协议，补法同上；
 *     3. {scheme}://invite?code={code}&server={url编码的服务器基址}&guild={guildId}
 *        深链（guild 参数可选）。
 * 深链 scheme 由服务端门户配置（默认 newtspeak），手动解析避免各 WebView
 * 对非标准 scheme 的 URL 解析差异。无法识别时返回 null。
 */
export function parseInviteLink(input: string): ParsedInviteLink | null {
  const raw = sanitizeInput(input)
  if (!raw) return null

  // 深链形态：{scheme}://register 或 {scheme}://invite（scheme 任意，排除 http/https）
  const deepLink = raw.match(
    /^(?!https?:)[a-z][a-z0-9+.-]*:\/\/(register|invite)\/?(?:\?(.*))?$/i
  )
  if (deepLink) {
    const params = new URLSearchParams(deepLink[2] ?? "")
    const server = params.get("server")
    const code = params.get("code")
    if (!server || !code) return null
    const serverBaseUrl = normalizeBaseUrl(server)
    if (!serverBaseUrl) return null
    if (deepLink[1].toLowerCase() === "register")
      return { kind: "registration", serverBaseUrl, code }
    return { kind: "guild", serverBaseUrl, code, guildId: params.get("guild") }
  }

  // 分享链接形态：允许省略协议（如 "example.com/register/xxx"、"example.com/invite/xxx"）
  let candidate = raw
  if (
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) &&
    /^[^/\s]+\/(register|invite)\//i.test(candidate)
  ) {
    const isLocal = /^(localhost|127\.|\[?::1)/i.test(candidate)
    candidate = (isLocal ? "http://" : "https://") + candidate
  }
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  const segments = url.pathname.split("/").filter(Boolean)
  if (segments.length !== 2 || !segments[1]) return null
  const code = decodeURIComponent(segments[1])
  if (segments[0] === "register")
    return { kind: "registration", serverBaseUrl: url.origin, code }
  if (segments[0] === "invite")
    return { kind: "guild", serverBaseUrl: url.origin, code, guildId: null }
  return null
}

/** 两个基址是否指向同一服务器（按 origin 比较，容忍路径/尾斜杠差异） */
export function isSameServer(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return a === b
  }
}

/** 判断输入是否像裸邀请码（只有短码没有服务器地址） */
export function looksLikeBareInviteCode(input: string): boolean {
  return /^[a-z0-9]{6,20}$/i.test(sanitizeInput(input))
}
