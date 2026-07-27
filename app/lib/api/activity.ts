// 活跃度（每日活跃分 / 等级 / 每日积分奖励）用户端 API。

import type { GameCatalogEntry } from "~/lib/activity/game-catalog"
import { api, apiBaseURL, ensureAccessToken, qs } from "./http"

/** 今日实时计数（未结算，score_estimate 为预估分） */
export type ActivityToday = {
  day: string
  msg_count: number
  voice_minutes: number
  reaction_count: number
  login_count: number
  score_estimate: number
}

/** 各维度每日计分上限 */
export type ActivityCaps = {
  message: number
  voice_minutes: number
  reactions: number
  login: number
}

/** 各维度单位分值 */
export type ActivityWeights = {
  message: number
  voice_minute: number
  reaction: number
  login: number
}

/** 历史某天（已结算 granted=true 时含发放积分） */
export type ActivityHistoryEntry = {
  day: string
  msg_count: number
  voice_minutes: number
  reaction_count: number
  login_count: number
  score: number
  granted_points: number
  granted: boolean
}

/** 下一等级信息；满级时整体为 null */
export type ActivityNextLevel = {
  level: number
  threshold: number
  progress_pct: number
}

export type MyActivity = {
  today: ActivityToday
  caps: ActivityCaps
  weights: ActivityWeights
  /** 活跃分 → 积分换算率（如 0.1） */
  points_rate: number
  /** 当前等级的每日积分加成百分比（如 4 = +4%） */
  level_bonus_pct: number
  total_score: number
  level: number
  next_level: ActivityNextLevel | null
  history: ActivityHistoryEntry[]
}

export const getMyActivity = (days = 14) =>
  api<MyActivity>(`/users/@me/activity${qs({ days })}`)

// ---- 活动封面 / 游戏目录（Server-18 Rich Presence）----

export type GameCatalogResponse = {
  version: number
  games: GameCatalogEntry[]
}

export type ResolveCoverResponse = {
  kind: "game" | "music"
  name?: string
  details?: string
  cover_url?: string
  source?: string
}

export const getGameCatalog = () =>
  api<GameCatalogResponse>("/activity/game-catalog")

export const resolveCover = (params: {
  kind: "game" | "music"
  name: string
  artist?: string
}) => {
  const q = new URLSearchParams({ kind: params.kind, name: params.name })
  if (params.artist) q.set("artist", params.artist)
  return api<ResolveCoverResponse>(`/activity/resolve-cover?${q.toString()}`)
}

/** 上传活动封面（PNG/JPEG/WebP），返回相对路径 /public-assets/activity/... */
export async function uploadActivityCover(
  pngBase64: string,
  filename = "icon.png",
): Promise<string | null> {
  try {
    const binary = atob(pngBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: "image/png" })
    const form = new FormData()
    form.append("file", blob, filename)
    const token = await ensureAccessToken()
    const res = await fetch(`${apiBaseURL()}/activity/cover`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
    if (!res.ok) return null
    const data = (await res.json()) as { cover_url?: string }
    return data.cover_url ?? null
  } catch {
    return null
  }
}
