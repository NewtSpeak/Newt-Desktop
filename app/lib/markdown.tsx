// 消息正文的有限 Markdown 解析（docs 05 FR-14/15）。
//
// 白名单：粗体 ** / 斜体 * / 删除线 ~~ / 行内代码 ` / 代码块 ``` /
// 链接（仅 http/https 可点）/ 引用 > / 无序列表 - * /
// 检查清单 - [ ] / - [x] / GFM 表格 | ... | /
// @提及 <@用户ID> / 频道提及 <#频道ID>。
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
  /** 频道提及 wire：`<#频道ID>` */
  | { kind: "channel_mention"; channelId: string }
  /** 自定义小表情 wire：`<e:item_id:mark>`（docs 17） */
  | { kind: "custom_emote"; itemId: string; mark: string }

type TaskListItem = {
  checked: boolean
  children: InlineNode[]
}

/** GFM 表格列对齐 */
export type TableAlign = "left" | "center" | "right" | null

type TableBlock = {
  kind: "table"
  /** 每列对齐；长度 = 列数 */
  aligns: TableAlign[]
  /** 表头单元格（行内节点） */
  header: InlineNode[][]
  /** 数据行 */
  rows: InlineNode[][][]
}

type BlockNode =
  | { kind: "paragraph"; children: InlineNode[] }
  | { kind: "codeblock"; lang: string; code: string }
  | { kind: "quote"; lines: InlineNode[][] }
  | { kind: "list"; items: InlineNode[][] }
  | { kind: "tasklist"; items: TaskListItem[] }
  | TableBlock

/** `- [ ] text` / `- [x] text` / `* [X] text` */
const TASK_LIST_ITEM_RE = /^[-*]\s+\[([ xX])\](?:\s+(.*))?$/

/** 粗略判断是否像表格行（至少一列竖线） */
function looksLikeTableRow(line: string): boolean {
  const t = line.trim()
  if (!t.includes("|")) return false
  // 避免把单独的 `|` 或代码/普通句中偶发竖线当成表
  return /^\|?.+\|.+\|?$/.test(t) || /^\|(.+\|)+$/.test(t)
}

/** 拆分表格行单元格；支持单元格内 `\|` 转义 */
function splitTableCells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith("|")) s = s.slice(1)
  if (s.endsWith("|")) s = s.slice(0, -1)

  const cells: string[] = []
  let cur = ""
  let escaped = false
  for (const ch of s) {
    if (escaped) {
      cur += ch
      escaped = false
      continue
    }
    if (ch === "\\") {
      escaped = true
      continue
    }
    if (ch === "|") {
      cells.push(cur.trim())
      cur = ""
      continue
    }
    cur += ch
  }
  if (escaped) cur += "\\"
  cells.push(cur.trim())
  return cells
}

/** `| --- | :---: | ---: |` → 对齐数组；非法则 null */
function parseTableAlignRow(line: string): TableAlign[] | null {
  if (!looksLikeTableRow(line)) return null
  const cells = splitTableCells(line)
  if (cells.length === 0) return null
  const aligns: TableAlign[] = []
  for (const raw of cells) {
    const c = raw.replace(/\s/g, "")
    if (!c || !/^:?-+:?$/.test(c)) return null
    const left = c.startsWith(":")
    const right = c.endsWith(":")
    if (left && right) aligns.push("center")
    else if (right) aligns.push("right")
    else if (left) aligns.push("left")
    else aligns.push(null)
  }
  return aligns
}

// ---------------------------------------------------------------------------
// 行内解析
// ---------------------------------------------------------------------------

/** 提及占位（wire format）：<@用户ID>；服务端用户 ID 为 UUID */
const MENTION_RE = /<@([0-9a-zA-Z-]{1,36})>/
/** 频道提及（wire）：<#频道ID> */
const CHANNEL_MENTION_RE = /<#([0-9a-zA-Z-]{1,36})>/
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

  // # 频道提及 <#channelId>
  const channelMentionMatch = CHANNEL_MENTION_RE.exec(text)
  if (channelMentionMatch) {
    consider({
      index: channelMentionMatch.index,
      length: channelMentionMatch[0].length,
      node: { kind: "channel_mention", channelId: channelMentionMatch[1]! },
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

    // GFM 表格：表头 + 分隔行 |---| + 数据行
    if (
      looksLikeTableRow(line) &&
      index + 1 < lines.length &&
      parseTableAlignRow(lines[index + 1])
    ) {
      const headerCells = splitTableCells(line)
      const alignsRaw = parseTableAlignRow(lines[index + 1])!
      const colCount = Math.max(headerCells.length, alignsRaw.length)
      const aligns: TableAlign[] = Array.from({ length: colCount }, (_, i) =>
        i < alignsRaw.length ? alignsRaw[i]! : null,
      )
      const padRow = (cells: string[]): InlineNode[][] =>
        Array.from({ length: colCount }, (_, i) =>
          parseInline(i < cells.length ? cells[i]! : ""),
        )

      const header = padRow(headerCells)
      const rows: InlineNode[][][] = []
      let cursor = index + 2
      while (cursor < lines.length && looksLikeTableRow(lines[cursor])) {
        // 下一行若是新表的分隔行则停止（极少见）
        if (parseTableAlignRow(lines[cursor])) break
        rows.push(padRow(splitTableCells(lines[cursor]!)))
        cursor++
      }
      blocks.push({ kind: "table", aligns, header, rows })
      index = cursor
      continue
    }

    // 检查清单 - [ ] / - [x]（必须先于普通无序列表，避免 [x] 被当纯文本）
    if (TASK_LIST_ITEM_RE.test(line)) {
      const items: TaskListItem[] = []
      while (index < lines.length) {
        const taskMatch = TASK_LIST_ITEM_RE.exec(lines[index])
        if (!taskMatch) break
        items.push({
          checked: taskMatch[1]!.toLowerCase() === "x",
          children: parseInline(taskMatch[2] ?? ""),
        })
        index++
      }
      blocks.push({ kind: "tasklist", items })
      continue
    }

    // 无序列表 - / *
    if (/^[-*]\s+/.test(line)) {
      const items: InlineNode[][] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        // 若中途出现检查清单项，结束当前普通列表，留给下一轮 tasklist
        if (TASK_LIST_ITEM_RE.test(lines[index])) break
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
