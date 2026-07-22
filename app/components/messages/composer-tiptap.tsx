// TipTap 消息输入：有限 Markdown 工具栏 + 提及 chip + wire Markdown 序列化。
// 由 Composer 嵌入，保留附件/发送/冷却等外层逻辑。

import { useCallback, useEffect, useMemo, useState } from "react"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import {
  BoldIcon,
  CodeIcon,
  FileCodeIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  QuoteIcon,
  StrikethroughIcon,
} from "lucide-react"

import {
  createOwlExtensions,
  TIPTAP_PROSE_CLASS,
} from "~/lib/tiptap/extensions"
import {
  isTipTapDocEmpty,
  markdownToTipTapDoc,
  tipTapDocToMarkdown,
} from "~/lib/tiptap/markdown-bridge"
import { cn } from "~/lib/utils"
import { useStickersStore } from "~/stores/stickers"

export type ComposerFormatState = {
  bold: boolean
  italic: boolean
  strike: boolean
  code: boolean
  quote: boolean
  list: boolean
  codeblock: boolean
}

const EMPTY_FORMAT: ComposerFormatState = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  quote: false,
  list: false,
  codeblock: false,
}

function FormatToolbar({
  state,
  onInline,
  onBlock,
  onLink,
}: {
  state: ComposerFormatState
  onInline: (cmd: "bold" | "italic" | "strike" | "code") => void
  onBlock: (cmd: "quote" | "list" | "codeblock") => void
  onLink: () => void
}) {
  const btn =
    "flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground data-[active=true]:bg-primary/15 data-[active=true]:text-primary"

  return (
    <div
      className="flex flex-wrap items-center gap-0.5 border-b border-border/40 px-2 py-1"
      role="toolbar"
      aria-label="Markdown 格式"
      onMouseDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className={btn}
        data-active={state.bold}
        aria-label="粗体"
        title="粗体 (⌘/Ctrl+B)"
        onClick={() => onInline("bold")}
      >
        <BoldIcon className="size-3.5" />
      </button>
      <button
        type="button"
        className={btn}
        data-active={state.italic}
        aria-label="斜体"
        title="斜体 (⌘/Ctrl+I)"
        onClick={() => onInline("italic")}
      >
        <ItalicIcon className="size-3.5" />
      </button>
      <button
        type="button"
        className={btn}
        data-active={state.strike}
        aria-label="删除线"
        title="删除线 (⌘/Ctrl+Shift+S)"
        onClick={() => onInline("strike")}
      >
        <StrikethroughIcon className="size-3.5" />
      </button>
      <button
        type="button"
        className={btn}
        data-active={state.code}
        aria-label="行内代码"
        title="行内代码 (⌘/Ctrl+E)"
        onClick={() => onInline("code")}
      >
        <CodeIcon className="size-3.5" />
      </button>
      <span className="mx-0.5 h-4 w-px bg-border/60" aria-hidden />
      <button
        type="button"
        className={btn}
        data-active={state.codeblock}
        aria-label="代码块"
        title="代码块 (⌘/Ctrl+Shift+C)"
        onClick={() => onBlock("codeblock")}
      >
        <FileCodeIcon className="size-3.5" />
      </button>
      <button
        type="button"
        className={btn}
        data-active={state.quote}
        aria-label="引用"
        title="引用 (⌘/Ctrl+Shift+Q)"
        onClick={() => onBlock("quote")}
      >
        <QuoteIcon className="size-3.5" />
      </button>
      <button
        type="button"
        className={btn}
        data-active={state.list}
        aria-label="无序列表"
        title="无序列表 (⌘/Ctrl+Shift+8)"
        onClick={() => onBlock("list")}
      >
        <ListIcon className="size-3.5" />
      </button>
      <span className="mx-0.5 h-4 w-px bg-border/60" aria-hidden />
      <button
        type="button"
        className={btn}
        aria-label="插入链接"
        title="插入链接 (⌘/Ctrl+Shift+L)"
        onClick={onLink}
      >
        <LinkIcon className="size-3.5" />
      </button>
    </div>
  )
}

export type TipTapComposerHandle = {
  getMarkdown: () => string
  clear: () => void
  focus: () => void
  insertMention: (userId: string, label: string, queryLen: number) => void
  deleteBeforeCaret: (chars: number) => void
  insertEmoji: (emoji: string) => void
  /** 插入自定义小表情节点（docs 17 wire `<e:id:mark>`） */
  insertCustomEmote: (opts: {
    itemId: string
    mark: string
    assetUrl?: string
    animated?: boolean
  }) => void
  isEmpty: () => boolean
  getTextBeforeCaret: () => string
}

function textBeforeCaret(ed: Editor): string {
  const { from } = ed.state.selection
  try {
    return ed.state.doc.textBetween(0, from, "\n", (node) => {
      if (node.type.name === "mention") return `@${node.attrs.label}`
      if (node.type.name === "customEmote") {
        return `<e:${node.attrs.itemId}:${node.attrs.mark}>`
      }
      return ""
    })
  } catch {
    return ""
  }
}

function matchMentionAtEnd(
  text: string,
): { start: number; query: string } | null {
  const match = /(^|[\s([{（【])@([\p{L}\p{N}_-]{0,32})$/u.exec(text)
  if (!match) return null
  const query = match[2] ?? ""
  return { start: text.length - query.length - 1, query }
}

export function TipTapComposerEditor({
  channelId,
  channelName,
  disabled,
  onChange,
  onSubmit,
  onEditLast,
  onEscapeReply,
  onMentionQuery,
  mentionOpen,
  onPasteFiles,
  editorRef,
  resolveMentionLabel,
  leadingActions,
  trailingActions,
}: {
  channelId: string
  channelName: string
  disabled?: boolean
  onChange: (markdown: string) => void
  onSubmit: () => void
  onEditLast: () => void
  onEscapeReply?: () => void
  onMentionQuery: (query: { start: number; query: string } | null) => void
  /** 父级 @ 补全面板是否打开（拦截 Enter 发送 / 方向键） */
  mentionOpen?: boolean
  onPasteFiles?: (files: File[]) => void
  editorRef: React.MutableRefObject<TipTapComposerHandle | null>
  resolveMentionLabel?: (id: string) => string
  /** 工具栏下方、编辑器左侧（如附件按钮） */
  leadingActions?: React.ReactNode
  /** 编辑器右侧（如表情 / 发送） */
  trailingActions?: React.ReactNode
}) {
  const [formatState, setFormatState] =
    useState<ComposerFormatState>(EMPTY_FORMAT)

  const extensions = useMemo(
    () =>
      createOwlExtensions({
        editable: true,
        placeholder: `给 #${channelName} 发消息`,
      }),
    [channelName],
  )

  const refreshFormat = useCallback((ed: Editor) => {
    setFormatState({
      bold: ed.isActive("bold"),
      italic: ed.isActive("italic"),
      strike: ed.isActive("strike"),
      code: ed.isActive("code"),
      quote: ed.isActive("blockquote"),
      list: ed.isActive("bulletList"),
      codeblock: ed.isActive("codeBlock"),
    })
  }, [])

  const refreshMention = useCallback(
    (ed: Editor) => {
      const text = textBeforeCaret(ed)
      onMentionQuery(matchMentionAtEnd(text))
    },
    [onMentionQuery],
  )

  const editor = useEditor({
    extensions,
    content: markdownToTipTapDoc(""),
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn(
          TIPTAP_PROSE_CLASS,
          "max-h-56 min-h-[calc(1.5rem*3+0.75rem)] w-full overflow-y-auto bg-transparent px-1 py-1.5 text-sm leading-6",
          "whitespace-pre-wrap break-words",
          // Placeholder（@tiptap/extension-placeholder）
          "[&_p.is-editor-empty:first-child]:before:pointer-events-none",
          "[&_p.is-editor-empty:first-child]:before:float-left",
          "[&_p.is-editor-empty:first-child]:before:h-0",
          "[&_p.is-editor-empty:first-child]:before:text-muted-foreground",
          "[&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
        ),
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": `给 #${channelName} 发消息`,
      },
      handlePaste: (_view, event) => {
        const files: File[] = []
        const items = event.clipboardData?.items
        if (items) {
          for (const item of items) {
            if (item.kind === "file") {
              const file = item.getAsFile()
              if (file) {
                files.push(
                  file.name
                    ? file
                    : new File([file], "image.png", {
                        type: file.type || "image/png",
                      }),
                )
              }
            }
          }
        }
        if (files.length > 0 && onPasteFiles) {
          event.preventDefault()
          onPasteFiles(files)
          return true
        }
        // 其余交给 TipTap（纯文本 / HTML 会按 schema 清洗）
        return false
      },
    },
    onUpdate: ({ editor: ed }) => {
      const md = tipTapDocToMarkdown(ed.getJSON())
      onChange(md)
      refreshMention(ed)
      refreshFormat(ed)
    },
    onSelectionUpdate: ({ editor: ed }) => {
      refreshFormat(ed)
      refreshMention(ed)
    },
  })

  // 频道切换清空
  useEffect(() => {
    if (!editor) return
    editor.commands.clearContent(true)
    onChange("")
    setFormatState(EMPTY_FORMAT)
    onMentionQuery(null)
  }, [channelId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!disabled)
  }, [editor, disabled])

  useEffect(() => {
    if (!editor) return
    editor.storage.mention = {
      resolveLabel: resolveMentionLabel,
      resolveAvatar: undefined,
      selfId: undefined,
    }
    // 从 stickers store 解析小表情 asset URL（输入框内嵌图）
    editor.storage.customEmote = {
      resolveAssetUrl: (itemId: string) =>
        useStickersStore.getState().itemCache[itemId]?.asset_url,
    }
  }, [editor, resolveMentionLabel])

  // 暴露 handle
  useEffect(() => {
    if (!editor) {
      editorRef.current = null
      return
    }
    editorRef.current = {
      getMarkdown: () => tipTapDocToMarkdown(editor.getJSON()),
      clear: () => {
        editor.commands.clearContent(true)
        onChange("")
      },
      focus: () => {
        editor.commands.focus("end")
      },
      isEmpty: () => isTipTapDocEmpty(editor.getJSON()),
      getTextBeforeCaret: () => textBeforeCaret(editor),
      insertEmoji: (emoji: string) => {
        editor.chain().focus().insertContent(emoji).run()
      },
      insertCustomEmote: (opts) => {
        editor
          .chain()
          .focus()
          .insertContent([
            {
              type: "customEmote",
              attrs: {
                itemId: opts.itemId,
                mark: opts.mark,
                assetUrl: opts.assetUrl ?? "",
                animated: opts.animated ?? false,
              },
            },
          ])
          .run()
      },
      deleteBeforeCaret: (chars: number) => {
        if (chars <= 0) return
        const { from } = editor.state.selection
        const deleteFrom = Math.max(0, from - chars)
        editor
          .chain()
          .focus()
          .deleteRange({ from: deleteFrom, to: from })
          .run()
      },
      insertMention: (userId: string, label: string, queryLen: number) => {
        const { from } = editor.state.selection
        const deleteFrom = Math.max(0, from - Math.max(0, queryLen))
        editor
          .chain()
          .focus()
          .deleteRange({ from: deleteFrom, to: from })
          .insertContent([
            {
              type: "mention",
              attrs: { id: userId, label },
            },
            { type: "text", text: " " },
          ])
          .run()
      },
    }
  }, [editor, editorRef, onChange])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!editor) return
    const mod = event.metaKey || event.ctrlKey

    if (mod && !event.altKey) {
      const key = event.key.toLowerCase()
      if (key === "b" && !event.shiftKey) {
        event.preventDefault()
        editor.chain().focus().toggleBold().run()
        return
      }
      if (key === "i" && !event.shiftKey) {
        event.preventDefault()
        editor.chain().focus().toggleItalic().run()
        return
      }
      if (key === "e" && !event.shiftKey) {
        event.preventDefault()
        editor.chain().focus().toggleCode().run()
        return
      }
      if (key === "s" && event.shiftKey) {
        event.preventDefault()
        editor.chain().focus().toggleStrike().run()
        return
      }
      if (key === "c" && event.shiftKey) {
        event.preventDefault()
        editor.chain().focus().toggleCodeBlock().run()
        return
      }
      if (key === "q" && event.shiftKey) {
        event.preventDefault()
        editor.chain().focus().toggleBlockquote().run()
        return
      }
      if (event.shiftKey && (key === "8" || event.code === "Digit8")) {
        event.preventDefault()
        editor.chain().focus().toggleBulletList().run()
        return
      }
      if (key === "l" && event.shiftKey) {
        event.preventDefault()
        const raw = window.prompt("输入链接地址（http/https）", "https://")
        if (!raw) return
        const href = raw.trim()
        if (!/^https?:\/\//i.test(href)) return
        editor.chain().focus().extendMarkRange("link").setLink({ href }).run()
        return
      }
    }

    // mention 面板打开时：Enter / 方向键 / Esc 由父级 capture 处理
    if (mentionOpen) {
      if (
        event.key === "Enter" ||
        event.key === "Tab" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Escape"
      ) {
        return
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      onSubmit()
      return
    }
    if (event.key === "ArrowUp" && isTipTapDocEmpty(editor.getJSON())) {
      event.preventDefault()
      onEditLast()
      return
    }
    if (event.key === "Escape" && onEscapeReply) {
      event.preventDefault()
      onEscapeReply()
    }
  }

  if (!editor) return null

  return (
    <div className="flex min-w-0 flex-1 flex-col" onKeyDown={handleKeyDown}>
      <FormatToolbar
        state={formatState}
        onInline={(cmd) => {
          const chain = editor.chain().focus()
          if (cmd === "bold") chain.toggleBold().run()
          if (cmd === "italic") chain.toggleItalic().run()
          if (cmd === "strike") chain.toggleStrike().run()
          if (cmd === "code") chain.toggleCode().run()
        }}
        onBlock={(cmd) => {
          const chain = editor.chain().focus()
          if (cmd === "quote") chain.toggleBlockquote().run()
          if (cmd === "list") chain.toggleBulletList().run()
          if (cmd === "codeblock") chain.toggleCodeBlock().run()
        }}
        onLink={() => {
          const raw = window.prompt("输入链接地址（http/https）", "https://")
          if (raw === null) return
          const href = raw.trim()
          if (!href || !/^https?:\/\//i.test(href)) return
          editor.chain().focus().extendMarkRange("link").setLink({ href }).run()
        }}
      />
      <div className="flex min-w-0 items-end gap-1 px-2 py-1.5">
        {leadingActions}
        <EditorContent
          editor={editor}
          className="min-w-0 min-h-[calc(1.5rem*3+0.75rem)] flex-1"
        />
        {trailingActions}
      </div>
    </div>
  )
}
