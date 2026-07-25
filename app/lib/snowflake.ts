// 雪花 ID（十进制字符串）工具：跨 store 共用，避免 messages ↔ read-states 模块环。

/** 雪花 ID 比较：长度不同直接比长度，相同按字典序（等价于 BigInt 比较且更廉价） */
export function compareSnowflake(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * 规范化雪花 / 条目 ID 为十进制字符串。
 * 禁止用 Number()：贴图 snowflake 已超过 Number.MAX_SAFE_INTEGER，会丢精度
 *（例如 74381389109137408 → 74381389109137400），导致「不在可用集合内」。
 */
export function asSnowflakeId(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value.trim()
  if (typeof value === "bigint") return value.toString(10)
  if (typeof value === "number") {
    // 已丢精度的 number 无法恢复；尽量用整数形式输出并避免科学计数法
    if (!Number.isFinite(value)) return ""
    return Math.trunc(value).toString(10)
  }
  return String(value).trim()
}

/**
 * 在 JSON.parse 之前，把「裸」大整数改写成 JSON 字符串，避免精度丢失。
 * 仅处理 ≥16 位的整数 token（雪花 ID 量级）；不影响普通小数字与已有字符串。
 */
export function parseJsonPreservingLargeInts<T = unknown>(text: string): T {
  if (!text) return undefined as T
  const rewritten = text.replace(
    /([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g,
    '$1"$2"',
  )
  return JSON.parse(rewritten) as T
}
