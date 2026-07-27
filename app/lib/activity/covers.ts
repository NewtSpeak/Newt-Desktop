// 活动封面解析：游戏目录 + 服务端 /activity/resolve-cover（音乐 iTunes）

import { api } from "~/lib/api/http"
import { customGamesAsCatalog } from "./custom-games"
import {
  BUILTIN_GAME_CATALOG,
  matchGameInCatalog,
  type GameCatalogEntry,
} from "./game-catalog"

export type ResolvedCover = {
  kind: "game" | "music"
  name?: string
  details?: string
  cover_url?: string
  source?: "catalog" | "itunes" | "manual" | "none" | string
}

let remoteCatalog: GameCatalogEntry[] | null = null
let remoteCatalogFetchedAt = 0
const CATALOG_TTL_MS = 30 * 60_000

function mergeCatalog(base: GameCatalogEntry[]): GameCatalogEntry[] {
  // 自定义优先（同 id / 可执行名覆盖）
  const custom = customGamesAsCatalog()
  if (!custom.length) return base
  const byExec = new Set(
    custom.flatMap((g) => (g.executables ?? []).map((e) => e.toLowerCase())),
  )
  const filtered = base.filter(
    (g) =>
      !(g.executables ?? []).some((e) => byExec.has(e.toLowerCase())),
  )
  return [...custom, ...filtered]
}

/** 拉取服务端游戏目录（失败则用内置），并合并用户本地登记 */
export async function loadGameCatalog(): Promise<GameCatalogEntry[]> {
  if (remoteCatalog && Date.now() - remoteCatalogFetchedAt < CATALOG_TTL_MS) {
    return mergeCatalog(remoteCatalog)
  }
  try {
    const data = await api<{ version: number; games: GameCatalogEntry[] }>(
      "/activity/game-catalog",
    )
    if (data.games?.length) {
      remoteCatalog = data.games
      remoteCatalogFetchedAt = Date.now()
      return mergeCatalog(remoteCatalog)
    }
  } catch {
    // ignore
  }
  return mergeCatalog(BUILTIN_GAME_CATALOG)
}

/** 强制刷新目录缓存（登记新游戏后调用） */
export function invalidateGameCatalogCache() {
  remoteCatalog = null
  remoteCatalogFetchedAt = 0
}

export function isSafeCoverUrl(url: string | undefined | null): boolean {
  if (!url) return false
  const v = url.trim()
  const u = v.toLowerCase()
  return (
    u.startsWith("https://") ||
    u.startsWith("http://") ||
    v.startsWith("/public-assets/")
  )
}

/** 规范化封面 URL（http(s) 或本站 /public-assets/） */
export function normalizeCoverUrl(url: string | undefined | null): string | undefined {
  const v = url?.trim()
  if (!v || !isSafeCoverUrl(v)) return undefined
  return v.slice(0, 1024)
}

/**
 * 解析游戏封面：先本地/远端目录，再请求服务端 resolve（仍目录匹配）。
 */
export async function resolveGameCover(name: string): Promise<ResolvedCover> {
  const catalog = await loadGameCatalog()
  const hit = matchGameInCatalog(name, catalog)
  if (hit?.cover_url) {
    return {
      kind: "game",
      name: hit.name,
      cover_url: hit.cover_url,
      source: "catalog",
    }
  }
  try {
    const data = await api<ResolvedCover>(
      `/activity/resolve-cover?kind=game&name=${encodeURIComponent(name.trim())}`,
    )
    return {
      kind: "game",
      name: data.name || name,
      cover_url: normalizeCoverUrl(data.cover_url),
      source: data.source || "none",
    }
  } catch {
    return { kind: "game", name, source: "none" }
  }
}

/**
 * 解析音乐封面：服务端代理 iTunes Search（曲名 + 可选艺人）。
 * details 常为艺人。
 */
export async function resolveMusicCover(
  name: string,
  artist?: string,
): Promise<ResolvedCover> {
  const params = new URLSearchParams({ kind: "music", name: name.trim() })
  if (artist?.trim()) params.set("artist", artist.trim())
  try {
    const data = await api<ResolvedCover>(
      `/activity/resolve-cover?${params.toString()}`,
    )
    return {
      kind: "music",
      name: data.name || name,
      details: data.details || artist,
      cover_url: normalizeCoverUrl(data.cover_url),
      source: data.source || "none",
    }
  } catch {
    return { kind: "music", name, details: artist, source: "none" }
  }
}

/** 按活动类型解析封面 */
export async function resolveActivityCover(input: {
  type: string
  name: string
  details?: string
}): Promise<ResolvedCover> {
  const name = input.name.trim()
  if (!name) return { kind: "game", source: "none" }
  if (input.type === "listening") {
    return resolveMusicCover(name, input.details)
  }
  // 游戏 / 观看 / 直播等：优先游戏目录
  return resolveGameCover(name)
}
