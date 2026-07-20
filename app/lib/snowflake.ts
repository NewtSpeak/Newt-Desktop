// 雪花 ID（十进制字符串）工具：跨 store 共用，避免 messages ↔ read-states 模块环。

/** 雪花 ID 比较：长度不同直接比长度，相同按字典序（等价于 BigInt 比较且更廉价） */
export function compareSnowflake(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  return a < b ? -1 : a > b ? 1 : 0
}
