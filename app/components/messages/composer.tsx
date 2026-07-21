// 消息输入区：多行自适应 contenteditable（Enter 发送 / Shift+Enter 换行）、
// 行内 @chip（灰色背景，非独立组件）、4000 字计数、typing 节流、@成员补全面板、
// 附件三入口（+ 按钮 / 拖拽 / 粘贴图片）与 presign+直传进度。

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  CrownIcon,
  FileIcon,
  PlusIcon,
  SendIcon,
  SmileIcon,
  XIcon,
} from "lucide-react"

import { presignAttachment, uploadAttachmentWithProgress } from "~/lib/api/attachments"
import { ApiError } from "~/lib/api/http"
import { sendTyping } from "~/lib/api/messages"
import { MESSAGE_TYPE_SYSTEM_ADMIN, type GuildMember } from "~/lib/api/types"
import {
  memberDisplayName,
  nameInitials,
  resolveProfileAssetUrl,
} from "~/lib/user-display"
import { cn } from "~/lib/utils"
import { useMembersStore } from "~/stores/members"
import { useMessagesStore, type ChatMessage } from "~/stores/messages"
import { formatBytes } from "./attachments"
import { EmojiPickerPopover } from "./emoji-picker"

const MAX_CONTENT = 4000
const MAX_ATTACHMENTS = 10
const TYPING_THROTTLE_MS = 8000

/** 行内 @chip 样式（与消息正文提及风格接近，输入区略收敛） */
const MENTION_CHIP_CLASS =
  "mx-0.5 inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[0.95em] font-medium text-foreground align-middle select-none"

// ---------------------------------------------------------------------------
// contenteditable：序列化 / 光标 / @chip
// ---------------------------------------------------------------------------

/** 将编辑器 DOM 序列化为发送用 wire 文本（chip → <@uuid>） */
function serializeComposer(root: HTMLElement): string {
  let out = ""
  const walk = (node: Node, isRoot = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? "").replace(/\u00A0/g, " ")
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    if (el.dataset.mentionUserId) {
      out += `<@${el.dataset.mentionUserId}>`
      return
    }
    if (el.tagName === "BR") {
      out += "\n"
      return
    }
    const isBlock = el.tagName === "DIV" || el.tagName === "P"
    // contenteditable 换行常包在 DIV 里：块前补换行（根下第一个块除外）
    if (isBlock && !isRoot && out.length > 0 && !out.endsWith("\n")) {
      out += "\n"
    }
    for (const child of el.childNodes) walk(child)
  }
  for (const child of root.childNodes) walk(child, true)
  // 浏览器空编辑器可能只剩 <br>
  if (out === "\n") return ""
  return out
}

function isEditorVisuallyEmpty(root: HTMLElement): boolean {
  const text = serializeComposer(root).trim()
  return text === ""
}

/** 创建不可编辑的 @chip */
function createMentionChip(userId: string, label: string): HTMLSpanElement {
  const span = document.createElement("span")
  span.contentEditable = "false"
  span.dataset.mentionUserId = userId
  span.className = MENTION_CHIP_CLASS
  span.textContent = `@${label}`
  // 避免拖选拆开 chip
  span.draggable = false
  return span
}

/** 取选区前的「纯文本」视图（chip 视为空格，便于 (^|\s)@ 匹配） */
function plainTextBeforeCaret(root: HTMLElement): string {
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
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    if (el.dataset.mentionUserId) {
      out += " "
      return
    }
    if (el.tagName === "BR") {
      out += "\n"
      return
    }
    for (const child of el.childNodes) walk(child)
  }
  // 用 TreeWalker 只遍历 range 内节点较繁琐；改用 cloneContents
  const frag = range.cloneContents()
  for (const child of frag.childNodes) walk(child)
  return out
}

/** 从光标向前删除 count 个纯文本字符（用于插入 chip 前清掉 @query） */
function deleteTextBeforeCaret(root: HTMLElement, charCount: number) {
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
      // 文本节点开头：跳到前一个叶子
      const prev = previousLeaf(root, tn)
      if (!prev) break
      placeCaretAfter(sel, prev)
      continue
    }

    // 光标在元素节点上（如 root 的子节点间隙）
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
        // chip 或 br：整块删掉（@query 不会落在 chip 上，一般不会走到）
        if ((child as HTMLElement).dataset?.mentionUserId || (child as HTMLElement).tagName === "BR") {
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

/** 在光标处插入节点并放光标到其后 */
function insertNodeAtCaret(node: Node) {
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
function insertTextAtCaret(text: string) {
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

function clearEditor(root: HTMLElement) {
  root.innerHTML = ""
}

// ---------------------------------------------------------------------------
// 上传项
// ---------------------------------------------------------------------------

type UploadItem = {
  localId: string
  file: File
  status: "uploading" | "done" | "error"
  /** 0-1 */
  progress: number
  attachmentId?: string
  error?: string
  abort?: () => void
  /** 图片缩略 object URL */
  previewUrl?: string
}

function ProgressRing({ progress }: { progress: number }) {
  const radius = 14
  const circumference = 2 * Math.PI * radius
  return (
    <svg viewBox="0 0 36 36" className="size-9 -rotate-90">
      <circle cx="18" cy="18" r={radius} fill="none" strokeWidth="3" className="stroke-muted" />
      <circle
        cx="18"
        cy="18"
        r={radius}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        className="stroke-primary transition-[stroke-dashoffset]"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(1, progress))}
      />
    </svg>
  )
}

function AttachmentTrayCard({ item, onRemove }: { item: UploadItem; onRemove: () => void }) {
  return (
    <div
      className={cn(
        "relative flex w-44 shrink-0 flex-col gap-1 rounded-lg border p-2",
        item.status === "error" && "border-destructive/60 bg-destructive/5",
      )}
    >
      <div className="flex h-16 items-center justify-center overflow-hidden rounded-md bg-muted/50">
        {item.previewUrl ? (
          <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />
        ) : (
          <FileIcon className="size-8 text-muted-foreground" />
        )}
        {item.status === "uploading" && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/60">
            <ProgressRing progress={item.progress} />
          </div>
        )}
      </div>
      <p className="truncate text-xs font-medium" title={item.file.name}>
        {item.file.name}
      </p>
      <p className="text-[10px] text-muted-foreground">
        {item.status === "error" ? (
          <span className="text-destructive">{item.error ?? "上传失败"}</span>
        ) : (
          formatBytes(item.file.size)
        )}
      </p>
      <button
        type="button"
        aria-label={`移除 ${item.file.name}`}
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 rounded-full border bg-background p-0.5 text-muted-foreground shadow-sm hover:text-destructive"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// @ 提及补全
// ---------------------------------------------------------------------------

function matchMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const match = /(^|\s)@([\p{L}\p{N}_-]{0,32})$/u.exec(before)
  if (!match) return null
  return { start: caret - match[2].length - 1, query: match[2] }
}

function filterMembers(members: GuildMember[], query: string): GuildMember[] {
  const lowered = query.toLowerCase()
  return members
    .filter((member) => {
      const name = memberDisplayName(member).toLowerCase()
      return (
        name.includes(lowered) ||
        member.username.toLowerCase().includes(lowered) ||
        (member.nickname ?? "").toLowerCase().includes(lowered) ||
        (member.display_name ?? "").toLowerCase().includes(lowered)
      )
    })
    .slice(0, 8)
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

export type ComposerProps = {
  channelId: string
  guildId: string
  channelName: string
  /** 正在回复的消息（null 表示无） */
  replyTo: ChatMessage | null
  onCancelReply: () => void
  /** 输入框为空时按 ↑：编辑自己最近一条消息 */
  onEditLast: () => void
  resolveName: (userId: string) => string
}

export function Composer({
  channelId,
  guildId,
  channelName,
  replyTo,
  onCancelReply,
  onEditLast,
  resolveName,
}: ComposerProps) {
  const send = useMessagesStore((state) => state.send)
  const discardPending = useMessagesStore((state) => state.discardPending)
  const members = useMembersStore((state) => state.byGuild[guildId]) ?? []

  const [value, setValue] = useState("")
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)

  const editableRef = useRef<HTMLDivElement>(null)
  const lastTypingRef = useRef(0)
  const uploadsRef = useRef(uploads)
  uploadsRef.current = uploads

  // 频道切换：清空本地输入态（上传中的先中止）+ 清空编辑器
  useEffect(() => {
    if (editableRef.current) {
      clearEditor(editableRef.current)
      setValue("")
      setMention(null)
    }
    return () => {
      for (const item of uploadsRef.current) {
        item.abort?.()
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      }
    }
  }, [channelId])

  // 429 冷却倒计时
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const resize = () => {
    const el = editableRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }

  const syncValueFromDom = useCallback(() => {
    const el = editableRef.current
    if (!el) return ""
    const next = serializeComposer(el)
    setValue(next)
    return next
  }, [])

  // -------------------------------------------------------------------------
  // 附件上传
  // -------------------------------------------------------------------------

  const patchUpload = (localId: string, patch: Partial<UploadItem>) =>
    setUploads((items) =>
      items.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
    )

  const startUpload = useCallback(
    async (item: UploadItem) => {
      try {
        const presigned = await presignAttachment(channelId, {
          filename: item.file.name,
          size: item.file.size,
          mime: item.file.type || undefined,
        })
        const { promise, abort } = uploadAttachmentWithProgress(
          presigned,
          item.file,
          (loaded, total) => patchUpload(item.localId, { progress: total > 0 ? loaded / total : 0 }),
        )
        patchUpload(item.localId, { abort })
        const result = await promise
        patchUpload(item.localId, {
          status: "done",
          progress: 1,
          attachmentId: result.attachment_id,
          abort: undefined,
        })
      } catch (error) {
        if (error instanceof ApiError && error.code === "UPLOAD_ABORTED") return
        const message =
          error instanceof ApiError
            ? error.code === "FILE_TOO_LARGE"
              ? "文件超过本服务器单文件上限"
              : error.message
            : "上传失败"
        patchUpload(item.localId, { status: "error", error: message, abort: undefined })
      }
    },
    [channelId],
  )

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      setInlineError(null)
      const room = MAX_ATTACHMENTS - uploadsRef.current.length
      if (room <= 0) {
        setInlineError(`一条消息最多 ${MAX_ATTACHMENTS} 个附件`)
        return
      }
      const accepted = files.slice(0, room)
      if (files.length > room) {
        setInlineError(`一条消息最多 ${MAX_ATTACHMENTS} 个附件，多余的文件未加入`)
      }
      const items: UploadItem[] = accepted.map((file) => ({
        localId: crypto.randomUUID(),
        file,
        status: "uploading",
        progress: 0,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      }))
      setUploads((current) => [...current, ...items])
      // 加入即开始 presign + 直传（不等用户点发送）
      for (const item of items) void startUpload(item)
    },
    [startUpload],
  )

  const removeUpload = (localId: string) => {
    setUploads((items) => {
      const target = items.find((item) => item.localId === localId)
      target?.abort?.()
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return items.filter((item) => item.localId !== localId)
    })
  }

  // 拖拽入窗口
  useEffect(() => {
    let depth = 0
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return
      depth++
      setDragOver(true)
    }
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragOver(false)
    }
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault()
    }
    const onDrop = (event: DragEvent) => {
      depth = 0
      setDragOver(false)
      if (!event.dataTransfer?.files.length) return
      event.preventDefault()
      addFiles([...event.dataTransfer.files])
    }
    window.addEventListener("dragenter", onDragEnter)
    window.addEventListener("dragleave", onDragLeave)
    window.addEventListener("dragover", onDragOver)
    window.addEventListener("drop", onDrop)
    return () => {
      window.removeEventListener("dragenter", onDragEnter)
      window.removeEventListener("dragleave", onDragLeave)
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("drop", onDrop)
    }
  }, [addFiles])

  // -------------------------------------------------------------------------
  // typing 节流
  // -------------------------------------------------------------------------

  const reportTyping = () => {
    const now = Date.now()
    if (now - lastTypingRef.current < TYPING_THROTTLE_MS) return
    lastTypingRef.current = now
    void sendTyping(channelId).catch(() => undefined)
  }

  // -------------------------------------------------------------------------
  // @ 补全
  // -------------------------------------------------------------------------

  const mentionCandidates = useMemo(
    () => (mention ? filterMembers(members, mention.query) : []),
    [mention, members],
  )

  const refreshMentionFromCaret = () => {
    const root = editableRef.current
    if (!root) {
      setMention(null)
      return
    }
    const before = plainTextBeforeCaret(root)
    const matched = matchMentionQuery(before, before.length)
    setMention(matched)
    if (matched) setMentionIndex(0)
  }

  /** 在输入框光标处插入灰色 @chip，替换正在输入的 @query */
  const insertMention = (member: GuildMember) => {
    if (!mention) return
    const root = editableRef.current
    if (!root) return
    root.focus()

    // 已存在同一提及：只删掉正在打的 @query，不重复插 chip
    const already = serializeComposer(root).includes(`<@${member.user_id}>`)
    const queryLen = mention.query.length + 1 // 含 @
    deleteTextBeforeCaret(root, queryLen)

    if (!already) {
      const label = memberDisplayName(member) || member.username
      const chip = createMentionChip(member.user_id, label)
      insertNodeAtCaret(chip)
      insertTextAtCaret(" ")
    }

    setMention(null)
    syncValueFromDom()
    requestAnimationFrame(() => {
      root.focus()
      resize()
    })
  }

  // -------------------------------------------------------------------------
  // 发送
  // -------------------------------------------------------------------------

  const overCount = [...value].length - MAX_CONTENT
  const uploading = uploads.some((item) => item.status === "uploading")
  const failedUploads = uploads.filter((item) => item.status === "error")
  const doneAttachmentIds = uploads
    .filter((item) => item.status === "done" && item.attachmentId)
    .map((item) => item.attachmentId!)
  const canSend =
    cooldown <= 0 &&
    overCount <= 0 &&
    !uploading &&
    failedUploads.length === 0 &&
    (value.trim() !== "" || doneAttachmentIds.length > 0)

  const doSend = async () => {
    if (!canSend) return
    const root = editableRef.current
    const content = (root ? serializeComposer(root) : value).trim()
    const attachments = uploads
      .filter((item) => item.status === "done" && item.attachmentId)
      .map((item) => ({
        id: item.attachmentId!,
        filename: item.file.name,
        mime: item.file.type,
        size: item.file.size,
      }))
    setInlineError(null)
    // 先清空输入（乐观回显由 store 的 pending 队列负责）
    if (root) clearEditor(root)
    setValue("")
    setMention(null)
    for (const item of uploads) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    }
    setUploads([])
    onCancelReply()
    lastTypingRef.current = 0
    requestAnimationFrame(resize)
    try {
      await send(channelId, {
        content,
        replyToId: replyTo?.id,
        attachmentIds: attachments.map((attachment) => attachment.id),
        attachments,
      })
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 429) {
          setCooldown(error.retryAfterSeconds ?? 5)
          setInlineError("发送过快，请稍候")
          return
        }
        if (error.status === 403 || error.status === 404) {
          // 无权限/频道不可用：pending 重试无意义，直接移除并内联提示
          setInlineError(
            error.status === 403 ? error.message : "频道不可用，消息未能发送",
          )
          const pendingQueue = useMessagesStore.getState().pendingByChannel[channelId] ?? []
          const failed = pendingQueue.filter((item) => item.status === "failed")
          if (failed.length > 0) discardPending(channelId, failed[failed.length - 1].nonce)
          return
        }
      }
      // 其他错误：保留 failed pending 行供重试，无需内联提示
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (mention && mentionCandidates.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setMentionIndex((index) => (index + 1) % mentionCandidates.length)
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setMentionIndex(
          (index) => (index - 1 + mentionCandidates.length) % mentionCandidates.length,
        )
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        insertMention(mentionCandidates[mentionIndex])
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setMention(null)
        return
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void doSend()
      return
    }
    const root = editableRef.current
    if (event.key === "ArrowUp" && root && isEditorVisuallyEmpty(root)) {
      event.preventDefault()
      onEditLast()
      return
    }
    if (event.key === "Escape" && replyTo) {
      event.preventDefault()
      onCancelReply()
    }
  }

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const files: File[] = []
    for (const clipboardItem of event.clipboardData.items) {
      if (clipboardItem.kind === "file") {
        const file = clipboardItem.getAsFile()
        if (file) {
          // 剪贴板位图通常无文件名：命名 image.png
          files.push(
            file.name
              ? file
              : new File([file], "image.png", { type: file.type || "image/png" }),
          )
        }
      }
    }
    if (files.length > 0) {
      event.preventDefault()
      addFiles(files)
      return
    }
    // 纯文本粘贴，避免带入 HTML 破坏 chip 结构
    const text = event.clipboardData.getData("text/plain")
    if (text) {
      event.preventDefault()
      insertTextAtCaret(text)
      syncValueFromDom()
      resize()
      refreshMentionFromCaret()
      if (text.trim()) reportTyping()
    }
  }

  const pickFiles = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.multiple = true
    input.onchange = () => addFiles([...(input.files ?? [])])
    input.click()
  }

  return (
    <div className="relative shrink-0 px-4 pb-4">
      {/* 拖放遮罩 */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/80">
          <div className="rounded-2xl border-2 border-dashed border-primary px-10 py-8 text-center">
            <p className="text-lg font-semibold">拖放以上传到 #{channelName}</p>
            <p className="mt-1 text-sm text-muted-foreground">每条消息最多 10 个附件</p>
          </div>
        </div>
      )}

      {/* 内联错误 / 冷却提示 */}
      {(inlineError || cooldown > 0) && (
        <p className="pb-1 text-xs text-destructive" role="alert">
          {cooldown > 0 ? `发送过快，请稍候 ${cooldown} 秒` : inlineError}
        </p>
      )}

      {/* 回复条 */}
      {replyTo && (
        <div className="flex items-center justify-between rounded-t-lg border border-b-0 bg-muted/50 px-3 py-1.5 text-xs">
          <span className="flex min-w-0 items-center gap-1.5 truncate text-muted-foreground">
            正在回复
            {(() => {
              const isSystemAdmin = replyTo.type === MESSAGE_TYPE_SYSTEM_ADMIN
              // 临场超管：固定皇冠头像 + 名称，禁止回落到本人资料
              if (isSystemAdmin) {
                return (
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    <span
                      className="flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-600 text-white"
                      title="系统超级管理员"
                    >
                      <CrownIcon className="size-2.5 text-white" aria-hidden />
                    </span>
                    系统超级管理员
                  </span>
                )
              }
              const authorId = replyTo.author_id
              const m = members.find((item) => item.user_id === authorId)
              const name =
                resolveName(authorId) || replyTo.author_username
              const avatar = resolveProfileAssetUrl(m?.avatar_url)
              return (
                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                  {avatar ? (
                    <img
                      src={avatar}
                      alt=""
                      className="size-4 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[9px]">
                      {nameInitials(name)}
                    </span>
                  )}
                  @{name}
                </span>
              )
            })()}
          </span>
          <button
            type="button"
            aria-label="取消回复"
            onClick={onCancelReply}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}

      {/* 待发附件区 */}
      {uploads.length > 0 && (
        <div
          className={cn(
            "flex gap-2 overflow-x-auto border border-b-0 bg-muted/30 p-2",
            replyTo ? "" : "rounded-t-lg",
          )}
        >
          {uploads.map((item) => (
            <AttachmentTrayCard
              key={item.localId}
              item={item}
              onRemove={() => removeUpload(item.localId)}
            />
          ))}
        </div>
      )}

      {/* @ 补全面板（带头像）；chip 本身在输入框内渲染 */}
      {mention && mentionCandidates.length > 0 && (
        <div className="absolute bottom-full left-4 z-30 mb-1 w-72 rounded-lg border bg-popover p-1 shadow-lg">
          <p className="px-2 py-1 text-xs text-muted-foreground select-none">成员</p>
          {mentionCandidates.map((member, index) => {
            const name = memberDisplayName(member)
            const avatar = resolveProfileAssetUrl(member.avatar_url)
            return (
              <button
                key={member.user_id}
                type="button"
                onMouseEnter={() => setMentionIndex(index)}
                onClick={() => insertMention(member)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  index === mentionIndex && "bg-muted",
                )}
              >
                {avatar ? (
                  <img
                    src={avatar}
                    alt=""
                    className="size-6 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
                    {nameInitials(name)}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  @{member.username}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* 输入行：圆角灰底无边框；图标与输入区垂直居中 */}
      <div
        className={cn(
          "flex items-center gap-1 rounded-2xl border-0 bg-muted px-2 py-1.5",
          (replyTo || uploads.length > 0) && "rounded-t-none",
        )}
      >
        <button
          type="button"
          aria-label="添加附件"
          onClick={pickFiles}
          disabled={uploads.length >= MAX_ATTACHMENTS}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background/60 hover:text-foreground disabled:opacity-40"
          title={uploads.length >= MAX_ATTACHMENTS ? "一条消息最多 10 个附件" : "上传文件"}
        >
          <PlusIcon className="size-5" />
        </button>
        <div
          ref={editableRef}
          role="textbox"
          aria-multiline="true"
          aria-label={`给 #${channelName} 发消息`}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={`给 #${channelName} 发消息`}
          data-empty={value.trim() === "" ? "true" : "false"}
          onInput={() => {
            const next = syncValueFromDom()
            resize()
            refreshMentionFromCaret()
            if (next.trim() !== "") reportTyping()
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onClick={() => refreshMentionFromCaret()}
          onKeyUp={() => refreshMentionFromCaret()}
          className={cn(
            "max-h-56 min-h-9 flex-1 overflow-y-auto bg-transparent px-1 py-1.5 text-sm leading-6 outline-none",
            "whitespace-pre-wrap break-words",
            // 空内容时显示占位（含浏览器只剩 <br> 的情况）
            "data-[empty=true]:before:pointer-events-none",
            "data-[empty=true]:before:text-muted-foreground",
            "data-[empty=true]:before:content-[attr(data-placeholder)]",
          )}
        />
        <EmojiPickerPopover
          onPick={(emoji) => {
            const root = editableRef.current
            root?.focus()
            insertTextAtCaret(emoji)
            syncValueFromDom()
            resize()
          }}
        >
          <button
            type="button"
            aria-label="插入表情"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background/60 hover:text-foreground"
          >
            <SmileIcon className="size-5" />
          </button>
        </EmojiPickerPopover>
        <button
          type="button"
          aria-label="发送"
          onClick={() => void doSend()}
          disabled={!canSend}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-primary hover:bg-background/60 disabled:opacity-40"
          title={
            uploading
              ? "附件上传中…"
              : failedUploads.length > 0
                ? "有附件上传失败，移除或等待重试后再发送"
                : undefined
          }
        >
          <SendIcon className="size-5" />
        </button>
      </div>

      {/* 字数计数（接近/超出上限时显示） */}
      {[...value].length > MAX_CONTENT - 200 && (
        <p
          className={cn(
            "pt-0.5 text-right text-xs",
            overCount > 0 ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {overCount > 0 ? `-${overCount}` : `${[...value].length}/${MAX_CONTENT}`}
        </p>
      )}
    </div>
  )
}
