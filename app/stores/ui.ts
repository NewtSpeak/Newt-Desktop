// UI 状态 store：当前选中的服务器/频道、Gateway 连接指示。

import { create } from "zustand"

import type { GatewayStatus } from "~/lib/gateway/client"

type UIState = {
  selectedGuildId: string | null
  selectedChannelId: string | null
  gatewayStatus: GatewayStatus
  selectGuild: (guildId: string | null) => void
  selectChannel: (guildId: string, channelId: string) => void
  setGatewayStatus: (status: GatewayStatus) => void
  reset: () => void
}

export const useUIStore = create<UIState>()((set) => ({
  selectedGuildId: null,
  selectedChannelId: null,
  gatewayStatus: "idle",

  selectGuild: (guildId) =>
    set((state) =>
      state.selectedGuildId === guildId
        ? state
        : { selectedGuildId: guildId, selectedChannelId: null },
    ),

  selectChannel: (guildId, channelId) =>
    set({ selectedGuildId: guildId, selectedChannelId: channelId }),

  setGatewayStatus: (status) => set({ gatewayStatus: status }),

  reset: () =>
    set({ selectedGuildId: null, selectedChannelId: null, gatewayStatus: "idle" }),
}))
