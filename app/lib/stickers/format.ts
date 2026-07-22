// 贴图 / 小表情 wire 与反应键（对齐 Owl-Server docs 17）

import type { MessageStickerRef, StickerItem } from "~/lib/api/types"
import { resolveApiUrl } from "~/lib/api/http"

/** 正文内嵌小表情：`<e:item_id:mark>` */
export const CUSTOM_EMOTE_RE = /<e:(\d+):([a-zA-Z0-9_]+)>/g

export function customEmoteWire(itemId: string, mark: string): string {
  return `<e:${itemId}:${mark}>`
}

/** 自定义反应路径键 */
export function customReactionKey(itemId: string): string {
  return `item:${itemId}`
}

export function isCustomReactionKey(emoji: string): boolean {
  return emoji.startsWith("item:")
}

export function parseCustomReactionItemId(emoji: string): string | null {
  if (!emoji.startsWith("item:")) return null
  const id = emoji.slice(5)
  return /^\d+$/.test(id) ? id : null
}

export type EmoteSegment =
  | { kind: "text"; text: string }
  | { kind: "emote"; itemId: string; mark: string }

/** 将正文拆成文本段与小表情节点（保序） */
export function splitCustomEmotes(content: string): EmoteSegment[] {
  const segments: EmoteSegment[] = []
  const re = new RegExp(CUSTOM_EMOTE_RE.source, "g")
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    if (match.index > last) {
      segments.push({ kind: "text", text: content.slice(last, match.index) })
    }
    segments.push({
      kind: "emote",
      itemId: match[1]!,
      mark: match[2]!,
    })
    last = match.index + match[0].length
  }
  if (last < content.length) {
    segments.push({ kind: "text", text: content.slice(last) })
  }
  if (segments.length === 0 && content) {
    segments.push({ kind: "text", text: content })
  }
  return segments
}

export function contentHasCustomEmote(content: string): boolean {
  return /<e:\d+:[a-zA-Z0-9_]+>/.test(content)
}

/** 资产 URL：服务端返回相对路径时补全 */
export function stickerAssetUrl(path: string | undefined | null): string {
  if (!path) return ""
  return resolveApiUrl(path)
}

/** 是否为短视频贴图资产（mp4/webm/mov） */
export function isStickerVideoAsset(
  urlOrPath: string | undefined | null,
): boolean {
  if (!urlOrPath) return false
  const path = urlOrPath.split("?")[0]?.toLowerCase() ?? ""
  return (
    path.endsWith(".mp4") ||
    path.endsWith(".webm") ||
    path.endsWith(".mov") ||
    path.endsWith(".m4v")
  )
}

/** 文件选择器 accept：图片 + 短视频 */
export const STICKER_UPLOAD_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/apng,video/mp4,video/webm,video/quicktime,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov"

/**
 * 贴图媒体 props 辅助：根据 URL 扩展名判断用 video 还是 img。
 * 视频默认静音循环自动播放（表情/贴图预览语义）。
 */
export function stickerMediaKind(
  urlOrPath: string | undefined | null,
): "video" | "image" {
  return isStickerVideoAsset(urlOrPath) ? "video" : "image"
}

export function itemToRef(item: StickerItem): MessageStickerRef {
  return {
    item_id: item.id,
    pack_id: item.pack_id,
    mark: item.mark,
    kind: item.kind,
    animated: item.animated,
    asset_url: item.asset_url,
    width: item.width,
    height: item.height,
  }
}

/** 最近使用本地键 */
const RECENT_KEY = "owl.sticker.recent.v1"
const RECENT_MAX = 24

export type RecentExpression =
  | { kind: "unicode"; emoji: string }
  | {
      kind: "item"
      itemId: string
      mark: string
      /** 展示名（选择器下方文案） */
      name?: string
      assetUrl: string
      itemKind: "emote" | "sticker"
    }

/** 选择器下方展示名：优先 name，否则 mark */
export function itemDisplayName(item: {
  name?: string
  mark: string
}): string {
  const n = item.name?.trim()
  return n || item.mark
}

export function loadRecentExpressions(): RecentExpression[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as RecentExpression[]
    return Array.isArray(list) ? list.slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

export function pushRecentExpression(entry: RecentExpression): RecentExpression[] {
  const prev = loadRecentExpressions()
  const key =
    entry.kind === "unicode"
      ? `u:${entry.emoji}`
      : `i:${entry.itemId}`
  const next = [
    entry,
    ...prev.filter((item) =>
      item.kind === "unicode"
        ? `u:${item.emoji}` !== key
        : `i:${item.itemId}` !== key,
    ),
  ].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // quota
  }
  return next
}
