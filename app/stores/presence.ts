// Presence store（docs 01 §3.4 + Server-18）：user_id → 在线状态 + 自定义状态 + 活动。
//   - READY 顶层 presences 快照重建（只含非 offline 用户；他人 invisible 已被服务端掩码）；
//   - PRESENCE_UPDATE 事件增量维护（他人 offline 时从表中移除，读不到 = 离线灰点）；
//   - 本人的「有效状态」= 手动状态（settings.presence.manualStatus）叠加本地空闲检测：
//     手动为 online 且键鼠空闲 10 分钟 → 自动 idle，恢复输入回 online（FR-19）。
//   - 自定义状态（docs 01 FR-23）：emoji + 文本 + 可选过期；随 PRESENCE 上报与广播。
//   - 活动（Server-18）：手动/检测的结构化 activities；随 PRESENCE 上报。
//
// 上行时机：READY / RESUMED 后重放当前有效状态；用户切换 / 空闲翻转 / 活动变更时即时上报。

import { create } from "zustand"

import { gateway } from "~/lib/gateway/client"
import type {
  ActivityType,
  PresenceActivity,
  PresenceEntry,
  PresenceStatus,
  PresenceUpdatePayload,
} from "~/lib/gateway/events"
import {
  customReactionKey,
  isCustomReactionKey,
  parseCustomReactionItemId,
} from "~/lib/stickers/format"
import { useAuthStore } from "./auth"
import { useSettingsStore, type ManualPresenceStatus } from "./settings"

const IDLE_AFTER_MS = 10 * 60 * 1000

/**
 * 用户级自定义状态（内存；过期惰性判定）。
 * emoji 字段存小表情贴图键 `item:{id}`（与反应键一致），不允许 Unicode emoji。
 */
export type CustomPresence = {
  text?: string
  /** 小表情贴图键，形如 item:123；空 = 未选表情 */
  emoji?: string
  expiresAt?: string | null
}

export function isCustomPresenceExpired(
  custom: CustomPresence | null | undefined,
  now = Date.now(),
): boolean {
  if (!custom?.expiresAt) return false
  const ts = Date.parse(custom.expiresAt)
  if (Number.isNaN(ts)) return false
  return ts <= now
}

/** 规范化为合法贴图键；Unicode / 非法值一律丢弃 */
export function normalizeStatusEmoteKey(
  raw: string | undefined | null,
): string | undefined {
  const v = raw?.trim()
  if (!v) return undefined
  if (!isCustomReactionKey(v)) return undefined
  const id = parseCustomReactionItemId(v)
  if (!id) return undefined
  return customReactionKey(id)
}

export function statusEmoteItemId(
  custom: CustomPresence | null | undefined,
): string | null {
  return parseCustomReactionItemId(custom?.emoji?.trim() ?? "")
}

export function isCustomPresenceEmpty(
  custom: CustomPresence | null | undefined,
): boolean {
  if (!custom) return true
  const emote = normalizeStatusEmoteKey(custom.emoji)
  return !custom.text?.trim() && !emote
}

export function hasCustomStatus(
  custom: CustomPresence | null | undefined,
): boolean {
  return (
    !!custom &&
    !isCustomPresenceExpired(custom) &&
    !isCustomPresenceEmpty(custom)
  )
}

/**
 * 纯文案摘要（不含贴图键）。
 * 仅有贴图时返回空串；展示组件请配合 CustomEmoteImg。
 */
export function formatCustomStatus(
  custom: CustomPresence | null | undefined,
): string {
  if (!hasCustomStatus(custom)) return ""
  return custom!.text?.trim() ?? ""
}

/** title / aria 用：有文案用文案，否则「自定义状态」 */
export function customStatusTitle(
  custom: CustomPresence | null | undefined,
): string {
  if (!hasCustomStatus(custom)) return ""
  const text = custom!.text?.trim()
  if (text) return text
  return "自定义状态"
}

function normalizeCustom(
  entry: {
    custom_text?: string
    custom_emoji?: string
    custom_expires_at?: string | null
  } | null | undefined,
): CustomPresence | undefined {
  if (!entry) return undefined
  const text = entry.custom_text?.trim() || undefined
  // 只接受小表情贴图键；历史 Unicode 状态忽略 emoji 位
  const emoji = normalizeStatusEmoteKey(entry.custom_emoji)
  const expiresAt = entry.custom_expires_at ?? null
  if (!text && !emoji) return undefined
  const custom: CustomPresence = { text, emoji, expiresAt }
  if (isCustomPresenceExpired(custom)) return undefined
  return custom
}

function customFromSettings(): CustomPresence | undefined {
  const p = useSettingsStore.getState().presence
  const custom: CustomPresence = {
    text: p.customText?.trim() || undefined,
    emoji: normalizeStatusEmoteKey(p.customEmoji),
    expiresAt: p.customExpiresAt ?? null,
  }
  if (isCustomPresenceEmpty(custom) || isCustomPresenceExpired(custom)) {
    return undefined
  }
  return custom
}

function sanitizeCoverUrl(url: string | undefined | null): string | undefined {
  const v = url?.trim()
  if (!v) return undefined
  const lower = v.toLowerCase()
  if (
    lower.startsWith("https://") ||
    lower.startsWith("http://") ||
    v.startsWith("/public-assets/")
  ) {
    return v.slice(0, 1024)
  }
  return undefined
}

function normalizeActivities(
  raw: PresenceActivity[] | undefined | null,
): PresenceActivity[] {
  if (!raw?.length) return []
  const out: PresenceActivity[] = []
  for (const a of raw) {
    if (!a?.type || !a?.name?.trim() || !a?.source) continue
    const large = sanitizeCoverUrl(a.assets?.large_image)
    const small = sanitizeCoverUrl(a.assets?.small_image)
    const assets =
      large || small || a.assets?.large_text || a.assets?.small_text
        ? {
            large_image: large,
            large_text: a.assets?.large_text?.trim().slice(0, 128) || undefined,
            small_image: small,
            small_text: a.assets?.small_text?.trim().slice(0, 128) || undefined,
          }
        : undefined
    out.push({
      type: a.type,
      name: a.name.trim().slice(0, 128),
      details: a.details?.trim().slice(0, 128) || undefined,
      state: a.state?.trim().slice(0, 128) || undefined,
      application_id: a.application_id,
      url: a.url,
      assets,
      timestamps: a.timestamps,
      source: a.source,
    })
    if (out.length >= 3) break
  }
  return out
}

/** 活动展示前缀（中文 UI） */
export function activityPrefix(type: ActivityType | string): string {
  switch (type) {
    case "playing":
      return "正在玩"
    case "listening":
      return "正在听"
    case "watching":
      return "正在看"
    case "streaming":
      return "正在直播"
    case "competing":
      return "竞技中"
    default:
      return ""
  }
}

/** 主活动一行文案：正在玩 原神 */
export function formatPrimaryActivity(
  activities: PresenceActivity[] | undefined | null,
): string {
  const a = activities?.[0]
  if (!a?.name) return ""
  const prefix = activityPrefix(a.type)
  return prefix ? `${prefix} ${a.name}` : a.name
}

type PresenceState = {
  /** 非 offline 用户的状态表；缺失 = offline */
  statusByUser: Record<string, PresenceStatus>
  /** 非 offline 用户的自定义状态；缺失/过期 = 无 */
  customByUser: Record<string, CustomPresence>
  /** 非 offline 用户的活动列表（已按观察者隐私过滤后的服务端结果） */
  activitiesByUser: Record<string, PresenceActivity[]>
  /** 本机自动检测结果（仅本人上报用，不经 READY 他人路径） */
  detectedActivities: PresenceActivity[]
  /** 本地空闲检测结果（仅当手动状态为 online 时生效） */
  autoIdle: boolean

  applySnapshot: (entries: PresenceEntry[]) => void
  applyUpdate: (payload: PresenceUpdatePayload) => void
  setDetectedActivities: (acts: PresenceActivity[]) => void
  setAutoIdle: (idle: boolean) => void
  reset: () => void
}

export const usePresenceStore = create<PresenceState>()((set) => ({
  statusByUser: {},
  customByUser: {},
  activitiesByUser: {},
  detectedActivities: [],
  autoIdle: false,

  applySnapshot: (entries) => {
    const statusByUser: Record<string, PresenceStatus> = {}
    const customByUser: Record<string, CustomPresence> = {}
    const activitiesByUser: Record<string, PresenceActivity[]> = {}
    for (const entry of entries) {
      if (entry.status === "offline") continue
      statusByUser[entry.user_id] = entry.status
      const custom = normalizeCustom(entry)
      if (custom) customByUser[entry.user_id] = custom
      const acts = normalizeActivities(entry.activities)
      if (acts.length) activitiesByUser[entry.user_id] = acts
    }
    set({ statusByUser, customByUser, activitiesByUser })
  },

  applyUpdate: (payload) =>
    set((state) => {
      const nextStatus = { ...state.statusByUser }
      const nextCustom = { ...state.customByUser }
      const nextActs = { ...state.activitiesByUser }
      if (payload.status === "offline") {
        delete nextStatus[payload.user_id]
        delete nextCustom[payload.user_id]
        delete nextActs[payload.user_id]
      } else {
        nextStatus[payload.user_id] = payload.status
        const custom = normalizeCustom(payload)
        if (custom) nextCustom[payload.user_id] = custom
        else delete nextCustom[payload.user_id]
        // activities 字段：服务端始终在变更时带上当前合并结果；省略视为清空
        const acts = normalizeActivities(payload.activities)
        if (acts.length) nextActs[payload.user_id] = acts
        else delete nextActs[payload.user_id]
      }
      return {
        statusByUser: nextStatus,
        customByUser: nextCustom,
        activitiesByUser: nextActs,
      }
    }),

  setDetectedActivities: (acts) =>
    set({ detectedActivities: normalizeActivities(acts) }),

  setAutoIdle: (idle) =>
    set((state) => (state.autoIdle === idle ? state : { autoIdle: idle })),

  reset: () =>
    set({
      statusByUser: {},
      customByUser: {},
      activitiesByUser: {},
      detectedActivities: [],
      autoIdle: false,
    }),
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

/**
 * 成员列表用状态：本人用本地有效状态；他人缺失或 invisible 视作 offline。
 * 返回值仅 online / idle / dnd / offline（列表分组不出现 invisible）。
 */
export function memberListStatus(
  userId: string,
  selfId: string | undefined,
  statusByUser: Record<string, PresenceStatus>,
  selfEffective?: PresenceStatus,
): "online" | "idle" | "dnd" | "offline" {
  if (selfId && userId === selfId) {
    const s = selfEffective ?? effectiveSelfStatus()
    if (s === "invisible") return "offline"
    if (s === "online" || s === "idle" || s === "dnd") return s
    return "offline"
  }
  const s = statusByUser[userId]
  if (s === "online" || s === "idle" || s === "dnd") return s
  return "offline"
}

/** 读取本人当前自定义状态（settings 为权威，已过期则视为空） */
export function effectiveSelfCustom(): CustomPresence | undefined {
  return customFromSettings()
}

function manualActivityFromSettings(): PresenceActivity[] {
  const p = useSettingsStore.getState().presence
  if (!p.activityEnabled || !p.activityName?.trim()) return []
  const type = (p.activityType || "playing") as ActivityType
  const name = p.activityName.trim().slice(0, 128)
  const cover = sanitizeCoverUrl(p.activityCoverUrl)
  const coverText =
    p.activityCoverText?.trim().slice(0, 128) || name || undefined
  return [
    {
      type,
      name,
      details: p.activityDetails?.trim().slice(0, 128) || undefined,
      source: "manual",
      assets: cover
        ? { large_image: cover, large_text: coverText }
        : undefined,
      timestamps: p.activityStartedAt
        ? { start: p.activityStartedAt }
        : undefined,
    },
  ]
}

/**
 * 本人应上报/展示的活动：
 * 1) 手动覆盖开启 → 仅手动
 * 2) 否则优先自动检测结果
 * 3) 无检测时回落手动（activityEnabled）
 */
export function effectiveSelfActivities(): PresenceActivity[] {
  const p = useSettingsStore.getState().presence
  const manual = manualActivityFromSettings()
  if (p.activityManualOverride && manual.length) return manual
  const detected = usePresenceStore.getState().detectedActivities
  if (detected.length) return detected.slice(0, 3)
  return manual
}

/** 写入自动检测结果，并乐观更新本人 activities 缓存 */
export function applyDetectedActivities(acts: PresenceActivity[]) {
  usePresenceStore.getState().setDetectedActivities(acts)
  const selfId = useAuthStore.getState().user?.id
  if (!selfId) return
  // 手动覆盖时不改展示缓存（仍以手动为准）
  if (useSettingsStore.getState().presence.activityManualOverride) return
  const effective = effectiveSelfActivities()
  usePresenceStore.setState((state) => {
    const activitiesByUser = { ...state.activitiesByUser }
    if (effective.length) activitiesByUser[selfId] = effective
    else delete activitiesByUser[selfId]
    return { activitiesByUser }
  })
}

/**
 * 上报当前有效状态 + 自定义状态 + 活动（连接建立后 / 状态变化时调用）。
 * includeActivities：默认 true，重放与活动变更时带 activities；仅切四态/空闲时也带上，
 * 避免服务端 session 活动被「省略」以外的路径弄丢（每次全量同步本端活动）。
 */
export function reportSelfPresence(opts?: { includeActivities?: boolean }) {
  // 服务端每次 PRESENCE 整表覆盖 custom；必须始终带上当前自定义状态，避免仅切四态时被清空
  const custom = customFromSettings()
  const includeActs = opts?.includeActivities !== false
  gateway.sendPresence(
    effectiveSelfStatus(),
    {
      text: custom?.text ?? "",
      emoji: custom?.emoji ?? "",
      expiresAt: custom?.expiresAt ?? null,
    },
    includeActs ? effectiveSelfActivities() : undefined,
  )
}

/** 用户手动切换四态：存偏好 + 即时上报（保留自定义状态） */
export function setManualPresence(status: ManualPresenceStatus) {
  useSettingsStore.getState().setPresence({ manualStatus: status })
  // 手动切走 online 时清掉空闲标记，切回 online 时重新计时
  usePresenceStore.getState().setAutoIdle(false)
  reportSelfPresence()
}

/**
 * 设置/清除自定义状态（docs 01 FR-23）。
 * 传入空 text+emoji 即清除；expiresAt 为 ISO 字符串或 null（不过期）。
 */
export function setCustomPresence(input: {
  text?: string
  /** 小表情贴图键 item:{id}，或空清除表情 */
  emoji?: string
  expiresAt?: string | null
}) {
  const text = input.text?.trim() ?? ""
  const emoji = normalizeStatusEmoteKey(input.emoji) ?? ""
  const empty = !text && !emoji
  useSettingsStore.getState().setPresence({
    customText: empty ? "" : text,
    customEmoji: empty ? "" : emoji,
    customExpiresAt: empty ? null : (input.expiresAt ?? null),
  })
  // 乐观写入本人缓存，避免等事件回环
  const selfId = useAuthStore.getState().user?.id
  if (selfId) {
    const custom = empty
      ? undefined
      : normalizeCustom({
          custom_text: text,
          custom_emoji: emoji,
          custom_expires_at: input.expiresAt ?? null,
        })
    usePresenceStore.setState((state) => {
      const customByUser = { ...state.customByUser }
      if (custom) customByUser[selfId] = custom
      else delete customByUser[selfId]
      return { customByUser }
    })
  }
  reportSelfPresence()
}

/** 从 store 读取某用户当前有效自定义状态（含过期过滤） */
export function getCustomPresence(userId: string): CustomPresence | undefined {
  const custom = usePresenceStore.getState().customByUser[userId]
  if (!custom || isCustomPresenceExpired(custom) || isCustomPresenceEmpty(custom)) {
    return undefined
  }
  return custom
}

/** 读取某用户活动（本人优先本地 settings 乐观值） */
export function getActivities(userId: string): PresenceActivity[] {
  const selfId = useAuthStore.getState().user?.id
  if (selfId && userId === selfId) {
    return effectiveSelfActivities()
  }
  return usePresenceStore.getState().activitiesByUser[userId] ?? []
}

/**
 * 设置/清除手动活动（Server-18）。
 * name 为空即清除；type 默认 playing；coverUrl 为 https 封面。
 */
export function setManualActivity(input: {
  enabled?: boolean
  type?: ActivityType
  name?: string
  details?: string
  /** 封面 URL（https）；空串清除封面 */
  coverUrl?: string | null
  coverText?: string | null
}) {
  const name = input.name?.trim() ?? ""
  const enabled = input.enabled !== false && !!name
  const type = input.type ?? "playing"
  const coverUrl =
    input.coverUrl === undefined
      ? useSettingsStore.getState().presence.activityCoverUrl
      : sanitizeCoverUrl(input.coverUrl) ?? ""
  const coverText =
    input.coverText === undefined
      ? useSettingsStore.getState().presence.activityCoverText
      : (input.coverText?.trim() ?? "")
  useSettingsStore.getState().setPresence({
    activityEnabled: enabled,
    activityManualOverride: enabled,
    activityType: enabled ? type : "playing",
    activityName: enabled ? name : "",
    activityDetails: enabled ? (input.details?.trim() ?? "") : "",
    activityStartedAt: enabled ? Date.now() : null,
    activityCoverUrl: enabled ? coverUrl : "",
    activityCoverText: enabled ? coverText : "",
  })
  const selfId = useAuthStore.getState().user?.id
  if (selfId) {
    const acts = effectiveSelfActivities()
    usePresenceStore.setState((state) => {
      const activitiesByUser = { ...state.activitiesByUser }
      if (acts.length) activitiesByUser[selfId] = acts
      else delete activitiesByUser[selfId]
      return { activitiesByUser }
    })
  }
  reportSelfPresence({ includeActivities: true })
}

/** 主活动封面 URL */
export function primaryActivityCover(
  activities: PresenceActivity[] | undefined | null,
): string | undefined {
  return sanitizeCoverUrl(activities?.[0]?.assets?.large_image)
}

/** 清除手动活动并解除覆盖，恢复自动检测 */
export function clearManualActivity() {
  useSettingsStore.getState().setPresence({
    activityEnabled: false,
    activityManualOverride: false,
    activityName: "",
    activityDetails: "",
    activityCoverUrl: "",
    activityCoverText: "",
    activityStartedAt: null,
  })
  const selfId = useAuthStore.getState().user?.id
  if (selfId) {
    const acts = effectiveSelfActivities()
    usePresenceStore.setState((state) => {
      const activitiesByUser = { ...state.activitiesByUser }
      if (acts.length) activitiesByUser[selfId] = acts
      else delete activitiesByUser[selfId]
      return { activitiesByUser }
    })
  }
  reportSelfPresence({ includeActivities: true })
}

/** 关闭手动覆盖，改回使用自动检测 */
export function resumeActivityAutoDetect() {
  clearManualActivity()
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
