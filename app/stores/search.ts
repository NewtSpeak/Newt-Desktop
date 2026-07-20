// 消息搜索 store（docs 06 P0）：右侧结果面板状态、显式提交执行、
// 429 冷却、before 游标分页、5 分钟内存缓存、竞态忽略、按账号隔离的搜索历史。

import { create } from "zustand"

import { ApiError } from "~/lib/api/http"
import { searchMessages } from "~/lib/api/search"
import type { Message, SearchMessagesParams } from "~/lib/api/types"
import {
  afterDateCursor,
  beforeDateCursor,
  extractFilters,
  mergePills,
  type SearchFilterPill,
} from "~/lib/search-syntax"
import { useAuthStore } from "./auth"
import { useUIStore } from "./ui"

// ---------------------------------------------------------------------------
// 类型与常量
// ---------------------------------------------------------------------------

export type SearchScope = "channel" | "guild" | "global"

export type SearchHistoryEntry = {
  q: string
  filters: SearchFilterPill[]
  scope: SearchScope
  at: number
}

const PAGE_LIMIT = 25
const CACHE_TTL_MS = 5 * 60 * 1000
const HISTORY_LIMIT = 20
const SCOPE_KEY = "owl.search.scope"

// ---------------------------------------------------------------------------
// 内存缓存（同一查询 5 分钟内直接复用，减少限流压力 FR-31）
// ---------------------------------------------------------------------------

type CacheEntry = { messages: Message[]; hasMore: boolean; at: number }
const resultCache = new Map<string, CacheEntry>()

function cacheKeyOf(params: SearchMessagesParams): string {
  return JSON.stringify([
    params.q,
    params.guild_id ?? "",
    params.channel_id ?? "",
    params.author_id ?? "",
    params.before ?? "",
    params.after ?? "",
  ])
}

// ---------------------------------------------------------------------------
// 搜索历史（localStorage，按账号隔离 FR-23/26）
// ---------------------------------------------------------------------------

function historyKey(): string | null {
  const userId = useAuthStore.getState().user?.id
  return userId ? `owl.search.history.${userId}` : null
}

export function readHistory(): SearchHistoryEntry[] {
  const key = historyKey()
  if (!key || typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as SearchHistoryEntry[]) : []
  } catch {
    return []
  }
}

function writeHistory(entries: SearchHistoryEntry[]) {
  const key = historyKey()
  if (!key || typeof window === "undefined") return
  localStorage.setItem(key, JSON.stringify(entries.slice(0, HISTORY_LIMIT)))
}

function pushHistory(entry: SearchHistoryEntry) {
  const rest = readHistory().filter(
    (item) => !(item.q === entry.q && item.scope === entry.scope),
  )
  writeHistory([entry, ...rest])
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

function loadScope(): SearchScope {
  if (typeof window === "undefined") return "guild"
  const saved = localStorage.getItem(SCOPE_KEY)
  return saved === "channel" || saved === "guild" || saved === "global" ? saved : "guild"
}

type SearchState = {
  panelOpen: boolean
  /** 作用域三档，记住上次选择 */
  scope: SearchScope
  /** 输入框文本（不含已抽取的胶囊） */
  input: string
  /** 已抽取的过滤器胶囊 */
  filters: SearchFilterPill[]

  /** 最近一次已执行查询（null = 从未执行） */
  executedQuery: { text: string; filters: SearchFilterPill[]; scope: SearchScope } | null
  results: Message[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: string | null
  /** 429 冷却截止时间戳（ms）；0 = 无冷却 */
  cooldownUntil: number
  /** 历史刷新信号（写历史后自增，驱动组件重读 localStorage） */
  historyVersion: number

  openPanel: (initialInput?: string) => void
  closePanel: () => void
  togglePanel: () => void
  setScope: (scope: SearchScope) => void
  setInput: (input: string) => void
  setFilters: (filters: SearchFilterPill[]) => void
  removeFilter: (index: number) => void
  /** 显式提交（Enter/点击入口）执行搜索 */
  submit: () => Promise<void>
  loadMore: () => Promise<void>
  /** 历史重放：还原查询词/胶囊/作用域并立即执行 */
  replayHistory: (entry: SearchHistoryEntry) => Promise<void>
  removeHistoryAt: (index: number) => void
  clearHistory: () => void
  reset: () => void
}

/** 竞态处理：只采纳最后一次提交的结果 */
let submitSeq = 0

export const useSearchStore = create<SearchState>()((set, get) => {
  /** 由作用域 + 胶囊组装服务端参数；in:/from: 胶囊优先于作用域 */
  const buildParams = (
    text: string,
    filters: SearchFilterPill[],
    scope: SearchScope,
  ): SearchMessagesParams => {
    const params: SearchMessagesParams = { q: text, limit: PAGE_LIMIT }
    const ui = useUIStore.getState()
    if (scope === "channel" && ui.selectedChannelId) {
      params.channel_id = ui.selectedChannelId
      params.guild_id = ui.selectedGuildId ?? undefined
    } else if (scope === "guild" && ui.selectedGuildId) {
      params.guild_id = ui.selectedGuildId
    }
    for (const pill of filters) {
      switch (pill.kind) {
        case "from":
          params.author_id = pill.authorId
          break
        case "in":
          params.channel_id = pill.channelId
          params.guild_id = pill.guildId
          break
        case "before":
          params.before = beforeDateCursor(pill.date)
          break
        case "after":
          params.after = afterDateCursor(pill.date)
          break
      }
    }
    return params
  }

  const runSearch = async (
    text: string,
    filters: SearchFilterPill[],
    scope: SearchScope,
  ) => {
    const seq = ++submitSeq
    const params = buildParams(text, filters, scope)
    const key = cacheKeyOf(params)

    set({
      executedQuery: { text, filters, scope },
      error: null,
    })

    // 命中 5 分钟缓存直接呈现，不发请求（FR-31 简化为直接缓存）
    const cached = resultCache.get(key)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      set({ results: cached.messages, hasMore: cached.hasMore, loading: false })
      return
    }

    set({ loading: true, results: [], hasMore: false })
    try {
      const messages = await searchMessages(params)
      if (seq !== submitSeq) return // 已有更新的查询在途，丢弃本次结果
      const hasMore = messages.length >= PAGE_LIMIT
      resultCache.set(key, { messages, hasMore, at: Date.now() })
      set({ results: messages, hasMore, loading: false, cooldownUntil: 0 })
    } catch (error) {
      if (seq !== submitSeq) return
      if (error instanceof ApiError && error.status === 429) {
        const seconds = error.retryAfterSeconds ?? 5
        set({ loading: false, cooldownUntil: Date.now() + seconds * 1000, error: null })
        return
      }
      const message =
        error instanceof ApiError ? error.message : "搜索失败，请检查网络后重试"
      set({ loading: false, error: message })
    }
  }

  return {
    panelOpen: false,
    scope: loadScope(),
    input: "",
    filters: [],

    executedQuery: null,
    results: [],
    loading: false,
    loadingMore: false,
    hasMore: false,
    error: null,
    cooldownUntil: 0,
    historyVersion: 0,

    openPanel: (initialInput) => {
      set({ panelOpen: true })
      if (initialInput !== undefined) {
        set({ input: initialInput, filters: [] })
      }
    },
    closePanel: () => set({ panelOpen: false }),
    togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),

    setScope: (scope) => {
      if (typeof window !== "undefined") localStorage.setItem(SCOPE_KEY, scope)
      set({ scope })
    },
    setInput: (input) => set({ input }),
    setFilters: (filters) => set({ filters }),
    removeFilter: (index) =>
      set((state) => ({ filters: state.filters.filter((_, i) => i !== index) })),

    submit: async () => {
      const { input, filters, scope, cooldownUntil } = get()
      // 提交时解析输入里残留的过滤语法（from:/in:/before:/after:），
      // 解析结果并入胶囊；无法解析的前缀留在文本里按普通词搜索（FR-09）
      const { text, filters: extracted } = extractFilters(input.trim())
      const merged = mergePills(filters, extracted)
      // 空词但带过滤器允许提交（边界表）；两者都空则忽略
      if (!text && merged.length === 0) return
      if (cooldownUntil > Date.now()) return
      set({ input: text, filters: merged })
      pushHistory({ q: text, filters: merged, scope, at: Date.now() })
      set((state) => ({ historyVersion: state.historyVersion + 1 }))
      await runSearch(text, merged, scope)
    },

    loadMore: async () => {
      const { executedQuery, results, hasMore, loadingMore, loading } = get()
      if (!executedQuery || !hasMore || loadingMore || loading || results.length === 0) return
      const seq = submitSeq
      const oldest = results[results.length - 1]
      const params = buildParams(executedQuery.text, executedQuery.filters, executedQuery.scope)
      params.before = oldest.id // 时间倒序分页：向更早翻页
      set({ loadingMore: true })
      try {
        const page = await searchMessages(params)
        if (seq !== submitSeq) return
        set((state) => {
          const seen = new Set(state.results.map((item) => item.id))
          const merged = [...state.results, ...page.filter((item) => !seen.has(item.id))]
          // 追加页写回缓存，面板重开时保持完整结果
          const baseKey = cacheKeyOf(
            buildParams(executedQuery.text, executedQuery.filters, executedQuery.scope),
          )
          resultCache.set(baseKey, {
            messages: merged,
            hasMore: page.length >= PAGE_LIMIT,
            at: resultCache.get(baseKey)?.at ?? Date.now(),
          })
          return { results: merged, hasMore: page.length >= PAGE_LIMIT, loadingMore: false }
        })
      } catch (error) {
        if (seq !== submitSeq) return
        if (error instanceof ApiError && error.status === 429) {
          const seconds = error.retryAfterSeconds ?? 5
          set({ loadingMore: false, cooldownUntil: Date.now() + seconds * 1000 })
          return
        }
        set({ loadingMore: false })
      }
    },

    replayHistory: async (entry) => {
      set({ input: entry.q, filters: entry.filters, scope: entry.scope })
      await get().submit()
    },

    removeHistoryAt: (index) => {
      const entries = readHistory()
      entries.splice(index, 1)
      writeHistory(entries)
      set((state) => ({ historyVersion: state.historyVersion + 1 }))
    },

    clearHistory: () => {
      const key = historyKey()
      if (key && typeof window !== "undefined") localStorage.removeItem(key)
      set((state) => ({ historyVersion: state.historyVersion + 1 }))
    },

    reset: () => {
      submitSeq++
      resultCache.clear()
      set({
        panelOpen: false,
        input: "",
        filters: [],
        executedQuery: null,
        results: [],
        loading: false,
        loadingMore: false,
        hasMore: false,
        error: null,
        cooldownUntil: 0,
      })
    },
  }
})
