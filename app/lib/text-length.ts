// 文本长度工具：码点级计数，与服务端 utf8.RuneCountInString 对齐。

/** 按 Unicode 码点计数（emoji 基本符为 1；ZWJ 复合序列按多个码点计） */
export function codePointLength(value: string): number {
  return Array.from(value).length
}

/** 按码点截断到 max 长度 */
export function sliceByCodePoints(value: string, max: number): string {
  if (max <= 0) return ""
  const points = Array.from(value)
  if (points.length <= max) return value
  return points.slice(0, max).join("")
}

/**
 * 在光标处插入文本，可选码点上限。
 * 返回新字符串与新的 selection 位置（以 JS string index 计）。
 */
export function insertAtSelection(
  value: string,
  insert: string,
  start: number,
  end: number = start,
  maxChars?: number,
): { next: string; selection: number } {
  const before = value.slice(0, start)
  const after = value.slice(end)
  let next = before + insert + after
  if (maxChars !== undefined && codePointLength(next) > maxChars) {
    const room = maxChars - codePointLength(before + after)
    if (room <= 0) {
      return { next: value, selection: start }
    }
    const clipped = sliceByCodePoints(insert, room)
    next = before + clipped + after
    return { next, selection: before.length + clipped.length }
  }
  return { next, selection: before.length + insert.length }
}
