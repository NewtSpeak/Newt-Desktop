// Bot 消息卡片（message.card）解析：服务端自 2026-07 起解析并校验 buttons 键
//（互斥/上限/裁剪，设计文档 2026-07-26），其余键仍由客户端约定渲染。
// 客户端解析保持「宽容跳过」白名单风格：非法按钮丢弃而非整卡拒绝（防御旧数据）。

export type BotCardField = {
  name: string
  value: string
  inline?: boolean
}

export type BotCardButtonStyle = "primary" | "secondary" | "success" | "danger"
export type BotCardButtonSize = "xs" | "sm" | "md" | "lg"

type BotCardButtonBase = {
  /** 1-40 码位；超长按码位截断（防 emoji 拦腰截断） */
  label: string
  /** 解析后必填：缺省/非法值回退 "secondary" */
  style: BotCardButtonStyle
  /** 解析后必填：缺省/未知值回退 "sm" */
  size: BotCardButtonSize
  disabled: boolean
  /** 0-4 显式分行；缺省进入自动折行（每行 5 个） */
  row?: number
}

/** 外链按钮（渲染为 <a>，link 样式 + 外链图标） */
export type BotCardLinkButton = BotCardButtonBase & {
  kind: "link"
  url: string
}

/** 交互回调按钮（点击走 interactions 端点） */
export type BotCardInteractiveButton = BotCardButtonBase & {
  kind: "interactive"
  customId: string
}

export type BotCardButton = BotCardLinkButton | BotCardInteractiveButton

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
const CUSTOM_ID_PATTERN = /^[A-Za-z0-9_\-:.]{1,64}$/

const BUTTON_STYLES: readonly BotCardButtonStyle[] = [
  "primary",
  "secondary",
  "success",
  "danger",
]
const BUTTON_SIZES: readonly BotCardButtonSize[] = ["xs", "sm", "md", "lg"]

/** 与服务端一致的按钮上限（5 行 × 5 个） */
export const MAX_CARD_BUTTONS = 25
const MAX_LABEL_CODEPOINTS = 40
const MAX_BUTTON_ROW = 4
/** 自动折行：无显式 row 的按钮每行个数 */
const AUTO_ROW_SIZE = 5

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

function parseButtonLabel(raw: unknown): string | undefined {
  const label = asTrimmedString(raw)
  if (!label) return undefined
  // 按 Unicode 码位截断到 40，防止 emoji 被拦腰截断
  return Array.from(label).slice(0, MAX_LABEL_CODEPOINTS).join("")
}

function parseButtons(raw: unknown): BotCardButton[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const buttons: BotCardButton[] = []
  const seenCustomIds = new Set<string>()
  for (const item of raw) {
    if (buttons.length >= MAX_CARD_BUTTONS) break
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const label = parseButtonLabel(row.label)
    if (!label) continue
    const url = asTrimmedString(row.url)
    const customId = asTrimmedString(row.custom_id)
    // url 与 custom_id 必须恰好其一（服务端已校验，此处防御旧数据/恶意 payload）
    if (Boolean(url) === Boolean(customId)) continue

    const style = BUTTON_STYLES.includes(row.style as BotCardButtonStyle)
      ? (row.style as BotCardButtonStyle)
      : "secondary"
    const size = BUTTON_SIZES.includes(row.size as BotCardButtonSize)
      ? (row.size as BotCardButtonSize)
      : "sm"
    const rowIndex =
      typeof row.row === "number" &&
      Number.isInteger(row.row) &&
      row.row >= 0 &&
      row.row <= MAX_BUTTON_ROW
        ? row.row
        : undefined
    const base: BotCardButtonBase = {
      label,
      style,
      size,
      disabled: Boolean(row.disabled),
      row: rowIndex,
    }

    if (url) {
      if (!isSafeHttpUrl(url)) continue
      buttons.push({ ...base, kind: "link", url })
      continue
    }
    if (!customId || !CUSTOM_ID_PATTERN.test(customId)) continue
    if (seenCustomIds.has(customId)) continue
    seenCustomIds.add(customId)
    buttons.push({ ...base, kind: "interactive", customId })
  }
  return buttons.length > 0 ? buttons : undefined
}

/**
 * 按钮分行排布（与服务端「缺省按声明顺序每行 5 个自动折行」约定对齐）：
 * 显式 row 的按钮按 0-4 分桶（桶内保持声明顺序），
 * 无 row 的按钮按声明顺序每 5 个一行追加在显式行之后；空桶不产生空行。
 */
export function layoutButtonRows(buttons: BotCardButton[]): BotCardButton[][] {
  const explicit = new Map<number, BotCardButton[]>()
  const auto: BotCardButton[] = []
  for (const button of buttons) {
    if (button.row !== undefined) {
      const bucket = explicit.get(button.row) ?? []
      bucket.push(button)
      explicit.set(button.row, bucket)
    } else {
      auto.push(button)
    }
  }
  const rows: BotCardButton[][] = []
  for (let index = 0; index <= MAX_BUTTON_ROW; index++) {
    const bucket = explicit.get(index)
    if (bucket && bucket.length > 0) rows.push(bucket)
  }
  for (let start = 0; start < auto.length; start += AUTO_ROW_SIZE) {
    rows.push(auto.slice(start, start + AUTO_ROW_SIZE))
  }
  return rows
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
