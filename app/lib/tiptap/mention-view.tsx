// TipTap mention 的 React NodeView（JSX，须为 .tsx）

import {
  NodeViewWrapper,
  type ReactNodeViewProps,
} from "@tiptap/react"

import type { MentionStorage } from "./mention"

export function MentionChipView(props: ReactNodeViewProps) {
  const { node, editor } = props
  const id = String(node.attrs.id ?? "")
  const storage = editor.storage.mention as MentionStorage | undefined
  const label =
    storage?.resolveLabel?.(id) ||
    String(node.attrs.label || id.slice(0, 6) || "用户")
  const avatar = storage?.resolveAvatar?.(id)
  const isSelf = Boolean(storage?.selfId && storage.selfId === id)

  return (
    <NodeViewWrapper as="span" className="inline">
      <span
        contentEditable={false}
        data-type="mention"
        data-id={id}
        className={[
          "mx-0.5 inline-flex items-center gap-1 rounded-md font-medium align-middle select-none",
          "py-0.5 pr-1.5 pl-0.5 text-[0.95em]",
          isSelf
            ? "bg-amber-500/30 text-amber-700 dark:text-amber-300"
            : "bg-primary/15 text-primary",
        ].join(" ")}
      >
        {avatar ? (
          <img
            src={avatar}
            alt=""
            className="size-4 shrink-0 rounded-full object-cover"
            draggable={false}
          />
        ) : (
          <span
            className={[
              "flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
              isSelf
                ? "bg-amber-600/40 text-amber-50"
                : "bg-primary/30 text-primary-foreground",
            ].join(" ")}
            aria-hidden
          >
            {(label || "?").slice(0, 1).toUpperCase()}
          </span>
        )}
        <span>@{label}</span>
      </span>
    </NodeViewWrapper>
  )
}
