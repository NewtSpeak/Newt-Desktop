// 消息正文的有限 Markdown 解析（docs 05 FR-14/15）。
//
// 白名单：粗体 ** / 斜体 * / 删除线 ~~ / 行内代码 ` / 代码块 ``` /
// 链接（仅 http/https 可点）/ 引用 > / 无序列表 - * / @提及 <@用户ID>。
// 轻量解析器供 TipTap bridge 与工具函数使用；UI 渲染见 TipTapMarkdown。

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
  /** 自定义小表情 wire：`<e:item_id:mark>`（docs 17） */
  | { kind: "custom_emote"; itemId: string; mark: string }

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
/** 自定义小表情（docs 17）：<e:item_id:mark> */
const CUSTOM_EMOTE_RE = /<e:(\d+):([a-zA-Z0-9_]+)>/
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

  // 自定义小表情 <e:item_id:mark>
  const emoteMatch = CUSTOM_EMOTE_RE.exec(text)
  if (emoteMatch) {
    consider({
      index: emoteMatch.index,
      length: emoteMatch[0].length,
      node: {
        kind: "custom_emote",
        itemId: emoteMatch[1]!,
        mark: emoteMatch[2]!,
      },
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
// 提及 / 展示工具
// ---------------------------------------------------------------------------

/** 消息正文是否提及某用户（整行高亮判断用） */
export function contentMentionsUser(content: string, userId: string): boolean {
  return content.includes(`<@${userId}>`)
}

const EMOJI_ONLY_RE =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F3FB}-\u{1F3FF}\u200D\uFE0F\u20E3]|\s)+$/u

/** ≤27 字符且全为 emoji（含 ZWJ/变体选择符）时放大显示 */
export function isJumboEmoji(content: string): boolean {
  const trimmed = content.trim()
  if (trimmed === "" || trimmed.length > 27) return false
  return EMOJI_ONLY_RE.test(trimmed)
}

export type MentionResolver = (userId: string) => string
/** 提及头像解析（可选） */
export type MentionAvatarResolver = (userId: string) => string | undefined

/** UI 渲染：TipTap 只读组件 */
export {
  TipTapMarkdown as MarkdownContent,
} from "~/components/messages/tiptap-markdown"
