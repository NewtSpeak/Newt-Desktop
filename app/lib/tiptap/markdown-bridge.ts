// Wire Markdown（docs 05 白名单）↔ TipTap JSON 互转。
// 解析复用 app/lib/markdown.tsx 的有限白名单，保证与发送协议一致。

import type { JSONContent } from "@tiptap/core"

import { parseMarkdown } from "~/lib/markdown"

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
  | { kind: "custom_emote"; itemId: string; mark: string }

type AnyBlock =
  | { kind: "paragraph"; children: AnyInline[] }
  | { kind: "codeblock"; lang: string; code: string }
  | { kind: "quote"; lines: AnyInline[][] }
  | { kind: "list"; items: AnyInline[][] }

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
      case "custom_emote":
        out.push({
          type: "customEmote",
          attrs: {
            itemId: node.itemId,
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

/** wire Markdown → TipTap doc JSON */
export function markdownToTipTapDoc(
  content: string,
  resolveMentionLabel?: (userId: string) => string,
): JSONContent {
  const blocks = parseMarkdown(content) as AnyBlock[]
  const contentNodes: JSONContent[] = []

  const mapInline = (nodes: AnyInline[]) => {
    const mapped = nodes.map((n) => {
      if (n.kind === "mention" && resolveMentionLabel) {
        return n
      }
      return n
    })
    // 回填 mention label
    const withLabels = mapped.map((n) => {
      if (n.kind === "mention") {
        return {
          ...n,
          // label 在 inlineToTipTap 里用 attrs；这里改写
        }
      }
      return n
    })
    const result = inlineToTipTap(withLabels)
    if (resolveMentionLabel) {
      for (const item of result) {
        if (item.type === "mention" && item.attrs?.id) {
          item.attrs.label =
            resolveMentionLabel(String(item.attrs.id)) ||
            String(item.attrs.id).slice(0, 6)
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
    if (node.type === "customEmote") {
      const itemId = String(node.attrs?.itemId ?? "")
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
