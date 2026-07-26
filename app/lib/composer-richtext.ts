// Composer 富文本 Markdown：contenteditable DOM ↔ 消息 wire Markdown 互转，
// 以及行内/块级格式切换（与 app/lib/markdown.tsx 白名单对齐）。

export type InlineFormat = "bold" | "italic" | "strike" | "code"
export type BlockFormat = "quote" | "list" | "codeblock"

const INLINE_TAG: Record<InlineFormat, string> = {
  bold: "STRONG",
  italic: "EM",
  strike: "S",
  code: "CODE",
}

const INLINE_CLASS: Record<InlineFormat, string> = {
  bold: "font-semibold",
  italic: "italic",
  strike: "line-through",
  // 行内 `code` 与消息正文一致：用全局 UI 字体（MiSans），不用等宽
  code: "rounded bg-muted px-1 py-0.5 font-sans text-[0.85em]",
}

const MD_MARK: Record<InlineFormat, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  strike: ["~~", "~~"],
  code: ["`", "`"],
}

/** 行内 @chip 样式（与消息正文提及风格接近，输入区略收敛） */
export const MENTION_CHIP_CLASS =
  "mx-0.5 inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[0.95em] font-medium text-foreground align-middle select-none"

const BLOCK_QUOTE_CLASS =
  "my-0.5 border-l-2 border-border pl-2 text-muted-foreground"
const BLOCK_CODE_CLASS =
  "my-0.5 block w-full overflow-x-auto rounded-md border-0 bg-muted/50 px-2 py-1.5 font-sans text-[13px] leading-relaxed whitespace-pre-wrap"
const LIST_ITEM_CLASS = "list-item-composer relative pl-4 before:absolute before:left-1 before:content-['•'] before:text-muted-foreground"
const LINK_CLASS = "text-primary underline-offset-2 underline break-all"

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE
}

function escapeMdInline(text: string): string {
  // 不转义用户刻意输入的 markdown 定界符；仅规范化空白
  // 去掉格式占位用的零宽字符，避免进入 wire
  return text.replace(/\u00A0/g, " ").replace(/[\u200B\uFEFF]/g, "")
}

function getFormatFromEl(el: HTMLElement): InlineFormat | null {
  const md = el.dataset.md
  if (md === "bold" || md === "italic" || md === "strike" || md === "code") return md
  const tag = el.tagName
  if (tag === "STRONG" || tag === "B") return "bold"
  if (tag === "EM" || tag === "I") return "italic"
  if (tag === "S" || tag === "DEL" || tag === "STRIKE") return "strike"
  if (tag === "CODE" && el.dataset.md !== "codeblock") return "code"
  // style 回落（粘贴场景）
  const style = el.style
  if (style.fontWeight === "bold" || style.fontWeight === "700") return "bold"
  if (style.fontStyle === "italic") return "italic"
  if (style.textDecoration.includes("line-through")) return "strike"
  return null
}

function isBlockEl(el: HTMLElement): boolean {
  const tag = el.tagName
  return (
    tag === "DIV" ||
    tag === "P" ||
    tag === "BLOCKQUOTE" ||
    tag === "PRE" ||
    tag === "LI" ||
    tag === "UL" ||
    tag === "OL" ||
    el.dataset.md === "quote" ||
    el.dataset.md === "list-item" ||
    el.dataset.md === "codeblock"
  )
}

// ---------------------------------------------------------------------------
// 序列化：DOM → Markdown wire
// ---------------------------------------------------------------------------

type SerializeOpts = {
  /** 当前是否在代码块内（内部不再二次转义/嵌套 markdown） */
  inCodeBlock?: boolean
  /** 当前行内格式栈（避免重复包） */
  formats?: Set<InlineFormat>
}

function serializeNode(node: Node, opts: SerializeOpts = {}): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeMdInline(node.textContent ?? "")
  }
  if (!isElement(node)) return ""

  const el = node
  if (el.dataset.mentionUserId) {
    return `<@${el.dataset.mentionUserId}>`
  }
  if (el.tagName === "BR") return "\n"

  // 链接
  if (el.dataset.md === "link" || el.tagName === "A") {
    const href = el.dataset.href || el.getAttribute("href") || ""
    const label = serializeChildren(el, opts).trim() || href
    if (!href) return label
    // 裸 URL 且 label===href 时直接输出 URL
    if (label === href && /^https?:\/\//i.test(href)) return href
    return `[${label}](${href})`
  }

  // 代码块
  if (el.dataset.md === "codeblock" || el.tagName === "PRE") {
    const lang = el.dataset.lang ?? ""
    const code = (el.textContent ?? "").replace(/\u00A0/g, " ").replace(/\n$/, "")
    return `\`\`\`${lang}\n${code}\n\`\`\``
  }

  // 引用
  if (el.dataset.md === "quote" || el.tagName === "BLOCKQUOTE") {
    const inner = serializeChildren(el, opts)
    const lines = inner.split("\n")
    return lines.map((line) => `> ${line}`).join("\n")
  }

  // 列表项
  if (el.dataset.md === "list-item" || el.tagName === "LI") {
    const inner = serializeChildren(el, opts).replace(/^\n+|\n+$/g, "")
    return `- ${inner}`
  }

  if (el.tagName === "UL" || el.tagName === "OL") {
    return serializeChildren(el, opts)
  }

  // 行内格式
  const fmt = getFormatFromEl(el)
  if (fmt && !opts.inCodeBlock) {
    const formats = opts.formats ?? new Set<InlineFormat>()
    if (formats.has(fmt)) {
      return serializeChildren(el, opts)
    }
    const next = new Set(formats)
    next.add(fmt)
    const inner = serializeChildren(el, { ...opts, formats: next })
    // 空格式不输出标记
    if (inner === "") return ""
    // 行内代码内部不再嵌套其他 md
    if (fmt === "code") {
      return `\`${inner.replace(/`/g, "'")}\``
    }
    const [open, close] = MD_MARK[fmt]
    return `${open}${inner}${close}`
  }

  const isBlock = isBlockEl(el)
  let out = ""
  if (isBlock) {
    // 块前补换行由调用方/根 walk 处理；这里仅序列化子节点
    out = serializeChildren(el, opts)
  } else {
    out = serializeChildren(el, opts)
  }
  return out
}

function serializeChildren(el: HTMLElement, opts: SerializeOpts): string {
  let out = ""
  for (const child of el.childNodes) {
    if (isElement(child) && isBlockEl(child) && out.length > 0 && !out.endsWith("\n")) {
      out += "\n"
    }
    out += serializeNode(child, opts)
  }
  return out
}

/** 将编辑器 DOM 序列化为发送用 wire Markdown（chip → <@uuid>，样式 → md 语法） */
export function serializeComposer(root: HTMLElement): string {
  let out = ""
  for (const child of root.childNodes) {
    if (isElement(child) && isBlockEl(child) && out.length > 0 && !out.endsWith("\n")) {
      out += "\n"
    }
    out += serializeNode(child)
  }
  // 浏览器空编辑器可能只剩 <br>
  if (out === "\n") return ""
  // 去掉末尾多余换行（contenteditable 常在末尾留 br）
  return out.replace(/\n+$/, (m) => (m.length > 1 ? "\n" : ""))
}

export function isEditorVisuallyEmpty(root: HTMLElement): boolean {
  return serializeComposer(root).trim() === ""
}

// ---------------------------------------------------------------------------
// @chip / 光标
// ---------------------------------------------------------------------------

/** 创建不可编辑的 @chip */
export function createMentionChip(userId: string, label: string): HTMLSpanElement {
  const span = document.createElement("span")
  span.contentEditable = "false"
  span.dataset.mentionUserId = userId
  span.className = MENTION_CHIP_CLASS
  span.textContent = `@${label}`
  span.draggable = false
  return span
}

/** 取选区前的「纯文本」视图（chip 视为空格，便于 (^|\s)@ 匹配） */
export function plainTextBeforeCaret(root: HTMLElement): string {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
    return serializeComposer(root)
  }
  const end = sel.getRangeAt(0)
  const range = document.createRange()
  range.selectNodeContents(root)
  range.setEnd(end.endContainer, end.endOffset)

  let out = ""
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? "").replace(/\u00A0/g, " ")
      return
    }
    if (!isElement(node)) return
    if (node.dataset.mentionUserId) {
      out += " "
      return
    }
    if (node.tagName === "BR") {
      out += "\n"
      return
    }
    for (const child of node.childNodes) walk(child)
  }
  const frag = range.cloneContents()
  for (const child of frag.childNodes) walk(child)
  return out
}

function placeCaretAfter(sel: Selection, node: Node) {
  const r = document.createRange()
  if (node.nodeType === Node.TEXT_NODE) {
    r.setStart(node, (node as Text).length)
  } else {
    r.setStartAfter(node)
  }
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
}

function previousLeaf(root: HTMLElement, node: Node): Node | null {
  let current: Node | null = node
  while (current && current !== root) {
    if (current.previousSibling) {
      current = current.previousSibling
      while (current.lastChild) current = current.lastChild
      return current
    }
    current = current.parentNode
  }
  return null
}

/** 从光标向前删除 count 个纯文本字符（用于插入 chip 前清掉 @query） */
export function deleteTextBeforeCaret(root: HTMLElement, charCount: number) {
  if (charCount <= 0) return
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) return

  let remaining = charCount
  while (remaining > 0) {
    const r = sel.getRangeAt(0)
    const { startContainer: container, startOffset: offset } = r

    if (container.nodeType === Node.TEXT_NODE) {
      const tn = container as Text
      if (offset > 0) {
        const del = Math.min(offset, remaining)
        tn.deleteData(offset - del, del)
        remaining -= del
        const nextOffset = offset - del
        if (tn.length === 0) {
          const parent = tn.parentNode!
          const index = Array.prototype.indexOf.call(parent.childNodes, tn)
          tn.remove()
          r.setStart(parent, index)
        } else {
          r.setStart(tn, nextOffset)
        }
        r.collapse(true)
        sel.removeAllRanges()
        sel.addRange(r)
        continue
      }
      const prev = previousLeaf(root, tn)
      if (!prev) break
      placeCaretAfter(sel, prev)
      continue
    }

    if (container.nodeType === Node.ELEMENT_NODE) {
      if (offset > 0) {
        const child = container.childNodes[offset - 1]
        if (child.nodeType === Node.TEXT_NODE) {
          const tn = child as Text
          r.setStart(tn, tn.length)
          r.collapse(true)
          sel.removeAllRanges()
          sel.addRange(r)
          continue
        }
        if (
          (child as HTMLElement).dataset?.mentionUserId ||
          (child as HTMLElement).tagName === "BR"
        ) {
          child.parentNode?.removeChild(child)
          remaining -= 1
          r.setStart(container, offset - 1)
          r.collapse(true)
          sel.removeAllRanges()
          sel.addRange(r)
          continue
        }
        placeCaretAfter(sel, child)
        continue
      }
      const prev = previousLeaf(root, container)
      if (!prev) break
      placeCaretAfter(sel, prev)
      continue
    }
    break
  }
}

/** 在光标处插入节点并放光标到其后 */
export function insertNodeAtCaret(node: Node) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

/** 在光标处插入纯文本 */
export function insertTextAtCaret(text: string) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const textNode = document.createTextNode(text)
  range.insertNode(textNode)
  range.setStartAfter(textNode)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

export function clearEditor(root: HTMLElement) {
  root.innerHTML = ""
}

// ---------------------------------------------------------------------------
// 选区与祖先
// ---------------------------------------------------------------------------

function selectionInside(root: HTMLElement): Range | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  return range
}

function findAncestor(
  node: Node | null,
  root: HTMLElement,
  predicate: (el: HTMLElement) => boolean,
): HTMLElement | null {
  let cur: Node | null = node
  while (cur && cur !== root) {
    if (isElement(cur) && predicate(cur)) return cur
    cur = cur.parentNode
  }
  return null
}

function createInlineEl(format: InlineFormat): HTMLElement {
  const tag = INLINE_TAG[format].toLowerCase()
  const el = document.createElement(tag)
  el.dataset.md = format
  el.className = INLINE_CLASS[format]
  return el
}

/** 判断当前选区是否全部处于某行内格式内 */
export function queryInlineFormat(root: HTMLElement, format: InlineFormat): boolean {
  const range = selectionInside(root)
  if (!range) return false
  const node = range.commonAncestorContainer
  const el = findAncestor(
    node.nodeType === Node.TEXT_NODE ? node.parentNode : node,
    root,
    (e) => getFormatFromEl(e) === format,
  )
  return Boolean(el)
}

export function queryBlockFormat(root: HTMLElement, format: BlockFormat): boolean {
  const range = selectionInside(root)
  if (!range) return false
  const node = range.commonAncestorContainer
  const start = node.nodeType === Node.TEXT_NODE ? node.parentNode : node
  if (format === "quote") {
    return Boolean(
      findAncestor(start, root, (e) => e.dataset.md === "quote" || e.tagName === "BLOCKQUOTE"),
    )
  }
  if (format === "list") {
    return Boolean(
      findAncestor(start, root, (e) => e.dataset.md === "list-item" || e.tagName === "LI"),
    )
  }
  if (format === "codeblock") {
    return Boolean(
      findAncestor(start, root, (e) => e.dataset.md === "codeblock" || e.tagName === "PRE"),
    )
  }
  return false
}

// ---------------------------------------------------------------------------
// 行内格式切换
// ---------------------------------------------------------------------------

function unwrapElement(el: HTMLElement) {
  const parent = el.parentNode
  if (!parent) return
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  parent.removeChild(el)
}

/**
 * 切换行内格式。有选区时包/解包选中文本；无选区时在光标插入空格式壳并把光标放进去。
 */
export function toggleInlineFormat(root: HTMLElement, format: InlineFormat): void {
  root.focus()
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return

  // 若光标/选区已在该格式内 → 解包（仅解包最内层匹配）
  const anchorEl =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : (range.commonAncestorContainer as HTMLElement)
  const existing = findAncestor(anchorEl, root, (e) => getFormatFromEl(e) === format)

  if (existing) {
    // 选区折叠且整段格式：解包整个格式节点
    if (range.collapsed) {
      unwrapElement(existing)
      // 尽量保持光标
      return
    }
    // 有选区：若选区完全在 existing 内，拆分解包较复杂——简化为对选区内容取消该格式
    // 策略：提取选区 → 去掉其中该格式 → 重新插入
    const extracted = range.extractContents()
    stripFormatFromFragment(extracted, format)
    range.insertNode(extracted)
    sel.removeAllRanges()
    // 放光标到插入内容末尾
    range.collapse(false)
    sel.addRange(range)
    return
  }

  if (range.collapsed) {
    // 无选区：插入空壳 + zero-width space 占位，便于继续输入
    const el = createInlineEl(format)
    const zwsp = document.createTextNode("\u200B")
    el.appendChild(zwsp)
    range.insertNode(el)
    // 光标放在 zwsp 后
    const r = document.createRange()
    r.setStart(zwsp, 1)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
    return
  }

  // 有选区：包一层
  const el = createInlineEl(format)
  try {
    range.surroundContents(el)
  } catch {
    // 跨元素边界时 surroundContents 会失败：extract + wrap
    const frag = range.extractContents()
    el.appendChild(frag)
    range.insertNode(el)
  }
  // 选中刚包好的内容
  const r = document.createRange()
  r.selectNodeContents(el)
  sel.removeAllRanges()
  sel.addRange(r)
}

function stripFormatFromFragment(frag: DocumentFragment | Node, format: InlineFormat) {
  const walk = (node: Node) => {
    if (!isElement(node)) return
    const children = [...node.childNodes]
    if (getFormatFromEl(node) === format) {
      const parent = node.parentNode
      if (parent) {
        while (node.firstChild) parent.insertBefore(node.firstChild, node)
        parent.removeChild(node)
      }
      for (const c of children) walk(c)
      return
    }
    for (const c of children) walk(c)
  }
  for (const c of [...frag.childNodes]) walk(c)
}

// ---------------------------------------------------------------------------
// 块级格式
// ---------------------------------------------------------------------------

function wrapBlock(root: HTMLElement, create: () => HTMLElement) {
  root.focus()
  const range = selectionInside(root)
  if (!range) return

  if (range.collapsed) {
    // 找当前行（最近块级祖先，或整段文本）
    const block = findAncestor(
      range.commonAncestorContainer,
      root,
      (e) => isBlockEl(e) && e !== root,
    )
    const wrapper = create()
    if (block && block.parentNode === root) {
      // 用 wrapper 替换 block
      while (block.firstChild) wrapper.appendChild(block.firstChild)
      if (!wrapper.firstChild) wrapper.appendChild(document.createElement("br"))
      root.replaceChild(wrapper, block)
    } else if (block && (block.dataset.md === "quote" || block.dataset.md === "list-item" || block.dataset.md === "codeblock")) {
      // 已是某种块格式：把内容挪进新 wrapper 再替换
      while (block.firstChild) wrapper.appendChild(block.firstChild)
      if (!wrapper.firstChild) wrapper.appendChild(document.createElement("br"))
      block.parentNode?.replaceChild(wrapper, block)
    } else {
      // 整行文本：取当前块内全部内容
      const parent =
        findAncestor(range.commonAncestorContainer, root, (e) => e === root || isBlockEl(e)) ??
        root
      if (parent === root && root.childNodes.length > 0) {
        // 把 root 下当前「行」包起来——简化：包整个选区所在文本节点的父
        const textParent =
          range.startContainer.nodeType === Node.TEXT_NODE
            ? range.startContainer.parentNode
            : range.startContainer
        if (textParent && textParent !== root && isElement(textParent as Node)) {
          const el = textParent as HTMLElement
          if (el.parentNode === root) {
            while (el.firstChild) wrapper.appendChild(el.firstChild)
            if (!wrapper.firstChild) wrapper.appendChild(document.createElement("br"))
            root.replaceChild(wrapper, el)
          } else {
            insertEmptyBlockAtCaret(wrapper, range)
          }
        } else {
          // 直接包 root 全部子节点过于激进：仅插空块
          insertEmptyBlockAtCaret(wrapper, range)
        }
      } else {
        insertEmptyBlockAtCaret(wrapper, range)
      }
    }
    placeCaretInside(wrapper)
    return
  }

  // 有选区：extract 后包块
  const wrapper = create()
  const frag = range.extractContents()
  wrapper.appendChild(frag)
  if (!wrapper.textContent) wrapper.appendChild(document.createElement("br"))
  range.insertNode(wrapper)
  placeCaretInside(wrapper)
}

function insertEmptyBlockAtCaret(wrapper: HTMLElement, range: Range) {
  if (!wrapper.firstChild) wrapper.appendChild(document.createElement("br"))
  range.insertNode(wrapper)
}

function placeCaretInside(el: HTMLElement) {
  const sel = window.getSelection()
  if (!sel) return
  const r = document.createRange()
  // 找到第一个文本或 br
  let target: Node = el
  while (target.firstChild && isElement(target.firstChild) && target.firstChild.tagName !== "BR") {
    target = target.firstChild
  }
  if (target.nodeType === Node.TEXT_NODE) {
    r.setStart(target, (target as Text).length)
  } else if (isElement(target) && target.tagName === "BR") {
    r.setStartBefore(target)
  } else {
    r.selectNodeContents(el)
    r.collapse(false)
  }
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
}

function unwrapBlock(el: HTMLElement) {
  const parent = el.parentNode
  if (!parent) return
  // 解包为普通 div 行
  const div = document.createElement("div")
  while (el.firstChild) div.appendChild(el.firstChild)
  if (!div.firstChild) div.appendChild(document.createElement("br"))
  parent.replaceChild(div, el)
}

export function toggleBlockFormat(root: HTMLElement, format: BlockFormat): void {
  root.focus()
  const range = selectionInside(root)
  if (!range) return

  const start =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentNode
      : range.commonAncestorContainer

  if (format === "quote") {
    const existing = findAncestor(
      start,
      root,
      (e) => e.dataset.md === "quote" || e.tagName === "BLOCKQUOTE",
    )
    if (existing) {
      unwrapBlock(existing)
      return
    }
    wrapBlock(root, () => {
      const el = document.createElement("blockquote")
      el.dataset.md = "quote"
      el.className = BLOCK_QUOTE_CLASS
      return el
    })
    return
  }

  if (format === "list") {
    const existing = findAncestor(
      start,
      root,
      (e) => e.dataset.md === "list-item" || e.tagName === "LI",
    )
    if (existing) {
      unwrapBlock(existing)
      return
    }
    wrapBlock(root, () => {
      const el = document.createElement("div")
      el.dataset.md = "list-item"
      el.className = LIST_ITEM_CLASS
      return el
    })
    return
  }

  if (format === "codeblock") {
    const existing = findAncestor(
      start,
      root,
      (e) => e.dataset.md === "codeblock" || e.tagName === "PRE",
    )
    if (existing) {
      unwrapBlock(existing)
      return
    }
    wrapBlock(root, () => {
      const el = document.createElement("pre")
      el.dataset.md = "codeblock"
      el.dataset.lang = ""
      el.className = BLOCK_CODE_CLASS
      return el
    })
  }
}

/** 插入或编辑链接：有选区时包为链接；无选区时插入 [label](url) 视觉链接 */
export function applyLink(root: HTMLElement, href: string, label?: string): void {
  root.focus()
  const safe = (() => {
    try {
      const u = new URL(href)
      if (u.protocol === "http:" || u.protocol === "https:") return u.href
    } catch {
      // try with https prefix
      try {
        const u = new URL(`https://${href}`)
        if (u.protocol === "https:") return u.href
      } catch {
        return null
      }
    }
    return null
  })()
  if (!safe) return

  const range = selectionInside(root)
  if (!range) return

  const a = document.createElement("a")
  a.dataset.md = "link"
  a.dataset.href = safe
  a.href = safe
  a.target = "_blank"
  a.rel = "noopener noreferrer"
  a.className = LINK_CLASS

  if (range.collapsed) {
    a.textContent = label?.trim() || safe
    range.insertNode(a)
    // 链接后加空格
    const space = document.createTextNode(" ")
    a.parentNode?.insertBefore(space, a.nextSibling)
    const sel = window.getSelection()
    if (sel) {
      const r = document.createRange()
      r.setStartAfter(space)
      r.collapse(true)
      sel.removeAllRanges()
      sel.addRange(r)
    }
    return
  }

  const frag = range.extractContents()
  a.appendChild(frag)
  if (!a.textContent?.trim()) a.textContent = label?.trim() || safe
  range.insertNode(a)
}

// ---------------------------------------------------------------------------
// 粘贴：纯文本保留换行；若含 markdown 语法则轻量解析为 DOM
// ---------------------------------------------------------------------------

/** 将纯文本（可含有限 markdown）转为可插入的 DocumentFragment */
export function textToComposerFragment(text: string): DocumentFragment {
  const frag = document.createDocumentFragment()
  // 代码块优先切分
  const parts = splitByCodeBlocks(text)
  for (const part of parts) {
    if (part.type === "codeblock") {
      const pre = document.createElement("pre")
      pre.dataset.md = "codeblock"
      pre.dataset.lang = part.lang
      pre.className = BLOCK_CODE_CLASS
      pre.textContent = part.code
      frag.appendChild(pre)
      continue
    }
    const lines = part.text.split("\n")
    lines.forEach((line, index) => {
      if (index > 0) {
        // 用 div 分行（contenteditable 习惯）
      }
      const block = lineToBlock(line)
      frag.appendChild(block)
    })
  }
  return frag
}

function splitByCodeBlocks(
  text: string,
): Array<
  | { type: "text"; text: string }
  | { type: "codeblock"; lang: string; code: string }
> {
  const result: Array<
    | { type: "text"; text: string }
    | { type: "codeblock"; lang: string; code: string }
  > = []
  const re = /^```(\S*)\s*\n([\s\S]*?)^```\s*$/gm
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      result.push({ type: "text", text: text.slice(last, m.index) })
    }
    result.push({ type: "codeblock", lang: m[1] ?? "", code: m[2].replace(/\n$/, "") })
    last = m.index + m[0].length
  }
  if (last < text.length) {
    result.push({ type: "text", text: text.slice(last) })
  }
  if (result.length === 0) result.push({ type: "text", text })
  return result
}

function lineToBlock(line: string): HTMLElement {
  // 引用
  const quote = /^>\s?(.*)$/.exec(line)
  if (quote) {
    const el = document.createElement("blockquote")
    el.dataset.md = "quote"
    el.className = BLOCK_QUOTE_CLASS
    appendInlines(el, quote[1])
    if (!el.firstChild) el.appendChild(document.createElement("br"))
    return el
  }
  // 列表
  const list = /^[-*]\s+(.*)$/.exec(line)
  if (list) {
    const el = document.createElement("div")
    el.dataset.md = "list-item"
    el.className = LIST_ITEM_CLASS
    appendInlines(el, list[1])
    if (!el.firstChild) el.appendChild(document.createElement("br"))
    return el
  }
  // 普通行用 div
  const div = document.createElement("div")
  if (line === "") {
    div.appendChild(document.createElement("br"))
  } else {
    appendInlines(div, line)
  }
  return div
}

/** 解析行内 markdown 并 append 到 parent（与 markdown.tsx 白名单大致对齐） */
function appendInlines(parent: HTMLElement, text: string) {
  type Hit = { index: number; length: number; apply: () => void }

  let rest = text
  while (rest.length > 0) {
    const candidates: Hit[] = []

    const mention = /<@([0-9a-zA-Z-]{1,36})>/.exec(rest)
    if (mention) {
      const m = mention
      candidates.push({
        index: m.index,
        length: m[0].length,
        apply: () => {
          parent.appendChild(createMentionChip(m[1], m[1].slice(0, 8)))
        },
      })
    }

    const code = /`([^`\n]+)`/.exec(rest)
    if (code) {
      const m = code
      candidates.push({
        index: m.index,
        length: m[0].length,
        apply: () => {
          const el = createInlineEl("code")
          el.textContent = m[1]
          parent.appendChild(el)
        },
      })
    }

    const bold = /\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*/.exec(rest)
    if (bold) {
      const m = bold
      candidates.push({
        index: m.index,
        length: m[0].length,
        apply: () => {
          const el = createInlineEl("bold")
          appendInlines(el, m[1])
          parent.appendChild(el)
        },
      })
    }

    const strike = /~~(?!\s)([\s\S]+?)(?<!\s)~~/.exec(rest)
    if (strike) {
      const m = strike
      candidates.push({
        index: m.index,
        length: m[0].length,
        apply: () => {
          const el = createInlineEl("strike")
          appendInlines(el, m[1])
          parent.appendChild(el)
        },
      })
    }

    const italic = /(?<!\*)\*(?!\*|\s)([^*\n]+?)(?<!\s)\*(?!\*)/.exec(rest)
    if (italic) {
      const m = italic
      candidates.push({
        index: m.index,
        length: m[0].length,
        apply: () => {
          const el = createInlineEl("italic")
          appendInlines(el, m[1])
          parent.appendChild(el)
        },
      })
    }

    const mdLink = /\[([^\[\]\n]{1,200})\]\((https?:\/\/[^()\s]+)\)/.exec(rest)
    if (mdLink) {
      const m = mdLink
      candidates.push({
        index: m.index,
        length: m[0].length,
        apply: () => {
          const a = document.createElement("a")
          a.dataset.md = "link"
          a.dataset.href = m[2]
          a.href = m[2]
          a.target = "_blank"
          a.rel = "noopener noreferrer"
          a.className = LINK_CLASS
          a.textContent = m[1]
          parent.appendChild(a)
        },
      })
    }

    const bare = /https?:\/\/[^\s<>]+/.exec(rest)
    if (bare) {
      const trimmed = bare[0].replace(/[.,;:!?)\]}>'"]+$/, "")
      const index = bare.index
      candidates.push({
        index,
        length: trimmed.length,
        apply: () => {
          const a = document.createElement("a")
          a.dataset.md = "link"
          a.dataset.href = trimmed
          a.href = trimmed
          a.target = "_blank"
          a.rel = "noopener noreferrer"
          a.className = LINK_CLASS
          a.textContent = trimmed
          parent.appendChild(a)
        },
      })
    }

    if (candidates.length === 0) {
      parent.appendChild(document.createTextNode(rest))
      break
    }

    candidates.sort((a, b) => a.index - b.index)
    const hit = candidates[0]
    if (hit.index > 0) {
      parent.appendChild(document.createTextNode(rest.slice(0, hit.index)))
    }
    hit.apply()
    rest = rest.slice(hit.index + hit.length)
  }
}

/** 在光标处插入 fragment */
export function insertFragmentAtCaret(frag: DocumentFragment) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const last = frag.lastChild
  range.insertNode(frag)
  if (last) {
    range.setStartAfter(last)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }
}

/** 将 Markdown 字符串灌入编辑器（用于编辑回填等） */
export function setComposerMarkdown(root: HTMLElement, markdown: string) {
  clearEditor(root)
  if (!markdown) return
  const frag = textToComposerFragment(markdown)
  // 若只有一个空 div，保持空
  root.appendChild(frag)
}
