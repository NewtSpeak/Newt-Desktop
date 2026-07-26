// 消息交互按钮点击（设计文档 2026-07-26）：
// POST /channels/{cid}/messages/{mid}/interactions {custom_id} → 202 受理，
// bot 的回应经 Gateway INTERACTION_ACK / MESSAGE_CREATE / MESSAGE_UPDATE 到达。

import { api } from "./http"

export type InteractionCreateResult = {
  /** 交互记录雪花 ID（字符串），与 INTERACTION_ACK.interaction_id 对应 */
  interaction_id: string
  status: "PENDING"
}

/**
 * 点击交互按钮（202 受理 ≠ bot 已处理）。
 * 错误码：404 消息/按钮不可见、400 NOT_INTERACTIVE（disabled 等）、
 * 429 INTERACTION_RATE_LIMITED（每用户 2 QPS）。
 */
export const createInteraction = (
  channelId: string,
  messageId: string,
  customId: string,
) =>
  api<InteractionCreateResult>(
    `/channels/${channelId}/messages/${messageId}/interactions`,
    { method: "POST", body: JSON.stringify({ custom_id: customId }) },
  )
