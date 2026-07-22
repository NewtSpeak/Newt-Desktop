// UI 状态 store：当前选中的服务器/频道、Gateway 连接指示、成员面板开合。
// 持久化（localStorage 键 owl.ui）：成员面板开合、左右侧栏宽度；其余为会话态。

import { create } from "zustand"
import { persist } from "zustand/middleware"

import type { GatewayStatus } from "~/lib/gateway/client"
import {
  clampPanelWidth,
  PANEL_WIDTH_DEFAULT,
} from "~/lib/panel-width"

/** 服管设置分栏 id（与 guild-settings-panel NAV 对齐） */
export type GuildAdminSectionId =
  | "overview"
  | "roles"
  | "expressions"
  | "members"
  | "bans"
  | "restrictions"
  | "invites"
  | "voice-nodes"
  | "voice-packs"
  | "audit-log"
  | "danger"

type UIState = {
  selectedGuildId: string | null
  selectedChannelId: string | null
  gatewayStatus: GatewayStatus
  /** 右侧成员面板开合（docs 02 FR-22，持久化） */
  memberPanelOpen: boolean
  /** 左侧频道/私信栏宽度（px，持久化；可拖拽） */
  channelListWidth: number
  /** 右侧成员/资料栏宽度（px，持久化；可拖拽） */
  memberPanelWidth: number
  /** 服务器个人设置面板（docs 17；会话态，打开时绑定目标服） */
  guildPersonalGuildId: string | null
  /** 服务器管理设置全屏面板（docs 18；会话态） */
  guildAdminGuildId: string | null
  /** 打开服管时着陆分栏（可选） */
  guildAdminSection: GuildAdminSectionId | null
  /** 频道设置中型面板（docs 03/04；会话态） */
  channelSettingsChannelId: string | null
  selectGuild: (guildId: string | null) => void
  openGuildPersonal: (guildId: string) => void
  closeGuildPersonal: () => void
  openGuildAdmin: (guildId: string, section?: GuildAdminSectionId) => void
  closeGuildAdmin: () => void
  clearGuildAdminSection: () => void
  openChannelSettings: (channelId: string) => void
  closeChannelSettings: () => void
  selectChannel: (guildId: string, channelId: string) => void
  setGatewayStatus: (status: GatewayStatus) => void
  toggleMemberPanel: () => void
  setChannelListWidth: (width: number) => void
  setMemberPanelWidth: (width: number) => void
  reset: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      selectedGuildId: null,
      selectedChannelId: null,
      gatewayStatus: "idle",
      memberPanelOpen: true,
      channelListWidth: PANEL_WIDTH_DEFAULT,
      memberPanelWidth: PANEL_WIDTH_DEFAULT,
      guildPersonalGuildId: null,
      guildAdminGuildId: null,
      guildAdminSection: null,
      channelSettingsChannelId: null,

      // 面板互斥（docs 18 FR-04）
      openGuildPersonal: (guildId) =>
        set({
          guildPersonalGuildId: guildId,
          guildAdminGuildId: null,
          guildAdminSection: null,
          channelSettingsChannelId: null,
        }),
      closeGuildPersonal: () => set({ guildPersonalGuildId: null }),
      openGuildAdmin: (guildId, section) =>
        set({
          guildAdminGuildId: guildId,
          guildAdminSection: section ?? null,
          guildPersonalGuildId: null,
          channelSettingsChannelId: null,
        }),
      closeGuildAdmin: () =>
        set({ guildAdminGuildId: null, guildAdminSection: null }),
      clearGuildAdminSection: () => set({ guildAdminSection: null }),
      openChannelSettings: (channelId) =>
        set({
          channelSettingsChannelId: channelId,
          guildAdminGuildId: null,
          guildAdminSection: null,
          guildPersonalGuildId: null,
        }),
      closeChannelSettings: () => set({ channelSettingsChannelId: null }),

      selectGuild: (guildId) =>
        set((state) =>
          state.selectedGuildId === guildId
            ? state
            : {
                selectedGuildId: guildId,
                selectedChannelId: null,
                // 切服退出以身份查看（由 view-as 监听处理也可，此处清不了 store 外状态）
              },
        ),

      selectChannel: (guildId, channelId) =>
        set((state) =>
          state.selectedGuildId === guildId &&
          state.selectedChannelId === channelId
            ? state
            : { selectedGuildId: guildId, selectedChannelId: channelId },
        ),

      setGatewayStatus: (status) =>
        set((state) =>
          state.gatewayStatus === status ? state : { gatewayStatus: status },
        ),

      toggleMemberPanel: () =>
        set((state) => ({ memberPanelOpen: !state.memberPanelOpen })),

      setChannelListWidth: (width) =>
        set((state) => {
          const next = clampPanelWidth(width)
          return state.channelListWidth === next
            ? state
            : { channelListWidth: next }
        }),

      setMemberPanelWidth: (width) =>
        set((state) => {
          const next = clampPanelWidth(width)
          return state.memberPanelWidth === next
            ? state
            : { memberPanelWidth: next }
        }),

      reset: () =>
        set({
          selectedGuildId: null,
          selectedChannelId: null,
          gatewayStatus: "idle",
          channelSettingsChannelId: null,
          guildAdminGuildId: null,
          guildAdminSection: null,
        }),
    }),
    {
      name: "owl.ui",
      partialize: (state) => ({
        memberPanelOpen: state.memberPanelOpen,
        channelListWidth: state.channelListWidth,
        memberPanelWidth: state.memberPanelWidth,
      }),
      // 旧版 localStorage 无宽度字段时回落默认，并钳制非法值
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UIState>
        return {
          ...current,
          ...p,
          channelListWidth: clampPanelWidth(
            p.channelListWidth ?? current.channelListWidth,
          ),
          memberPanelWidth: clampPanelWidth(
            p.memberPanelWidth ?? current.memberPanelWidth,
          ),
          memberPanelOpen:
            typeof p.memberPanelOpen === "boolean"
              ? p.memberPanelOpen
              : current.memberPanelOpen,
        }
      },
    },
  ),
)
