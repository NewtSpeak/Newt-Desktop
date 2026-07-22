// 消息正文：Markdown + 内嵌自定义小表情节点。

import { MarkdownContent } from "~/lib/markdown"
import type { MentionAvatarResolver, MentionResolver } from "~/lib/markdown"
import {
  contentHasCustomEmote,
  splitCustomEmotes,
} from "~/lib/stickers/format"
import { useStickersStore } from "~/stores/stickers"
import { CustomEmoteImg, INLINE_EMOTE_PX } from "./custom-emote"

export function MessageContent({
  content,
  resolveMention,
  resolveMentionAvatar,
  selfId,
  guildId,
  compact = false,
  className,
}: {
  content: string
  resolveMention: MentionResolver
  resolveMentionAvatar?: MentionAvatarResolver
  selfId?: string
  guildId?: string
  compact?: boolean
  className?: string
}) {
  const openPackPreview = useStickersStore((s) => s.openPackPreview)
  const getItem = useStickersStore((s) => s.getItem)

  if (!contentHasCustomEmote(content)) {
    return (
      <MarkdownContent
        content={content}
        resolveMention={resolveMention}
        resolveMentionAvatar={resolveMentionAvatar}
        selfId={selfId}
        compact={compact}
        className={className}
      />
    )
  }

  const segments = splitCustomEmotes(content)
  return (
    <span
      className={
        className ??
        (compact
          ? "inline min-w-0 text-sm leading-snug"
          : "inline-block min-w-0 text-sm leading-relaxed")
      }
    >
      {segments.map((seg, index) => {
        if (seg.kind === "text") {
          if (!seg.text) return null
          // 混排时文本段走 Markdown；多段时避免块级撑开
          return (
            <MarkdownContent
              key={`t-${index}`}
              content={seg.text}
              resolveMention={resolveMention}
              resolveMentionAvatar={resolveMentionAvatar}
              selfId={selfId}
              compact
              className="inline [&_.tiptap-owl]:inline [&_.tiptap-owl_p]:inline"
            />
          )
        }
        const cached = getItem(seg.itemId)
        return (
          <CustomEmoteImg
            key={`e-${seg.itemId}-${index}`}
            itemId={seg.itemId}
            mark={seg.mark}
            assetUrl={cached?.asset_url}
            size={compact ? 16 : INLINE_EMOTE_PX}
            className="mx-0.5"
            onClick={() => {
              const packId = cached?.pack_id
              if (packId) {
                openPackPreview(packId, {
                  itemId: seg.itemId,
                  guildId,
                })
              }
            }}
          />
        )
      })}
    </span>
  )
}
