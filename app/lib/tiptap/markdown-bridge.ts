// Wire Markdown（docs 05 白名单）↔ TipTap JSON 互转。
// 解析复用 app/lib/markdown.tsx 的有限白名单，保证与发送协议一致。

import type { JSONContent } from "@tiptap/core"

import { parseMarkdown } from "~/lib/markdown"
import { asSnowflakeId } from "~/lib/snowflake"

type InlineNode = ReturnType<typeof parseMarkdown>[number] extends infer B
  ? B extends { children: infer C }
    ? C extends (infer I)[]
      ? I
      : never
    : B extends { lines: (infer L)[][] }
      ? L
      : B extends { items: (infer L)[][] }
        ? L
        : never
  : never

// 简化：直接从 markdown.tsx 导入内部不够，用 any 结构匹配 parse 输出
type AnyInline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; children: AnyInline[] }
  | { kind: "italic"; children: AnyInline[] }
  | { kind: "strike"; children: AnyInline[] }
  | { kind: "link"; href: string; label: string }
  | { kind: "mention"; userId: string }
  | { kind: "channel_mention"; channelId: string }
  | { kind: "custom_emote"; itemId: string; mark: string }

type AnyBlock =
  | { kind: "paragraph"; children: AnyInline[] }
  | { kind: "codeblock"; lang: string; code: string }
  | { kind: "quote"; lines: AnyInline[][] }
  | { kind: "list"; items: AnyInline[][] }
  | {
      kind: "tasklist"
      items: Array<{ checked: boolean; children: AnyInline[] }>
    }
  | {
      kind: "table"
      aligns: Array<"left" | "center" | "right" | null>
      header: AnyInline[][]
      rows: AnyInline[][][]
    }

function inlineToTipTap(
  nodes: AnyInline[],
  marks: Array<{ type: string; attrs?: Record<string, unknown> }> = [],
): JSONContent[] {
  const out: JSONContent[] = []
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        if (node.text) {
          out.push({
            type: "text",
            text: node.text,
            ...(marks.length ? { marks: [...marks] } : {}),
          })
        }
        break
      case "code":
        out.push({
          type: "text",
          text: node.text,
          marks: [...marks, { type: "code" }],
        })
        break
      case "bold":
        out.push(
          ...inlineToTipTap(node.children, [...marks, { type: "bold" }]),
        )
        break
      case "italic":
        out.push(
          ...inlineToTipTap(node.children, [...marks, { type: "italic" }]),
        )
        break
      case "strike":
        out.push(
          ...inlineToTipTap(node.children, [...marks, { type: "strike" }]),
        )
        break
      case "link":
        out.push({
          type: "text",
          text: node.label || node.href,
          marks: [
            ...marks,
            { type: "link", attrs: { href: node.href, target: "_blank" } },
          ],
        })
        break
      case "mention":
        out.push({
          type: "mention",
          attrs: {
            id: node.userId,
            label: node.userId.slice(0, 6),
          },
        })
        break
      case "channel_mention":
        out.push({
          type: "channelMention",
          attrs: {
            id: node.channelId,
            label: node.channelId.slice(0, 6),
            channelType: "TEXT",
          },
        })
        break
      case "custom_emote":
        out.push({
          type: "customEmote",
          attrs: {
            itemId: asSnowflakeId(node.itemId),
            mark: node.mark,
            assetUrl: "",
            animated: false,
          },
        })
        break
    }
  }
  return out
}

export type ChannelMentionResolve = {
  label?: (channelId: string) => string
  channelType?: (channelId: string) => string | undefined
}

/** wire Markdown → TipTap doc JSON */
export function markdownToTipTapDoc(
  content: string,
  resolveMentionLabel?: (userId: string) => string,
  resolveChannel?: ChannelMentionResolve,
): JSONContent {
  const blocks = parseMarkdown(content) as AnyBlock[]
  const contentNodes: JSONContent[] = []

  const mapInline = (nodes: AnyInline[]) => {
    const result = inlineToTipTap(nodes)
    if (resolveMentionLabel) {
      for (const item of result) {
        if (item.type === "mention" && item.attrs?.id) {
          item.attrs.label =
            resolveMentionLabel(String(item.attrs.id)) ||
            String(item.attrs.id).slice(0, 6)
        }
      }
    }
    if (resolveChannel) {
      for (const item of result) {
        if (item.type === "channelMention" && item.attrs?.id) {
          const id = String(item.attrs.id)
          item.attrs.label =
            resolveChannel.label?.(id) || id.slice(0, 6)
          const t = resolveChannel.channelType?.(id)
          if (t === "TEXT" || t === "VOICE" || t === "CATEGORY") {
            item.attrs.channelType = t
          }
        }
      }
    }
    return result
  }

  for (const block of blocks) {
    switch (block.kind) {
      case "paragraph": {
        const children = mapInline(block.children)
        contentNodes.push({
          type: "paragraph",
          content: children.length ? children : undefined,
        })
        break
      }
      case "codeblock":
        contentNodes.push({
          type: "codeBlock",
          attrs: { language: block.lang || null },
          content: block.code
            ? [{ type: "text", text: block.code }]
            : undefined,
        })
        break
      case "quote": {
        // 多行引用 → 多个 paragraph 放在 blockquote
        const quoteContent: JSONContent[] = block.lines.map((line) => ({
          type: "paragraph",
          content: mapInline(line).length ? mapInline(line) : undefined,
        }))
        contentNodes.push({
          type: "blockquote",
          content: quoteContent.length
            ? quoteContent
            : [{ type: "paragraph" }],
        })
        break
      }
      case "list":
        contentNodes.push({
          type: "bulletList",
          content: block.items.map((item) => ({
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: mapInline(item).length
                  ? mapInline(item)
                  : undefined,
              },
            ],
          })),
        })
        break
      case "tasklist":
        contentNodes.push({
          type: "taskList",
          content: block.items.map((item) => {
            const children = mapInline(item.children)
            return {
              type: "taskItem",
              attrs: { checked: item.checked },
              content: [
                {
                  type: "paragraph",
                  content: children.length ? children : undefined,
                },
              ],
            }
          }),
        })
        break
      case "table": {
        const cellParagraph = (inlines: AnyInline[]): JSONContent => {
          const children = mapInline(inlines)
          return {
            type: "paragraph",
            content: children.length ? children : undefined,
          }
        }
        const makeCell = (
          type: "tableHeader" | "tableCell",
          inlines: AnyInline[],
          _align: "left" | "center" | "right" | null,
        ): JSONContent => ({
          type,
          // 仅 schema 已声明字段，避免未知 attrs 导致整表 setContent 失败
          attrs: {
            colspan: 1,
            rowspan: 1,
            colwidth: null,
          },
          content: [cellParagraph(inlines)],
        })

        const headerRow: JSONContent = {
          type: "tableRow",
          content: block.header.map((cell, i) =>
            makeCell("tableHeader", cell, block.aligns[i] ?? null),
          ),
        }
        const bodyRows: JSONContent[] = block.rows.map((row) => ({
          type: "tableRow",
          content: row.map((cell, i) =>
            makeCell("tableCell", cell, block.aligns[i] ?? null),
          ),
        }))
        contentNodes.push({
          type: "table",
          content: [headerRow, ...bodyRows],
        })
        break
      }
    }
  }

  if (contentNodes.length === 0) {
    contentNodes.push({ type: "paragraph" })
  }

  return { type: "doc", content: contentNodes }
}

// ---------------------------------------------------------------------------
// TipTap JSON → wire Markdown
// ---------------------------------------------------------------------------

function escapeLinkLabel(text: string): string {
  return text.replace(/[\[\]]/g, "\\$&")
}

function escapeTableCellText(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ")
}

function cellInnerMarkdown(cell: JSONContent | undefined): string {
  if (!cell?.content?.length) return ""
  const parts: string[] = []
  for (const child of cell.content) {
    if (child.type === "paragraph") {
      parts.push(serializeInline(child.content))
    } else {
      parts.push(serializeBlock(child))
    }
  }
  return escapeTableCellText(parts.join(" ").trim())
}

function alignMarker(align: unknown, minDashes = 3): string {
  const dashes = "-".repeat(Math.max(3, minDashes))
  if (align === "center") return `:${dashes}:`
  if (align === "right") return `${dashes}:`
  if (align === "left") return `:${dashes}`
  return dashes
}

function serializeTable(node: JSONContent): string {
  const rows = (node.content ?? []).filter((r) => r.type === "tableRow")
  if (rows.length === 0) return ""

  const matrix: string[][] = []
  const aligns: Array<string | null> = []

  for (const row of rows) {
    const cells = (row.content ?? []).filter(
      (c) => c.type === "tableHeader" || c.type === "tableCell",
    )
    const texts = cells.map((c) => cellInnerMarkdown(c))
    matrix.push(texts)
    if (aligns.length === 0) {
      for (const c of cells) {
        const a = c.attrs?.align
        aligns.push(
          a === "left" || a === "center" || a === "right" ? a : null,
        )
      }
    }
  }

  const colCount = Math.max(
    aligns.length,
    ...matrix.map((r) => r.length),
    1,
  )
  while (aligns.length < colCount) aligns.push(null)
  for (const row of matrix) {
    while (row.length < colCount) row.push("")
  }

  const fmt = (cells: string[]) =>
    `| ${cells.map((c) => (c === "" ? " " : c)).join(" | ")} |`

  const sep = fmt(
    aligns.map((a, i) => {
      const sample = matrix[0]?.[i] ?? ""
      return alignMarker(a, Math.max(3, Math.min(12, sample.length || 3)))
    }),
  )

  const lines = [fmt(matrix[0] ?? Array(colCount).fill("")), sep]
  for (let i = 1; i < matrix.length; i++) {
    lines.push(fmt(matrix[i]!))
  }
  return lines.join("\n")
}

function serializeInline(nodes: JSONContent[] | undefined): string {
  if (!nodes?.length) return ""
  let out = ""
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      out += "\n"
      continue
    }
    if (node.type === "mention") {
      const id = String(node.attrs?.id ?? "")
      if (id) out += `<@${id}>`
      continue
    }
    if (node.type === "channelMention") {
      const id = String(node.attrs?.id ?? "")
      if (id) out += `<#${id}>`
      continue
    }
    if (node.type === "customEmote") {
      const itemId = asSnowflakeId(node.attrs?.itemId)
      const mark = String(node.attrs?.mark ?? "")
      if (itemId && mark) out += `<e:${itemId}:${mark}>`
      continue
    }
    if (node.type === "text") {
      let text = node.text ?? ""
      const marks = node.marks ?? []
      // 由内到外：code 最内，再 bold/italic/strike，link 包最外
      const has = (t: string) => marks.some((m) => m.type === t)
      if (has("code")) text = `\`${text}\``
      if (has("bold")) text = `**${text}**`
      if (has("italic")) text = `*${text}*`
      if (has("strike")) text = `~~${text}~~`
      const link = marks.find((m) => m.type === "link")
      if (link?.attrs?.href) {
        const href = String(link.attrs.href)
        text = `[${escapeLinkLabel(text)}](${href})`
      }
      out += text
      continue
    }
    // 嵌套 inline 容器（少见）
    if (node.content) out += serializeInline(node.content)
  }
  return out
}

function serializeBlock(node: JSONContent): string {
  switch (node.type) {
    case "paragraph":
      return serializeInline(node.content)
    case "codeBlock": {
      const lang = node.attrs?.language ? String(node.attrs.language) : ""
      const code = (node.content ?? [])
        .map((c) => c.text ?? "")
        .join("")
      return `\`\`\`${lang}\n${code}\n\`\`\``
    }
    case "blockquote": {
      const lines: string[] = []
      for (const child of node.content ?? []) {
        if (child.type === "paragraph") {
          lines.push(`> ${serializeInline(child.content)}`)
        } else {
          const inner = serializeBlock(child)
          for (const line of inner.split("\n")) {
            lines.push(`> ${line}`)
          }
        }
      }
      return lines.join("\n")
    }
    case "bulletList": {
      const items: string[] = []
      for (const li of node.content ?? []) {
        if (li.type !== "listItem") continue
        // listItem 通常含 paragraph
        const parts: string[] = []
        for (const child of li.content ?? []) {
          if (child.type === "paragraph") {
            parts.push(serializeInline(child.content))
          } else {
            parts.push(serializeBlock(child))
          }
        }
        items.push(`- ${parts.join("\n")}`)
      }
      return items.join("\n")
    }
    case "taskList": {
      const items: string[] = []
      for (const li of node.content ?? []) {
        if (li.type !== "taskItem") continue
        const checked = Boolean(li.attrs?.checked)
        const mark = checked ? "x" : " "
        const parts: string[] = []
        for (const child of li.content ?? []) {
          if (child.type === "paragraph") {
            parts.push(serializeInline(child.content))
          } else {
            parts.push(serializeBlock(child))
          }
        }
        const body = parts.join("\n").trimEnd()
        items.push(body ? `- [${mark}] ${body}` : `- [${mark}]`)
      }
      return items.join("\n")
    }
    case "orderedList": {
      const items: string[] = []
      let i = 1
      for (const li of node.content ?? []) {
        if (li.type !== "listItem") continue
        const parts: string[] = []
        for (const child of li.content ?? []) {
          if (child.type === "paragraph") {
            parts.push(serializeInline(child.content))
          } else {
            parts.push(serializeBlock(child))
          }
        }
        items.push(`${i}. ${parts.join("\n")}`)
        i++
      }
      return items.join("\n")
    }
    case "table":
      return serializeTable(node)
    case "hardBreak":
      return "\n"
    default:
      if (node.content) {
        return (node.content as JSONContent[])
          .map(serializeBlock)
          .join("\n")
      }
      return ""
  }
}

/** TipTap doc → wire Markdown */
export function tipTapDocToMarkdown(doc: JSONContent | undefined | null): string {
  if (!doc?.content?.length) return ""
  return doc.content
    .map(serializeBlock)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[\u200B\uFEFF]/g, "")
}

export function isTipTapDocEmpty(doc: JSONContent | undefined | null): boolean {
  return tipTapDocToMarkdown(doc).trim() === ""
}
