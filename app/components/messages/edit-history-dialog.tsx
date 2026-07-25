// 消息编辑历史弹窗（docs 05 FR-36 / Server AS.5）：
// 作者、MANAGE_MESSAGES、系统管理员可查看全文快照；内容渲染与信息流一致。

import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  Code2Icon,
  HistoryIcon,
  Loader2Icon,
  TypeIcon,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { listMessageEdits } from "~/lib/api/messages"
import { ApiError } from "~/lib/api/http"
import type { MessageEdit } from "~/lib/api/types"
import type { MentionResolver } from "~/lib/markdown"
import { cn } from "~/lib/utils"
import type { ChatMessage } from "~/stores/messages"
import { MessageContent } from "./message-content"

function formatEditTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function EditSnapshotBody({
  content,
  plainText,
  resolveName,
  resolveAvatarUrl,
  selfId,
  guildId,
  className,
}: {
  content: string
  /** 展示 wire 原文（Markdown / `<e:…>` 等），不做富文本渲染 */
  plainText: boolean
  resolveName: MentionResolver
  resolveAvatarUrl?: (userId: string) => string | undefined
  selfId?: string
  guildId?: string
  className?: string
}) {
  const raw = content ?? ""
  const trimmed = raw.trim()
  if (!trimmed) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>（空正文）</p>
    )
  }
  if (plainText) {
    return (
      <pre
        className={cn(
          "max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-background/60 px-2.5 py-2 font-mono text-[12px] leading-relaxed text-foreground/90",
          className,
        )}
      >
        {raw}
      </pre>
    )
  }
  return (
    <div className={cn("text-sm", className)}>
      <MessageContent
        content={content}
        resolveMention={resolveName}
        resolveMentionAvatar={resolveAvatarUrl}
        selfId={selfId}
        guildId={guildId}
      />
    </div>
  )
}

/** 单张历史卡片：标题行 + 纯文本切换 + 正文 */
function EditHistoryCard({
  title,
  subtitle,
  timeIso,
  content,
  resolveName,
  resolveAvatarUrl,
  selfId,
  guildId,
  tone = "muted",
  animationDelayMs,
}: {
  title: ReactNode
  subtitle?: ReactNode
  timeIso?: string
  content: string
  resolveName: MentionResolver
  resolveAvatarUrl?: (userId: string) => string | undefined
  selfId?: string
  guildId?: string
  tone?: "current" | "muted"
  animationDelayMs?: number
}) {
  const [plainText, setPlainText] = useState(false)
  const hasContent = Boolean(content?.trim())

  return (
    <section
      className={cn(
        "rounded-2xl px-3.5 py-3",
        tone === "current" ? "bg-primary/5" : "bg-muted/40",
        "animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both duration-200",
      )}
      style={
        animationDelayMs != null
          ? { animationDelay: `${animationDelayMs}ms` }
          : undefined
      }
    >
      <header className="mb-1.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="font-medium text-foreground/80">{title}</span>
            {subtitle}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {timeIso ? (
            <time className="tabular-nums" dateTime={timeIso}>
              {formatEditTime(timeIso)}
            </time>
          ) : null}
          <button
            type="button"
            disabled={!hasContent}
            aria-pressed={plainText}
            title={plainText ? "切换为富文本预览" : "查看纯文本（wire 原文）"}
            onClick={() => setPlainText((v) => !v)}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              "disabled:pointer-events-none disabled:opacity-40",
              plainText
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            {plainText ? (
              <>
                <TypeIcon className="size-3" />
                富文本
              </>
            ) : (
              <>
                <Code2Icon className="size-3" />
                纯文本
              </>
            )}
          </button>
        </div>
      </header>
      <EditSnapshotBody
        content={content}
        plainText={plainText}
        resolveName={resolveName}
        resolveAvatarUrl={resolveAvatarUrl}
        selfId={selfId}
        guildId={guildId}
      />
    </section>
  )
}

export function EditHistoryDialog({
  open,
  onOpenChange,
  channelId,
  message,
  resolveName,
  resolveAvatarUrl,
  selfId,
  guildId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  channelId: string
  message: ChatMessage
  resolveName: MentionResolver
  resolveAvatarUrl?: (userId: string) => string | undefined
  selfId?: string
  guildId?: string
}) {
  const [edits, setEdits] = useState<MessageEdit[] | null>(null)
  const [editCount, setEditCount] = useState<number>(message.edit_count ?? 0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void listMessageEdits(channelId, message.id)
      .then((res) => {
        if (cancelled) return
        setEdits(res.edits ?? [])
        if (typeof res.edit_count === "number") {
          setEditCount(res.edit_count)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setEdits(null)
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "加载编辑历史失败",
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, channelId, message.id])

  // 历史快照：服务端按 version ASC 存「编辑前」正文；展示时新→旧
  const sortedEdits = useMemo(
    () =>
      (edits ?? [])
        .slice()
        .sort((a, b) => b.version - a.version),
    [edits],
  )

  const gId = guildId ?? message.guild_id

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // 动画弹窗：加长时长 + 滑入，列表项 stagger 见下方
          "sm:max-w-lg gap-4 duration-200",
          "data-open:zoom-in-95 data-open:slide-in-from-bottom-2",
          "data-closed:zoom-out-95 data-closed:slide-out-to-bottom-2",
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HistoryIcon className="size-4 text-muted-foreground" />
            编辑历史
          </DialogTitle>
          <DialogDescription>
            每次编辑保存全文快照（编辑前版本）。共编辑{" "}
            <span className="tabular-nums font-medium text-foreground">
              {editCount}
            </span>{" "}
            次；可切换「纯文本」查看 wire 原文。
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[min(28rem,60vh)] min-h-0 flex-col gap-3 overflow-y-auto pr-0.5">
          <EditHistoryCard
            title="当前版本"
            timeIso={message.edited_at}
            content={message.content}
            resolveName={resolveName}
            resolveAvatarUrl={resolveAvatarUrl}
            selfId={selfId}
            guildId={gId}
            tone="current"
            animationDelayMs={40}
          />

          {loading ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              加载历史版本…
            </p>
          ) : null}

          {error ? (
            <p className="rounded-2xl bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {!loading && !error && sortedEdits.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              暂无历史版本记录
            </p>
          ) : null}

          {!loading &&
            sortedEdits.map((edit, index) => (
              <EditHistoryCard
                key={`${edit.message_id}-${edit.version}`}
                title={
                  <>
                    版本{" "}
                    <span className="tabular-nums">{edit.version}</span>
                  </>
                }
                subtitle={
                  <span className="text-muted-foreground/70">· 编辑前快照</span>
                }
                timeIso={edit.edited_at}
                content={edit.content}
                resolveName={resolveName}
                resolveAvatarUrl={resolveAvatarUrl}
                selfId={selfId}
                guildId={gId}
                tone="muted"
                animationDelayMs={80 + index * 45}
              />
            ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
