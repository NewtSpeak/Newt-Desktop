// Gateway 事件 → store 的分发绑定。
//
// 后续功能 agent 的接入方式（两种任选）：
//   1. 直接 `gateway.subscribe(GatewayEvents.MessageCreate, handler)`（带 payload 类型推导）；
//   2. 在本文件的 bindGatewayToStores 里给对应事件换上真正的 store handler。
//
// 当前策略：
//   - VOICE_STATE_UPDATE 已接 voice store 骨架（applyVoiceStateUpdate）；
//   - Gateway 连接状态接 ui store（用户区状态圆点）；
//   - READY（含重连后）触发 REST 全量拉取对齐（无 resume 语义）；
//   - 其余事件先注册 console.debug 空壳，保持分发机制可观测。

import { gateway } from "~/lib/gateway/client"
import { GatewayEvents } from "~/lib/gateway/events"
import { voiceConnection } from "~/lib/voice/connection"
import { useChannelsStore } from "./channels"
import { useGuildsStore } from "./guilds"
import { useMembersStore } from "./members"
import { useMessagesStore } from "./messages"
import { useUIStore } from "./ui"
import { useVoiceStore } from "./voice"

let bound = false

/** 幂等：应用壳挂载时调用一次 */
export function bindGatewayToStores() {
  if (bound) return
  bound = true

  gateway.onStatusChange((status) => {
    useUIStore.getState().setGatewayStatus(status)
  })

  // 断线重连后没有 resume：每次 READY 都全量重拉 guilds，
  // 并刷新当前选中服务器的频道与成员，保证状态对齐。
  // 消息域：对当前打开的频道用 after 游标补断连期间的缺口（FR-48）。
  gateway.onReady(() => {
    void useGuildsStore.getState().fetchGuilds()
    const guildId = useUIStore.getState().selectedGuildId
    if (guildId) {
      void useChannelsStore.getState().fetchChannels(guildId)
      void useMembersStore.getState().fetchMembers(guildId)
    }
    const channelId = useUIStore.getState().selectedChannelId
    if (channelId) {
      void useMessagesStore.getState().fillGap(channelId)
    }
  })

  // 语音域：参与者列表落库 + 自身会话编排（docs 09 / 13）
  gateway.subscribe(GatewayEvents.VoiceStateUpdate, (payload) => {
    useVoiceStore.getState().applyVoiceStateUpdate(payload)
    voiceConnection.handleVoiceStateUpdate(payload)
  })
  gateway.subscribe(GatewayEvents.VoiceServerUpdate, (payload) => {
    voiceConnection.handleVoiceServerUpdate(payload)
  })
  gateway.subscribe(GatewayEvents.VoiceCapsUpdate, (payload) => {
    voiceConnection.handleVoiceCapsUpdate(payload)
  })
  gateway.subscribe(GatewayEvents.VoiceMigrating, (payload) => {
    voiceConnection.handleVoiceMigrating(payload)
  })
  gateway.subscribe(GatewayEvents.VoiceMigrated, (payload) => {
    voiceConnection.handleVoiceMigrated(payload)
  })

  // 消息域事件 → messages store
  gateway.subscribe(GatewayEvents.MessageCreate, (payload) => {
    useMessagesStore.getState().applyMessageCreate(payload)
  })
  gateway.subscribe(GatewayEvents.MessageUpdate, (payload) => {
    useMessagesStore.getState().applyMessageUpdate(payload)
  })
  gateway.subscribe(GatewayEvents.MessageDelete, (payload) => {
    useMessagesStore.getState().applyMessageDelete(payload)
  })
  gateway.subscribe(GatewayEvents.MessageReactionAdd, (payload) => {
    useMessagesStore.getState().applyReactionAdd(payload)
  })
  gateway.subscribe(GatewayEvents.MessageReactionRemove, (payload) => {
    useMessagesStore.getState().applyReactionRemove(payload)
  })
  gateway.subscribe(GatewayEvents.TypingStart, (payload) => {
    useMessagesStore.getState().applyTypingStart(payload)
  })

  // 尚未实现具体 handler 的事件：空壳注册（console.debug）。
  const placeholderEvents = [
    GatewayEvents.VoicePackPlay,
    GatewayEvents.RestrictionCreate,
    GatewayEvents.RestrictionUpdate,
    GatewayEvents.RestrictionLift,
    GatewayEvents.StageQueueUpdate,
    GatewayEvents.StageInstanceUpdate,
    GatewayEvents.ScreenShareStart,
    GatewayEvents.ScreenShareStop,
    GatewayEvents.ScreenQuotaUpdate,
    GatewayEvents.PermissionsUpdate,
  ] as const
  for (const event of placeholderEvents) {
    gateway.subscribe(event, (payload, eventName) => {
      console.debug(`[gateway] ${eventName}（暂无 handler）`, payload)
    })
  }
}
