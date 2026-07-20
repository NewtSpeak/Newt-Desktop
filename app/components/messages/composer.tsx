// 消息输入区：多行自适应 textarea（Enter 发送 / Shift+Enter 换行）、4000 字计数、
// typing 节流上报（8s）、429 冷却倒计时、@成员补全面板、
// 附件三入口（+ 按钮 / 拖拽 / 粘贴图片）与 presign+直传进度。

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  FileIcon,
  PlusIcon,
  SendIcon,
  SmileIcon,
  XIcon,
} from "lucide-react"

import { presignAttachment, uploadAttachmentWithProgress } from "~/lib/api/attachments"
import { ApiError } from "~/lib/api/http"
import { sendTyping } from "~/lib/api/messages"
import type { GuildMember } from "~/lib/api/types"
import { cn } from "~/lib/utils"
import { useMembersStore } from "~/stores/members"
import { useMessagesStore, type ChatMessage } from "~/stores/messages"
import { formatBytes } from "./attachments"
import { EmojiPickerPopover } from "./emoji-picker"

const MAX_CONTENT = 4000
const MAX_ATTACHMENTS = 10
const TYPING_THROTTLE_MS = 8000

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
    .filter(
      (member) =>
        member.username.toLowerCase().includes(lowered) ||
        member.nickname.toLowerCase().includes(lowered),
    )
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

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastTypingRef = useRef(0)
  const uploadsRef = useRef(uploads)
  uploadsRef.current = uploads

  // 频道切换：清空本地输入态（上传中的先中止）
  useEffect(() => {
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
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`
  }

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

  const refreshMention = (text: string, caret: number) => {
    const matched = matchMentionQuery(text, caret)
    setMention(matched)
    if (matched) setMentionIndex(0)
  }

  const insertMention = (member: GuildMember) => {
    if (!mention) return
    const textarea = textareaRef.current
    const caret = textarea?.selectionStart ?? value.length
    const next = `${value.slice(0, mention.start)}<@${member.user_id}> ${value.slice(caret)}`
    setValue(next)
    setMention(null)
    requestAnimationFrame(() => {
      const position = mention.start + member.user_id.length + 4
      textarea?.focus()
      textarea?.setSelectionRange(position, position)
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
    const content = value.trim()
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

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
    if (event.key === "ArrowUp" && value === "") {
      event.preventDefault()
      onEditLast()
      return
    }
    if (event.key === "Escape" && replyTo) {
      event.preventDefault()
      onCancelReply()
    }
  }

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
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
          <span className="truncate text-muted-foreground">
            正在回复{" "}
            <span className="font-medium text-foreground">
              @{resolveName(replyTo.author_id) || replyTo.author_username}
            </span>
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

      {/* @ 补全面板 */}
      {mention && mentionCandidates.length > 0 && (
        <div className="absolute bottom-full left-4 z-30 mb-1 w-72 rounded-lg border bg-popover p-1 shadow-lg">
          <p className="px-2 py-1 text-xs text-muted-foreground select-none">成员</p>
          {mentionCandidates.map((member, index) => (
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
              <span className="font-medium">{member.nickname || member.username}</span>
              {member.nickname && (
                <span className="text-xs text-muted-foreground">@{member.username}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 输入行 */}
      <div
        className={cn(
          "flex items-end gap-1 rounded-lg border bg-background px-2 py-1.5",
          (replyTo || uploads.length > 0) && "rounded-t-none",
        )}
      >
        <button
          type="button"
          aria-label="添加附件"
          onClick={pickFiles}
          disabled={uploads.length >= MAX_ATTACHMENTS}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          title={uploads.length >= MAX_ATTACHMENTS ? "一条消息最多 10 个附件" : "上传文件"}
        >
          <PlusIcon className="size-5" />
        </button>
        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          placeholder={`给 #${channelName} 发消息`}
          aria-label={`给 #${channelName} 发消息`}
          onChange={(event) => {
            setValue(event.target.value)
            resize()
            refreshMention(event.target.value, event.target.selectionStart ?? 0)
            if (event.target.value.trim() !== "") reportTyping()
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onClick={(event) =>
            refreshMention(value, (event.target as HTMLTextAreaElement).selectionStart ?? 0)
          }
          className="max-h-56 min-h-9 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <EmojiPickerPopover onPick={(emoji) => setValue((current) => current + emoji)}>
          <button
            type="button"
            aria-label="插入表情"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <SmileIcon className="size-5" />
          </button>
        </EmojiPickerPopover>
        <button
          type="button"
          aria-label="发送"
          onClick={() => void doSend()}
          disabled={!canSend}
          className="rounded-md p-1.5 text-primary hover:bg-muted disabled:opacity-40"
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
