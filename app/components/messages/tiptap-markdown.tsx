// TipTap 只读 Markdown 渲染：wire 格式 → TipTap doc → 精致 prose 展示。

import { useEffect, useMemo } from "react"
import { EditorContent, useEditor } from "@tiptap/react"

import {
  createOwlExtensions,
  TIPTAP_PROSE_CLASS,
} from "~/lib/tiptap/extensions"
import { markdownToTipTapDoc } from "~/lib/tiptap/markdown-bridge"
import { cn } from "~/lib/utils"

export type MentionResolver = (userId: string) => string
export type MentionAvatarResolver = (userId: string) => string | undefined

const EMOJI_ONLY_RE =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F3FB}-\u{1F3FF}\u200D\uFE0F\u20E3]|\s)+$/u

function isJumboEmoji(content: string): boolean {
  const trimmed = content.trim()
  if (trimmed === "" || trimmed.length > 27) return false
  return EMOJI_ONLY_RE.test(trimmed)
}

export function TipTapMarkdown({
  content,
  resolveMention,
  resolveMentionAvatar,
  selfId,
  className,
  compact = false,
}: {
  content: string
  resolveMention: MentionResolver
  resolveMentionAvatar?: MentionAvatarResolver
  selfId?: string
  className?: string
  compact?: boolean
}) {
  const jumbo = useMemo(() => isJumboEmoji(content), [content])
  const doc = useMemo(
    () => markdownToTipTapDoc(content, resolveMention),
    [content, resolveMention],
  )
  const extensions = useMemo(
    () => createOwlExtensions({ editable: false }),
    [],
  )
  const editorClass = useMemo(
    () =>
      cn(
        TIPTAP_PROSE_CLASS,
        "min-w-0 break-words text-sm",
        compact &&
          "[&_p]:my-0 [&_blockquote]:my-0 [&_pre]:my-0 [&_ul]:my-0",
      ),
    [compact],
  )

  const editor = useEditor({
    extensions,
    content: doc,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: editorClass,
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    editor.storage.mention = {
      resolveLabel: resolveMention,
      resolveAvatar: resolveMentionAvatar,
      selfId,
    }
    editor.commands.setContent(doc)
  }, [editor, doc, resolveMention, resolveMentionAvatar, selfId])

  if (jumbo && !compact) {
    return (
      <p className={cn("text-4xl leading-snug", className)}>{content.trim()}</p>
    )
  }

  if (compact) {
    // 紧凑：单行摘要，去掉块级间距
    return (
      <div
        className={cn(
          "min-w-0 truncate text-sm [&_.tiptap-owl]:inline [&_.tiptap-owl_p]:inline",
          className,
        )}
      >
        <EditorContent editor={editor} />
      </div>
    )
  }

  return (
    <div className={cn("min-w-0", className)}>
      <EditorContent editor={editor} />
    </div>
  )
}
