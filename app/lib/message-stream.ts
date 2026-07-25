// 流式消息（MESSAGE_STREAM_*）纯逻辑：按 seq 拼接 delta、乱序缓冲、缺口判定、纠偏合并。
// 供 messages store 调用；单测可脱离 zustand 运行。

export type StreamableMessage = {
  content: string
  stream_status?: string
  /** 创建时间（ISO）；无 streamLastActivityAt 时用于 idle 判定 */
  created_at?: string
  /** 已应用的最大 seq（本地） */
  streamSeq?: number
  /** 乱序 delta 暂存 */
  streamPendingDeltas?: Record<number, string>
  /** 最近一次流式活动时间戳（ms，仅本地） */
  streamLastActivityAt?: number
}

/** 乱序空洞达到此跨度时建议 REST 纠偏 */
export const STREAM_GAP_RECONCILE_THRESHOLD = 3

/** 流式空闲超过此时长（ms）UI 显示「生成较慢」 */
export const STREAM_SLOW_IDLE_MS = 90_000

/** 流式空闲超过此时长（ms）UI 显示「可能已中断」 */
export const STREAM_STALE_IDLE_MS = 5 * 60_000

/**
 * 将乱序缓冲中连续 seq 拼进 content。
 * 仅当 stream_status === "STREAMING" 时生效。
 */
export function flushStreamDeltas<T extends StreamableMessage>(message: T): T {
  if (message.stream_status !== "STREAMING") return message
  let seq = message.streamSeq ?? 0
  let content = message.content ?? ""
  const pending = { ...(message.streamPendingDeltas ?? {}) }
  while (pending[seq + 1] !== undefined) {
    seq += 1
    content += pending[seq]
    delete pending[seq]
  }
  const pendingKeys = Object.keys(pending)
  return {
    ...message,
    content,
    streamSeq: seq > 0 ? seq : message.streamSeq,
    streamPendingDeltas: pendingKeys.length > 0 ? pending : undefined,
  }
}

/**
 * 应用一条 MESSAGE_STREAM_DELTA。
 * - 非 STREAMING / 非法 seq / 空 delta / 过期或重复 seq → 返回 null
 * - 否则返回更新后的消息（可能仅写入空洞缓冲）
 */
export function applyStreamDelta<T extends StreamableMessage>(
  message: T,
  seq: number,
  delta: string,
  now = Date.now()
): T | null {
  if (message.stream_status !== "STREAMING") return null
  if (!Number.isFinite(seq) || seq < 1) return null
  if (delta === "") return null

  const lastSeq = message.streamSeq ?? 0
  if (seq <= lastSeq) return null
  // 已在空洞缓冲中的 seq 忽略（防重复 delta 覆盖）
  if (message.streamPendingDeltas?.[seq] !== undefined) return null

  const withPending: T = {
    ...message,
    streamPendingDeltas: {
      ...(message.streamPendingDeltas ?? {}),
      [seq]: delta,
    },
    streamLastActivityAt: now,
  }
  return flushStreamDeltas(withPending)
}

/**
 * 按序批量应用多条 delta（同一帧内合并）。
 * 返回 null 表示无任何有效变更。
 */
export function applyStreamDeltasBatch<T extends StreamableMessage>(
  message: T,
  deltas: ReadonlyArray<{ seq: number; delta: string }>,
  now = Date.now()
): T | null {
  if (message.stream_status !== "STREAMING" || deltas.length === 0) return null
  let current: T = message
  let changed = false
  for (const item of deltas) {
    const next: T | null = applyStreamDelta(current, item.seq, item.delta, now)
    if (next) {
      current = next
      changed = true
    }
  }
  return changed ? current : null
}

/**
 * 乱序缓冲中「最高 seq − 已应用 seq」的跨度。
 * 跨度大说明中间缺片，宜 REST getMessage 纠偏。
 */
export function streamGapSpan(message: StreamableMessage): number {
  const pending = message.streamPendingDeltas
  if (!pending) return 0
  const lastSeq = message.streamSeq ?? 0
  let maxPending = lastSeq
  for (const key of Object.keys(pending)) {
    const seq = Number(key)
    if (Number.isFinite(seq) && seq > maxPending) maxPending = seq
  }
  return Math.max(0, maxPending - lastSeq)
}

/** 是否建议发起 REST 纠偏（空洞跨度过大） */
export function shouldReconcileStreamGap(message: StreamableMessage): boolean {
  return (
    message.stream_status === "STREAMING" &&
    streamGapSpan(message) >= STREAM_GAP_RECONCILE_THRESHOLD
  )
}

export type StreamIdleLevel = "active" | "slow" | "stale"

/** 解析流式活动时间：优先本地活动戳，否则 created_at */
export function streamActivityAt(
  message: StreamableMessage,
  now = Date.now()
): number {
  if (
    typeof message.streamLastActivityAt === "number" &&
    Number.isFinite(message.streamLastActivityAt)
  ) {
    return message.streamLastActivityAt
  }
  if (message.created_at) {
    const parsed = Date.parse(message.created_at)
    if (Number.isFinite(parsed)) return parsed
  }
  return now
}

/** 根据空闲时长判定流式健康度（供 UI） */
export function streamIdleLevel(
  message: StreamableMessage,
  now = Date.now()
): StreamIdleLevel {
  if (message.stream_status !== "STREAMING") return "active"
  const last = streamActivityAt(message, now)
  const idle = now - last
  if (idle >= STREAM_STALE_IDLE_MS) return "stale"
  if (idle >= STREAM_SLOW_IDLE_MS) return "slow"
  return "active"
}

/**
 * REST 纠偏合并：
 * - 终态（非 STREAMING）：完全采用服务端
 * - 仍在 STREAMING：服务端 content 为权威累计；若本地因往返竞态更长则保留本地
 * - seq 推进到本地已见最大值，清空空洞缓冲，避免重复拼接
 */
export function mergeReconciledStreamMessage<T extends StreamableMessage>(
  previous: T | undefined,
  remote: T,
  now = Date.now()
): T {
  if (!previous) {
    return {
      ...remote,
      streamPendingDeltas: undefined,
      streamSeq: undefined,
      streamLastActivityAt:
        remote.stream_status === "STREAMING" ? now : undefined,
    }
  }

  if (remote.stream_status !== "STREAMING") {
    return {
      ...remote,
      streamSeq: undefined,
      streamPendingDeltas: undefined,
      streamLastActivityAt: undefined,
    }
  }

  let maxSeq = previous.streamSeq ?? 0
  for (const key of Object.keys(previous.streamPendingDeltas ?? {})) {
    const seq = Number(key)
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq
  }

  const localContent = previous.content ?? ""
  const remoteContent = remote.content ?? ""
  // 流式正文服务端只追加：更长 ⇒ 更新；往返期间本地可能已超前
  const localAhead = localContent.length > remoteContent.length
  const content = localAhead ? localContent : remoteContent
  const streamSeq = localAhead
    ? previous.streamSeq
    : maxSeq > 0
      ? maxSeq
      : undefined

  return {
    ...remote,
    content,
    stream_status: "STREAMING",
    streamSeq: streamSeq && streamSeq > 0 ? streamSeq : undefined,
    streamPendingDeltas: undefined,
    streamLastActivityAt: now,
  }
}

/** 频道+消息 → 批处理队列 key */
export function streamMessageKey(channelId: string, messageId: string): string {
  return `${channelId}\u0000${messageId}`
}

export function parseStreamMessageKey(
  key: string
): { channelId: string; messageId: string } | null {
  const sep = key.indexOf("\u0000")
  if (sep <= 0) return null
  return {
    channelId: key.slice(0, sep),
    messageId: key.slice(sep + 1),
  }
}
