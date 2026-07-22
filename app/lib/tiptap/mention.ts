// TipTap 提及节点：渲染为胶囊 chip，wire 序列化为 <@userId>
// 无 JSX，保持 .ts；React 视图见 mention-view.tsx

import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"

import { MentionChipView } from "./mention-view"

export type MentionStorage = {
  resolveLabel?: (id: string) => string
  resolveAvatar?: (id: string) => string | undefined
  selfId?: string
}

declare module "@tiptap/core" {
  interface Storage {
    mention: MentionStorage
  }
}

export const MentionExtension = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addStorage() {
    return {
      resolveLabel: undefined,
      resolveAvatar: undefined,
      selfId: undefined,
    } satisfies MentionStorage
  },

  addAttributes() {
    return {
      id: { default: "" },
      label: { default: "" },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="mention"]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false
          return {
            id: el.getAttribute("data-id") || "",
            label:
              el.getAttribute("data-label") ||
              el.textContent?.replace(/^@/, "") ||
              "",
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "mention",
        "data-id": node.attrs.id,
        "data-label": node.attrs.label,
        class:
          "mx-0.5 inline-flex items-center rounded-md bg-primary/15 px-1.5 py-0.5 text-[0.95em] font-medium text-primary align-middle select-none",
      }),
      `@${node.attrs.label || "用户"}`,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionChipView)
  },

  renderText({ node }) {
    return `<@${node.attrs.id}>`
  },
})
