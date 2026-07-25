// Bot 消息卡片（message.card）解析：服务端只校验「JSON 对象 ≤8KB」，
// 渲染 schema 由客户端约定（对齐 Bot SDK README 推荐结构）。

export type BotCardField = {
  name: string
  value: string
  inline?: boolean
}

export type BotCardButton = {
  label: string
  url: string
}

/** 推荐卡片结构（字段均可选；未知字段忽略） */
export type BotCard = {
  title?: string
  description?: string
  /** 左侧色条，推荐 #RRGGBB */
  color?: string
  fields?: BotCardField[]
  buttons?: BotCardButton[]
  footer?: string
  /** 右侧小图 URL */
  thumbnail?: string
  /** 底部大图 URL */
  image?: string
}

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/** 仅允许 http(s) 外链，避免 javascript: 等危险协议 */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

export function normalizeCardColor(color: string | undefined): string | undefined {
  if (!color) return undefined
  const trimmed = color.trim()
  return HEX_COLOR.test(trimmed) ? trimmed : undefined
}

function parseFields(raw: unknown): BotCardField[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const fields: BotCardField[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const name = asTrimmedString(row.name)
    const value = asTrimmedString(row.value)
    if (!name || !value) continue
    fields.push({
      name,
      value,
      inline: Boolean(row.inline),
    })
  }
  return fields.length > 0 ? fields : undefined
}

function parseButtons(raw: unknown): BotCardButton[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const buttons: BotCardButton[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const label = asTrimmedString(row.label)
    const url = asTrimmedString(row.url)
    if (!label || !url || !isSafeHttpUrl(url)) continue
    buttons.push({ label, url })
  }
  return buttons.length > 0 ? buttons : undefined
}

/**
 * 将 message.card（对象或 JSON 字符串）解析为可渲染卡片。
 * 非法 / 空对象返回 null。
 */
export function parseBotCard(raw: unknown): BotCard | null {
  let value: unknown = raw
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
      value = JSON.parse(trimmed)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null

  const obj = value as Record<string, unknown>
  const card: BotCard = {
    title: asTrimmedString(obj.title),
    description: asTrimmedString(obj.description),
    color: normalizeCardColor(asTrimmedString(obj.color)),
    fields: parseFields(obj.fields),
    buttons: parseButtons(obj.buttons),
    footer: asTrimmedString(obj.footer),
    thumbnail:
      asTrimmedString(obj.thumbnail) &&
      isSafeHttpUrl(asTrimmedString(obj.thumbnail)!)
        ? asTrimmedString(obj.thumbnail)
        : undefined,
    image:
      asTrimmedString(obj.image) && isSafeHttpUrl(asTrimmedString(obj.image)!)
        ? asTrimmedString(obj.image)
        : undefined,
  }

  const hasBody = Boolean(
    card.title ||
      card.description ||
      card.fields?.length ||
      card.buttons?.length ||
      card.footer ||
      card.thumbnail ||
      card.image
  )
  return hasBody ? card : null
}
