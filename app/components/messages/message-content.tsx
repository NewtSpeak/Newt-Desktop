// 消息正文：统一走 TipTap Markdown（含行内小表情混排，字号与正文 1em 一致）。

import { MarkdownContent } from "~/lib/markdown"
import type { MentionAvatarResolver, MentionResolver } from "~/lib/markdown"

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
  return (
    <MarkdownContent
      content={content}
      resolveMention={resolveMention}
      resolveMentionAvatar={resolveMentionAvatar}
      selfId={selfId}
      guildId={guildId}
      compact={compact}
      className={className}
    />
  )
}
