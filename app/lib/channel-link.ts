// 消息内 <#channelId> chip 点击：跳转文字频道 / 加入语音频道（含密码解锁）。
// 与 channel-list-items 的 TextChannelItem / VoiceChannelItem 行为对齐。

import { toast } from "sonner"

import { ensureGuildAccount } from "~/lib/ensure-guild-account"
import type { Channel } from "~/lib/api/types"
import { useChannelsStore } from "~/stores/channels"
import { useChannelUnlocksStore } from "~/stores/channel-unlocks"
import { useUIStore } from "~/stores/ui"
import { useVoiceStore } from "~/stores/voice"

export function findChannelById(channelId: string): Channel | undefined {
  const byGuild = useChannelsStore.getState().byGuild
  for (const list of Object.values(byGuild)) {
    const hit = list?.find((c) => c.id === channelId)
    if (hit) return hit
  }
  return undefined
}

export function resolveChannelLabel(channelId: string, fallback?: string): string {
  const ch = findChannelById(channelId)
  if (ch?.name) return ch.name
  if (fallback) return fallback
  return channelId.slice(0, 6) || "频道"
}

export type OpenLinkedChannelOptions = {
  /** React Router navigate；不传则只更新 UI store（尽量仍应传入） */
  navigate?: (to: string) => void
}

/**
 * 打开消息中绑定的频道：
 * - TEXT：解锁（如需）后导航
 * - VOICE：解锁（如需）后 join 语音并导航
 * - 找不到 / CATEGORY：提示错误
 */
export async function openLinkedChannel(
  channelId: string,
  options?: OpenLinkedChannelOptions,
): Promise<void> {
  const channel = findChannelById(channelId)
  if (!channel) {
    toast.error("找不到该频道（可能已删除或无权访问）")
    return
  }
  if (channel.type === "CATEGORY") {
    toast.error("不能跳转到分类")
    return
  }

  const guildId = channel.guild_id
  const ok = await ensureGuildAccount(guildId)
  if (!ok) return

  const href = `/channels/${guildId}/${channel.id}`
  const isVoice = channel.type === "VOICE"
  const isCurrentVoice =
    isVoice && useVoiceStore.getState().session?.channelId === channel.id

  const proceed = () => {
    useUIStore.getState().selectChannel(guildId, channel.id)
    if (isVoice && !isCurrentVoice) {
      // 动态导入，避免消息渲染链路静态拉入整套语音/降噪依赖
      void import("~/lib/voice/connection").then(({ voiceConnection }) => {
        void voiceConnection.join(guildId, channel.id)
      })
    }
    options?.navigate?.(href)
  }

  const isLocked = Boolean(channel.locked)
  if (isLocked && !(isVoice && isCurrentVoice)) {
    const unlocked = await useChannelUnlocksStore
      .getState()
      .ensureUnlocked(channel.id, true)
    if (!unlocked) {
      useChannelUnlocksStore.getState().requestUnlock(channel.id, proceed)
      return
    }
  }

  proceed()
}
