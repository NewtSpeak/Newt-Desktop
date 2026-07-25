// 消息流列表：倒序渲染（新的在下）、日期分割线、同作者 7 分钟分组、
// 滚动到顶 before 翻页（prepend 滚动补偿）、底部粘滞自动滚动、
// 上翻时浮动「↓ N 条新消息」按钮、到头渲染频道欢迎块。

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { ArrowDownIcon, HashIcon } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { TooltipProvider } from "~/components/ui/tooltip"
import { UserProfilePopover } from "~/components/user-profile-popover"
import type { MentionResolver } from "~/lib/markdown"
import { nameInitials } from "~/lib/user-display"
import { cn } from "~/lib/utils"
import {
  compareSnowflake,
  useMessagesStore,
  type ChatMessage,
} from "~/stores/messages"
import { useReadStatesStore } from "~/stores/read-states"
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
    <div className="mx-4 mt-3 flex items-center justify-center" role="separator">
      <span className="text-xs text-muted-foreground select-none">
        {dayLabel(iso)}
      </span>
    </div>
  )
}

/** 「新消息」标记（docs 15 FR-06/UX-03）— 仅保留徽章，不画横向线 */
function NewMessagesDivider() {
  return (
    <div
      className="mx-4 mt-2 flex items-center justify-center"
      role="separator"
      aria-label="新消息"
    >
      <span className="rounded-sm bg-red-500 px-1 text-[9px] font-bold text-white select-none">
        新消息
      </span>
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
      <p className="text-sm text-muted-foreground">
        这里是 #{channelName} 频道的开始。
      </p>
    </div>
  )
}

export type MessageListProps = {
  channelId: string
  guildId?: string
  channelName: string
  selfId?: string
  selfName: string
  resolveName: MentionResolver
  resolveAvatarUrl?: (userId: string) => string | undefined
  editingId: string | null
  onStartEdit: (messageId: string) => void
  onStopEdit: () => void
  onReply: (message: ChatMessage) => void
  /** 搜索跳转锚点：定位到该消息并高亮闪烁 2s（docs 06 FR-18） */
  focusMessageId?: string | null
  /** 锚点定位完成（或目标不在列表中无法定位）后的回调，用于清理 URL 参数 */
  onFocusDone?: () => void
  /**
   * 底部悬浮输入区高度（px）。列表底部留白，避免最后几条消息被毛玻璃 Composer 挡住。
   */
  bottomInset?: number
}

function MessageList({
  channelId,
  guildId,
  channelName,
  selfId,
  selfName,
  resolveName,
  resolveAvatarUrl,
  editingId,
  onStartEdit,
  onStopEdit,
  onReply,
  focusMessageId,
  onFocusDone,
  bottomInset = 0,
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
    /** 末条 content 长度：流式增长时 id 不变，用于贴底跟随 */
    lastContentLen: number
  } | null>(null)
  const [newCount, setNewCount] = useState(0)
  const [flashingId, setFlashingId] = useState<string | null>(null)

  // 进入频道时捕获一次 last_read（组件按频道 key 重挂载）：
  // 「新消息」分割线按该快照定位，停留期间不跳动（docs 15 FR-06）
  const [entryLastRead] = useState<string | null>(
    () => useReadStatesStore.getState().lastReadByChannel[channelId] ?? null
  )

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  /** 已读推进（docs 15 FR-02）：处于底部且窗口聚焦时 ack（store 内 1s 节流） */
  const ackIfAtBottom = () => {
    if (!stickRef.current) return
    if (typeof document !== "undefined" && !document.hasFocus()) return
    useReadStatesStore.getState().ack(channelId)
  }

  // 频道切换：重置滚动状态
  useEffect(() => {
    stickRef.current = true
    snapshotRef.current = null
    setNewCount(0)
    scrollToBottom()
  }, [channelId])

  // 消息变化且在底部 → 推进已读；窗口重新聚焦时同样补一次
  useEffect(() => {
    ackIfAtBottom()
    const onFocus = () => ackIfAtBottom()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, channelId])

  // 频道切走（卸载）时 ack 一次当前已知最新（FR-02 切频落点）
  useEffect(() => {
    return () => {
      useReadStatesStore.getState().ack(channelId)
    }
  }, [channelId])

  // 消息/待发变化后的滚动策略
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const firstId = messages[0]?.id ?? null
    const last = messages[messages.length - 1]
    const lastId = last?.id ?? null
    // 末条正文长度：流式 delta 增长时 id 不变，需据此贴底
    const lastContentLen = last?.content?.length ?? 0
    const previous = snapshotRef.current
    snapshotRef.current = {
      firstId,
      lastId,
      scrollHeight: el.scrollHeight,
      pendingCount: pendingList.length,
      lastContentLen,
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
          ? messages.filter(
              (message) => compareSnowflake(message.id, previous.lastId!) > 0
            ).length
          : 1
        setNewCount((count) => count + Math.max(1, appendedCount))
      }
      return
    }
    // 同一条末消息内容增长（AI 流式）：贴底时跟随滚到底，上翻时不打扰
    if (
      stickRef.current &&
      lastId !== null &&
      lastId === previous.lastId &&
      (lastContentLen !== previous.lastContentLen ||
        el.scrollHeight !== previous.scrollHeight)
    ) {
      scrollToBottom()
    }
  }, [messages, pendingList.length])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distanceToBottom < BOTTOM_THRESHOLD_PX
    stickRef.current = atBottom
    if (atBottom && newCount > 0) setNewCount(0)
    if (atBottom) ackIfAtBottom()
    if (el.scrollTop < LOAD_OLDER_THRESHOLD_PX && channel?.loadedInitial) {
      void loadOlder(channelId).catch(() => undefined)
    }
  }

  const jumpTo = useCallback((messageId: string, flashMs = 1200) => {
    const target = document.getElementById(`message-${messageId}`)
    if (!target) return false
    // 离开底部粘滞，避免新消息到达时把定位拉回底部
    stickRef.current = false
    target.scrollIntoView({ block: "center" })
    setFlashingId(messageId)
    setTimeout(
      () =>
        setFlashingId((current) => (current === messageId ? null : current)),
      flashMs
    )
    return true
  }, [])

  // 搜索跳转锚点：消息渲染到列表后定位并高亮 2s
  useEffect(() => {
    if (!focusMessageId) return
    if (!messages.some((message) => message.id === focusMessageId)) return
    jumpTo(focusMessageId, 2000)
    onFocusDone?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMessageId, messages])

  // 渲染列表：日期分割线 + 新消息分割线 + 分组
  const rows: React.ReactNode[] = []
  let previousMessage: ChatMessage | null = null
  let newDividerPlaced = false
  for (const message of messages) {
    if (
      !previousMessage ||
      dayKey(previousMessage.created_at) !== dayKey(message.created_at)
    ) {
      rows.push(
        <DateDivider key={`divider-${message.id}`} iso={message.created_at} />
      )
    }
    // 「新消息」分割线：进频时快照的 last_read 之后第一条消息上方（一次性定位）
    if (
      !newDividerPlaced &&
      entryLastRead !== null &&
      compareSnowflake(message.id, entryLastRead) > 0
    ) {
      newDividerPlaced = true
      // 全部消息都已读时不会走到这里；自己刚发的消息不标新
      if (message.author_id !== selfId) {
        rows.push(<NewMessagesDivider key={`new-${message.id}`} />)
      }
    }
    // 系统管理员临场发言不与普通消息合并分组，保证皇冠头像 + 徽章始终可见。
    // type 空/缺省归一，避免 pending 转正时字段差异拆组导致头像闪一下。
    const normalizeType = (type: string | undefined) => type?.trim() || ""
    const sameType =
      normalizeType(previousMessage?.type) === normalizeType(message.type)
    const timeDelta =
      previousMessage !== null
        ? new Date(message.created_at).getTime() -
          new Date(previousMessage.created_at).getTime()
        : Number.POSITIVE_INFINITY
    const grouped =
      previousMessage !== null &&
      String(previousMessage.author_id) === String(message.author_id) &&
      sameType &&
      dayKey(previousMessage.created_at) === dayKey(message.created_at) &&
      (Number.isFinite(timeDelta) ? timeDelta < GROUP_WINDOW_MS : true)
    rows.push(
      <MessageRow
        key={message.id}
        message={message}
        channelId={channelId}
        guildId={guildId}
        grouped={grouped}
        selfId={selfId}
        resolveName={resolveName}
        resolveAvatarUrl={resolveAvatarUrl}
        editing={editingId === message.id}
        onStartEdit={onStartEdit}
        onStopEdit={onStopEdit}
        onReply={onReply}
        onJump={jumpTo}
        flashing={flashingId === message.id}
      />
    )
    previousMessage = message
  }

  const padBottom = Math.max(bottomInset, 16)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain"
        style={{ paddingBottom: padBottom }}
        role="log"
        aria-label={`#${channelName} 的消息`}
      >
        {channel?.reachedStart && <WelcomeBlock channelName={channelName} />}
        {channel?.loadingOlder && (
          <p className="py-2 text-center text-xs text-muted-foreground">
            加载更早的消息…
          </p>
        )}
        {channel?.loadingInitial &&
          !channel.loadedInitial &&
          messages.length === 0 && (
            <p className="py-2 text-center text-sm text-muted-foreground">
              消息加载中…
            </p>
          )}
        {rows}
        {pendingList.map((item, index) => {
          // 与上一条正式消息 / 上一条 pending 合并：连发时不重复出头像
          const prevMessage =
            index === 0 ? (messages[messages.length - 1] ?? null) : null
          const prevPending = index > 0 ? pendingList[index - 1] : null
          const prevTime = prevMessage
            ? new Date(prevMessage.created_at).getTime()
            : NaN
          // 时间解析失败时偏向合并，避免连发误拆分组露出文字头像
          const withinWindow =
            !Number.isFinite(prevTime) ||
            Date.now() - prevTime < GROUP_WINDOW_MS
          const groupedWithPrevMessage = Boolean(
            prevMessage &&
            selfId &&
            String(prevMessage.author_id) === String(selfId) &&
            withinWindow
          )
          const groupedWithPrevPending = Boolean(prevPending)
          const grouped = groupedWithPrevMessage || groupedWithPrevPending
          return (
            <PendingRow
              key={item.nonce}
              nonce={item.nonce}
              channelId={channelId}
              guildId={guildId}
              content={item.content}
              attachments={item.attachments}
              stickerPreview={item.stickerPreview}
              status={item.status}
              errorMessage={item.errorMessage}
              selfName={selfName}
              selfId={selfId}
              resolveName={resolveName}
              avatarUrl={selfId ? resolveAvatarUrl?.(selfId) : undefined}
              grouped={grouped}
            />
          )
        })}
      </div>
      {newCount > 0 && (
        <button
          type="button"
          onClick={() => {
            stickRef.current = true
            setNewCount(0)
            scrollToBottom()
          }}
          className="absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-md hover:bg-primary/90"
          style={{ bottom: Math.max(bottomInset, 12) + 12 }}
        >
          <ArrowDownIcon className="size-3.5" />
          {newCount} 条新消息
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// typing 指示：头像列表 + 悬停显示名 + 点击打开资料卡
// ---------------------------------------------------------------------------

const TYPING_AVATAR_MAX = 5

function TypingDots({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      aria-hidden
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1 animate-bounce rounded-full bg-muted-foreground/70"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }}
        />
      ))}
    </span>
  )
}

function typingSummaryText(
  names: string[],
): string {
  if (names.length === 0) return "有人正在输入"
  if (names.length === 1) return `${names[0]} 正在输入`
  if (names.length === 2) return `${names[0]}、${names[1]} 正在输入`
  if (names.length === 3) {
    return `${names[0]}、${names[1]}、${names[2]} 正在输入`
  }
  return `${names[0]}、${names[1]} 和另外 ${names.length - 2} 人正在输入`
}

export function TypingIndicator({
  channelId,
  resolveName,
  resolveAvatarUrl,
}: {
  channelId: string
  resolveName: MentionResolver
  resolveAvatarUrl?: (userId: string) => string | undefined
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

  // 无 typing 时保留高度，避免输入区跳动
  if (activeIds.length === 0) {
    return <div className="h-6" aria-hidden />
  }

  const names = activeIds.map((id) => resolveName(id))
  const shownIds = activeIds.slice(0, TYPING_AVATAR_MAX)
  const overflow = activeIds.length - shownIds.length
  const summary = typingSummaryText(names)

  return (
    <TooltipProvider delay={200}>
      <div
        className="flex h-6 min-w-0 items-center gap-2 px-4"
        aria-live="polite"
        aria-label={summary}
      >
        {/* 正在输入的用户头像列表（悬停名称 / 点击资料卡） */}
        <div className="flex shrink-0 items-center pl-0.5">
          {shownIds.map((userId, index) => {
            const name = resolveName(userId)
            const avatarUrl = resolveAvatarUrl?.(userId)
            return (
              <div
                key={userId}
                className={cn(
                  "relative shrink-0 rounded-full ring-2 ring-background",
                  index > 0 && "-ml-1.5",
                )}
                style={{ zIndex: shownIds.length - index }}
              >
                <UserProfilePopover
                  userId={userId}
                  displayName={name}
                  avatarUrl={avatarUrl}
                  tooltip={name}
                  side="top"
                >
                  <span className="relative inline-flex size-5">
                    <Avatar className="size-5 after:border-0">
                      {avatarUrl ? (
                        <AvatarImage
                          src={avatarUrl}
                          alt=""
                          className="object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="text-[9px] font-semibold">
                        {nameInitials(name)}
                      </AvatarFallback>
                    </Avatar>
                  </span>
                </UserProfilePopover>
              </div>
            )
          })}
          {overflow > 0 ? (
            <span
              className={cn(
                "relative -ml-1.5 flex size-5 shrink-0 items-center justify-center",
                "rounded-full bg-muted text-[9px] font-semibold text-muted-foreground",
                "ring-2 ring-background",
              )}
              title={`还有 ${overflow} 人正在输入`}
            >
              +{overflow}
            </span>
          ) : null}
        </div>

        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">
            {activeIds.length <= 3
              ? names.join("、")
              : `${names[0]}、${names[1]} 和另外 ${activeIds.length - 2} 人`}
          </span>
          <span> 正在输入</span>
          <TypingDots className="ml-1.5 align-middle" />
        </p>
      </div>
    </TooltipProvider>
  )
}

export const MemoizedMessageList = memo(MessageList)
export { MemoizedMessageList as MessageList }
