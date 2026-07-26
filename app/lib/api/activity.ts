// 活跃度（每日活跃分 / 等级 / 每日积分奖励）用户端 API。

import { api, qs } from "./http"

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
