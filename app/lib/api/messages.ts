// 消息 CRUD / 编辑历史 / 表情反应 / 打字指示 / 入场语音包只读（message 模块用户端路由）。

import { api, qs } from "./http"
import type {
  ChannelVoicePackConfig,
  GuildVoicePackConfig,
  Message,
  MessageEdit,
} from "./types"

export type SendMessageInput = {
  content?: string
  /** 单层引用回复：被回复消息的雪花 ID */
  reply_to_id?: string
  /** presign 返回的附件 UUID（发送时绑定） */
  attachment_ids?: string[]
  /** 幂等标识；不传则自动生成。失败重试必须沿用同一 nonce 防重复落库 */
  nonce?: string
  /**
   * 贴图消息（docs 17）：长度必须为 1，且与 content/attachment_ids 互斥。
   * 小表情请写入 content 的 `<e:item_id:mark>` wire，勿放此字段。
   */
  sticker_items?: { item_id: string }[]
}

/** 发送贴图消息（一条恰好一张） */
export const sendStickerMessage = (
  channelId: string,
  itemId: string,
  opts: { reply_to_id?: string; nonce?: string } = {},
) =>
  sendMessage(channelId, {
    content: "",
    sticker_items: [{ item_id: itemId }],
    reply_to_id: opts.reply_to_id,
    nonce: opts.nonce,
  })

/** 发送消息（nonce 幂等，重复提交短窗口内返回原消息） */
export const sendMessage = (channelId: string, input: SendMessageInput) =>
  api<Message>(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ nonce: crypto.randomUUID(), ...input }),
  })

export type ListMessagesParams = {
  /** 雪花消息 ID 游标：取比它更早的 */
  before?: string
  /** 取比它更新的 */
  after?: string
  /** 1-100，默认 50 */
  limit?: number
}

/** 拉取历史消息，恒按 ID 降序（新 → 旧）；无 READ_MESSAGE_HISTORY 权限返回 404 */
export const listMessages = (channelId: string, params: ListMessagesParams = {}) =>
  api<{ messages?: Message[] }>(`/channels/${channelId}/messages${qs(params)}`).then(
    (raw) => raw.messages ?? [],
  )

/** 读取单条消息（软删/不可见 404） */
export const getMessage = (channelId: string, messageId: string) =>
  api<Message>(`/channels/${channelId}/messages/${messageId}`)

/** 编辑消息正文（仅作者可编辑） */
export const editMessage = (channelId: string, messageId: string, content: string) =>
  api<Message>(`/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ content }),
  })

/** 删除消息（作者或 MANAGE_MESSAGES；软删） */
export const deleteMessage = (channelId: string, messageId: string) =>
  api<void>(`/channels/${channelId}/messages/${messageId}`, { method: "DELETE" })

/** 编辑历史（仅作者/MANAGE_MESSAGES 可见，其他人 404） */
export const listMessageEdits = (channelId: string, messageId: string) =>
  api<{ edits?: MessageEdit[]; edit_count?: number }>(
    `/channels/${channelId}/messages/${messageId}/edits`,
  )

/** 添加表情反应（幂等） */
export const addReaction = (channelId: string, messageId: string, emoji: string) =>
  api<void>(
    `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
    { method: "PUT" },
  )

/** 移除自己的表情反应（幂等） */
export const removeReaction = (channelId: string, messageId: string, emoji: string) =>
  api<void>(
    `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
    { method: "DELETE" },
  )

/** 打字指示：触发频道内其他客户端收到 TYPING_START（204 无响应体） */
export const sendTyping = (channelId: string) =>
  api<void>(`/channels/${channelId}/typing`, { method: "POST" })

/** 服级入场语音包配置（只读，客户端据此决定是否播放） */
export const getGuildVoicePack = (guildId: string) =>
  api<GuildVoicePackConfig>(`/guilds/${guildId}/voice-pack`)

/** 频道级入场语音包配置（只读） */
export const getChannelVoicePack = (guildId: string, channelId: string) =>
  api<ChannelVoicePackConfig>(`/guilds/${guildId}/channels/${channelId}/voice-pack`)
