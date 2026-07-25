// TipTap channelMention NodeView：
// 与 @mention 一样用 span（勿用 button，contentEditable 内 button 会导致插入/展示异常）。
// 背景对齐行内 code（muted）；略大但不强行撑高行。

import type { CSSProperties, KeyboardEvent, MouseEvent } from "react"
import { HashIcon, Volume2Icon } from "lucide-react"
import {
  NodeViewWrapper,
  type ReactNodeViewProps,
} from "@tiptap/react"

import type { ChannelMentionStorage } from "./channel-mention"

const CHIP_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.2em",
  maxWidth: "100%",
  padding: "0.1em 0.4em",
  margin: "0 0.12em",
  verticalAlign: "middle",
  fontSize: "0.95em",
  lineHeight: 1.25,
  borderRadius: "0.3em",
  whiteSpace: "nowrap",
  backgroundColor: "var(--muted)",
  color: "var(--foreground)",
}

export function ChannelMentionChipView(props: ReactNodeViewProps) {
  const { node, editor } = props
  const id = String(node.attrs.id ?? "")
  const storage = editor.storage.channelMention as
    | ChannelMentionStorage
    | undefined
  const label =
    storage?.resolveLabel?.(id) ||
    String(node.attrs.label || id.slice(0, 6) || "频道")
  const channelType =
    storage?.resolveType?.(id) ||
    (String(node.attrs.channelType || "TEXT").toUpperCase() as
      | "TEXT"
      | "VOICE"
      | "CATEGORY")
  const isVoice = channelType === "VOICE"
  const clickable = Boolean(id) && !editor.isEditable && Boolean(storage?.onOpen)

  const open = () => {
    if (!clickable || !id) return
    storage?.onOpen?.(id)
  }

  const onClick = (event: MouseEvent) => {
    if (!clickable) return
    event.preventDefault()
    event.stopPropagation()
    open()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!clickable) return
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      open()
    }
  }

  return (
    <NodeViewWrapper as="span" className="owl-channel-mention-nv inline">
      <span
        contentEditable={false}
        data-type="channelMention"
        data-id={id}
        data-label={label}
        data-channel-type={channelType}
        role={clickable ? "link" : undefined}
        tabIndex={clickable ? 0 : undefined}
        title={
          isVoice ? `加入语音频道 #${label}` : `跳转到 #${label}`
        }
        onClick={onClick}
        onKeyDown={onKeyDown}
        className={[
          "owl-channel-mention-chip font-medium select-none",
          clickable ? "cursor-pointer" : "cursor-default",
        ].join(" ")}
        style={CHIP_STYLE}
      >
        {isVoice ? (
          <Volume2Icon
            className="shrink-0 opacity-80"
            style={{ width: "0.9em", height: "0.9em" }}
            aria-hidden
          />
        ) : (
          <HashIcon
            className="shrink-0 opacity-80"
            style={{ width: "0.9em", height: "0.9em" }}
            aria-hidden
          />
        )}
        <span className="min-w-0 truncate" style={{ lineHeight: 1.25 }}>
          {label}
        </span>
      </span>
    </NodeViewWrapper>
  )
}
