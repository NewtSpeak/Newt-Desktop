// 全系统消息搜索（docs 13 AU）：结果只含调用者可见频道；每用户 1 QPS、突发 5，
// 超限 429 SEARCH_RATE_LIMITED。

import { api, qs } from "./http"
import type { Message, SearchMessagesParams } from "./types"

export const searchMessages = (params: SearchMessagesParams) =>
  api<{ messages?: Message[] }>(`/search/messages${qs(params)}`).then(
    (raw) => raw.messages ?? [],
  )
