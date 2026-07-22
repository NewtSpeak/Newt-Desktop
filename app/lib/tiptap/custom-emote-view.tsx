// TipTap customEmote NodeView：输入框内嵌小表情图

import {
  NodeViewWrapper,
  type ReactNodeViewProps,
} from "@tiptap/react"

import { stickerAssetUrl } from "~/lib/stickers/format"
import type { CustomEmoteStorage } from "./custom-emote"

export function CustomEmoteChipView(props: ReactNodeViewProps) {
  const { node, editor } = props
  const itemId = String(node.attrs.itemId ?? "")
  const mark = String(node.attrs.mark ?? "")
  const storage = editor.storage.customEmote as CustomEmoteStorage | undefined
  const resolved =
    storage?.resolveAssetUrl?.(itemId) ||
    String(node.attrs.assetUrl || "")
  const url = stickerAssetUrl(resolved)

  return (
    <NodeViewWrapper as="span" className="inline">
      <span
        contentEditable={false}
        data-type="custom-emote"
        data-item-id={itemId}
        data-mark={mark}
        className="mx-0.5 inline-flex size-[1.35em] items-center justify-center align-[-0.2em] select-none"
        title={mark || "小表情"}
      >
        {url ? (
          <img
            src={url}
            alt={mark || "小表情"}
            draggable={false}
            className="size-[1.35em] object-contain"
          />
        ) : (
          <span className="text-[0.75em] text-muted-foreground">:{mark}:</span>
        )}
      </span>
    </NodeViewWrapper>
  )
}
