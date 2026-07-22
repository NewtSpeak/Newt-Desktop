// 用户设置的服务端同步（docs 15 FR-11 / docs 16 §7-1）：
//   - 登录后 GET /users/@me/settings 拉取远端文档合并进本地 store；
//   - 本地可同步域（voice/appearance/notifications/presence）变化 → 防抖 PUT 整体替换；
//   - USER_SETTINGS_UPDATE 事件（他端修改）→ 合并回本地。
//
// 回环抑制：维护「最近一次与服务端一致的内容」快照 lastSyncedJson——
//   - 本地变化序列化后与之相同则跳过 PUT（含远端合并触发的 store 变化）；
//   - 远端事件内容与本地相同则跳过合并（自己 PUT 触发的回声）。

import { getMySettings, putMySettings } from "~/lib/api/users"
import { useSettingsStore } from "~/stores/settings"

const PUT_DEBOUNCE_MS = 1_500

/** 参与服务端同步的设置域（docs 17 §4.1：新增 guildPreferences / guildOrder） */
const SYNC_DOMAINS = [
  "voice",
  "appearance",
  "notifications",
  "presence",
  "privacy",
  "guildPreferences",
  "guildOrder",
] as const
type SyncDomain = (typeof SYNC_DOMAINS)[number]

/** 数组型域：远端整体替换而非对象浅合并 */
const ARRAY_DOMAINS: ReadonlySet<SyncDomain> = new Set(["guildOrder"])

function syncablePayload(): Record<string, unknown> {
  const state = useSettingsStore.getState()
  const payload: Record<string, unknown> = {}
  for (const domain of SYNC_DOMAINS) {
    payload[domain] = state[domain]
  }
  return payload
}

let lastSyncedJson = ""
let putTimer: ReturnType<typeof setTimeout> | null = null
let bound = false

/** 远端设置文档合并进本地 store（USER_SETTINGS_UPDATE / 登录拉取共用） */
export function applyRemoteSettings(doc: Record<string, unknown>) {
  const state = useSettingsStore.getState()
  const patch: Partial<Record<SyncDomain, unknown>> = {}
  for (const domain of SYNC_DOMAINS) {
    const incoming = doc[domain]
    if (incoming == null || typeof incoming !== "object") continue
    if (ARRAY_DOMAINS.has(domain)) {
      if (Array.isArray(incoming)) patch[domain] = incoming
      continue
    }
    if (!Array.isArray(incoming)) {
      patch[domain] = { ...state[domain], ...(incoming as Record<string, unknown>) }
    }
  }
  if (Object.keys(patch).length === 0) return

  // 与本地一致（自己 PUT 的回声）：只对齐快照，不触碰正在编辑的状态
  const nextJson = JSON.stringify({ ...syncablePayload(), ...patch })
  const currentJson = JSON.stringify(syncablePayload())
  if (nextJson === currentJson) {
    lastSyncedJson = currentJson
    return
  }
  // 先记快照再写 store，让 subscription 里的 PUT 判等后跳过
  lastSyncedJson = nextJson
  useSettingsStore.setState(patch as never)
}

function schedulePut() {
  if (putTimer) clearTimeout(putTimer)
  putTimer = setTimeout(() => {
    putTimer = null
    const payload = syncablePayload()
    const json = JSON.stringify(payload)
    if (json === lastSyncedJson) return
    lastSyncedJson = json
    void putMySettings(payload).catch(() => {
      // 失败允许下次变更重试；置空快照使下一次变化必然重发
      lastSyncedJson = ""
    })
  }, PUT_DEBOUNCE_MS)
}

/** 幂等：登录成功后调用一次 */
export function initSettingsSync() {
  if (bound || typeof window === "undefined") return
  bound = true

  void getMySettings()
    .then(({ settings }) => {
      if (settings && Object.keys(settings).length > 0) {
        applyRemoteSettings(settings)
      }
      // 无论有无远端文档，以合并后的本地状态为同步基线
      lastSyncedJson = JSON.stringify(syncablePayload())
    })
    .catch(() => undefined)

  useSettingsStore.subscribe(() => schedulePut())
}
