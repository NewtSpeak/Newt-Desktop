// TipTap 只读 Markdown 渲染：wire 格式 → TipTap doc → 精致 prose 展示。

import { useEffect, useMemo } from "react"
import { useNavigate } from "react-router"
import { EditorContent, useEditor } from "@tiptap/react"

import {
  findChannelById,
  openLinkedChannel,
  resolveChannelLabel,
} from "~/lib/channel-link"
import {
  createOwlExtensions,
  TIPTAP_PROSE_CLASS,
} from "~/lib/tiptap/extensions"
import { markdownToTipTapDoc } from "~/lib/tiptap/markdown-bridge"
import { asSnowflakeId } from "~/lib/snowflake"
import { cn } from "~/lib/utils"
import { useChannelsStore } from "~/stores/channels"
import { useStickersStore } from "~/stores/stickers"

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
  guildId,
  className,
  compact = false,
}: {
  content: string
  resolveMention: MentionResolver
  resolveMentionAvatar?: MentionAvatarResolver
  selfId?: string
  guildId?: string
  className?: string
  compact?: boolean
}) {
  const navigate = useNavigate()
  // 订阅频道表，改名/加载后 chip 标签可刷新
  const channelsByGuild = useChannelsStore((s) => s.byGuild)
  const itemCache = useStickersStore((s) => s.itemCache)
  const openPackPreview = useStickersStore((s) => s.openPackPreview)

  const resolveChannelLabelFn = useMemo(
    () => (id: string) => resolveChannelLabel(id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channelsByGuild],
  )
  const resolveChannelTypeFn = useMemo(
    () => (id: string) => findChannelById(id)?.type,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channelsByGuild],
  )

  const jumbo = useMemo(() => isJumboEmoji(content), [content])
  const doc = useMemo(
    () =>
      markdownToTipTapDoc(content, resolveMention, {
        label: resolveChannelLabelFn,
        channelType: resolveChannelTypeFn,
      }),
    [content, resolveMention, resolveChannelLabelFn, resolveChannelTypeFn],
  )
  const extensions = useMemo(
    () => createOwlExtensions({ editable: false }),
    [],
  )
  const editorClass = useMemo(
    () =>
      cn(
        TIPTAP_PROSE_CLASS,
        // 行内混排：段落保持行内流，小表情 1em 与文字同排
        "min-w-0 break-words text-sm owl-prose-inline-emotes",
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
    editor.storage.channelMention = {
      resolveLabel: resolveChannelLabelFn,
      resolveType: resolveChannelTypeFn,
      onOpen: (channelId: string) => {
        void openLinkedChannel(channelId, {
          navigate: (to) => {
            void navigate(to)
          },
        })
      },
    }
    editor.storage.customEmote = {
      resolveAssetUrl: (itemId: string) => {
        const id = asSnowflakeId(itemId)
        return id ? itemCache[id]?.asset_url : undefined
      },
      onOpen: ({ itemId }) => {
        const id = asSnowflakeId(itemId)
        const packId = id ? itemCache[id]?.pack_id : undefined
        if (id && packId) {
          openPackPreview(packId, { itemId: id, guildId })
        }
      },
    }
    // 解析失败时不静默清空：保留可诊断内容
    try {
      editor.commands.setContent(doc, { emitUpdate: false })
    } catch (err) {
      console.error("[TipTapMarkdown] setContent failed", err, doc)
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: content
              ? [{ type: "text", text: content.slice(0, 2000) }]
              : undefined,
          },
        ],
      })
    }
  }, [
    editor,
    doc,
    content,
    resolveMention,
    resolveMentionAvatar,
    selfId,
    resolveChannelLabelFn,
    resolveChannelTypeFn,
    navigate,
    itemCache,
    openPackPreview,
    guildId,
  ])

  if (jumbo && !compact) {
    return (
      <p className={cn("text-4xl leading-snug", className)}>{content.trim()}</p>
    )
  }

  // 注意：不要对整个 .tiptap-owl 强制 display:inline，否则 GFM 表格会直接「消失」
  if (compact) {
    return (
      <div className={cn("min-w-0 overflow-hidden text-sm", className)}>
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
