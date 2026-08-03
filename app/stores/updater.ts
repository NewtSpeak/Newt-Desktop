// 应用内更新状态（仅桌面 Tauri）

import { create } from "zustand"
import {
  isDesktopUpdaterSupported,
  phaseLabel,
  updaterCheckAndDownload,
  updaterGetStatus,
  updaterInstallNow,
  updaterListMirrors,
  updaterProbeMirrors,
  updaterSetAutoCheck,
  updaterSetInstallOnQuit,
  type MirrorProbeResult,
  type UpdateMirror,
  type UpdateStatus,
} from "~/lib/updater"

type UpdaterStore = {
  supported: boolean
  status: UpdateStatus | null
  mirrors: UpdateMirror[]
  /** id → 测速结果 */
  probeById: Record<string, MirrorProbeResult>
  probing: boolean
  installOnQuit: boolean
  busy: boolean
  error: string | null
  init: () => Promise<void>
  applyStatus: (status: UpdateStatus | null) => void
  applyProbe: (result: MirrorProbeResult) => void
  checkAndDownload: () => Promise<void>
  installNow: () => Promise<void>
  setAutoCheck: (enabled: boolean) => Promise<void>
  setInstallOnQuit: (enabled: boolean) => Promise<void>
  probeMirrors: () => Promise<void>
}

export const useUpdaterStore = create<UpdaterStore>((set, get) => ({
  supported: false,
  status: null,
  mirrors: [],
  probeById: {},
  probing: false,
  installOnQuit: true,
  busy: false,
  error: null,

  applyStatus: (status) => {
    set({
      status,
      error: status?.phase === "error" ? status.error ?? "更新失败" : null,
    })
  },

  applyProbe: (result) => {
    set((state) => ({
      probeById: { ...state.probeById, [result.id]: result },
    }))
  },

  init: async () => {
    if (!isDesktopUpdaterSupported()) {
      set({ supported: false, status: null })
      return
    }
    set({ supported: true })
    try {
      const [status, mirrors] = await Promise.all([
        updaterGetStatus(),
        updaterListMirrors(),
      ])
      set({ mirrors })
      get().applyStatus(status)
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  checkAndDownload: async () => {
    if (!get().supported || get().busy) return
    set({ busy: true, error: null })
    try {
      const status = await updaterCheckAndDownload()
      get().applyStatus(status)
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      set({ busy: false })
    }
  },

  installNow: async () => {
    if (!get().supported || get().busy) return
    set({ busy: true, error: null })
    try {
      await updaterInstallNow()
      // 成功后进程会退出；若未退出则刷新状态
      const status = await updaterGetStatus()
      get().applyStatus(status)
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  setAutoCheck: async (enabled) => {
    try {
      const status = await updaterSetAutoCheck(enabled)
      get().applyStatus(status)
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  setInstallOnQuit: async (enabled) => {
    set({ installOnQuit: enabled })
    try {
      await updaterSetInstallOnQuit(enabled)
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  probeMirrors: async () => {
    if (!get().supported || get().probing) return
    set({ probing: true })
    try {
      const results = await updaterProbeMirrors()
      const map: Record<string, MirrorProbeResult> = {}
      for (const r of results) map[r.id] = r
      set({ probeById: map })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      set({ probing: false })
    }
  },
}))

export function updaterStatusSummary(status: UpdateStatus | null): string {
  if (!status) return "—"
  return phaseLabel(status.phase)
}
