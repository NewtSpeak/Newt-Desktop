// TipTap 自定义小表情节点：编辑器内嵌图片 chip，wire 序列化为 <e:item_id:mark>

import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"

import { CustomEmoteChipView } from "./custom-emote-view"

export type CustomEmoteStorage = {
  resolveAssetUrl?: (itemId: string) => string | undefined
}

declare module "@tiptap/core" {
  interface Storage {
    customEmote: CustomEmoteStorage
  }
}

export const CustomEmoteExtension = Node.create({
  name: "customEmote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addStorage() {
    return {
      resolveAssetUrl: undefined,
    } satisfies CustomEmoteStorage
  },

  addAttributes() {
    return {
      itemId: { default: "" },
      mark: { default: "" },
      assetUrl: { default: "" },
      animated: { default: false },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="custom-emote"]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false
          return {
            itemId: el.getAttribute("data-item-id") || "",
            mark: el.getAttribute("data-mark") || "",
            assetUrl: el.getAttribute("data-asset-url") || "",
            animated: el.getAttribute("data-animated") === "true",
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "custom-emote",
        "data-item-id": node.attrs.itemId,
        "data-mark": node.attrs.mark,
        "data-asset-url": node.attrs.assetUrl,
        "data-animated": node.attrs.animated ? "true" : "false",
        class: "inline-block align-middle mx-0.5",
      }),
      `:${node.attrs.mark || "emote"}:`,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CustomEmoteChipView)
  },

  renderText({ node }) {
    const itemId = String(node.attrs.itemId ?? "")
    const mark = String(node.attrs.mark ?? "")
    if (!itemId || !mark) return ""
    return `<e:${itemId}:${mark}>`
  },
})
