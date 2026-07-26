// 活跃度状态：本人活跃摘要（今日计数 / 等级 / 历史），
// REST 拉全量 + Gateway ACTIVITY_UPDATE / ACTIVITY_LEVEL_UP 增量合并。
// 实时事件不携带等级进度百分比：load 时由服务端 progress_pct 反解上一级门槛，
// 增量到达后在本地重算，保证进度条对实时事件平滑响应。

import { create } from "zustand"

import { getMyActivity, type MyActivity } from "~/lib/api/activity"
import type {
  ActivityLevelUpPayload,
  ActivityUpdatePayload,
} from "~/lib/gateway/events"

type ActivityStatus = "idle" | "loading" | "loaded" | "error"

type ActivityState = {
  summary: MyActivity | null
  status: ActivityStatus
  /** 当前等级的累计门槛（由 load 时的 progress_pct 反解；满级/无下一级为 null） */
  prevThreshold: number | null

  reset: () => void
  /** 拉取全量摘要（默认最近 14 天） */
  load: (days?: number) => Promise<void>
  /** 合并 ACTIVITY_UPDATE：更新今日计数 / 预估分 / 总分 / 等级（并重算进度） */
  applyRealtime: (payload: ActivityUpdatePayload) => void
  /** 合并 ACTIVITY_LEVEL_UP：更新等级 / 总分（并重拉刷新 next_level） */
  applyLevelUp: (payload: ActivityLevelUpPayload) => void
}

/**
 * 反解上一级累计门槛：pct = (T - P) / (Th - P) → P = (T - pct·Th) / (1 - pct)。
 * pct ≥ 100% 或数据异常时返回 null（进度条退化为服务端快照值）。
 */
function derivePrevThreshold(summary: MyActivity): number | null {
  const next = summary.next_level
  if (!next) return null
  const pct = next.progress_pct / 100
  if (!Number.isFinite(pct) || pct >= 1) return null
  const prev = (summary.total_score - pct * next.threshold) / (1 - pct)
  if (!Number.isFinite(prev) || prev < 0 || prev >= next.threshold) return 0
  return prev
}

function recomputeProgressPct(
  totalScore: number,
  threshold: number,
  prevThreshold: number,
): number {
  if (threshold <= prevThreshold) return 100
  const pct = ((totalScore - prevThreshold) / (threshold - prevThreshold)) * 100
  return Math.min(100, Math.max(0, pct))
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  summary: null,
  status: "idle",
  prevThreshold: null,

  reset: () => set({ summary: null, status: "idle", prevThreshold: null }),

  load: async (days = 14) => {
    set({ status: "loading" })
    try {
      const summary = await getMyActivity(days)
      set({ summary, status: "loaded", prevThreshold: derivePrevThreshold(summary) })
    } catch (e) {
      // 保留旧数据便于降级展示
      set({ status: "error" })
      throw e
    }
  },

  applyRealtime: (payload) => {
    const { summary, prevThreshold } = get()
    if (!summary) return
    const levelChanged = payload.level !== summary.level
    let nextLevel = summary.next_level
    if (!levelChanged && nextLevel && prevThreshold != null) {
      nextLevel = {
        ...nextLevel,
        progress_pct: recomputeProgressPct(
          payload.total_score,
          nextLevel.threshold,
          prevThreshold,
        ),
      }
    }
    set({
      summary: {
        ...summary,
        today: {
          ...summary.today,
          day: payload.day,
          msg_count: payload.msg_count,
          voice_minutes: payload.voice_minutes,
          reaction_count: payload.reaction_count,
          login_count: payload.login_count,
          score_estimate: payload.score_estimate,
        },
        total_score: payload.total_score,
        level: payload.level,
        next_level: nextLevel,
      },
    })
    if (levelChanged) {
      // 等级变化后 next_level 门槛已失真，重拉一次刷新（低频，开销可忽略）
      void get().load().catch(() => undefined)
    }
  },

  applyLevelUp: (payload) => {
    const summary = get().summary
    if (!summary) return
    set({
      summary: {
        ...summary,
        level: payload.level,
        total_score: payload.total_score,
      },
    })
    void get().load().catch(() => undefined)
  },
}))
