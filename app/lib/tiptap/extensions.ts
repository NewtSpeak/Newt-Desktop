// Composer / 只读渲染共用的 TipTap 扩展集（有限 Markdown 白名单）。

import Link from "@tiptap/extension-link"
import Placeholder from "@tiptap/extension-placeholder"
import StarterKit from "@tiptap/starter-kit"

import { CustomEmoteExtension } from "./custom-emote"
import { MentionExtension } from "./mention"

export function createOwlExtensions(options?: {
  placeholder?: string
  editable?: boolean
}) {
  const editable = options?.editable !== false
  return [
    StarterKit.configure({
      heading: false,
      orderedList: false,
      horizontalRule: false,
      // 链接用独立 extension（http/https 白名单）
      link: false,
      // strike / bold / italic / code / codeBlock / blockquote / bulletList 保留
    }),
    Link.configure({
      openOnClick: !editable,
      autolink: true,
      linkOnPaste: true,
      protocols: ["http", "https"],
      HTMLAttributes: {
        class:
          "text-primary underline underline-offset-2 break-all cursor-pointer",
        rel: "noopener noreferrer",
        target: "_blank",
      },
      validate: (href) => /^https?:\/\//i.test(href),
    }),
    MentionExtension,
    CustomEmoteExtension,
    ...(editable
      ? [
          Placeholder.configure({
            placeholder: options?.placeholder ?? "发消息…",
            emptyEditorClass: "is-editor-empty",
          }),
        ]
      : []),
  ]
}

/** 编辑器 / 渲染共用的 prose 样式 class */
export const TIPTAP_PROSE_CLASS = [
  "tiptap-owl outline-none",
  "[&_p]:my-0 [&_p]:leading-relaxed",
  "[&_blockquote]:my-0.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-muted/60 [&_pre]:px-3 [&_pre]:py-2 [&_pre]:font-mono [&_pre]:text-[13px]",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_ul]:my-0.5 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_li]:leading-relaxed",
  "[&_strong]:font-semibold [&_em]:italic [&_s]:line-through",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:break-all",
].join(" ")
