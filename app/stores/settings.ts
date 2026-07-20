// 客户端设置 store（docs 16 P0）：偏好持久化 localStorage（键 owl.settings），
// 结构按域划分（voice / appearance / notifications / presence）；
// 面板开关与当前分栏为会话态，不持久化。
// 可同步域（voice/appearance/notifications/presence）另经 app/lib/settings-sync.ts
// 推送到服务端 PUT /users/@me/settings 做跨端同步。
//
// 外观域为「真实生效」项：applyAppearance 把主题写到 html 根节点的 dark class、
// 字体档位写到 html font-size 百分比；跟随系统通过 matchMedia 监听。

import { create } from "zustand"
import { persist } from "zustand/middleware"

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type ThemeMode = "dark" | "light" | "system"
export type MessageDensity = "comfortable" | "compact"
export type VoiceInputMode = "voice-activity" | "push-to-talk"

export type VoiceSettings = {
  /** 输入设备 deviceId；null = 系统默认 */
  inputDeviceId: string | null
  /** 输出设备 deviceId；null = 系统默认 */
  outputDeviceId: string | null
  /** 输入音量 0-200（%） */
  inputVolume: number
  /** 输出音量 0-200（%） */
  outputVolume: number
  /** 输入模式：语音激活 / 按键说话（本期仅存储，语音层接入见 TODO） */
  inputMode: VoiceInputMode
  /** 语音激活灵敏度 0-100 */
  vadSensitivity: number
  /** 回声消除 */
  aec: boolean
  /** 噪声抑制 */
  ns: boolean
  /** 自动增益 */
  agc: boolean
  /** 播放他人入场语音（docs 12 FR-03①） */
  voicePackEnabled: boolean
  /** 入场音效音量 0-100（独立于通话输出音量） */
  voicePackVolume: number
  /** 「不再播放此人的入场音效」本地屏蔽名单（user_id，docs 12 FR-19） */
  voicePackMutedUsers: string[]
}

export type AppearanceSettings = {
  theme: ThemeMode
  /** html 根字体大小档位（px），基准 16 */
  fontSize: number
  /** 消息密度（存储备用，消息区尚未接入） */
  density: MessageDensity
}

/** 通知层级（docs 15 FR-08）：全部消息 / 仅 @提及 / 无 */
export type NotifyLevel = "all" | "mentions" | "none"

export type GuildNotifyOverride = {
  /** 缺省 = 跟随全局 */
  level?: NotifyLevel
  /** 静音（直到重新开启）：不产生系统通知，未读白点不显示；@ 计数保留（docs 15 FR-09） */
  muted?: boolean
  /** 定时静音截止时间戳（ms）；到期惰性失效（判定时比较，无定时器） */
  mutedUntil?: number
}

/** 频道级覆盖（docs 15 FR-08 三层）：缺省 = 继承服务器 */
export type ChannelNotifyOverride = {
  level?: NotifyLevel
  muted?: boolean
  mutedUntil?: number
}

export type NotificationSettings = {
  /** 全局默认层级（默认仅 @提及，对齐 Discord） */
  globalLevel: NotifyLevel
  /** 每服务器覆盖 */
  perGuild: Record<string, GuildNotifyOverride>
  /** 每频道覆盖（层级判定优先于服务器覆盖，docs 15 FR-08） */
  perChannel: Record<string, ChannelNotifyOverride>
  /** 新消息提示音开关（docs 15 FR-16，通过通知管线后播放） */
  soundMessageEnabled: boolean
  /** @提及提示音开关（音高与普通消息不同） */
  soundMentionEnabled: boolean
  /** 提示音音量 0-100（独立于通话输出音量） */
  soundVolume: number
}

/** 覆盖项当前是否处于静音（muted 常开 或 mutedUntil 未到期） */
export function isOverrideMuted(
  override: { muted?: boolean; mutedUntil?: number } | undefined,
  now = Date.now(),
): boolean {
  if (!override) return false
  if (override.muted) return true
  return typeof override.mutedUntil === "number" && override.mutedUntil > now
}

/** 定时静音时长选项（docs 15 FR-09；null = 直到重新开启） */
export const MUTE_DURATION_OPTIONS: { label: string; ms: number | null }[] = [
  { label: "15 分钟", ms: 15 * 60_000 },
  { label: "1 小时", ms: 60 * 60_000 },
  { label: "8 小时", ms: 8 * 60 * 60_000 },
  { label: "24 小时", ms: 24 * 60 * 60_000 },
  { label: "直到重新开启", ms: null },
]

/** 剩余静音时长的展示文案；非定时静音返回 null */
export function muteRemainingLabel(
  override: { muted?: boolean; mutedUntil?: number } | undefined,
  now = Date.now(),
): string | null {
  if (!override || override.muted) return null
  if (typeof override.mutedUntil !== "number" || override.mutedUntil <= now) return null
  const minutes = Math.ceil((override.mutedUntil - now) / 60_000)
  if (minutes < 60) return `剩余 ${minutes} 分钟`
  return `剩余 ${Math.ceil(minutes / 60)} 小时`
}

/** 手动 Presence 状态（隐身仅本人可选；离线不是可选项） */
export type ManualPresenceStatus = "online" | "idle" | "dnd" | "invisible"

export type PresenceSettings = {
  /** 手动选择的状态，连接建立后上报恢复（docs 01 FR-18/§9.2） */
  manualStatus: ManualPresenceStatus
}

export type SettingsSection =
  | "account"
  | "voice"
  | "notifications"
  | "appearance"
  | "keybinds"
  | "about"

const DEFAULT_VOICE: VoiceSettings = {
  inputDeviceId: null,
  outputDeviceId: null,
  inputVolume: 100,
  outputVolume: 100,
  inputMode: "voice-activity",
  vadSensitivity: 50,
  aec: true,
  ns: true,
  agc: true,
  voicePackEnabled: true,
  voicePackVolume: 80,
  voicePackMutedUsers: [],
}

const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: "system",
  fontSize: 16,
  density: "comfortable",
}

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  globalLevel: "mentions",
  perGuild: {},
  perChannel: {},
  soundMessageEnabled: true,
  soundMentionEnabled: true,
  soundVolume: 60,
}

const DEFAULT_PRESENCE: PresenceSettings = {
  manualStatus: "online",
}

export const FONT_SIZE_STEPS = [12, 14, 15, 16, 18, 20, 24] as const

type SettingsState = {
  voice: VoiceSettings
  appearance: AppearanceSettings
  notifications: NotificationSettings
  presence: PresenceSettings

  // ---- 会话态（不持久化）----
  panelOpen: boolean
  activeSection: SettingsSection

  setVoice: (patch: Partial<VoiceSettings>) => void
  setAppearance: (patch: Partial<AppearanceSettings>) => void
  setNotifications: (patch: Partial<NotificationSettings>) => void
  setGuildNotify: (guildId: string, patch: GuildNotifyOverride) => void
  setChannelNotify: (channelId: string, patch: ChannelNotifyOverride) => void
  setPresence: (patch: Partial<PresenceSettings>) => void
  /** 语音包屏蔽名单增删（docs 12 FR-19） */
  setVoicePackMuted: (userId: string, muted: boolean) => void
  openPanel: (section?: SettingsSection) => void
  closePanel: () => void
  setSection: (section: SettingsSection) => void
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

/** 覆盖条目规范化：剔除 undefined / 已过期字段；全部回落默认时返回 null（删条目） */
function normalizeOverride<
  T extends { level?: NotifyLevel; muted?: boolean; mutedUntil?: number },
>(merged: T): T | null {
  const next = { ...merged }
  if (!next.muted) delete next.muted
  if (typeof next.mutedUntil !== "number" || next.mutedUntil <= Date.now()) {
    delete next.mutedUntil
  }
  if (next.level === undefined) delete next.level
  if (next.level === undefined && !next.muted && next.mutedUntil === undefined) {
    return null
  }
  return next
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      voice: DEFAULT_VOICE,
      appearance: DEFAULT_APPEARANCE,
      notifications: DEFAULT_NOTIFICATIONS,
      presence: DEFAULT_PRESENCE,

      panelOpen: false,
      activeSection: "account",

      setVoice: (patch) => set((state) => ({ voice: { ...state.voice, ...patch } })),
      setAppearance: (patch) =>
        set((state) => ({ appearance: { ...state.appearance, ...patch } })),
      setNotifications: (patch) =>
        set((state) => ({ notifications: { ...state.notifications, ...patch } })),
      setGuildNotify: (guildId, patch) =>
        set((state) => {
          const merged = normalizeOverride({
            ...state.notifications.perGuild[guildId],
            ...patch,
          })
          const perGuild = { ...state.notifications.perGuild }
          // 全部回落默认时清掉条目，避免 perGuild 越积越大
          if (merged) perGuild[guildId] = merged
          else delete perGuild[guildId]
          return { notifications: { ...state.notifications, perGuild } }
        }),
      setChannelNotify: (channelId, patch) =>
        set((state) => {
          const merged = normalizeOverride({
            ...state.notifications.perChannel[channelId],
            ...patch,
          })
          const perChannel = { ...state.notifications.perChannel }
          if (merged) perChannel[channelId] = merged
          else delete perChannel[channelId]
          return { notifications: { ...state.notifications, perChannel } }
        }),
      setPresence: (patch) =>
        set((state) => ({ presence: { ...state.presence, ...patch } })),
      setVoicePackMuted: (userId, muted) =>
        set((state) => {
          const list = state.voice.voicePackMutedUsers
          const next = muted
            ? list.includes(userId)
              ? list
              : [...list, userId]
            : list.filter((id) => id !== userId)
          if (next === list) return state
          return { voice: { ...state.voice, voicePackMutedUsers: next } }
        }),

      openPanel: (section) =>
        set((state) => ({
          panelOpen: true,
          activeSection: section ?? state.activeSection,
        })),
      closePanel: () => set({ panelOpen: false }),
      setSection: (section) => set({ activeSection: section }),
    }),
    {
      name: "owl.settings",
      // 仅持久化偏好域；面板会话态排除
      partialize: (state) => ({
        voice: state.voice,
        appearance: state.appearance,
        notifications: state.notifications,
        presence: state.presence,
      }),
      // 合并默认值，保证新增字段在旧持久化数据上有默认值
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<
          Pick<SettingsState, "voice" | "appearance" | "notifications" | "presence">
        >
        return {
          ...current,
          voice: { ...current.voice, ...saved.voice },
          appearance: { ...current.appearance, ...saved.appearance },
          notifications: { ...current.notifications, ...saved.notifications },
          presence: { ...current.presence, ...saved.presence },
        }
      },
    },
  ),
)

// ---------------------------------------------------------------------------
// 外观生效（html 根节点副作用）
// ---------------------------------------------------------------------------

function applyAppearance(appearance: AppearanceSettings, systemDark: boolean) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  const dark = appearance.theme === "dark" || (appearance.theme === "system" && systemDark)
  root.classList.toggle("dark", dark)
  // 字体档位按 16px 基准换算成百分比，rem 布局整体缩放
  root.style.fontSize = `${(appearance.fontSize / 16) * 100}%`
}

let appearanceBound = false

/** 挂载外观副作用：应用当前值 + 订阅 store 变化 + 监听系统主题。幂等。 */
export function initAppearance() {
  if (appearanceBound || typeof window === "undefined") return
  appearanceBound = true
  const media = window.matchMedia("(prefers-color-scheme: dark)")
  const apply = () => applyAppearance(useSettingsStore.getState().appearance, media.matches)
  media.addEventListener("change", apply)
  useSettingsStore.subscribe(apply)
  apply()
}
