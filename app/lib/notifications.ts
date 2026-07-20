// 系统通知决策管线（docs 15 FR-10 七步）+ 提示音（FR-16/17）+ Dock 角标（FR-18）。
//
// 管线（对每条 MESSAGE_CREATE）：
//   ① 自己发的 → 否
//   ② 窗口聚焦且正在看该频道 → 否
//   ③ 频道不可见（channels store 里查无此频道）→ 否（Server-12 §6.2 兜底）
//   ④ 本人勿扰 → 否（计数照常，由 read-states 负责）
//   ⑤ 频道或服务器静音（含定时静音 mutedUntil，惰性过期）且非 @ 本人 → 否
//   ⑥ 有效层级（频道覆盖 → 服务器覆盖 → 全局默认，FR-08）为「无」→ 否；
//      「仅 @提及」且未提及 → 否
//   ⑦ 其余 → 发系统通知（同频道 5s 聚合限流，FR-15 简化：窗口内丢弃）
//      + 提示音（消息/提及双音色，各自开关；本人 self_deaf 时抑制）
//
// 点击跳转调研结论（docs 15 FR-13，2026-07 复核）：
//   @tauri-apps/plugin-notification v2 的 Actions API（registerActionTypes /
//   onAction）官方文档明确标注 “Mobile Only”（tauri-docs plugin/notification.mdx
//   :::caution[Mobile Only]），桌面端（macOS/Windows/Linux）不派发通知点击/动作
//   回调，sendNotification 也不返回可监听的句柄；macOS 上点击通知仅由系统默认
//   行为激活 App，无法拿到「点了哪条」的上下文。因此桌面端「点击 → 跳转频道」
//   本期不实现、不 hack（社区第三方 crate 如 tauri-plugin-notifications 支持
//   桌面 actions，但引入额外原生依赖，不在本期范围）。待官方插件桌面端支持
//   onAction 后，在 deliver() 里带上 guild/channel id 并注册回调即可。
//
// 浏览器 dev 环境回退 Web Notification API，行为一致。

import { isTauriRuntime } from "~/lib/secure-storage"
import type { Message } from "~/lib/api/types"
import { playNotifySound } from "~/lib/notification-sounds"
import { effectiveSelfStatus } from "~/stores/presence"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import { useGuildsStore } from "~/stores/guilds"
import { useMembersStore } from "~/stores/members"
import { useReadStatesStore } from "~/stores/read-states"
import { isOverrideMuted, useSettingsStore } from "~/stores/settings"
import { useUIStore } from "~/stores/ui"
import { useVoiceStore } from "~/stores/voice"

const CHANNEL_AGGREGATE_WINDOW_MS = 5_000
const PREVIEW_MAX_CHARS = 80

// ---------------------------------------------------------------------------
// 权限与发送（Tauri 插件 / Web Notification 双路径）
// ---------------------------------------------------------------------------

let permissionGranted: boolean | null = null

async function ensurePermission(): Promise<boolean> {
  if (permissionGranted !== null) return permissionGranted
  try {
    if (isTauriRuntime()) {
      const plugin = await import("@tauri-apps/plugin-notification")
      let granted = await plugin.isPermissionGranted()
      if (!granted) {
        granted = (await plugin.requestPermission()) === "granted"
      }
      permissionGranted = granted
    } else if (typeof Notification !== "undefined") {
      if (Notification.permission === "default") {
        permissionGranted = (await Notification.requestPermission()) === "granted"
      } else {
        permissionGranted = Notification.permission === "granted"
      }
    } else {
      permissionGranted = false
    }
  } catch {
    permissionGranted = false
  }
  return permissionGranted
}

async function deliver(title: string, body: string) {
  if (!(await ensurePermission())) return
  try {
    if (isTauriRuntime()) {
      const plugin = await import("@tauri-apps/plugin-notification")
      plugin.sendNotification({ title, body })
    } else if (typeof Notification !== "undefined") {
      new Notification(title, { body })
    }
  } catch {
    // 通知失败静默（权限被吊销等），应用内角标不受影响
  }
}

// ---------------------------------------------------------------------------
// 决策管线
// ---------------------------------------------------------------------------

/** channelId → 最近一次弹出时间（5s 聚合限流） */
const lastNotifiedAt: Record<string, number> = {}

function previewOf(message: Message): string {
  if (message.content) {
    const flat = message.content.replace(/\s+/g, " ").trim()
    return flat.length > PREVIEW_MAX_CHARS ? `${flat.slice(0, PREVIEW_MAX_CHARS)}…` : flat
  }
  if (message.attachments.length > 0) {
    const first = message.attachments[0]
    return first.preview === "image" ? "[图片]" : `[${first.filename}]`
  }
  return "发来一条消息"
}

/** MESSAGE_CREATE → 是否弹系统通知（mentioned 由调用方按本人角色算好传入） */
export function maybeNotifyMessage(message: Message, mentioned: boolean) {
  const selfId = useAuthStore.getState().user?.id
  if (!selfId || message.author_id === selfId) return // ①

  const ui = useUIStore.getState()
  if (
    typeof document !== "undefined" &&
    document.hasFocus() &&
    ui.selectedChannelId === message.channel_id
  ) {
    return // ②
  }

  const channels = useChannelsStore.getState().byGuild[message.guild_id]
  if (channels && !channels.some((channel) => channel.id === message.channel_id)) {
    return // ③ 已加载该服频道列表且查无此频道 = 不可见
  }

  if (effectiveSelfStatus() === "dnd") return // ④

  const notifySettings = useSettingsStore.getState().notifications
  const guildOverride = notifySettings.perGuild[message.guild_id]
  const channelOverride = notifySettings.perChannel[message.channel_id]
  // ⑤ 静音（频道或服务器任一生效即静音；定时静音 mutedUntil 判定时惰性比较）
  if (
    (isOverrideMuted(channelOverride) || isOverrideMuted(guildOverride)) &&
    !mentioned
  ) {
    return
  }

  // ⑥ 有效层级：频道覆盖 → 服务器覆盖 → 全局默认（docs 15 FR-08）
  const level =
    channelOverride?.level ?? guildOverride?.level ?? notifySettings.globalLevel
  if (level === "none") return
  if (level === "mentions" && !mentioned) return

  // ⑦ 聚合限流：同频道 5s 内只弹一条
  const now = Date.now()
  if (now - (lastNotifiedAt[message.channel_id] ?? 0) < CHANNEL_AGGREGATE_WINDOW_MS) return
  lastNotifiedAt[message.channel_id] = now

  const guildName =
    useGuildsStore.getState().guilds.find((guild) => guild.id === message.guild_id)?.name ??
    "服务器"
  const channelName =
    channels?.find((channel) => channel.id === message.channel_id)?.name ?? "频道"
  const member = useMembersStore
    .getState()
    .byGuild[message.guild_id]?.find((item) => item.user_id === message.author_id)
  const author = member?.nickname || member?.username || message.author_username

  void deliver(`${guildName} · #${channelName}`, `${author}: ${previewOf(message)}`)

  // 提示音（FR-16/17）：管线通过后播放；勿扰在 ④ 已拦截；self_deaf 抑制
  const selfDeaf = useVoiceStore.getState().session?.selfDeaf
  if (!selfDeaf) {
    const soundEnabled = mentioned
      ? notifySettings.soundMentionEnabled
      : notifySettings.soundMessageEnabled
    if (soundEnabled) {
      playNotifySound(mentioned ? "mention" : "message", notifySettings.soundVolume)
    }
  }
}

// ---------------------------------------------------------------------------
// Dock 角标（macOS）：全局 mention 总数；不支持的平台静默忽略（FR-18）
// ---------------------------------------------------------------------------

let badgeBound = false
let lastBadge = -1

async function setBadge(count: number) {
  if (!isTauriRuntime()) return
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window")
    await getCurrentWindow().setBadgeCount(count > 0 ? count : undefined)
  } catch {
    // 平台不支持（如 Windows 无 badge count）：静默忽略
  }
}

/** 幂等：应用壳挂载时调用一次 */
export function initDockBadge() {
  if (badgeBound || typeof window === "undefined") return
  badgeBound = true
  const update = () => {
    const mentions = useReadStatesStore.getState().mentionsByChannel
    const total = Object.values(mentions).reduce((sum, count) => sum + count, 0)
    if (total === lastBadge) return
    lastBadge = total
    void setBadge(total)
  }
  useReadStatesStore.subscribe(update)
  update()
}
