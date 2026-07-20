// Presence store（docs 01 §3.4）：user_id → 在线状态。
//   - READY 顶层 presences 快照重建（只含非 offline 用户；他人 invisible 已被服务端掩码）；
//   - PRESENCE_UPDATE 事件增量维护（他人 offline 时从表中移除，读不到 = 离线灰点）；
//   - 本人的「有效状态」= 手动状态（settings.presence.manualStatus）叠加本地空闲检测：
//     手动为 online 且键鼠空闲 10 分钟 → 自动 idle，恢复输入回 online（FR-19）。
//
// 上行时机：READY / RESUMED 后重放当前有效状态；用户切换 / 空闲翻转时即时上报。

import { create } from "zustand"

import { gateway } from "~/lib/gateway/client"
import type { PresenceEntry, PresenceStatus, PresenceUpdatePayload } from "~/lib/gateway/events"
import { useSettingsStore, type ManualPresenceStatus } from "./settings"

const IDLE_AFTER_MS = 10 * 60 * 1000

type PresenceState = {
  /** 非 offline 用户的状态表；缺失 = offline */
  statusByUser: Record<string, PresenceStatus>
  /** 本地空闲检测结果（仅当手动状态为 online 时生效） */
  autoIdle: boolean

  applySnapshot: (entries: PresenceEntry[]) => void
  applyUpdate: (payload: PresenceUpdatePayload) => void
  setAutoIdle: (idle: boolean) => void
  reset: () => void
}

export const usePresenceStore = create<PresenceState>()((set) => ({
  statusByUser: {},
  autoIdle: false,

  applySnapshot: (entries) => {
    const statusByUser: Record<string, PresenceStatus> = {}
    for (const entry of entries) {
      if (entry.status !== "offline") statusByUser[entry.user_id] = entry.status
    }
    set({ statusByUser })
  },

  applyUpdate: (payload) =>
    set((state) => {
      const next = { ...state.statusByUser }
      if (payload.status === "offline") delete next[payload.user_id]
      else next[payload.user_id] = payload.status
      return { statusByUser: next }
    }),

  setAutoIdle: (idle) =>
    set((state) => (state.autoIdle === idle ? state : { autoIdle: idle })),

  reset: () => set({ statusByUser: {}, autoIdle: false }),
}))

// ---------------------------------------------------------------------------
// 本人有效状态与上报
// ---------------------------------------------------------------------------

/** 本人当前应上报/展示的状态：手动 online 时叠加空闲检测 */
export function effectiveSelfStatus(): ManualPresenceStatus {
  const manual = useSettingsStore.getState().presence.manualStatus
  if (manual === "online" && usePresenceStore.getState().autoIdle) return "idle"
  return manual
}

/** 上报当前有效状态（连接建立后 / 状态变化时调用） */
export function reportSelfPresence() {
  gateway.sendPresence(effectiveSelfStatus())
}

/** 用户手动切换状态：存偏好（下次连接恢复）+ 即时上报 */
export function setManualPresence(status: ManualPresenceStatus) {
  useSettingsStore.getState().setPresence({ manualStatus: status })
  // 手动切走 online 时清掉空闲标记，切回 online 时重新计时
  usePresenceStore.getState().setAutoIdle(false)
  reportSelfPresence()
}

// ---------------------------------------------------------------------------
// 空闲检测（docs 01 FR-19）：无键鼠输入 10 分钟自动 idle；仅手动 online 时生效
// ---------------------------------------------------------------------------

let idleWatcherBound = false

/** 幂等：应用壳挂载时调用一次 */
export function initIdleWatcher() {
  if (idleWatcherBound || typeof window === "undefined") return
  idleWatcherBound = true

  let timer: ReturnType<typeof setTimeout> | null = null

  const goIdle = () => {
    if (useSettingsStore.getState().presence.manualStatus !== "online") return
    if (usePresenceStore.getState().autoIdle) return
    usePresenceStore.getState().setAutoIdle(true)
    reportSelfPresence()
  }

  const onActivity = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(goIdle, IDLE_AFTER_MS)
    if (usePresenceStore.getState().autoIdle) {
      usePresenceStore.getState().setAutoIdle(false)
      if (useSettingsStore.getState().presence.manualStatus === "online") {
        reportSelfPresence()
      }
    }
  }

  for (const event of ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const) {
    window.addEventListener(event, onActivity, { passive: true })
  }
  onActivity()
}
