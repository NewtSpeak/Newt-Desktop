// TipTap 自定义小表情节点：编辑器内嵌图片 chip，wire 序列化为 <e:item_id:mark>

import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"

import { asSnowflakeId } from "~/lib/snowflake"
import { CustomEmoteChipView } from "./custom-emote-view"

export type CustomEmoteStorage = {
  resolveAssetUrl?: (itemId: string) => string | undefined
  /** 只读消息：点击小表情打开表情包预览 */
  onOpen?: (opts: { itemId: string; mark: string }) => void
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
      onOpen: undefined,
    } satisfies CustomEmoteStorage
  },

  addAttributes() {
    return {
      itemId: {
        default: "",
        // 始终存字符串，防止 ProseMirror/JSON 路径把雪花变成 number
        parseHTML: (el) =>
          asSnowflakeId(
            el instanceof HTMLElement
              ? el.getAttribute("data-item-id")
              : "",
          ),
        renderHTML: (attrs) => ({
          "data-item-id": asSnowflakeId(attrs.itemId),
        }),
      },
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
            itemId: asSnowflakeId(el.getAttribute("data-item-id")),
            mark: el.getAttribute("data-mark") || "",
            assetUrl: el.getAttribute("data-asset-url") || "",
            animated: el.getAttribute("data-animated") === "true",
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const itemId = asSnowflakeId(node.attrs.itemId)
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "custom-emote",
        "data-item-id": itemId,
        "data-mark": node.attrs.mark,
        "data-asset-url": node.attrs.assetUrl,
        "data-animated": node.attrs.animated ? "true" : "false",
        // 与正文字号一致（1em），行内混排
        class: "owl-custom-emote inline-block align-[-0.15em]",
        style: "width:1em;height:1em;line-height:1",
      }),
      `:${node.attrs.mark || "emote"}:`,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CustomEmoteChipView, {
      // 行内 atom：必须用 span，否则会变成块级单独占行
      as: "span",
      className: "owl-custom-emote-nv",
    })
  },

  renderText({ node }) {
    const itemId = asSnowflakeId(node.attrs.itemId)
    const mark = String(node.attrs.mark ?? "")
    if (!itemId || !mark) return ""
    return `<e:${itemId}:${mark}>`
  },
})
