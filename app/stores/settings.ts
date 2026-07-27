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

import type {
  DfnPresetId,
  DfnTuningParams,
  DtlnPresetId,
  DtlnTuningParams,
  NoiseModelId,
  WasmNsModelId,
} from "~/lib/noise-suppression"
import {
  clampDfnTuning,
  clampDtlnTuning,
  DEFAULT_DFN_PRESET_ID,
  DEFAULT_DTLN_PRESET_ID,
  defaultDfnTuningFromPreset,
  defaultDtlnTuningFromPreset,
  resolveDfnPreset,
  resolveDtlnPreset,
} from "~/lib/noise-suppression"

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
  /** 输入模式：语音激活 / 按键说话（docs 16 FR-08） */
  inputMode: VoiceInputMode
  /**
   * 按键说话绑定键（KeyboardEvent.code，如 KeyV / Space / Mouse4）。
   * 仅应用焦点内生效；全局热键需系统权限插件（P1）。
   */
  pttKey: string
  /** PTT 释放后延迟关麦（ms，0–2000，docs 16 FR-08） */
  pttReleaseDelayMs: number
  /** 语音激活灵敏度 0-100 */
  vadSensitivity: number
  /** 回声消除 */
  aec: boolean
  /** 噪声抑制（总开关，docs 20 FR-S01） */
  ns: boolean
  /**
   * 降噪模型（docs 20 FR-S02/S03）：ns=true 时生效；
   * WASM 模型时关闭浏览器 noiseSuppression 约束避免双重处理（FR-S05）。
   */
  nsModel: NoiseModelId
  /**
   * 每模型记忆的降噪强度 0–100（docs 20 FR-S06；干/湿混合比，缺省 100 全湿）。
   */
  nsStrengthByModel: Partial<Record<NoiseModelId, number>>
  /**
   * DeepFilterNet 专用调参：预设 + 衰减上限 + 人声清晰度。
   * 默认预设「屏蔽环境噪音与键鼠」。
   */
  dfnPreset: DfnPresetId
  dfnAttenuationLimitDb: number
  dfnPresenceGainDb: number
  /**
   * DTLN 专用调参：预设 + 人声清晰度 + 输出补偿。
   * 默认预设「屏蔽环境噪音与键鼠」。
   */
  dtlnPreset: DtlnPresetId
  dtlnPresenceGainDb: number
  dtlnMakeupGainDb: number
  /**
   * 对他人「本地下行降噪」名单（user_id → true，docs 20 FR-R06）。
   * 决议 R4 跨端同步（随 voice 域整体走 settings-sync）；
   * 决议 R1：关 ns 总开关时暂停处理但名单保留。
   */
  localNs: Record<string, true>
  /**
   * 每用户下行降噪模型覆盖（docs 20 FR-R04 P1）；缺省 = 跟随全局 nsModel。
   */
  localNsModels: Record<string, WasmNsModelId>
  /**
   * 下行同时降噪软上限覆盖（docs 20 FR-R09 P1）；null = 按模型默认
   * （决议 R6：轻量 8 路 / DeepFilterNet 4 路）。仅 toast 提示，不硬拦截。
   */
  localNsMaxTracks: number | null
  /** 自动增益 */
  agc: boolean
  /**
   * 立体声采集/编码（双声道 Opus）。
   * 默认关：普通耳机麦与 AEC 场景以单声道为主；开启后请求 channelCount=2。
   */
  stereo: boolean
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
  /** 抑制 @everyone/@here 的打断（通知与声音）；@ 计数保留（docs 17 FR-11） */
  suppressEveryone?: boolean
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
  /** 系统通知桌面弹窗开关（docs 21 FR-09；安全类强制开） */
  desktopFriendRequest: boolean
  desktopFriendAccept: boolean
  desktopGuildModeration: boolean
  desktopSystemAnnounce: boolean
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
  /** 自定义状态文本（docs 01 FR-23；连接后随 PRESENCE 重放） */
  customText: string
  /** 自定义状态 emoji（Unicode） */
  customEmoji: string
  /** 自定义状态过期时间 ISO；null = 不过期 */
  customExpiresAt: string | null
  /** 手动活动开关（Server-18） */
  activityEnabled: boolean
  /** 活动类型：playing / listening / watching / … */
  activityType: string
  /** 活动名称（必填才展示） */
  activityName: string
  /** 活动详情（可选） */
  activityDetails: string
  /** 活动开始时间 epoch ms；null = 未设置 */
  activityStartedAt: number | null
  /** 活动封面 URL（https，游戏/专辑图） */
  activityCoverUrl: string
  /** 封面悬停文案（可选，默认活动名） */
  activityCoverText: string
  /**
   * 手动活动覆盖自动检测（Server-18 M2）：
   * true = 展示/上报手填活动，忽略进程/媒体检测。
   */
  activityManualOverride: boolean
  /**
   * 自动捕捉焦点游戏（仅 Desktop）：跟随前台窗口实时更新，无需手选。
   * 开启后内部约 1.5s 轮询，不受 detectIntervalSec 限制。
   */
  detectGames: boolean
  /** 自动检测正在播放的音乐（macOS / Windows SMTC / Linux playerctl） */
  detectMedia: boolean
  /** 其它检测轮询间隔秒数 5–30（仅音乐时使用；游戏焦点固定 ~1.5s） */
  detectIntervalSec: number
}

/**
 * 每服务器客户端个人偏好（GPS，docs 17 FR-01/FR-02 A 类）：
 * 稀疏存储——未修改的服不落条目；随 settings-sync 跨端同步。
 */
export type GuildPreferences = {
  /** 已折叠的分类频道 id（docs 17 FR-20） */
  collapsedCategoryIds?: string[]
  /** 隐藏已静音频道（当前选中与有 @ 的仍显示，docs 17 FR-21） */
  hideMutedChannels?: boolean
  /**
   * 允许本服成员因「共同服务器」向我发起私信（docs 17 FR-18 / Server-16 BM.2）。
   * 好友私信不受影响；缺省 true。服务端专用 API 就绪后改为权威源。
   */
  allowDmsFromMembers?: boolean
}

/** 账号级隐私设置（docs 19 / Server-16 BM；本地镜像，裁决以服务端为准） */
export type FriendRequestFrom =
  | "everyone"
  | "mutual_friends"
  | "mutual_guilds"
  | "nobody"
export type DmFrom = "everyone" | "friends" | "mutual_guilds" | "nobody"

export type ShowActivityTo = "everyone" | "friends" | "nobody"

export type PrivacySettings = {
  friendRequestFrom: FriendRequestFrom
  dmFrom: DmFrom
  /** 非好友私信先进消息请求箱 */
  messageRequestFilter: boolean
  showMutualGuilds: boolean
  publicProfileToNonFriends: boolean
  /** 活动（正在玩/听）对谁可见（Server-18；默认 friends） */
  showActivityTo: ShowActivityTo
}

export type SettingsSection =
  | "account"
  | "profile"
  | "privacy"
  | "applications"
  | "voice"
  | "notifications"
  | "appearance"
  | "keybinds"
  | "stickers"
  | "cosmetics-shop"
  | "cosmetics-inventory"
  | "activity"
  | "about"

const DEFAULT_VOICE: VoiceSettings = {
  inputDeviceId: null,
  outputDeviceId: null,
  inputVolume: 100,
  outputVolume: 100,
  inputMode: "voice-activity",
  pttKey: "KeyV",
  pttReleaseDelayMs: 200,
  vadSensitivity: 50,
  aec: true,
  ns: true,
  nsModel: "deepfilternet",
  nsStrengthByModel: {
    // 默认 DFN / DTLN 预设配套强度
    deepfilternet: resolveDfnPreset(DEFAULT_DFN_PRESET_ID).strength ?? 100,
    dtln: resolveDtlnPreset(DEFAULT_DTLN_PRESET_ID).strength ?? 100,
  },
  dfnPreset: DEFAULT_DFN_PRESET_ID,
  dfnAttenuationLimitDb:
    defaultDfnTuningFromPreset(DEFAULT_DFN_PRESET_ID).attenuationLimitDb,
  dfnPresenceGainDb:
    defaultDfnTuningFromPreset(DEFAULT_DFN_PRESET_ID).presenceGainDb,
  dtlnPreset: DEFAULT_DTLN_PRESET_ID,
  dtlnPresenceGainDb:
    defaultDtlnTuningFromPreset(DEFAULT_DTLN_PRESET_ID).presenceGainDb,
  dtlnMakeupGainDb:
    defaultDtlnTuningFromPreset(DEFAULT_DTLN_PRESET_ID).makeupGainDb,
  localNs: {},
  localNsModels: {},
  localNsMaxTracks: null,
  agc: true,
  stereo: false,
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
  desktopFriendRequest: true,
  desktopFriendAccept: true,
  desktopGuildModeration: true,
  desktopSystemAnnounce: false,
}

const DEFAULT_PRESENCE: PresenceSettings = {
  manualStatus: "online",
  customText: "",
  customEmoji: "",
  customExpiresAt: null,
  activityEnabled: false,
  activityType: "playing",
  activityName: "",
  activityDetails: "",
  activityStartedAt: null,
  activityCoverUrl: "",
  activityCoverText: "",
  activityManualOverride: false,
  detectGames: false,
  detectMedia: false,
  detectIntervalSec: 10,
}

/** 安全默认：仅同服可加好友、仅好友可私信、请求箱开（Server-16 BM.1） */
const DEFAULT_PRIVACY: PrivacySettings = {
  friendRequestFrom: "mutual_guilds",
  dmFrom: "friends",
  messageRequestFilter: true,
  showMutualGuilds: true,
  publicProfileToNonFriends: true,
  showActivityTo: "friends",
}

export const FONT_SIZE_STEPS = [12, 14, 15, 16, 18, 20, 24] as const

type SettingsState = {
  voice: VoiceSettings
  appearance: AppearanceSettings
  notifications: NotificationSettings
  presence: PresenceSettings
  privacy: PrivacySettings
  /** 每服个人偏好（docs 17；稀疏，键 = guild_id） */
  guildPreferences: Record<string, GuildPreferences>
  /** 服务器栏排序（docs 17 FR-23；未在数组中的服按加入时间排末尾） */
  guildOrder: string[]

  // ---- 会话态（不持久化）----
  panelOpen: boolean
  activeSection: SettingsSection

  setVoice: (patch: Partial<VoiceSettings>) => void
  setAppearance: (patch: Partial<AppearanceSettings>) => void
  setNotifications: (patch: Partial<NotificationSettings>) => void
  setGuildNotify: (guildId: string, patch: GuildNotifyOverride) => void
  setChannelNotify: (channelId: string, patch: ChannelNotifyOverride) => void
  setPresence: (patch: Partial<PresenceSettings>) => void
  setPrivacy: (patch: Partial<PrivacySettings>) => void
  /** 语音包屏蔽名单增删（docs 12 FR-19） */
  setVoicePackMuted: (userId: string, muted: boolean) => void
  /**
   * 对他人本地下行降噪名单增删（docs 20 FR-R06）。
   * 名单上限 500（docs 20 §6.1）；超限拒绝新增并返回 false。
   */
  setLocalNs: (userId: string, enabled: boolean) => boolean
  /** 每用户下行降噪模型覆盖；null = 恢复跟随全局（docs 20 FR-R04 P1） */
  setLocalNsModel: (userId: string, model: WasmNsModelId | null) => void
  /** 每模型强度记忆（docs 20 FR-S06） */
  setNsStrength: (model: NoiseModelId, percent: number) => void
  /** 应用 DeepFilterNet 预设（写入衰减/清晰度/强度；非 custom 时覆盖数值） */
  applyDfnPreset: (preset: DfnPresetId) => void
  /** 自定义 DeepFilterNet 调参（自动切到 custom 预设） */
  setDfnTuning: (patch: Partial<DfnTuningParams>) => void
  /** 应用 DTLN 预设（写入清晰度/补偿/强度；非 custom 时覆盖数值） */
  applyDtlnPreset: (preset: DtlnPresetId) => void
  /** 自定义 DTLN 调参（自动切到 custom 预设） */
  setDtlnTuning: (patch: Partial<DtlnTuningParams>) => void
  /** GPS 稀疏写入：全部回落默认时删条目（docs 17 FR-29 稀疏存储） */
  setGuildPreference: (guildId: string, patch: Partial<GuildPreferences>) => void
  /** 分类折叠切换（docs 17 FR-20） */
  toggleCategoryCollapsed: (guildId: string, categoryId: string) => void
  /** 服务器栏排序（docs 17 FR-23） */
  setGuildOrder: (order: string[]) => void
  /** 退出/被移出服务器后清理该服个人数据（docs 17 FR-30） */
  clearGuildPersonal: (guildId: string) => void
  openPanel: (section?: SettingsSection) => void
  closePanel: () => void
  setSection: (section: SettingsSection) => void
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

/** 覆盖条目规范化：剔除 undefined / 已过期字段；全部回落默认时返回 null（删条目） */
function normalizeOverride<
  T extends {
    level?: NotifyLevel
    muted?: boolean
    mutedUntil?: number
    suppressEveryone?: boolean
  },
>(merged: T): T | null {
  const next = { ...merged }
  if (!next.muted) delete next.muted
  if (typeof next.mutedUntil !== "number" || next.mutedUntil <= Date.now()) {
    delete next.mutedUntil
  }
  if (next.level === undefined) delete next.level
  if (!next.suppressEveryone) delete next.suppressEveryone
  if (
    next.level === undefined &&
    !next.muted &&
    next.mutedUntil === undefined &&
    !next.suppressEveryone
  ) {
    return null
  }
  return next
}

/** localNs 名单上限（docs 20 §6.1：超出拒绝新增并提示） */
export const LOCAL_NS_MAX_USERS = 500

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      voice: DEFAULT_VOICE,
      appearance: DEFAULT_APPEARANCE,
      notifications: DEFAULT_NOTIFICATIONS,
      presence: DEFAULT_PRESENCE,
      privacy: DEFAULT_PRIVACY,
      guildPreferences: {},
      guildOrder: [],

      panelOpen: false,
      activeSection: "account",

      setVoice: (patch) => set((state) => ({ voice: { ...state.voice, ...patch } })),
      setAppearance: (patch) =>
        set((state) => ({ appearance: { ...state.appearance, ...patch } })),
      setNotifications: (patch) =>
        set((state) => ({ notifications: { ...state.notifications, ...patch } })),
      setPrivacy: (patch) =>
        set((state) => ({ privacy: { ...state.privacy, ...patch } })),
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
      setLocalNs: (userId, enabled) => {
        const current = get().voice.localNs ?? {}
        if (enabled) {
          if (current[userId]) return true
          if (Object.keys(current).length >= LOCAL_NS_MAX_USERS) return false
          set((state) => ({
            voice: {
              ...state.voice,
              localNs: { ...(state.voice.localNs ?? {}), [userId]: true },
            },
          }))
          return true
        }
        if (!current[userId]) return true
        set((state) => {
          const next = { ...(state.voice.localNs ?? {}) }
          delete next[userId]
          return { voice: { ...state.voice, localNs: next } }
        })
        return true
      },
      setLocalNsModel: (userId, model) =>
        set((state) => {
          const next = { ...(state.voice.localNsModels ?? {}) }
          if (model === null) {
            if (!(userId in next)) return state
            delete next[userId]
          } else {
            if (next[userId] === model) return state
            next[userId] = model
          }
          return { voice: { ...state.voice, localNsModels: next } }
        }),
      setGuildPreference: (guildId, patch) =>
        set((state) => {
          const merged: GuildPreferences = {
            ...state.guildPreferences[guildId],
            ...patch,
          }
          // 稀疏化：字段回落默认即删除
          if (!merged.collapsedCategoryIds?.length)
            delete merged.collapsedCategoryIds
          if (!merged.hideMutedChannels) delete merged.hideMutedChannels
          // allowDmsFromMembers 缺省 true：仅 false 时落盘
          if (merged.allowDmsFromMembers !== false)
            delete merged.allowDmsFromMembers
          const next = { ...state.guildPreferences }
          if (Object.keys(merged).length > 0) next[guildId] = merged
          else delete next[guildId]
          return { guildPreferences: next }
        }),
      toggleCategoryCollapsed: (guildId, categoryId) =>
        set((state) => {
          const current =
            state.guildPreferences[guildId]?.collapsedCategoryIds ?? []
          const collapsed = current.includes(categoryId)
            ? current.filter((id) => id !== categoryId)
            : [...current, categoryId]
          const merged: GuildPreferences = {
            ...state.guildPreferences[guildId],
            collapsedCategoryIds: collapsed,
          }
          if (!merged.collapsedCategoryIds?.length)
            delete merged.collapsedCategoryIds
          if (!merged.hideMutedChannels) delete merged.hideMutedChannels
          if (merged.allowDmsFromMembers !== false)
            delete merged.allowDmsFromMembers
          const next = { ...state.guildPreferences }
          if (Object.keys(merged).length > 0) next[guildId] = merged
          else delete next[guildId]
          return { guildPreferences: next }
        }),
      setGuildOrder: (order) => set({ guildOrder: order }),
      clearGuildPersonal: (guildId) =>
        set((state) => {
          const guildPreferences = { ...state.guildPreferences }
          delete guildPreferences[guildId]
          const perGuild = { ...state.notifications.perGuild }
          delete perGuild[guildId]
          return {
            guildPreferences,
            guildOrder: state.guildOrder.filter((id) => id !== guildId),
            notifications: { ...state.notifications, perGuild },
          }
        }),
      setNsStrength: (model, percent) =>
        set((state) => ({
          voice: {
            ...state.voice,
            nsStrengthByModel: {
              ...(state.voice.nsStrengthByModel ?? {}),
              [model]: Math.min(100, Math.max(0, Math.round(percent))),
            },
            // 手动改 DFN / DTLN 强度 → 视为自定义
            ...(model === "deepfilternet"
              ? { dfnPreset: "custom" as DfnPresetId }
              : model === "dtln"
                ? { dtlnPreset: "custom" as DtlnPresetId }
                : null),
          },
        })),

      applyDfnPreset: (preset) =>
        set((state) => {
          if (preset === "custom") {
            return {
              voice: { ...state.voice, dfnPreset: "custom" },
            }
          }
          const meta = resolveDfnPreset(preset)
          const tuning = clampDfnTuning({
            attenuationLimitDb: meta.attenuationLimitDb ?? 48,
            presenceGainDb: meta.presenceGainDb ?? 2,
          })
          const strength = meta.strength ?? 100
          return {
            voice: {
              ...state.voice,
              dfnPreset: preset,
              dfnAttenuationLimitDb: tuning.attenuationLimitDb,
              dfnPresenceGainDb: tuning.presenceGainDb,
              nsStrengthByModel: {
                ...(state.voice.nsStrengthByModel ?? {}),
                deepfilternet: strength,
              },
            },
          }
        }),

      setDfnTuning: (patch) =>
        set((state) => {
          const next = clampDfnTuning({
            attenuationLimitDb:
              patch.attenuationLimitDb ?? state.voice.dfnAttenuationLimitDb ?? 48,
            presenceGainDb:
              patch.presenceGainDb ?? state.voice.dfnPresenceGainDb ?? 2,
          })
          return {
            voice: {
              ...state.voice,
              dfnPreset: "custom",
              dfnAttenuationLimitDb: next.attenuationLimitDb,
              dfnPresenceGainDb: next.presenceGainDb,
            },
          }
        }),

      applyDtlnPreset: (preset) =>
        set((state) => {
          if (preset === "custom") {
            return {
              voice: { ...state.voice, dtlnPreset: "custom" },
            }
          }
          const meta = resolveDtlnPreset(preset)
          const tuning = clampDtlnTuning({
            presenceGainDb: meta.presenceGainDb ?? 2,
            makeupGainDb: meta.makeupGainDb ?? 0.5,
          })
          const strength = meta.strength ?? 100
          return {
            voice: {
              ...state.voice,
              dtlnPreset: preset,
              dtlnPresenceGainDb: tuning.presenceGainDb,
              dtlnMakeupGainDb: tuning.makeupGainDb,
              nsStrengthByModel: {
                ...(state.voice.nsStrengthByModel ?? {}),
                dtln: strength,
              },
            },
          }
        }),

      setDtlnTuning: (patch) =>
        set((state) => {
          const next = clampDtlnTuning({
            presenceGainDb:
              patch.presenceGainDb ?? state.voice.dtlnPresenceGainDb ?? 2,
            makeupGainDb:
              patch.makeupGainDb ?? state.voice.dtlnMakeupGainDb ?? 0.5,
          })
          return {
            voice: {
              ...state.voice,
              dtlnPreset: "custom",
              dtlnPresenceGainDb: next.presenceGainDb,
              dtlnMakeupGainDb: next.makeupGainDb,
            },
          }
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
        privacy: state.privacy,
        guildPreferences: state.guildPreferences,
        guildOrder: state.guildOrder,
      }),
      // 合并默认值，保证新增字段在旧持久化数据上有默认值
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<
          Pick<
            SettingsState,
            | "voice"
            | "appearance"
            | "notifications"
            | "presence"
            | "privacy"
            | "guildPreferences"
            | "guildOrder"
          >
        >
        return {
          ...current,
          voice: { ...current.voice, ...saved.voice },
          appearance: { ...current.appearance, ...saved.appearance },
          notifications: { ...current.notifications, ...saved.notifications },
          presence: { ...current.presence, ...saved.presence },
          privacy: { ...current.privacy, ...saved.privacy },
          guildPreferences: {
            ...current.guildPreferences,
            ...saved.guildPreferences,
          },
          guildOrder: saved.guildOrder ?? current.guildOrder,
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
