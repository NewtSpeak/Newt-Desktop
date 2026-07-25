// TipTap 频道提及节点：chip 展示，wire 序列化为 <#channelId>
// React 视图见 channel-mention-view.tsx

import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"

import { ChannelMentionChipView } from "./channel-mention-view"

export type ChannelMentionStorage = {
  resolveLabel?: (id: string) => string
  resolveType?: (id: string) => "TEXT" | "VOICE" | "CATEGORY" | undefined
  /** 点击 chip 时打开频道（由渲染层注入 navigate） */
  onOpen?: (channelId: string) => void
}

declare module "@tiptap/core" {
  interface Storage {
    channelMention: ChannelMentionStorage
  }
}

export const ChannelMentionExtension = Node.create({
  name: "channelMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addStorage() {
    return {
      resolveLabel: undefined,
      resolveType: undefined,
      onOpen: undefined,
    } satisfies ChannelMentionStorage
  },

  addAttributes() {
    return {
      id: { default: "" },
      label: { default: "" },
      /** TEXT | VOICE；写入时带上，渲染时也可从 store 回填 */
      channelType: { default: "TEXT" },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="channelMention"]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false
          return {
            id: el.getAttribute("data-id") || "",
            label:
              el.getAttribute("data-label") ||
              el.textContent?.replace(/^#/, "") ||
              "",
            channelType: el.getAttribute("data-channel-type") || "TEXT",
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "channelMention",
        "data-id": node.attrs.id,
        "data-label": node.attrs.label,
        "data-channel-type": node.attrs.channelType || "TEXT",
        class:
          "owl-channel-mention-chip inline-flex items-center gap-[0.2em] rounded-[0.3em] bg-muted px-[0.4em] py-[0.1em] font-medium text-foreground align-middle select-none",
      }),
      ["span", {}, String(node.attrs.label || "频道")],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChannelMentionChipView, {
      as: "span",
      className: "owl-channel-mention-nv inline",
    })
  },

  renderText({ node }) {
    return `<#${node.attrs.id}>`
  },
})
