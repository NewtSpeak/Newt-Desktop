// 语音链路统一 debug 日志 + 结构化观测埋点（docs 13 §8；诊断面板数据源）。
//
// 埋点：内存 ring buffer（最近 200 条），每条含时间戳/事件类型/关闭码/migration_id/
// 阶段耗时；同时按事件类型与关闭码累计计数（CUTOVER 时长、迁移端到端耗时、
// ICE restart 次数等均以事件形式落入 buffer，计数从 countsByType 读取）。
// getVoiceDiagnostics() 供未来诊断面板（docs 16）导出。

export function vlog(...args: unknown[]) {
  console.debug("[voice]", ...args)
}

export function vwarn(...args: unknown[]) {
  console.warn("[voice]", ...args)
}

export function verror(...args: unknown[]) {
  console.error("[voice]", ...args)
}

// ---------------------------------------------------------------------------
// 结构化埋点
// ---------------------------------------------------------------------------

/** ring buffer 容量（docs 13 §8：最近 200 条） */
const DIAGNOSTICS_CAPACITY = 200

export type VoiceDiagnosticsEvent = {
  /** epoch ms */
  at: number
  /**
   * 事件类型，如 migration_start / migration_recv_switch / cutover /
   * migration_complete / migration_connect_timeout / ice_restart /
   * full_rejoin / signaling_closed / suspend / resume …
   */
  type: string
  /** 迁移全链路关联 id（FR-05，贯穿所有迁移日志） */
  migrationId?: string | null
  /** WSS 关闭码（signaling_closed 等事件携带） */
  closeCode?: string
  /** 阶段耗时（如 CUTOVER 时长、迁移端到端耗时、ICE restart 耗时） */
  durationMs?: number
  /** 其他上下文（node_id、attempt 次数等） */
  detail?: Record<string, unknown>
}

export type VoiceDiagnostics = {
  generatedAt: number
  /** 最近 200 条埋点事件（时间升序） */
  events: VoiceDiagnosticsEvent[]
  /** 事件类型 → 累计次数（如 ice_restart / full_rejoin / cutover） */
  countsByType: Record<string, number>
  /** 关闭码 → 累计次数（8 关闭码 + MIGRATED + 本地合成码，docs 13 §8） */
  closeCodes: Record<string, number>
}

const diagnosticsEvents: VoiceDiagnosticsEvent[] = []
const countsByType: Record<string, number> = {}
const closeCodeCounts: Record<string, number> = {}

/** 记录一条结构化埋点（同时输出 debug 日志，便于开发期观察） */
export function vevent(type: string, data?: Omit<VoiceDiagnosticsEvent, "at" | "type">) {
  const event: VoiceDiagnosticsEvent = { at: Date.now(), type, ...data }
  diagnosticsEvents.push(event)
  if (diagnosticsEvents.length > DIAGNOSTICS_CAPACITY) {
    diagnosticsEvents.splice(0, diagnosticsEvents.length - DIAGNOSTICS_CAPACITY)
  }
  countsByType[type] = (countsByType[type] ?? 0) + 1
  if (data?.closeCode) {
    closeCodeCounts[data.closeCode] = (closeCodeCounts[data.closeCode] ?? 0) + 1
  }
  vlog(`[event] ${type}`, data ?? "")
}

/** 导出诊断快照（未来诊断面板 / 诊断包用，docs 16 FR-37） */
export function getVoiceDiagnostics(): VoiceDiagnostics {
  return {
    generatedAt: Date.now(),
    events: [...diagnosticsEvents],
    countsByType: { ...countsByType },
    closeCodes: { ...closeCodeCounts },
  }
}
