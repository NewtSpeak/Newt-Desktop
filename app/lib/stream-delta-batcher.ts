// Gateway MESSAGE_STREAM_DELTA 批处理：将同一帧内多条 delta 合并为一次 store 写入，
// 降低 AI 高频 token 时的 React 重渲压力。

import {
  parseStreamMessageKey,
  streamMessageKey,
  type StreamableMessage,
} from "./message-stream"

export type StreamDeltaItem = {
  channelId: string
  messageId: string
  seq: number
  delta: string
}

export type StreamDeltaFlushHandler = (
  batches: Map<string, StreamDeltaItem[]>
) => void

const MAX_FLUSH_DELAY_MS = 32

/**
 * rAF + 最长 32ms 兜底的 delta 队列。
 * 浏览器用 rAF 对齐绘制；无 rAF 环境（测试）退化为 setTimeout。
 */
export class StreamDeltaBatcher {
  private queue = new Map<string, StreamDeltaItem[]>()
  private rafId = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly onFlush: StreamDeltaFlushHandler

  constructor(onFlush: StreamDeltaFlushHandler) {
    this.onFlush = onFlush
  }

  enqueue(item: StreamDeltaItem): void {
    if (!item.delta) return
    const key = streamMessageKey(item.channelId, item.messageId)
    const list = this.queue.get(key)
    if (list) list.push(item)
    else this.queue.set(key, [item])
    this.schedule()
  }

  /** 立即冲刷（END / reset / 测试用） */
  flushNow(): void {
    this.clearSchedule()
    if (this.queue.size === 0) return
    const batches = this.queue
    this.queue = new Map()
    this.onFlush(batches)
  }

  clear(): void {
    this.clearSchedule()
    this.queue = new Map()
  }

  get pendingCount(): number {
    let n = 0
    for (const list of this.queue.values()) n += list.length
    return n
  }

  private schedule(): void {
    if (typeof requestAnimationFrame === "function") {
      if (!this.rafId) {
        this.rafId = requestAnimationFrame(() => {
          this.rafId = 0
          this.flushNow()
        })
      }
    }
    // 最长等待：即使 rAF 被节流/后台标签页，也不超过 32ms 才写出
    if (this.timer == null) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.flushNow()
      }, MAX_FLUSH_DELAY_MS)
    }
  }

  private clearSchedule(): void {
    if (this.rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId)
    }
    this.rafId = 0
    if (this.timer != null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}

/** 从批处理 Map 中取出某条消息的 delta 列表 */
export function deltasForMessage(
  batches: Map<string, StreamDeltaItem[]>,
  channelId: string,
  messageId: string
): StreamDeltaItem[] {
  return batches.get(streamMessageKey(channelId, messageId)) ?? []
}

/** 将批处理项折叠为 {seq, delta}[]（供 applyStreamDeltasBatch） */
export function toSeqDeltas(
  items: StreamDeltaItem[]
): Array<{ seq: number; delta: string }> {
  return items.map((item) => ({ seq: item.seq, delta: item.delta }))
}

/** 遍历批处理中涉及的消息键 */
export function forEachStreamBatch(
  batches: Map<string, StreamDeltaItem[]>,
  fn: (
    channelId: string,
    messageId: string,
    items: StreamDeltaItem[]
  ) => void
): void {
  for (const [key, items] of batches) {
    const parsed = parseStreamMessageKey(key)
    if (!parsed) continue
    fn(parsed.channelId, parsed.messageId, items)
  }
}

/** 标记流式活动时间（START / 手动刷新后） */
export function touchStreamActivity<T extends StreamableMessage>(
  message: T,
  now = Date.now()
): T {
  return { ...message, streamLastActivityAt: now }
}
