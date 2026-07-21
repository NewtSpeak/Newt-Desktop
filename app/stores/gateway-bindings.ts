// Gateway 事件 → store 的分发绑定。
//
// 当前策略：
//   - READY（IDENTIFY 全量路径）：消费快照（guilds/presences/read_states）+
//     REST 重拉对齐 + 重放本人 presence；RESUMED（resume 成功）只重放 presence，
//     事件已按序补齐，不做全量重拉（docs 14 FR-03）；
//   - 消息/语音/舞台/屏幕共享域：既有绑定不变；
//   - 结构事件（GUILD_*/CHANNEL_*/MEMBER_*/ROLE_*/PERMISSIONS_UPDATE）增量维护
//     guilds/channels/members store；自己被踢/Ban 时移除该服 + toast；
//   - 未读（READ_STATE_UPDATE + MESSAGE_CREATE 本地推进）→ read-states store；
//   - PRESENCE_UPDATE → presence store；USER_SETTINGS_UPDATE → settings 合并；
//   - VOICE_PACK_PLAY → 入场语音包播放端（lib/voice/voice-pack.ts）。

import { toast } from "sonner"

import type { VoiceState } from "~/lib/api/types"
import { gateway } from "~/lib/gateway/client"
import { GatewayEvents } from "~/lib/gateway/events"
import { maybeNotifyMessage } from "~/lib/notifications"
import { applyRemoteSettings } from "~/lib/settings-sync"
import { voiceConnection } from "~/lib/voice/connection"
import { screenShare } from "~/lib/voice/screen-share"
import {
  handleSelfStageTransitions,
  handleStageInstanceNotify,
} from "~/lib/voice/stage-notify"
import { handleVoicePackPlay } from "~/lib/voice/voice-pack"
import { useAuthStore } from "./auth"
import { useChannelsStore } from "./channels"
import { useGuildsStore } from "./guilds"
import { useMembersStore } from "./members"
import { useMessagesStore } from "./messages"
import { reportSelfPresence, usePresenceStore } from "./presence"
import {
  countIdsAfterLastRead,
  messageMentionsSelf,
  useReadStatesStore,
} from "./read-states"
import { compareSnowflake } from "~/lib/snowflake"
import { useRolesStore } from "./roles"
import { useStageStore } from "./stage"
import { useUIStore } from "./ui"
import { useVoiceStore } from "./voice"

let bound = false

/**
 * 按该频道消息缓存精确回写未读条数。
 * 在 noteMessageCreate（可能已自动已读）之后调用，故 last_read 已是最新语义。
 * 取 max(缓存统计, 已有累加)：缓存被 CACHE_LIMIT 截断时不压低在线累加值。
 */
export function reconcileUnreadFromMessageCache(channelId: string) {
  if (!channelId) return
  const read = useReadStatesStore.getState()
  const lastRead = read.lastReadByChannel[channelId]
  const latest = read.latestByChannel[channelId]
  const tracked = read.unreadCountByChannel[channelId] ?? 0
  // last_read 已追上 latest → 已读清零（含自己发消息自动已读）
  if (latest && lastRead && compareSnowflake(lastRead, latest) >= 0) {
    if (tracked > 0) read.setUnreadCountExact(channelId, 0)
    return
  }
  const messages = useMessagesStore.getState().byChannel[channelId]?.messages ?? []
  if (messages.length === 0) return
  const fromCache = countIdsAfterLastRead(
    lastRead,
    messages.map((message) => message.id),
  )
  // 临场/他人多条：缓存统计为权威下限；与 tracked 取 max 防止截断少计
  const next = Math.max(tracked, fromCache)
  if (next !== tracked) read.setUnreadCountExact(channelId, next)
}

/** 自己所在服被移除（被踢/Ban/删服）时的统一清理 */
function dropGuildLocally(guildId: string) {
  useGuildsStore.getState().removeGuild(guildId)
  useChannelsStore.getState().removeGuild(guildId)
  useMembersStore.getState().removeGuild(guildId)
  useRolesStore.getState().removeGuild(guildId)
  if (useUIStore.getState().selectedGuildId === guildId) {
    // 路由侧：channel 页监听 guilds store，服务器消失后自动导航回首页
    useUIStore.getState().selectGuild(null)
  }
}

/** 幂等：应用壳挂载时调用一次 */
export function bindGatewayToStores() {
  if (bound) return
  bound = true

  gateway.onStatusChange((status) => {
    useUIStore.getState().setGatewayStatus(status)
  })

  // READY = IDENTIFY 全量路径（首连 / resume 失败重建会话）：
  // 消费快照（presences / read_states / guilds 内嵌频道 / voice_states），再 REST 重拉兜底对齐；
  // 消息域对当前打开的频道用 after 游标补断连期间的缺口（FR-48）。
  // 语音：若本人仍在某语音频道（刷新/杀进程后服务端 VoiceState 残留），透明 rejoin（docs 09 FR-06 / 13 FR-19）。
  gateway.onReady((ready) => {
    usePresenceStore.getState().applySnapshot(ready.presences ?? [])

    const guildByChannel: Record<string, string> = {}
    const allVoiceStates: VoiceState[] = []
    let selfVoice: { guildId: string; channelId: string } | null = null
    const selfId = ready.user?.id ?? useAuthStore.getState().user?.id

    if (ready.guilds?.length) {
      for (const snapshot of ready.guilds) {
        useGuildsStore
          .getState()
          .upsertGuild(snapshot.guild, { banners: snapshot.banners })
        useChannelsStore.getState().setChannels(snapshot.guild.id, snapshot.channels)
        for (const channel of snapshot.channels) {
          guildByChannel[channel.id] = snapshot.guild.id
        }
        const voiceStates = snapshot.voice_states ?? []
        for (const state of voiceStates) {
          allVoiceStates.push(state)
          if (
            selfId &&
            state.user_id === selfId &&
            state.channel_id &&
            !selfVoice
          ) {
            selfVoice = { guildId: snapshot.guild.id, channelId: state.channel_id }
          }
        }
      }
    }
    if (allVoiceStates.length > 0) {
      useVoiceStore.getState().applyVoiceStatesSnapshot(allVoiceStates)
    }
    useReadStatesStore.getState().applySnapshot(ready.read_states ?? [], guildByChannel)

    void useGuildsStore.getState().fetchGuilds()
    const guildId = useUIStore.getState().selectedGuildId
    if (guildId) {
      void useChannelsStore.getState().fetchChannels(guildId)
      void useMembersStore.getState().fetchMembers(guildId)
      void useRolesStore.getState().fetchRoles(guildId).catch(() => undefined)
    }
    const channelId = useUIStore.getState().selectedChannelId
    if (channelId) {
      void useMessagesStore.getState().fillGap(channelId)
    }

    // 恢复手动 presence（隐身/勿扰等跨连接保持，docs 01 §9.2）
    reportSelfPresence()

    // 刷新后服务端仍记着本人在语音频道：自动 rejoin 恢复媒体（UI 已从快照显示名单）
    if (selfVoice) {
      const session = useVoiceStore.getState().session
      // 已有本地会话（resume 路径）则不重复 join
      if (!session || session.channelId !== selfVoice.channelId) {
        void voiceConnection.join(selfVoice.guildId, selfVoice.channelId)
      }
    }
  })

  // RESUMED = 断连期间事件已按序补齐：不做全量重拉，只重放 presence
  gateway.onResumed(() => {
    reportSelfPresence()
  })

  // 语音域：参与者列表落库 + 自身会话编排（docs 09 / 13）
  // 舞台过渡钩子须在 store 写入前调用（依赖旧值对比，docs 10 FR-17/18/24）
  gateway.subscribe(GatewayEvents.VoiceStateUpdate, (payload) => {
    handleSelfStageTransitions(payload)
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

  // 音频审计提示（adminpresence）：本频道是否向用户显示「正在被审计」
  gateway.subscribe(GatewayEvents.ChannelAuditNotice, (payload) => {
    if (!payload?.channel_id) return
    useVoiceStore
      .getState()
      .setChannelAudited(payload.channel_id, Boolean(payload.audited))
  })

  // 入场语音包（docs 12）：本地过滤 + 队列串行播放 + 视觉提示
  gateway.subscribe(GatewayEvents.VoicePackPlay, (payload) => {
    handleVoicePackPlay(payload)
  })

  // 消息域事件 → messages store + 未读记账 + 系统通知管线
  gateway.subscribe(GatewayEvents.MessageCreate, (payload) => {
    useMessagesStore.getState().applyMessageCreate(payload)
    const selfId = useAuthStore.getState().user?.id
    const selfRoleIds = selfId
      ? useMembersStore
          .getState()
          .byGuild[payload.guild_id]?.find((member) => member.user_id === selfId)?.role_ids
      : undefined
    const mentioned = messageMentionsSelf(payload, selfId, selfRoleIds)
    useReadStatesStore.getState().noteMessageCreate(payload, selfId, mentioned)
    // 以消息缓存精确回写未读条数：修正在线多条 MESSAGE_CREATE 后角标卡在 1 的问题
    //（累加路径与「保底 1」在临场/乱序场景下可能漂移；缓存条数是权威值）。
    reconcileUnreadFromMessageCache(payload.channel_id)
    maybeNotifyMessage(payload, mentioned)
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

  // 未读跨端同步（docs 15 §7-1）：他端 ack / 提及计数增长
  gateway.subscribe(GatewayEvents.ReadStateUpdate, (payload) => {
    useReadStatesStore.getState().applyReadStateUpdate(payload)
  })

  // Presence（docs 01 §3.4）
  gateway.subscribe(GatewayEvents.PresenceUpdate, (payload) => {
    usePresenceStore.getState().applyUpdate(payload)
  })

  // 用户设置跨端同步（docs 16 §7-1）：他端修改后合并回本地
  gateway.subscribe(GatewayEvents.UserSettingsUpdate, (payload) => {
    if (payload.settings) applyRemoteSettings(payload.settings)
  })

  // 舞台域（docs 10）：队列与实例状态 → stage store
  gateway.subscribe(GatewayEvents.StageQueueUpdate, (payload) => {
    useStageStore.getState().applyQueueUpdate(payload)
  })
  gateway.subscribe(GatewayEvents.StageInstanceUpdate, (payload) => {
    handleStageInstanceNotify(payload)
    useStageStore.getState().applyInstanceUpdate(payload)
  })

  // 屏幕共享域（docs 11）：直播角标 + 本人被动停止 + 配额
  gateway.subscribe(GatewayEvents.ScreenShareStart, (payload) => {
    useStageStore.getState().applyScreenStart(payload)
  })
  gateway.subscribe(GatewayEvents.ScreenShareStop, (payload) => {
    useStageStore.getState().applyScreenStop(payload)
    if (payload.user_id === useAuthStore.getState().user?.id) {
      screenShare.handleRemoteStop(payload.reason)
    }
  })
  gateway.subscribe(GatewayEvents.ScreenQuotaUpdate, (payload) => {
    useStageStore.getState().applyQuotaUpdate(payload)
  })

  // -------------------------------------------------------------------------
  // 结构事件（docs 14 §3.2）：guilds / channels / members 增量维护
  // -------------------------------------------------------------------------

  // GUILD_CREATE：建服/加入服务器（含他端操作）——定向全量快照直接落库
  gateway.subscribe(GatewayEvents.GuildCreate, (payload) => {
    useGuildsStore
      .getState()
      .upsertGuild(payload.guild, { banners: payload.banners })
    useChannelsStore.getState().setChannels(payload.guild.id, payload.channels)
  })
  // GUILD_UPDATE：图标/名称等字段在 guild 上；banners 仅 banner 增删/排序时携带
  gateway.subscribe(GatewayEvents.GuildUpdate, (payload) => {
    useGuildsStore.getState().upsertGuild(payload.guild, {
      banners: payload.banners,
    })
  })
  gateway.subscribe(GatewayEvents.GuildDelete, (payload) => {
    const selected = useUIStore.getState().selectedGuildId === payload.guild_id
    dropGuildLocally(payload.guild_id)
    if (selected) toast.info("你所在的服务器已被删除")
  })

  gateway.subscribe(GatewayEvents.ChannelCreate, (payload) => {
    useChannelsStore.getState().upsertChannel(payload)
  })
  gateway.subscribe(GatewayEvents.ChannelUpdate, (payload) => {
    useChannelsStore.getState().upsertChannel(payload)
  })
  // 频道删除 / 禁看（定向 CHANNEL_DELETE）：移除频道 + 清其未读计数
  gateway.subscribe(GatewayEvents.ChannelDelete, (payload) => {
    useChannelsStore.getState().removeChannel(payload.guild_id, payload.channel_id)
    useReadStatesStore.getState().removeChannel(payload.channel_id)
  })

  gateway.subscribe(GatewayEvents.GuildMemberAdd, (payload) => {
    useMembersStore.getState().upsertMember(payload.guild_id, {
      id: payload.member.id,
      user_id: payload.member.user_id,
      username: payload.user?.username ?? "",
      display_name: payload.user?.display_name ?? "",
      nickname: payload.member.nickname ?? "",
      avatar_url: payload.user?.avatar_url ?? "",
      avatar_animated: payload.user?.avatar_animated ?? false,
      banner_url: payload.user?.banner_url ?? "",
      bio: payload.user?.bio ?? "",
      role_ids: payload.member.role_ids ?? [],
    })
  })
  gateway.subscribe(GatewayEvents.GuildMemberUpdate, (payload) => {
    useMembersStore.getState().upsertMember(payload.guild_id, {
      user_id: payload.member.user_id,
      nickname: payload.member.nickname ?? "",
      role_ids: payload.role_ids ?? payload.member.role_ids ?? [],
    })
  })
  // 资料变更：更新本人 auth.user，并按 user_id 合并进已缓存的各服成员列表
  gateway.subscribe(GatewayEvents.UserUpdate, (payload) => {
    const selfId = useAuthStore.getState().user?.id
    if (payload.id === selfId) {
      const current = useAuthStore.getState().user
      if (current) {
        useAuthStore.getState().setUser({
          ...current,
          username: payload.username || current.username,
          display_name: payload.display_name ?? "",
          bio: payload.bio ?? "",
          avatar_url: payload.avatar ?? "",
          avatar_animated: payload.avatar_animated ?? false,
          banner_url: payload.banner ?? "",
          accent_color: payload.accent_color ?? current.accent_color,
        })
      }
    }
    useMembersStore.getState().applyUserProfile(payload.id, {
      username: payload.username,
      display_name: payload.display_name,
      avatar_url: payload.avatar,
      avatar_animated: payload.avatar_animated,
      banner_url: payload.banner,
      bio: payload.bio,
    })
  })
  gateway.subscribe(GatewayEvents.GuildMemberRemove, (payload) => {
    const selfId = useAuthStore.getState().user?.id
    if (payload.user_id === selfId) {
      // 自己被移除：清该服缓存；被踢/Ban 时提示（主动退出无需打扰）
      const guildName = useGuildsStore
        .getState()
        .guilds.find((guild) => guild.id === payload.guild_id)?.name
      dropGuildLocally(payload.guild_id)
      if (payload.reason === "kick") {
        toast.warning(`你已被移出服务器${guildName ? `「${guildName}」` : ""}`)
      } else if (payload.reason === "ban") {
        toast.warning(`你已被服务器${guildName ? `「${guildName}」` : ""}封禁`)
      }
      return
    }
    useMembersStore.getState().removeMember(payload.guild_id, payload.user_id)
  })

  // 角色变化会影响成员 role_ids 与权限投影：该服已有缓存时重拉成员/频道；
  // 角色列表本身也重拉对齐（事件 payload 只带片段，不足以增量重建）
  const refreshGuildRoles = (guildId: string) => {
    if (useRolesStore.getState().byGuild[guildId]) {
      void useRolesStore.getState().fetchRoles(guildId).catch(() => undefined)
    }
  }
  const refreshGuildProjection = (guildId: string) => {
    if (useMembersStore.getState().byGuild[guildId]) {
      void useMembersStore.getState().fetchMembers(guildId).catch(() => undefined)
    }
    if (useChannelsStore.getState().byGuild[guildId]) {
      void useChannelsStore.getState().fetchChannels(guildId).catch(() => undefined)
    }
  }
  gateway.subscribe(GatewayEvents.GuildRoleCreate, (payload) => {
    // 新角色尚无成员绑定，权限投影无需更新；仅对齐角色列表缓存
    refreshGuildRoles(payload.guild_id)
  })
  gateway.subscribe(GatewayEvents.GuildRoleUpdate, (payload) => {
    refreshGuildRoles(payload.guild_id)
    refreshGuildProjection(payload.guild_id)
  })
  gateway.subscribe(GatewayEvents.GuildRoleDelete, (payload) => {
    refreshGuildRoles(payload.guild_id)
    refreshGuildProjection(payload.guild_id)
  })

  // 权限覆盖变更（guild 广播）：立即失效本地权限投影，重拉该服频道列表
  //（获得/失去可见性的用户会另收定向 CHANNEL_CREATE / CHANNEL_DELETE）
  gateway.subscribe(GatewayEvents.PermissionsUpdate, (payload) => {
    if (useChannelsStore.getState().byGuild[payload.guild_id]) {
      void useChannelsStore.getState().fetchChannels(payload.guild_id).catch(() => undefined)
    }
  })

  // 尚未实现具体 handler 的事件：空壳注册（console.debug）。
  const placeholderEvents = [
    GatewayEvents.RestrictionCreate,
    GatewayEvents.RestrictionUpdate,
    GatewayEvents.RestrictionLift,
  ] as const
  for (const event of placeholderEvents) {
    gateway.subscribe(event, (payload, eventName) => {
      console.debug(`[gateway] ${eventName}（暂无 handler）`, payload)
    })
  }
}
