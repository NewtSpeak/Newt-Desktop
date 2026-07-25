// Composer / 只读渲染共用的 TipTap 扩展集（有限 Markdown 白名单）。

import Link from "@tiptap/extension-link"
import Placeholder from "@tiptap/extension-placeholder"
import { TaskItem } from "@tiptap/extension-list/task-item"
import { TaskList } from "@tiptap/extension-list/task-list"
import { TableKit } from "@tiptap/extension-table"
import StarterKit from "@tiptap/starter-kit"

import { ChannelMentionExtension } from "./channel-mention"
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
      // 找队友模板等中文代码块：无描边 + 全局 MiSans
      code: {
        HTMLAttributes: {
          class: "rounded bg-muted px-1 py-0.5 font-sans text-[0.85em]",
        },
      },
      codeBlock: {
        HTMLAttributes: {
          class:
            "my-1 overflow-x-auto rounded-md border-0 bg-muted/50 px-3 py-2 font-sans text-[13px] leading-relaxed",
        },
      },
    }),
    // 检查清单 - [ ] / - [x]
    TaskList.configure({
      HTMLAttributes: {
        class: "owl-task-list",
      },
    }),
    TaskItem.configure({
      nested: false,
      HTMLAttributes: {
        class: "owl-task-item",
      },
    }),
    // GFM 表格 | col | col |
    TableKit.configure({
      table: {
        resizable: false,
        renderWrapper: true,
        HTMLAttributes: {
          class: "owl-md-table",
        },
      },
      tableRow: {
        HTMLAttributes: {
          class: "owl-md-tr",
        },
      },
      tableHeader: {
        HTMLAttributes: {
          class: "owl-md-th",
        },
      },
      tableCell: {
        HTMLAttributes: {
          class: "owl-md-td",
        },
      },
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
    ChannelMentionExtension,
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
  "tiptap-owl outline-none font-sans",
  // 段落不额外制造块级空隙；小表情为 1em 行内节点
  "[&_p]:my-0 [&_p]:leading-relaxed",
  "[&_blockquote]:my-0.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  // 代码块：无描边卡片，全文 MiSans（找队友模板等中文内容）
  "[&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border-0 [&_pre]:bg-muted/50 [&_pre]:px-3 [&_pre]:py-2 [&_pre]:font-sans [&_pre]:text-[13px] [&_pre]:leading-relaxed",
  // 行内 `code` 同样 MiSans
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-sans [&_code]:text-[0.85em]",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:font-sans [&_pre_code]:text-[inherit] [&_pre_code]:leading-inherit",
  "[&_ul]:my-0.5 [&_ul]:list-disc [&_ul]:pl-5",
  // 检查清单：去掉默认圆点，由 .owl-task-list 负责布局
  "[&_ul.owl-task-list]:my-1 [&_ul.owl-task-list]:list-none [&_ul.owl-task-list]:pl-0",
  "[&_li]:leading-relaxed",
  "[&_strong]:font-semibold [&_em]:italic [&_s]:line-through",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:break-all",
  // 表格：保持块级，避免被 inline 工具类压扁消失
  "[&_.tableWrapper]:my-2 [&_.tableWrapper]:block [&_.tableWrapper]:max-w-full [&_.tableWrapper]:overflow-x-auto",
  "[&_table]:my-0",
].join(" ")
