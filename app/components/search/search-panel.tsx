// 消息搜索面板（docs 06 FR-14/15/16/21/22/23/24/25，UX-01）：
// app-shell 主内容区右侧 420px 滑出；显式 Enter 提交（服务端限流 1QPS/突发5）；
// 429 冷却倒计时；结果按时间倒序、before 游标分页；点击结果跳频道并 around 定位。

import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router"
import { HistoryIcon, SearchIcon, XIcon } from "lucide-react"

import { Button } from "~/components/ui/button"
import { Skeleton } from "~/components/ui/skeleton"
import type { Message } from "~/lib/api/types"
import {
  breadcrumbFor,
  extractFilters,
  mergePills,
  pillToToken,
  type SearchFilterPill,
} from "~/lib/search-syntax"
import { cn } from "~/lib/utils"
import { readHistory, useSearchStore, type SearchScope } from "~/stores/search"
import { useUIStore } from "~/stores/ui"

// ---------------------------------------------------------------------------
// 关键词高亮（服务端无 highlight 片段，客户端按查询词本地高亮 FR-17）
// ---------------------------------------------------------------------------

function HighlightedText({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword) return <>{text}</>
  const parts: React.ReactNode[] = []
  const lower = text.toLowerCase()
  const query = keyword.toLowerCase()
  let cursor = 0
  for (;;) {
    const hit = lower.indexOf(query, cursor)
    if (hit === -1) break
    if (hit > cursor) parts.push(text.slice(cursor, hit))
    parts.push(
      <mark key={hit} className="rounded-sm bg-primary/25 px-0.5 text-foreground">
        {text.slice(hit, hit + query.length)}
      </mark>,
    )
    cursor = hit + query.length
  }
  parts.push(text.slice(cursor))
  return <>{parts}</>
}

// ---------------------------------------------------------------------------
// 结果卡片
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function ResultCard({
  message,
  keyword,
  onJump,
}: {
  message: Message
  keyword: string
  onJump: (message: Message) => void
}) {
  const breadcrumb = breadcrumbFor(message.guild_id, message.channel_id)
  return (
    <button
      type="button"
      onClick={() => onJump(message)}
      aria-label={`${message.author_username} 在 ${breadcrumb.guild} #${breadcrumb.channel} 于 ${formatTime(message.created_at)} 发送的消息`}
      className="block w-full rounded-2xl border p-3 text-left transition-colors hover:bg-muted/50"
    >
      <p className="truncate text-xs text-muted-foreground">
        {breadcrumb.guild} · #{breadcrumb.channel}
      </p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="truncate text-sm font-medium">{message.author_username}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatTime(message.created_at)}
        </span>
      </p>
      <p className="mt-1 line-clamp-3 text-sm break-words whitespace-pre-wrap">
        <HighlightedText text={message.content} keyword={keyword} />
      </p>
      {message.attachments.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {message.attachments.length} 个附件
        </p>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// 语法示例空态
// ---------------------------------------------------------------------------

function SyntaxExamples() {
  return (
    <div className="mt-4 rounded-2xl bg-muted/40 p-4 text-xs text-muted-foreground">
      <p className="mb-2 font-medium text-foreground">搜索语法</p>
      <p className="leading-6">
        <code className="rounded bg-muted px-1">from:@用户</code> 指定作者
        <br />
        <code className="rounded bg-muted px-1">in:#频道</code> 指定频道
        <br />
        <code className="rounded bg-muted px-1">before:2026-07-01</code> 该日期之前
        <br />
        <code className="rounded bg-muted px-1">after:2026-01-01</code> 该日期之后
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 主面板
// ---------------------------------------------------------------------------

const SCOPE_OPTIONS: { value: SearchScope; label: string }[] = [
  { value: "channel", label: "当前频道" },
  { value: "guild", label: "当前服务器" },
  { value: "global", label: "全部服务器" },
]

export function SearchPanel() {
  const navigate = useNavigate()
  const open = useSearchStore((state) => state.panelOpen)
  const scope = useSearchStore((state) => state.scope)
  const input = useSearchStore((state) => state.input)
  const filters = useSearchStore((state) => state.filters)
  const executedQuery = useSearchStore((state) => state.executedQuery)
  const results = useSearchStore((state) => state.results)
  const loading = useSearchStore((state) => state.loading)
  const loadingMore = useSearchStore((state) => state.loadingMore)
  const hasMore = useSearchStore((state) => state.hasMore)
  const error = useSearchStore((state) => state.error)
  const cooldownUntil = useSearchStore((state) => state.cooldownUntil)
  const historyVersion = useSearchStore((state) => state.historyVersion)

  const selectedGuildId = useUIStore((state) => state.selectedGuildId)
  const selectedChannelId = useUIStore((state) => state.selectedChannelId)

  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const [nowTick, setNowTick] = useState(() => Date.now())

  // 429 冷却倒计时
  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - nowTick) / 1000))
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return
    const timer = setInterval(() => setNowTick(Date.now()), 500)
    return () => clearInterval(timer)
  }, [cooldownUntil])

  const history = useMemo(() => readHistory().slice(0, 5), [historyVersion, open])

  if (!open) return null

  const store = useSearchStore.getState()

  /** 输入变化：token 以空格结尾时即时抽取成胶囊 */
  const handleInputChange = (value: string) => {
    if (/\s$/.test(value)) {
      const { text, filters: extracted } = extractFilters(value)
      if (extracted.length > 0) {
        store.setFilters(mergePills(filters, extracted))
        store.setInput(text ? `${text} ` : "")
        return
      }
    }
    store.setInput(value)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // IME 组合输入中不提交（UX-06）
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void store.submit()
      return
    }
    // 空输入退格：删除最后一个胶囊
    if (event.key === "Backspace" && input === "" && filters.length > 0) {
      store.removeFilter(filters.length - 1)
    }
  }

  const handleJump = (message: Message) => {
    navigate(
      `/channels/${message.guild_id}/${message.channel_id}?around=${message.id}`,
    )
  }

  const showHistory =
    focused && !input && filters.length === 0 && history.length > 0
  const showIdle = !executedQuery && !loading

  return (
    <aside
      className="flex w-[420px] shrink-0 flex-col overflow-hidden border-l bg-background"
      aria-label="消息搜索"
    >
      {/* 顶部：标题 + 关闭 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <span className="text-sm font-medium">搜索消息</span>
        <Button variant="ghost" size="icon-sm" aria-label="关闭搜索" onClick={store.closePanel}>
          <XIcon />
        </Button>
      </header>

      <div className="shrink-0 space-y-2 border-b p-3">
        {/* 搜索输入（胶囊 + 文本） */}
        <div
          className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-2xl bg-input/50 px-3 py-1.5"
          onClick={() => inputRef.current?.focus()}
        >
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          {filters.map((pill, index) => (
            <FilterPill key={`${pill.kind}-${index}`} pill={pill} onRemove={() => store.removeFilter(index)} />
          ))}
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => handleInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder={filters.length > 0 ? "" : "搜索，或使用 from:/in:/before:/after:"}
            className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* 作用域三档 */}
        <div className="flex gap-1">
          {SCOPE_OPTIONS.map((option) => {
            const disabled =
              (option.value === "channel" && !selectedChannelId) ||
              (option.value === "guild" && !selectedGuildId)
            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                onClick={() => store.setScope(option.value)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  scope === option.value
                    ? "bg-primary text-primary-foreground font-medium"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>

        {/* 历史（聚焦空框时最近 5 条 FR-24） */}
        {showHistory && (
          <div className="rounded-2xl border p-2">
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-xs font-medium text-muted-foreground">最近搜索</span>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onMouseDown={(event) => {
                  event.preventDefault()
                  store.clearHistory()
                }}
              >
                清除全部
              </button>
            </div>
            {history.map((entry, index) => (
              <div
                key={`${entry.at}-${index}`}
                className="group flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-muted/60"
              >
                <HistoryIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    void store.replayHistory(entry)
                  }}
                >
                  {[...entry.filters.map(pillToToken), entry.q].filter(Boolean).join(" ")}
                </button>
                <button
                  type="button"
                  aria-label="删除该历史"
                  className="opacity-0 group-hover:opacity-100"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    store.removeHistoryAt(index)
                  }}
                >
                  <XIcon className="size-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 429 冷却提示（FR-14） */}
        {cooldownLeft > 0 && (
          <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            搜索过于频繁，请 {cooldownLeft} 秒后重试
          </p>
        )}
      </div>

      {/* 结果区 */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {loading && (
          <>
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-20 w-full rounded-2xl" />
            ))}
          </>
        )}

        {error && !loading && (
          <div className="rounded-2xl border border-destructive/30 p-4 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() => void store.submit()}
            >
              重试
            </Button>
          </div>
        )}

        {showIdle && !error && (
          <div className="pt-6 text-center">
            <p className="text-sm text-muted-foreground">输入关键词，按 Enter 搜索</p>
            <SyntaxExamples />
          </div>
        )}

        {executedQuery && !loading && !error && results.length === 0 && (
          <div className="pt-6 text-center">
            <p className="text-sm">
              未找到与 &lsquo;{executedQuery.text || pillsSummary(executedQuery.filters)}&rsquo;
              匹配的消息
            </p>
            <SyntaxExamples />
          </div>
        )}

        {results.map((message) => (
          <ResultCard
            key={message.id}
            message={message}
            keyword={executedQuery?.text ?? ""}
            onJump={handleJump}
          />
        ))}

        {hasMore && !loading && (
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            disabled={loadingMore || cooldownLeft > 0}
            onClick={() => void store.loadMore()}
          >
            {loadingMore ? "加载中…" : "加载更多"}
          </Button>
        )}
      </div>

      {/* 索引延迟预期管理（FR-12） */}
      <footer className="shrink-0 border-t px-4 py-2">
        <p className="text-center text-xs text-muted-foreground">消息索引可能有数秒延迟</p>
      </footer>
    </aside>
  )
}

function pillsSummary(pills: SearchFilterPill[]): string {
  return pills.map(pillToToken).join(" ")
}

/** 过滤器胶囊（键名灰 + 值蓝双色，可整体删除 UX-03） */
function FilterPill({ pill, onRemove }: { pill: SearchFilterPill; onRemove: () => void }) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2 text-xs">
      <span className="text-muted-foreground">{pill.kind}:</span>
      <span className="font-medium text-primary">
        {pill.kind === "from" ? `@${pill.label}` : pill.kind === "in" ? `#${pill.label}` : pill.label}
      </span>
      <button type="button" aria-label="删除过滤器" onClick={onRemove}>
        <XIcon className="size-3 text-muted-foreground hover:text-foreground" />
      </button>
    </span>
  )
}
