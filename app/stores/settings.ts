// 客户端设置 store（docs 16 P0）：偏好持久化 localStorage（键 owl.settings），
// 结构按域划分（voice / appearance）；面板开关与当前分栏为会话态，不持久化。
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
}

export type AppearanceSettings = {
  theme: ThemeMode
  /** html 根字体大小档位（px），基准 16 */
  fontSize: number
  /** 消息密度（存储备用，消息区尚未接入） */
  density: MessageDensity
}

export type SettingsSection =
  | "account"
  | "voice"
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
}

const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: "system",
  fontSize: 16,
  density: "comfortable",
}

export const FONT_SIZE_STEPS = [12, 14, 15, 16, 18, 20, 24] as const

type SettingsState = {
  voice: VoiceSettings
  appearance: AppearanceSettings

  // ---- 会话态（不持久化）----
  panelOpen: boolean
  activeSection: SettingsSection

  setVoice: (patch: Partial<VoiceSettings>) => void
  setAppearance: (patch: Partial<AppearanceSettings>) => void
  openPanel: (section?: SettingsSection) => void
  closePanel: () => void
  setSection: (section: SettingsSection) => void
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      voice: DEFAULT_VOICE,
      appearance: DEFAULT_APPEARANCE,

      panelOpen: false,
      activeSection: "account",

      setVoice: (patch) => set((state) => ({ voice: { ...state.voice, ...patch } })),
      setAppearance: (patch) =>
        set((state) => ({ appearance: { ...state.appearance, ...patch } })),

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
      partialize: (state) => ({ voice: state.voice, appearance: state.appearance }),
      // 合并默认值，保证新增字段在旧持久化数据上有默认值
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<
          Pick<SettingsState, "voice" | "appearance">
        >
        return {
          ...current,
          voice: { ...current.voice, ...saved.voice },
          appearance: { ...current.appearance, ...saved.appearance },
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
