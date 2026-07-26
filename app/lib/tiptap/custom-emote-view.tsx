// TipTap customEmote NodeView：与正文字号 1:1 的行内小表情，支持文本混排

import { useEffect, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react"
import {
  NodeViewWrapper,
  type ReactNodeViewProps,
} from "@tiptap/react"

import { StickerMedia } from "~/components/messages/sticker-media"
import { asSnowflakeId } from "~/lib/snowflake"
import { stickerAssetUrl } from "~/lib/stickers/format"
import { cn } from "~/lib/utils"
import { useStickersStore } from "~/stores/stickers"
import type { CustomEmoteStorage } from "./custom-emote"

/** 与当前字体 1em 对齐，略下沉以贴近中文基线 */
const EMOTE_BOX: CSSProperties = {
  display: "inline-block",
  width: "1em",
  height: "1em",
  verticalAlign: "-0.15em",
  lineHeight: 1,
  overflow: "hidden",
}

export function CustomEmoteChipView(props: ReactNodeViewProps) {
  const { node, editor } = props
  const itemId = asSnowflakeId(node.attrs.itemId)
  const mark = String(node.attrs.mark ?? "")
  const attrUrl = String(node.attrs.assetUrl || "")
  const storage = editor.storage.customEmote as CustomEmoteStorage | undefined

  // 订阅 store：ensureAvailable / ensureItem 回填后能立刻重绘（不能只靠 storage 闭包）
  const cachedUrl = useStickersStore(
    (s) => (itemId ? s.itemCache[itemId]?.asset_url : undefined),
  )
  const ensureItem = useStickersStore((s) => s.ensureItem)

  const resolvedFromStorage = itemId
    ? storage?.resolveAssetUrl?.(itemId)
    : undefined
  const initialUrl = stickerAssetUrl(
    attrUrl || cachedUrl || resolvedFromStorage || "",
  )
  const [url, setUrl] = useState(initialUrl)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const fromStorage = (
      editor.storage.customEmote as CustomEmoteStorage | undefined
    )?.resolveAssetUrl?.(itemId)
    const next = stickerAssetUrl(attrUrl || cachedUrl || fromStorage || "")
    if (next) {
      setUrl(next)
      setFailed(false)
      return
    }
    if (!itemId) {
      setFailed(true)
      return
    }
    let cancelled = false
    void ensureItem(itemId).then((item) => {
      if (cancelled) return
      const fetched = stickerAssetUrl(item?.asset_url)
      if (fetched) {
        setUrl(fetched)
        setFailed(false)
      } else {
        setFailed(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [itemId, attrUrl, cachedUrl, ensureItem, editor])

  const clickable = Boolean(storage?.onOpen) && !editor.isEditable

  const onClick = (event: MouseEvent) => {
    if (!clickable) return
    event.preventDefault()
    event.stopPropagation()
    storage?.onOpen?.({ itemId, mark })
  }

  return (
    <NodeViewWrapper
      as="span"
      className="owl-custom-emote-nv"
      // 强制行内：避免 React NodeView 默认块级导致表情/文字被拆行
      style={{
        display: "inline",
        lineHeight: "inherit",
        whiteSpace: "nowrap",
        verticalAlign: "baseline",
      }}
    >
      <span
        contentEditable={false}
        data-type="custom-emote"
        data-item-id={itemId}
        data-mark={mark}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        title={mark ? `:${mark}:` : "小表情"}
        onClick={onClick}
        onKeyDown={
          clickable
            ? (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  storage?.onOpen?.({ itemId, mark })
                }
              }
            : undefined
        }
        className={cn(
          "owl-custom-emote select-none",
          clickable && "cursor-pointer",
        )}
        style={EMOTE_BOX}
      >
        {url && !failed ? (
          <StickerMedia
            src={url}
            alt={mark || "小表情"}
            draggable={false}
            className="block size-full max-h-none max-w-none"
            style={{ width: "100%", height: "100%", display: "block" }}
            onError={() => setFailed(true)}
          />
        ) : (
          <span
            className="inline-flex size-full items-center justify-center rounded-[2px] bg-muted/80 text-[0.55em] leading-none text-muted-foreground"
            aria-hidden
          >
            {failed ? "?" : ""}
          </span>
        )}
      </span>
    </NodeViewWrapper>
  )
}
