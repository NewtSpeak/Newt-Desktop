// 消息流列表：倒序渲染（新的在下）、日期分割线、同作者 7 分钟分组、
// 滚动到顶 before 翻页（prepend 滚动补偿）、底部粘滞自动滚动、
// 上翻时浮动「↓ N 条新消息」按钮、到头渲染频道欢迎块。

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowDownIcon, HashIcon } from "lucide-react"

import type { MentionResolver } from "~/lib/markdown"
import { compareSnowflake, useMessagesStore, type ChatMessage } from "~/stores/messages"
import { MessageRow, PendingRow } from "./message-item"

const GROUP_WINDOW_MS = 7 * 60 * 1000
/** 距顶部阈值：小于该值触发向上翻页 */
const LOAD_OLDER_THRESHOLD_PX = 300
/** 距底部阈值：小于该值视为「在底部」 */
const BOTTOM_THRESHOLD_PX = 60

function dayKey(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function DateDivider({ iso }: { iso: string }) {
  return (
    <div className="mx-4 mt-3 flex items-center gap-3" role="separator">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground select-none">{dayLabel(iso)}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

function WelcomeBlock({ channelName }: { channelName: string }) {
  return (
    <div className="flex flex-col gap-2 px-4 pt-10 pb-4">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <HashIcon className="size-7 text-muted-foreground" />
      </div>
      <p className="text-xl font-bold">欢迎来到 #{channelName}</p>
      <p className="text-sm text-muted-foreground">这里是 #{channelName} 频道的开始。</p>
    </div>
  )
}

export type MessageListProps = {
  channelId: string
  channelName: string
  selfId?: string
  selfName: string
  resolveName: MentionResolver
  editingId: string | null
  onStartEdit: (messageId: string) => void
  onStopEdit: () => void
  onReply: (message: ChatMessage) => void
  /** 搜索跳转锚点：定位到该消息并高亮闪烁 2s（docs 06 FR-18） */
  focusMessageId?: string | null
  /** 锚点定位完成（或目标不在列表中无法定位）后的回调，用于清理 URL 参数 */
  onFocusDone?: () => void
}

export function MessageList({
  channelId,
  channelName,
  selfId,
  selfName,
  resolveName,
  editingId,
  onStartEdit,
  onStopEdit,
  onReply,
  focusMessageId,
  onFocusDone,
}: MessageListProps) {
  const channel = useMessagesStore((state) => state.byChannel[channelId])
  const pending = useMessagesStore((state) => state.pendingByChannel[channelId])
  const loadOlder = useMessagesStore((state) => state.loadOlder)

  const messages = channel?.messages ?? []
  const pendingList = pending ?? []

  const containerRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const snapshotRef = useRef<{
    firstId: string | null
    lastId: string | null
    scrollHeight: number
    pendingCount: number
  } | null>(null)
  const [newCount, setNewCount] = useState(0)
  const [flashingId, setFlashingId] = useState<string | null>(null)

  const scrollToBottom = () => {
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // 频道切换：重置滚动状态
  useEffect(() => {
    stickRef.current = true
    snapshotRef.current = null
    setNewCount(0)
    scrollToBottom()
  }, [channelId])

  // 消息/待发变化后的滚动策略
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const firstId = messages[0]?.id ?? null
    const lastId = messages[messages.length - 1]?.id ?? null
    const previous = snapshotRef.current
    snapshotRef.current = {
      firstId,
      lastId,
      scrollHeight: el.scrollHeight,
      pendingCount: pendingList.length,
    }

    if (!previous) {
      scrollToBottom()
      return
    }
    // 本端发出乐观消息：无条件滚到底
    if (pendingList.length > previous.pendingCount) {
      stickRef.current = true
      scrollToBottom()
      return
    }
    // 向上翻页 prepend：保持视口内容不跳（补偿新增高度）
    if (
      firstId !== previous.firstId &&
      previous.firstId !== null &&
      messages.some((message) => message.id === previous.firstId)
    ) {
      el.scrollTop += el.scrollHeight - previous.scrollHeight
      return
    }
    // 底部追加新消息
    if (lastId !== previous.lastId && lastId !== null) {
      if (stickRef.current) {
        scrollToBottom()
      } else {
        const appendedCount = previous.lastId
          ? messages.filter((message) => compareSnowflake(message.id, previous.lastId!) > 0).length
          : 1
        setNewCount((count) => count + Math.max(1, appendedCount))
      }
    }
  }, [messages, pendingList.length])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distanceToBottom < BOTTOM_THRESHOLD_PX
    stickRef.current = atBottom
    if (atBottom && newCount > 0) setNewCount(0)
    if (el.scrollTop < LOAD_OLDER_THRESHOLD_PX && channel?.loadedInitial) {
      void loadOlder(channelId).catch(() => undefined)
    }
  }

  const jumpTo = (messageId: string, flashMs = 1200) => {
    const target = document.getElementById(`message-${messageId}`)
    if (!target) return false
    // 离开底部粘滞，避免新消息到达时把定位拉回底部
    stickRef.current = false
    target.scrollIntoView({ block: "center" })
    setFlashingId(messageId)
    setTimeout(() => setFlashingId((current) => (current === messageId ? null : current)), flashMs)
    return true
  }

  // 搜索跳转锚点：消息渲染到列表后定位并高亮 2s
  useEffect(() => {
    if (!focusMessageId) return
    if (!messages.some((message) => message.id === focusMessageId)) return
    jumpTo(focusMessageId, 2000)
    onFocusDone?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMessageId, messages])

  // 渲染列表：日期分割线 + 分组
  const rows: React.ReactNode[] = []
  let previousMessage: ChatMessage | null = null
  for (const message of messages) {
    if (!previousMessage || dayKey(previousMessage.created_at) !== dayKey(message.created_at)) {
      rows.push(<DateDivider key={`divider-${message.id}`} iso={message.created_at} />)
    }
    const grouped =
      previousMessage !== null &&
      previousMessage.author_id === message.author_id &&
      dayKey(previousMessage.created_at) === dayKey(message.created_at) &&
      new Date(message.created_at).getTime() - new Date(previousMessage.created_at).getTime() <
        GROUP_WINDOW_MS
    rows.push(
      <MessageRow
        key={message.id}
        message={message}
        channelId={channelId}
        grouped={grouped}
        selfId={selfId}
        resolveName={resolveName}
        editing={editingId === message.id}
        onStartEdit={onStartEdit}
        onStopEdit={onStopEdit}
        onReply={onReply}
        onJump={jumpTo}
        flashing={flashingId === message.id}
      />,
    )
    previousMessage = message
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain pb-4"
        role="log"
        aria-label={`#${channelName} 的消息`}
      >
        {channel?.reachedStart && <WelcomeBlock channelName={channelName} />}
        {channel?.loadingOlder && (
          <p className="py-2 text-center text-xs text-muted-foreground">加载更早的消息…</p>
        )}
        {channel?.loadingInitial && !channel.loadedInitial && (
          <p className="py-8 text-center text-sm text-muted-foreground">消息加载中…</p>
        )}
        {rows}
        {pendingList.map((item) => (
          <PendingRow
            key={item.nonce}
            nonce={item.nonce}
            channelId={channelId}
            content={item.content}
            attachments={item.attachments}
            status={item.status}
            errorMessage={item.errorMessage}
            selfName={selfName}
            selfId={selfId}
            resolveName={resolveName}
          />
        ))}
      </div>
      {newCount > 0 && (
        <button
          type="button"
          onClick={() => {
            stickRef.current = true
            setNewCount(0)
            scrollToBottom()
          }}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-md hover:bg-primary/90"
        >
          <ArrowDownIcon className="size-3.5" />
          {newCount} 条新消息
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// typing 指示
// ---------------------------------------------------------------------------

export function TypingIndicator({
  channelId,
  resolveName,
}: {
  channelId: string
  resolveName: MentionResolver
}) {
  const typing = useMessagesStore((state) => state.typingByChannel[channelId])
  const [, forceTick] = useState(0)

  // 周期检查过期（store 只存过期时间戳，渲染时过滤）
  useEffect(() => {
    if (!typing || Object.keys(typing).length === 0) return
    const timer = setInterval(() => forceTick((tick) => tick + 1), 1000)
    return () => clearInterval(timer)
  }, [typing])

  const now = Date.now()
  const activeIds = typing
    ? Object.entries(typing)
        .filter(([, expiresAt]) => expiresAt > now)
        .map(([userId]) => userId)
    : []

  if (activeIds.length === 0) return <div className="h-5" aria-hidden />

  let text: string
  if (activeIds.length === 1) {
    text = `${resolveName(activeIds[0])} 正在输入…`
  } else if (activeIds.length <= 3) {
    text = `${activeIds.map((userId) => resolveName(userId)).join("、")} 正在输入…`
  } else {
    text = "多人正在输入…"
  }

  return (
    <p className="h-5 truncate px-4 text-xs text-muted-foreground" aria-live="polite">
      {text}
    </p>
  )
}
