// UI 状态 store：当前选中的服务器/频道、Gateway 连接指示、成员面板开合。
// 仅成员面板开合持久化（localStorage 键 owl.ui），其余为会话态。

import { create } from "zustand"
import { persist } from "zustand/middleware"

import type { GatewayStatus } from "~/lib/gateway/client"

type UIState = {
  selectedGuildId: string | null
  selectedChannelId: string | null
  gatewayStatus: GatewayStatus
  /** 右侧成员面板开合（docs 02 FR-22，持久化） */
  memberPanelOpen: boolean
  selectGuild: (guildId: string | null) => void
  selectChannel: (guildId: string, channelId: string) => void
  setGatewayStatus: (status: GatewayStatus) => void
  toggleMemberPanel: () => void
  reset: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      selectedGuildId: null,
      selectedChannelId: null,
      gatewayStatus: "idle",
      memberPanelOpen: true,

      selectGuild: (guildId) =>
        set((state) =>
          state.selectedGuildId === guildId
            ? state
            : { selectedGuildId: guildId, selectedChannelId: null },
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

      reset: () =>
        set({ selectedGuildId: null, selectedChannelId: null, gatewayStatus: "idle" }),
    }),
    {
      name: "owl.ui",
      partialize: (state) => ({ memberPanelOpen: state.memberPanelOpen }),
    },
  ),
)
