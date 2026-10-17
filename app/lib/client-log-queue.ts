export type ClientLogEntry = {
  level: "debug" | "info" | "warn" | "error"
  message: string
  location?: string
  repeats?: number
}

type Options = {
  send: (entries: ClientLogEntry[], flush: boolean) => Promise<unknown>
  schedule?: (callback: () => void) => () => void
}

// 上限与 src-tauri/src/client_log.rs 的 validate_batch 对应（client-log-queue.test.ts 交叉校验）：
// 一批最多 MAX_QUEUE 条 + 1 条丢弃提示。Rust 拒收的批次只会被重试到 MAX_ATTEMPTS 次。
export const MAX_QUEUE = 400
export const MAX_MESSAGE_CHARS = 4000
export const MAX_LOCATION_CHARS = 512
const BATCH_SIZE = 80
/** Tauri IPC 的失败基本是确定性的（反序列化/校验），无限重试会让一条坏日志卡死整条队列 */
const MAX_ATTEMPTS = 3
type QueuedEntry = { entry: ClientLogEntry; sequence: number; attempts: number }

/** 孤立的 UTF-16 代理会让 serde_json 拒收整批（"unexpected end of hex escape"），替换为 U+FFFD */
function wellFormed(text: string) {
  return text.replace(
    /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g,
    (char) => (char.length === 2 ? char : "\uFFFD")
  )
}

function clip(text: string, max: number, suffix = "") {
  return wellFormed(text.length > max ? `${text.slice(0, max)}${suffix}` : text)
}

export function createClientLogQueue({
  send,
  schedule = defaultSchedule,
}: Options) {
  let pending: QueuedEntry[] = []
  let sequence = 0
  let inFlight = 0
  let dropped = 0
  let cancelTimer: (() => void) | undefined

  function scheduleFlush() {
    cancelTimer ??= schedule(() => {
      cancelTimer = undefined
      void flush()
    })
  }

  function push(input: ClientLogEntry) {
    const entry = {
      ...input,
      message: clip(input.message, MAX_MESSAGE_CHARS, "…[truncated]"),
      location: input.location && clip(input.location, MAX_LOCATION_CHARS),
    }
    const last = pending.at(-1)?.entry
    if (
      last &&
      last.level === entry.level &&
      last.message === entry.message &&
      last.location === entry.location
    ) {
      last.repeats = Math.min((last.repeats ?? 0) + 1, 0xffffffff)
    } else if (pending.length + inFlight >= MAX_QUEUE) {
      dropped++
    } else {
      pending.push({ entry, sequence: sequence++, attempts: 0 })
    }
    scheduleFlush()
  }

  async function flush(all = false): Promise<boolean> {
    cancelTimer?.()
    cancelTimer = undefined
    if (!all && inFlight > 0) return true
    if (pending.length === 0 && dropped === 0) return true

    const batch = pending.splice(0, all ? pending.length : BATCH_SIZE)
    const messages = batch.map(({ entry }) => entry)
    const lost = dropped
    dropped = 0
    const entries =
      lost > 0
        ? [
            ...messages,
            {
              level: "warn" as const,
              message: `[client-log] 已丢弃 ${lost} 条日志（队列溢出或多次发送失败）`,
            },
          ]
        : messages
    inFlight += batch.length
    try {
      await send(entries, all)
    } catch {
      const retry = batch.filter((item) => ++item.attempts < MAX_ATTEMPTS)
      pending = [...retry, ...pending].sort((a, b) => a.sequence - b.sequence)
      dropped += lost + batch.length - retry.length
      return false
    } finally {
      inFlight -= batch.length
    }
    if (pending.length > 0 || dropped > 0) scheduleFlush()
    return true
  }

  return { push, flush }
}

function defaultSchedule(callback: () => void) {
  const timer = setTimeout(callback, 300)
  return () => clearTimeout(timer)
}
