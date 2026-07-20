// 单条消息渲染：作者分组首条/后续两种形态、悬停操作条（反应/回复/编辑/删除）、
// 反应胶囊、内联编辑态、回复引用摘要、(已编辑) 标记、本人被提及高亮。

import { useEffect, useRef, useState } from "react"
import { CornerUpLeftIcon, PencilIcon, SmilePlusIcon, Trash2Icon } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Button } from "~/components/ui/button"
import { ApiError } from "~/lib/api/http"
import { MarkdownContent, contentMentionsUser, type MentionResolver } from "~/lib/markdown"
import { cn } from "~/lib/utils"
import { useMessagesStore, type ChatMessage } from "~/stores/messages"
import { MessageAttachments } from "./attachments"
import { EmojiPickerPopover } from "./emoji-picker"

// ---------------------------------------------------------------------------
// 时间格式
// ---------------------------------------------------------------------------

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function shortTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
}

/** 组首条的「今天 14:32」式时间 */
export function groupTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const time = shortTime(iso)
  if (sameDay(date, now)) return `今天 ${time}`
  if (sameDay(date, yesterday)) return `昨天 ${time}`
  return `${date.toLocaleDateString("zh-CN")} ${time}`
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN")
}

// ---------------------------------------------------------------------------
// 头像（成员数据无头像 URL：首字符色块）
// ---------------------------------------------------------------------------

const AVATAR_COLORS = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-cyan-500",
  "bg-blue-500",
  "bg-violet-500",
  "bg-fuchsia-500",
]

function AuthorAvatar({ userId, name }: { userId: string; name: string }) {
  let hash = 0
  for (let index = 0; index < userId.length; index++) {
    hash = (hash * 31 + userId.charCodeAt(index)) | 0
  }
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white select-none",
        color,
      )}
      aria-hidden
    >
      {(name || "?").slice(0, 1).toUpperCase()}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 反应胶囊
// ---------------------------------------------------------------------------

function ReactionPills({
  message,
  channelId,
  selfId,
}: {
  message: ChatMessage
  channelId: string
  selfId?: string
}) {
  const toggleReaction = useMessagesStore((state) => state.toggleReaction)
  const [pickerOpen, setPickerOpen] = useState(false)
  if (message.reactions.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {message.reactions.map((entry) => {
        const mine = selfId !== undefined && entry.userIds.includes(selfId)
        return (
          <button
            key={entry.emoji}
            type="button"
            aria-label={`${entry.emoji} 反应，共 ${entry.userIds.length} 人${mine ? "，包含你" : ""}`}
            onClick={() => void toggleReaction(channelId, message.id, entry.emoji).catch(() => undefined)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm transition-colors",
              mine
                ? "border-primary/50 bg-primary/10"
                : "border-transparent bg-muted hover:border-border",
            )}
          >
            <span>{entry.emoji}</span>
            <span className="text-xs text-muted-foreground">{entry.userIds.length}</span>
          </button>
        )
      })}
      <EmojiPickerPopover
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(emoji) => void toggleReaction(channelId, message.id, emoji).catch(() => undefined)}
      >
        <button
          type="button"
          aria-label="添加反应"
          className="rounded-full border border-transparent bg-muted px-2 py-0.5 text-sm text-muted-foreground hover:border-border hover:text-foreground"
        >
          +
        </button>
      </EmojiPickerPopover>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 内联编辑框
// ---------------------------------------------------------------------------

function InlineEditor({
  channelId,
  message,
  onDone,
}: {
  channelId: string
  message: ChatMessage
  onDone: () => void
}) {
  const edit = useMessagesStore((state) => state.edit)
  const [value, setValue] = useState(message.content)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const textarea = ref.current
    if (textarea) {
      textarea.focus()
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      textarea.style.height = "auto"
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }, [])

  const save = async () => {
    const content = value.trim()
    if (content === "" && message.attachments.length === 0) return
    if (content === message.content) {
      onDone()
      return
    }
    setSaving(true)
    setError(null)
    try {
      await edit(channelId, message.id, content)
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "编辑失败，请重试")
      setSaving(false)
    }
  }

  return (
    <div className="mt-0.5">
      <textarea
        ref={ref}
        value={value}
        disabled={saving}
        onChange={(event) => {
          setValue(event.target.value)
          event.target.style.height = "auto"
          event.target.style.height = `${event.target.scrollHeight}px`
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            void save()
          } else if (event.key === "Escape") {
            event.preventDefault()
            onDone()
          }
        }}
        rows={1}
        maxLength={4000}
        className="w-full resize-none rounded-lg border bg-muted/40 px-3 py-2 text-sm outline-none focus:border-ring"
        aria-label="编辑消息"
      />
      <p className="mt-0.5 text-xs text-muted-foreground">
        Esc <span className="text-foreground/70">取消</span> · Enter{" "}
        <span className="text-foreground/70">保存</span>
        {error && <span className="ml-2 text-destructive">{error}</span>}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 悬停操作条
// ---------------------------------------------------------------------------

function HoverActions({
  message,
  channelId,
  isOwn,
  onReply,
  onEdit,
}: {
  message: ChatMessage
  channelId: string
  isOwn: boolean
  onReply: () => void
  onEdit: () => void
}) {
  const toggleReaction = useMessagesStore((state) => state.toggleReaction)
  const remove = useMessagesStore((state) => state.remove)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const doDelete = async () => {
    try {
      await remove(channelId, message.id)
      setConfirmOpen(false)
    } catch (error) {
      // 服务端裁决：对他人消息无 MANAGE_MESSAGES 时收敛为通用提示
      setDeleteError(error instanceof ApiError ? error.message : "删除失败，请重试")
    }
  }

  const iconButton =
    "rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"

  return (
    <>
      <div
        className={cn(
          "absolute -top-3.5 right-4 hidden items-center gap-0.5 rounded-lg border bg-background p-0.5 shadow-sm group-hover/message:flex",
          pickerOpen && "flex",
        )}
      >
        <EmojiPickerPopover
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onPick={(emoji) =>
            void toggleReaction(channelId, message.id, emoji).catch(() => undefined)
          }
        >
          <button type="button" aria-label="添加反应" className={iconButton}>
            <SmilePlusIcon className="size-4" />
          </button>
        </EmojiPickerPopover>
        <button type="button" aria-label="回复" className={iconButton} onClick={onReply}>
          <CornerUpLeftIcon className="size-4" />
        </button>
        {isOwn && (
          <button type="button" aria-label="编辑" className={iconButton} onClick={onEdit}>
            <PencilIcon className="size-4" />
          </button>
        )}
        <button
          type="button"
          aria-label="删除"
          className={cn(iconButton, "hover:text-destructive")}
          onClick={(event) => {
            // Shift+点击跳过确认
            if (event.shiftKey) void doDelete()
            else {
              setDeleteError(null)
              setConfirmOpen(true)
            }
          }}
        >
          <Trash2Icon className="size-4" />
        </button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除消息</DialogTitle>
            <DialogDescription>
              确定要删除这条消息吗？此操作无法撤销。
              {!isOwn && (
                <span className="mt-1 block text-amber-600 dark:text-amber-400">
                  你正在删除他人消息，该操作将被记录。
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-32 overflow-y-auto rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium">{message.author_username}：</span>
            {message.content ? (
              <span className="whitespace-pre-wrap break-words">{message.content}</span>
            ) : (
              <span className="text-muted-foreground">[附件消息]</span>
            )}
          </div>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void doDelete()}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// 回复引用摘要条
// ---------------------------------------------------------------------------

function ReplyPreview({
  replyToId,
  channelId,
  resolveName,
  onJump,
}: {
  replyToId: string
  channelId: string
  resolveName: MentionResolver
  onJump: (messageId: string) => void
}) {
  const referenced = useMessagesStore((state) =>
    state.byChannel[channelId]?.messages.find((message) => message.id === replyToId),
  )
  if (!referenced) {
    return (
      <p className="mb-0.5 flex items-center gap-1 pl-11 text-xs text-muted-foreground italic">
        <CornerUpLeftIcon className="size-3" />
        原消息已删除
      </p>
    )
  }
  const name = resolveName(referenced.author_id) || referenced.author_username
  return (
    <button
      type="button"
      onClick={() => onJump(referenced.id)}
      className="mb-0.5 flex min-w-0 max-w-full items-center gap-1 pl-11 text-xs text-muted-foreground hover:text-foreground"
    >
      <CornerUpLeftIcon className="size-3 shrink-0" />
      <span className="shrink-0 font-medium text-foreground/80">@{name}</span>
      <span className="truncate">
        {referenced.content || (referenced.attachments.length > 0 ? "[附件]" : "")}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// 消息行
// ---------------------------------------------------------------------------

export type MessageRowProps = {
  message: ChatMessage
  channelId: string
  /** 与上一条同作者且间隔 < 7 分钟：合并进组，不显示头像行 */
  grouped: boolean
  selfId?: string
  resolveName: MentionResolver
  editing: boolean
  onStartEdit: (messageId: string) => void
  onStopEdit: () => void
  onReply: (message: ChatMessage) => void
  onJump: (messageId: string) => void
  /** 跳转定位后的闪烁高亮 */
  flashing: boolean
}

export function MessageRow({
  message,
  channelId,
  grouped,
  selfId,
  resolveName,
  editing,
  onStartEdit,
  onStopEdit,
  onReply,
  onJump,
  flashing,
}: MessageRowProps) {
  const isOwn = selfId !== undefined && message.author_id === selfId
  const mentioned = selfId !== undefined && contentMentionsUser(message.content, selfId)
  const displayName = resolveName(message.author_id) || message.author_username || "未知用户"
  const showHeader = !grouped || Boolean(message.reply_to_id)

  return (
    <div
      id={`message-${message.id}`}
      className={cn(
        "group/message relative px-4 py-0.5 transition-colors hover:bg-muted/40",
        showHeader && "mt-2.5",
        mentioned && "bg-amber-500/10 hover:bg-amber-500/15",
        flashing && "animate-pulse bg-primary/15",
      )}
    >
      {message.reply_to_id && (
        <ReplyPreview
          replyToId={message.reply_to_id}
          channelId={channelId}
          resolveName={resolveName}
          onJump={onJump}
        />
      )}
      <div className="flex gap-2.5">
        {showHeader ? (
          <AuthorAvatar userId={message.author_id} name={displayName} />
        ) : (
          <span className="w-9 shrink-0 pt-0.5 text-right text-[10px] leading-5 text-muted-foreground opacity-0 select-none group-hover/message:opacity-100">
            {shortTime(message.created_at)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {showHeader && (
            <p className="flex items-baseline gap-2 leading-5">
              <span className="text-sm font-semibold">{displayName}</span>
              <span className="text-xs text-muted-foreground" title={fullTime(message.created_at)}>
                {groupTime(message.created_at)}
              </span>
            </p>
          )}
          {editing ? (
            <InlineEditor channelId={channelId} message={message} onDone={onStopEdit} />
          ) : (
            <div className="text-sm">
              {message.content && (
                <span className="inline-block w-full align-top">
                  <MarkdownContent
                    content={message.content}
                    resolveMention={resolveName}
                    selfId={selfId}
                  />
                </span>
              )}
              {message.edit_count > 0 && (
                <span
                  className="ml-1 align-baseline text-[10px] text-muted-foreground select-none"
                  title={`已编辑 ×${message.edit_count}${message.edited_at ? `，最后编辑 ${fullTime(message.edited_at)}` : ""}`}
                >
                  (已编辑)
                </span>
              )}
            </div>
          )}
          <MessageAttachments attachments={message.attachments} />
          <ReactionPills message={message} channelId={channelId} selfId={selfId} />
        </div>
      </div>
      {!editing && (
        <HoverActions
          message={message}
          channelId={channelId}
          isOwn={isOwn}
          onReply={() => onReply(message)}
          onEdit={() => onStartEdit(message.id)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 乐观 / 失败消息行
// ---------------------------------------------------------------------------

export function PendingRow({
  nonce,
  channelId,
  content,
  attachments,
  status,
  errorMessage,
  selfName,
  selfId,
  resolveName,
}: {
  nonce: string
  channelId: string
  content: string
  attachments: { id: string; filename: string }[]
  status: "sending" | "failed"
  errorMessage?: string
  selfName: string
  selfId?: string
  resolveName: MentionResolver
}) {
  const retryPending = useMessagesStore((state) => state.retryPending)
  const discardPending = useMessagesStore((state) => state.discardPending)
  const failed = status === "failed"

  return (
    <div className={cn("mt-2.5 px-4 py-0.5", failed ? "" : "opacity-50")}>
      <div className="flex gap-2.5">
        <AuthorAvatar userId={selfId ?? "self"} name={selfName} />
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2 leading-5">
            <span className="text-sm font-semibold">{selfName}</span>
            <span className="text-xs text-muted-foreground">
              {failed ? "发送失败" : "发送中…"}
            </span>
          </p>
          <div className={cn("text-sm", failed && "text-destructive")}>
            {content && (
              <MarkdownContent content={content} resolveMention={resolveName} selfId={selfId} />
            )}
            {attachments.length > 0 && (
              <p className="text-xs text-muted-foreground">
                [{attachments.map((attachment) => attachment.filename).join("、")}]
              </p>
            )}
          </div>
          {failed && (
            <p className="mt-0.5 flex items-center gap-2 text-xs">
              <span className="text-destructive">{errorMessage ?? "发送失败"}</span>
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => void retryPending(channelId, nonce).catch(() => undefined)}
              >
                重试
              </button>
              <button
                type="button"
                className="font-medium text-muted-foreground hover:underline"
                onClick={() => discardPending(channelId, nonce)}
              >
                删除
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
