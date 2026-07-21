// 消息正文的有限 Markdown 渲染（docs 05 FR-14/15）。
//
// 白名单：粗体 ** / 斜体 * / 删除线 ~~ / 行内代码 ` / 代码块 ``` /
// 链接（仅 http/https 可点）/ 引用 > / 无序列表 - * / @提及 <@用户ID>。
// 自己实现的轻量解析器：输出 React 节点（React 自动转义，天然不渲染内联 HTML），
// 未识别语法一律按纯文本展示；javascript: 等协议链接不生成 <a>。

import { useMemo, useState, type ReactNode } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { cn } from "~/lib/utils"

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; children: InlineNode[] }
  | { kind: "italic"; children: InlineNode[] }
  | { kind: "strike"; children: InlineNode[] }
  | { kind: "link"; href: string; label: string }
  | { kind: "mention"; userId: string }

type BlockNode =
  | { kind: "paragraph"; children: InlineNode[] }
  | { kind: "codeblock"; lang: string; code: string }
  | { kind: "quote"; lines: InlineNode[][] }
  | { kind: "list"; items: InlineNode[][] }

// ---------------------------------------------------------------------------
// 行内解析
// ---------------------------------------------------------------------------

/** 提及占位（wire format）：<@用户ID>；服务端用户 ID 为 UUID */
const MENTION_RE = /<@([0-9a-zA-Z-]{1,36})>/
const BARE_URL_RE = /https?:\/\/[^\s<>]+/
const MD_LINK_RE = /\[([^\[\]\n]{1,200})\]\(([^()\s]+)\)/

function safeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol === "http:" || url.protocol === "https:") return url.href
  } catch {
    // 非法 URL 按纯文本
  }
  return null
}

type InlineMatch = {
  index: number
  length: number
  node: InlineNode | null
  /** 需要递归解析内部的定界符匹配 */
  inner?: { text: string; kind: "bold" | "italic" | "strike" }
}

/** 找 text 中最早出现的一个行内语法匹配 */
function findEarliest(text: string): InlineMatch | null {
  let best: InlineMatch | null = null
  const consider = (match: InlineMatch | null) => {
    if (match && (best === null || match.index < best.index)) best = match
  }

  // 行内代码：`code`（内部不再解析任何语法）
  const codeStart = text.indexOf("`")
  if (codeStart !== -1) {
    const codeEnd = text.indexOf("`", codeStart + 1)
    if (codeEnd > codeStart + 1) {
      consider({
        index: codeStart,
        length: codeEnd - codeStart + 1,
        node: { kind: "code", text: text.slice(codeStart + 1, codeEnd) },
      })
    }
  }

  // 粗体 **x**（先于斜体判断避免歧义）
  const boldMatch = /\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*/.exec(text)
  if (boldMatch) {
    consider({
      index: boldMatch.index,
      length: boldMatch[0].length,
      node: null,
      inner: { text: boldMatch[1], kind: "bold" },
    })
  }

  // 斜体 *x*（排除 **）
  const italicMatch = /(?<!\*)\*(?!\*|\s)([^*\n]+?)(?<!\s)\*(?!\*)/.exec(text)
  if (italicMatch) {
    consider({
      index: italicMatch.index,
      length: italicMatch[0].length,
      node: null,
      inner: { text: italicMatch[1], kind: "italic" },
    })
  }

  // 删除线 ~~x~~
  const strikeMatch = /~~(?!\s)([\s\S]+?)(?<!\s)~~/.exec(text)
  if (strikeMatch) {
    consider({
      index: strikeMatch.index,
      length: strikeMatch[0].length,
      node: null,
      inner: { text: strikeMatch[1], kind: "strike" },
    })
  }

  // @提及
  const mentionMatch = MENTION_RE.exec(text)
  if (mentionMatch) {
    consider({
      index: mentionMatch.index,
      length: mentionMatch[0].length,
      node: { kind: "mention", userId: mentionMatch[1] },
    })
  }

  // [label](url)：协议不合法时整体按纯文本
  const linkMatch = MD_LINK_RE.exec(text)
  if (linkMatch) {
    const href = safeHttpUrl(linkMatch[2])
    consider({
      index: linkMatch.index,
      length: linkMatch[0].length,
      node: href
        ? { kind: "link", href, label: linkMatch[1] }
        : { kind: "text", text: linkMatch[0] },
    })
  }

  // 裸 URL 自动识别
  const urlMatch = BARE_URL_RE.exec(text)
  if (urlMatch) {
    // 去掉常见的句尾标点
    const trimmed = urlMatch[0].replace(/[.,;:!?)\]}>'"]+$/, "")
    const href = safeHttpUrl(trimmed)
    if (href) {
      consider({
        index: urlMatch.index,
        length: trimmed.length,
        node: { kind: "link", href, label: trimmed },
      })
    }
  }

  return best
}

function parseInline(text: string, depth = 0): InlineNode[] {
  if (depth > 6 || text === "") {
    return text ? [{ kind: "text", text }] : []
  }
  const nodes: InlineNode[] = []
  let rest = text
  while (rest.length > 0) {
    const match = findEarliest(rest)
    if (!match) {
      nodes.push({ kind: "text", text: rest })
      break
    }
    if (match.index > 0) {
      nodes.push({ kind: "text", text: rest.slice(0, match.index) })
    }
    if (match.inner) {
      nodes.push({
        kind: match.inner.kind,
        children: parseInline(match.inner.text, depth + 1),
      })
    } else if (match.node) {
      nodes.push(match.node)
    }
    rest = rest.slice(match.index + match.length)
  }
  return nodes
}

// ---------------------------------------------------------------------------
// 块级解析
// ---------------------------------------------------------------------------

export function parseMarkdown(content: string): BlockNode[] {
  const blocks: BlockNode[] = []
  const lines = content.split("\n")
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    // 代码块 ```lang ... ```
    const fence = /^```(\S*)\s*$/.exec(line)
    if (fence) {
      const codeLines: string[] = []
      let cursor = index + 1
      let closed = false
      while (cursor < lines.length) {
        if (/^```\s*$/.test(lines[cursor])) {
          closed = true
          break
        }
        codeLines.push(lines[cursor])
        cursor++
      }
      if (closed) {
        blocks.push({ kind: "codeblock", lang: fence[1], code: codeLines.join("\n") })
        index = cursor + 1
        continue
      }
      // 未闭合：按纯文本段落处理
    }

    // 引用 >
    if (/^>\s?/.test(line)) {
      const quoteLines: InlineNode[][] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(parseInline(lines[index].replace(/^>\s?/, "")))
        index++
      }
      blocks.push({ kind: "quote", lines: quoteLines })
      continue
    }

    // 无序列表 - / *
    if (/^[-*]\s+/.test(line)) {
      const items: InlineNode[][] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(parseInline(lines[index].replace(/^[-*]\s+/, "")))
        index++
      }
      blocks.push({ kind: "list", items })
      continue
    }

    // 普通段落（逐行一个 paragraph，保持换行语义）
    blocks.push({ kind: "paragraph", children: parseInline(line) })
    index++
  }

  return blocks
}

// ---------------------------------------------------------------------------
// 提及工具
// ---------------------------------------------------------------------------

/** 消息正文是否提及某用户（整行高亮判断用） */
export function contentMentionsUser(content: string, userId: string): boolean {
  return content.includes(`<@${userId}>`)
}

// ---------------------------------------------------------------------------
// 纯 emoji 短消息判定（jumbo emoji）
// ---------------------------------------------------------------------------

const EMOJI_ONLY_RE =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F3FB}-\u{1F3FF}\u200D\uFE0F\u20E3]|\s)+$/u

/** ≤27 字符且全为 emoji（含 ZWJ/变体选择符）时放大显示 */
export function isJumboEmoji(content: string): boolean {
  const trimmed = content.trim()
  if (trimmed === "" || trimmed.length > 27) return false
  return EMOJI_ONLY_RE.test(trimmed)
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

const CODE_COLLAPSE_LINES = 20

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const lineCount = code === "" ? 0 : code.split("\n").length
  const collapsible = lineCount > CODE_COLLAPSE_LINES
  const shown =
    collapsible && !expanded
      ? code.split("\n").slice(0, CODE_COLLAPSE_LINES).join("\n")
      : code

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="group/code relative my-1 max-w-full">
      <pre className="overflow-x-auto rounded-lg border bg-muted/60 px-3 py-2 text-[13px] leading-relaxed">
        <code>{shown}</code>
      </pre>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-0.5 text-xs text-primary hover:underline"
        >
          {expanded ? "收起" : `展开（共 ${lineCount} 行）`}
        </button>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label="复制代码"
        className="absolute top-1.5 right-1.5 hidden rounded-md border bg-background/90 p-1 text-muted-foreground group-hover/code:block hover:text-foreground"
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </button>
      {lang && (
        <span className="absolute right-9 top-2 hidden text-[10px] text-muted-foreground select-none group-hover/code:block">
          {lang}
        </span>
      )}
    </div>
  )
}

export type MentionResolver = (userId: string) => string
/** 提及头像解析（可选） */
export type MentionAvatarResolver = (userId: string) => string | undefined

type InlineRenderOpts = {
  resolveMention: MentionResolver
  resolveMentionAvatar?: MentionAvatarResolver
  selfId?: string
  /** 回复摘要等场景：@卡片略缩小以贴合单行高度 */
  compact?: boolean
}

function renderInline(
  nodes: InlineNode[],
  opts: InlineRenderOpts,
  keyPrefix: string,
): ReactNode[] {
  const { resolveMention, resolveMentionAvatar, selfId, compact } = opts
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`
    switch (node.kind) {
      case "text":
        return <span key={key}>{node.text}</span>
      case "code":
        return (
          <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {node.text}
          </code>
        )
      case "bold":
        return (
          <strong key={key} className="font-semibold">
            {renderInline(node.children, opts, key)}
          </strong>
        )
      case "italic":
        return <em key={key}>{renderInline(node.children, opts, key)}</em>
      case "strike":
        return <s key={key}>{renderInline(node.children, opts, key)}</s>
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-2 hover:underline break-all"
          >
            {node.label}
          </a>
        )
      case "mention": {
        const name = resolveMention(node.userId)
        const avatarUrl = resolveMentionAvatar?.(node.userId)
        const isSelf = selfId !== undefined && node.userId === selfId
        const avatarSize = compact ? "size-3.5" : "size-4"
        return (
          <span
            key={key}
            className={cn(
              "mx-0.5 inline-flex items-center gap-1 rounded-md font-medium align-middle",
              compact
                ? "py-px pr-1 pl-0.5 text-[0.9em]"
                : "py-0.5 pr-1.5 pl-0.5 text-[0.95em]",
              isSelf
                ? "bg-amber-500/30 text-amber-700 dark:text-amber-300"
                : "bg-primary/15 text-primary",
            )}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className={cn(avatarSize, "shrink-0 rounded-full object-cover")}
                draggable={false}
              />
            ) : (
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
                  avatarSize,
                  isSelf ? "bg-amber-600/40 text-amber-50" : "bg-primary/30 text-primary-foreground",
                )}
                aria-hidden
              >
                {(name || "?").slice(0, 1).toUpperCase()}
              </span>
            )}
            <span>@{name}</span>
          </span>
        )
      }
    }
  })
}

export function MarkdownContent({
  content,
  resolveMention,
  resolveMentionAvatar,
  selfId,
  className,
  /**
   * 紧凑模式：用于回复引用摘要等单行场景。
   * 块级结构压成行内，@提及仍渲染为与正文一致的头像卡片样式。
   */
  compact = false,
}: {
  content: string
  /** 用户 ID → 显示名（members store 查不到时返回原 ID 片段） */
  resolveMention: MentionResolver
  /** 用户 ID → 头像 URL（@ 提及左侧） */
  resolveMentionAvatar?: MentionAvatarResolver
  selfId?: string
  className?: string
  compact?: boolean
}) {
  const blocks = useMemo(() => parseMarkdown(content), [content])
  const jumbo = useMemo(() => isJumboEmoji(content), [content])
  const inlineOpts: InlineRenderOpts = {
    resolveMention,
    resolveMentionAvatar,
    selfId,
    compact,
  }

  if (jumbo && !compact) {
    return <p className={cn("text-4xl leading-snug", className)}>{content.trim()}</p>
  }

  // 回复摘要：全部块压成同一行内流，保留 @ 卡片 / 粗斜体等行内样式。
  if (compact) {
    const parts: ReactNode[] = []
    blocks.forEach((block, index) => {
      if (index > 0) {
        parts.push(
          <span key={`sp-${index}`} className="text-muted-foreground/60">
            {" "}
          </span>,
        )
      }
      switch (block.kind) {
        case "paragraph":
          if (block.children.length > 0) {
            parts.push(
              <span key={`p${index}`}>
                {renderInline(block.children, inlineOpts, `cp${index}`)}
              </span>,
            )
          }
          break
        case "codeblock":
          parts.push(
            <code
              key={`c${index}`}
              className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
            >
              [代码]
            </code>,
          )
          break
        case "quote":
          block.lines.forEach((line, lineIndex) => {
            if (lineIndex > 0) parts.push(" ")
            parts.push(
              <span key={`q${index}-${lineIndex}`} className="text-muted-foreground">
                {renderInline(line, inlineOpts, `cq${index}-${lineIndex}`)}
              </span>,
            )
          })
          break
        case "list":
          block.items.forEach((item, itemIndex) => {
            if (itemIndex > 0) parts.push(" ")
            parts.push(
              <span key={`l${index}-${itemIndex}`}>
                · {renderInline(item, inlineOpts, `cl${index}-${itemIndex}`)}
              </span>,
            )
          })
          break
      }
    })
    return (
      <span
        className={cn(
          "min-w-0 truncate align-middle [&_.inline-flex]:align-middle",
          className,
        )}
      >
        {parts.length > 0 ? parts : null}
      </span>
    )
  }

  return (
    <div className={cn("min-w-0 break-words whitespace-pre-wrap", className)}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "paragraph":
            return block.children.length === 0 ? (
              // 空行保持段落间距
              <div key={index} className="h-[0.75em]" aria-hidden />
            ) : (
              <p key={index} className="leading-relaxed">
                {renderInline(block.children, inlineOpts, `p${index}`)}
              </p>
            )
          case "codeblock":
            return <CodeBlock key={index} lang={block.lang} code={block.code} />
          case "quote":
            return (
              <blockquote
                key={index}
                className="my-0.5 border-l-2 border-border pl-3 text-muted-foreground"
              >
                {block.lines.map((line, lineIndex) => (
                  <p key={lineIndex} className="leading-relaxed">
                    {renderInline(line, inlineOpts, `q${index}-${lineIndex}`)}
                  </p>
                ))}
              </blockquote>
            )
          case "list":
            return (
              <ul key={index} className="my-0.5 list-disc pl-5">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="leading-relaxed">
                    {renderInline(item, inlineOpts, `l${index}-${itemIndex}`)}
                  </li>
                ))}
              </ul>
            )
        }
      })}
    </div>
  )
}
