// 表情选择器：
// - 顶部 Tab：贴图 | 小表情（无系统 Unicode emoji）
// - 左侧导航：最近 + 当前 Tab 下的包封面
// - 记忆上次主 Tab / 分组 / 滚动位置
// - 搜索：name + mark + 包名
// - 无加载动画；底部悬停预览栏

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ClockIcon,
  PackageIcon,
  SearchIcon,
  SmileIcon,
  StickerIcon,
} from "lucide-react"

import { GuildAvatar } from "~/components/guild-avatar"
import { UserProfilePopover } from "~/components/user-profile-popover"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover"
import type { StickerItem, StickerPack } from "~/lib/api/types"
import { StickerMedia } from "~/components/messages/sticker-media"
import {
  itemDisplayName,
  loadExpressionPickerUi,
  loadRecentExpressions,
  pushRecentExpression,
  saveExpressionPickerUi,
  type ExpressionPickerMainTab,
  type ExpressionPickerUiState,
  type RecentExpression,
} from "~/lib/stickers/format"
import { nameInitials, resolveProfileAssetUrl } from "~/lib/user-display"
import { cn } from "~/lib/utils"
import { getPublicProfile } from "~/lib/api/users"
import { useGuildsStore } from "~/stores/guilds"
import { availableItems, useStickersStore } from "~/stores/stickers"

export type ExpressionPick =
  | { type: "unicode"; emoji: string }
  | { type: "emote"; item: StickerItem }
  | { type: "sticker"; item: StickerItem }

/** 顶部主分组：贴图（大）/ 小表情包（无系统 emoji） */
type MainTab = ExpressionPickerMainTab

type NavId = string

type HoverPreview = {
  kind: "item"
  item: StickerItem
  pack?: StickerPack
} | null

function packCoverUrl(
  pack: StickerPack,
  items: StickerItem[],
): string | undefined {
  if (pack.cover_url) return pack.cover_url
  const inPack = items.filter((i) => i.pack_id === pack.id)
  if (pack.cover_item_id) {
    const cover =
      inPack.find((i) => i.id === pack.cover_item_id) ??
      items.find((i) => i.id === pack.cover_item_id)
    if (cover?.asset_url) return cover.asset_url
  }
  return inPack[0]?.asset_url
}

function matchesItemSearch(
  item: StickerItem,
  pack: StickerPack | undefined,
  q: string,
): boolean {
  if (!q) return true
  const name = (item.name ?? "").toLowerCase()
  const mark = item.mark.toLowerCase()
  const packName = (pack?.name ?? "").toLowerCase()
  // 用户设置名称 + 系统 mark + 包名
  return name.includes(q) || mark.includes(q) || packName.includes(q)
}

// ---------------------------------------------------------------------------
// 格子
// ---------------------------------------------------------------------------

/** 自定义表情在预览栏显示的 :name: 形式 */
function customColonName(item: StickerItem): string {
  const raw = itemDisplayName(item).trim() || item.mark
  const slug = raw
    .replace(/\s+/g, "_")
    .replace(/[^\w\u4e00-\u9fff\-]+/g, "")
    .slice(0, 48)
  return `:${slug || item.mark}:`
}

function NamedCell({
  label,
  caption,
  onClick,
  onHoverEnter,
  children,
  className,
}: {
  label: string
  caption?: string
  onClick: () => void
  /** 仅在进入时回调；失焦不清空，保留最后悬停项 */
  onHoverEnter?: () => void
  children: React.ReactNode
  className?: string
}) {
  const showCaption = Boolean(caption?.trim())
  return (
    <button
      type="button"
      data-expr-cell
      onClick={onClick}
      onMouseEnter={() => onHoverEnter?.()}
      onFocus={() => onHoverEnter?.()}
      aria-label={label}
      title={label}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-xl p-1",
        "transition-[background-color,transform] duration-150",
        "hover:bg-muted active:scale-[0.96]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        "cursor-pointer",
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center text-2xl leading-none">
        {children}
      </span>
      {showCaption ? (
        <span className="w-full max-w-[3.5rem] truncate text-center text-[10px] leading-tight text-muted-foreground">
          {caption}
        </span>
      ) : null}
    </button>
  )
}

/** 账号级包：作者头像，点击打开资料卡 */
function OwnerAvatarBadge({
  userId,
  side = "top",
}: {
  userId: string
  side?: "top" | "bottom" | "left" | "right"
}) {
  const [name, setName] = useState("用户")
  const [avatar, setAvatar] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    void getPublicProfile(userId)
      .then((p) => {
        if (cancelled) return
        setName(
          p.display_name?.trim() || p.username?.trim() || "用户",
        )
        setAvatar(resolveProfileAssetUrl(p.avatar) || undefined)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [userId])

  return (
    <UserProfilePopover
      userId={userId}
      displayName={name}
      avatarUrl={avatar}
      side={side}
    >
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-lg p-0.5 transition-colors hover:bg-background/60 active:scale-[0.96] cursor-pointer"
        title={name}
        onClick={(e) => e.stopPropagation()}
      >
        <Avatar className="size-7">
          {avatar ? <AvatarImage src={avatar} alt="" /> : null}
          <AvatarFallback className="text-[10px]">
            {nameInitials(name)}
          </AvatarFallback>
        </Avatar>
        <span className="max-w-[5.5rem] truncate text-[11px] font-medium text-muted-foreground">
          {name}
        </span>
      </button>
    </UserProfilePopover>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="sticky top-0 z-[1] bg-popover/95 px-1.5 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur-sm select-none">
      {children}
    </p>
  )
}

// ---------------------------------------------------------------------------
// 面板
// ---------------------------------------------------------------------------

export function ExpressionPickerPanel({
  guildId,
  mode = "composer",
  onPick,
}: {
  guildId?: string
  mode?: "composer" | "reaction"
  onPick: (pick: ExpressionPick) => void
}) {
  const initialUi = useMemo(() => loadExpressionPickerUi(), [])
  const [mainTab, setMainTab] = useState<MainTab>(initialUi.mainTab)
  const [query, setQuery] = useState("")
  const [activeNav, setActiveNav] = useState<NavId>(
    () => initialUi.byTab[initialUi.mainTab]?.activeNav || "recent",
  )
  const [recent, setRecent] = useState<RecentExpression[]>(() =>
    loadRecentExpressions(),
  )
  const [hover, setHover] = useState<HoverPreview>(null)
  /** 各 Tab 独立记忆侧栏 + 滚动 */
  const uiByTabRef = useRef<ExpressionPickerUiState["byTab"]>(initialUi.byTab)
  const pendingScrollRestore = useRef(initialUi.byTab[initialUi.mainTab]?.scrollTop ?? 0)

  const ensureAvailable = useStickersStore((s) => s.ensureAvailable)
  const available = useStickersStore(
    (s) => s.availableByContext[guildId || "__dm__"],
  )
  const guilds = useGuildsStore((s) => s.guilds)

  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
  const suppressScrollSpy = useRef(false)

  const persistUi = useCallback(
    (patch?: {
      mainTab?: MainTab
      activeNav?: NavId
      scrollTop?: number
    }) => {
      const tab = patch?.mainTab ?? mainTab
      const prevTabState = uiByTabRef.current[tab] ?? {
        activeNav: "recent",
        scrollTop: 0,
      }
      const nextTabState = {
        activeNav: patch?.activeNav ?? prevTabState.activeNav,
        scrollTop:
          patch?.scrollTop !== undefined
            ? patch.scrollTop
            : prevTabState.scrollTop,
      }
      uiByTabRef.current = { ...uiByTabRef.current, [tab]: nextTabState }
      saveExpressionPickerUi({
        mainTab: tab,
        byTab: uiByTabRef.current,
      })
    },
    [mainTab],
  )

  useEffect(() => {
    // 静默加载，不展示 spinner / 入场动画
    void ensureAvailable(guildId)
  }, [guildId, ensureAvailable])

  // 切换顶部 Tab：恢复该 Tab 记忆的分组与滚动，不清成「最近」
  const switchMainTab = useCallback(
    (next: MainTab) => {
      if (next === mainTab) return
      // 离开前写入当前滚动
      const top = scrollRef.current?.scrollTop ?? 0
      persistUi({ mainTab, activeNav, scrollTop: top })
      const remembered = uiByTabRef.current[next] ?? {
        activeNav: "recent",
        scrollTop: 0,
      }
      pendingScrollRestore.current = remembered.scrollTop
      setQuery("")
      setMainTab(next)
      setActiveNav(remembered.activeNav || "recent")
      persistUi({ mainTab: next, activeNav: remembered.activeNav })
    },
    [mainTab, activeNav, persistUi],
  )

  // 内容就绪后恢复滚动位置
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const top = pendingScrollRestore.current
    // 等包列表渲染一帧
    const id = window.requestAnimationFrame(() => {
      root.scrollTop = top
      // 再写一次，避免图片加载后高度变化把位置冲掉
      window.setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = top
      }, 50)
    })
    return () => window.cancelAnimationFrame(id)
  }, [mainTab, available])

  const allItems = useMemo(() => availableItems(guildId), [guildId, available])
  const packs = available?.packs ?? []
  const packById = useMemo(() => {
    const m = new Map<string, StickerPack>()
    for (const p of packs) m.set(p.id, p)
    return m
  }, [packs])

  const emotePacks = useMemo(
    () => packs.filter((p) => p.kind === "emote"),
    [packs],
  )
  const stickerPacks = useMemo(
    () => packs.filter((p) => p.kind === "sticker"),
    [packs],
  )

  const emotesByPack = useMemo(() => {
    const map = new Map<string, StickerItem[]>()
    for (const item of allItems) {
      if (item.kind !== "emote") continue
      const list = map.get(item.pack_id) ?? []
      list.push(item)
      map.set(item.pack_id, list)
    }
    return map
  }, [allItems])

  const stickersByPack = useMemo(() => {
    const map = new Map<string, StickerItem[]>()
    for (const item of allItems) {
      if (item.kind !== "sticker") continue
      const list = map.get(item.pack_id) ?? []
      list.push(item)
      map.set(item.pack_id, list)
    }
    return map
  }, [allItems])

  const q = query.trim().toLowerCase()
  const searching = q.length > 0

  // ---- 搜索：仅自定义小表情 / 贴图（name + mark + 包名）----
  const filteredEmotes = useMemo(() => {
    if (!searching || mainTab !== "emotes") return [] as StickerItem[]
    return allItems.filter(
      (i) =>
        i.kind === "emote" &&
        matchesItemSearch(i, packById.get(i.pack_id), q),
    )
  }, [allItems, packById, q, searching, mainTab])

  const filteredStickers = useMemo(() => {
    if (!searching || mainTab !== "stickers") return [] as StickerItem[]
    return allItems.filter(
      (i) =>
        i.kind === "sticker" &&
        matchesItemSearch(i, packById.get(i.pack_id), q),
    )
  }, [allItems, packById, q, searching, mainTab])

  // 左侧导航：最近 + 包（无系统 emoji 分组）
  const navItems = useMemo(() => {
    type NavEntry = {
      id: NavId
      label: string
      kind: "recent" | "emote-pack" | "sticker-pack"
      coverUrl?: string
    }
    const list: NavEntry[] = [
      { id: "recent", label: "最近", kind: "recent" },
    ]
    if (mainTab === "emotes") {
      for (const pack of emotePacks) {
        list.push({
          id: `emote-pack:${pack.id}`,
          label: pack.name,
          kind: "emote-pack",
          coverUrl: packCoverUrl(pack, allItems),
        })
      }
    } else {
      for (const pack of stickerPacks) {
        list.push({
          id: `sticker-pack:${pack.id}`,
          label: pack.name,
          kind: "sticker-pack",
          coverUrl: packCoverUrl(pack, allItems),
        })
      }
    }
    return list
  }, [mainTab, emotePacks, stickerPacks, allItems])

  // 若记忆的 activeNav 已不存在（包被删），回退最近
  useEffect(() => {
    if (searching) return
    if (navItems.some((n) => n.id === activeNav)) return
    setActiveNav("recent")
    persistUi({ activeNav: "recent" })
  }, [navItems, activeNav, searching, persistUi])

  // 滚动联动侧栏高亮 + 持久化滚动位置
  useEffect(() => {
    const root = scrollRef.current
    if (!root || searching) return
    let scrollSaveTimer: number | undefined
    const onScroll = () => {
      if (suppressScrollSpy.current) return
      const rootTop = root.getBoundingClientRect().top
      let current: NavId = "recent"
      let best = Number.POSITIVE_INFINITY
      for (const item of navItems) {
        const el = sectionRefs.current[item.id]
        if (!el) continue
        const dist = Math.abs(el.getBoundingClientRect().top - rootTop - 8)
        if (dist < best) {
          best = dist
          current = item.id
        }
      }
      setActiveNav((prev) => {
        if (prev === current) return prev
        persistUi({ activeNav: current, scrollTop: root.scrollTop })
        return current
      })
      window.clearTimeout(scrollSaveTimer)
      scrollSaveTimer = window.setTimeout(() => {
        persistUi({ scrollTop: root.scrollTop })
      }, 120)
    }
    root.addEventListener("scroll", onScroll, { passive: true })
    onScroll()
    return () => {
      root.removeEventListener("scroll", onScroll)
      window.clearTimeout(scrollSaveTimer)
    }
  }, [navItems, searching, mainTab, persistUi])

  const scrollToSection = (id: NavId) => {
    setActiveNav(id)
    setQuery("")
    persistUi({ activeNav: id })
    const el = sectionRefs.current[id]
    if (!el || !scrollRef.current) return
    suppressScrollSpy.current = true
    el.scrollIntoView({ behavior: "smooth", block: "start" })
    window.setTimeout(() => {
      suppressScrollSpy.current = false
      persistUi({
        activeNav: id,
        scrollTop: scrollRef.current?.scrollTop ?? 0,
      })
    }, 400)
  }

  const pickItem = useCallback(
    (item: StickerItem) => {
      setRecent(
        pushRecentExpression({
          kind: "item",
          itemId: item.id,
          mark: item.mark,
          name: itemDisplayName(item),
          assetUrl: item.asset_url,
          itemKind: item.kind,
        }),
      )
      // 选中时也记下当前位置，下次打开仍在附近
      persistUi({
        scrollTop: scrollRef.current?.scrollTop ?? 0,
        activeNav,
      })
      onPick(
        item.kind === "sticker"
          ? { type: "sticker", item }
          : { type: "emote", item },
      )
    },
    [onPick, persistUi, activeNav],
  )

  const resolveRecentItem = (entry: RecentExpression & { kind: "item" }) => {
    const found = allItems.find((x) => x.id === entry.itemId)
    if (found) return found
    return {
      id: entry.itemId,
      pack_id: "",
      kind: entry.itemKind,
      mark: entry.mark,
      name: entry.name || entry.mark,
      asset_url: entry.assetUrl,
      content_hash: "",
      asset_id: "",
      width: 0,
      height: 0,
      animated: false,
      sort_order: 0,
      status: "active" as const,
      created_at: "",
      updated_at: "",
    } satisfies StickerItem
  }

  const recentForTab = useMemo(() => {
    // 仅自定义条目；系统 emoji 已移除
    if (mainTab === "stickers") {
      return recent.filter(
        (e) => e.kind === "item" && e.itemKind === "sticker",
      )
    }
    return recent.filter(
      (e) => e.kind === "item" && e.itemKind === "emote",
    )
  }, [recent, mainTab])

  const setSectionRef = (id: string) => (el: HTMLElement | null) => {
    sectionRefs.current[id] = el
  }

  const hoverNameLine = hover ? customColonName(hover.item) : ""

  const hoverSourceLine = (() => {
    if (!hover) return ""
    const packName = hover.pack?.name
    if (packName) return `来源：${packName}`
    return hover.item.kind === "sticker" ? "来源：贴图" : "来源：小表情"
  })()

  const hoverGuild =
    hover?.pack?.scope === "guild" && hover.pack.guild_id
      ? guilds.find((g) => g.id === hover.pack!.guild_id)
      : undefined

  return (
    <div className="flex h-[min(72vh,30rem)] w-[min(100vw-2rem,36rem)] flex-col overflow-hidden">
      {/* 顶部主分组：默认贴图 */}
      <div
        className="flex gap-1 bg-muted/40 px-2 pt-2 pb-1.5"
        role="tablist"
        aria-label="表情主分组"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "stickers"}
          onClick={() => switchMainTab("stickers")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-medium",
            "transition-[background-color,color,transform] duration-150",
            "cursor-pointer active:scale-[0.96]",
            mainTab === "stickers"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
          )}
        >
          <StickerIcon className="size-4 opacity-80" aria-hidden />
          贴图
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "emotes"}
          onClick={() => switchMainTab("emotes")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-medium",
            "transition-[background-color,color,transform] duration-150",
            "cursor-pointer active:scale-[0.96]",
            mainTab === "emotes"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
          )}
        >
          <SmileIcon className="size-4 opacity-80" aria-hidden />
          小表情
        </button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左侧导航 */}
        <nav
          className="flex w-12 shrink-0 flex-col gap-0.5 overflow-y-auto overscroll-contain bg-muted/30 py-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          aria-label="表情子分组"
        >
          {navItems.map((item) => {
            const active = !searching && activeNav === item.id
            return (
              <button
                key={item.id}
                type="button"
                title={item.label}
                aria-label={item.label}
                aria-current={active || undefined}
                onClick={() => scrollToSection(item.id)}
                className={cn(
                  "mx-auto flex size-9 shrink-0 items-center justify-center rounded-xl",
                  "transition-[background-color,transform,box-shadow] duration-150",
                  "cursor-pointer active:scale-[0.96]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
              >
                {item.kind === "recent" && (
                  <ClockIcon className="size-4" aria-hidden />
                )}
                {(item.kind === "emote-pack" ||
                  item.kind === "sticker-pack") &&
                  (item.coverUrl ? (
                    <StickerMedia
                      src={item.coverUrl}
                      alt=""
                      className="size-7 rounded-md object-contain"
                      draggable={false}
                    />
                  ) : item.kind === "sticker-pack" ? (
                    <StickerIcon className="size-4 opacity-70" aria-hidden />
                  ) : (
                    <PackageIcon className="size-4 opacity-70" aria-hidden />
                  ))}
              </button>
            )
          })}
        </nav>

        {/* 主内容 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative px-2.5 py-2">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                mainTab === "stickers"
                  ? "搜索贴图名称、mark 或包名…"
                  : "搜索小表情名称、mark 或包名…"
              }
              className={cn(
                "h-9 w-full rounded-xl border-0 bg-muted/50 py-1.5 pr-3 pl-9 text-sm",
                "outline-none ring-0 placeholder:text-muted-foreground/70",
                "focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40",
              )}
              aria-label="搜索表情"
            />
          </div>

          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pb-2"
          >
            {searching ? (
              <div className="flex flex-col gap-3">
                {mainTab === "emotes" && (
                  <>
                    {filteredEmotes.length > 0 ? (
                      <section>
                        <SectionTitle>小表情</SectionTitle>
                        <div className="grid grid-cols-8 gap-1">
                          {filteredEmotes.map((item) => (
                            <NamedCell
                              key={item.id}
                              label={itemDisplayName(item)}
                              caption={itemDisplayName(item)}
                              onClick={() => pickItem(item)}
                              onHoverEnter={() =>
                                setHover({
                                  kind: "item",
                                  item,
                                  pack: packById.get(item.pack_id),
                                })
                              }
                            >
                              <StickerMedia
                                src={item.asset_url}
                                alt=""
                                className="size-9 object-contain"
                                draggable={false}
                              />
                            </NamedCell>
                          ))}
                        </div>
                      </section>
                    ) : (
                      <p className="py-12 text-center text-sm text-muted-foreground">
                        没有匹配「{query.trim()}」的小表情
                      </p>
                    )}
                  </>
                )}
                {mainTab === "stickers" && (
                  <>
                    {filteredStickers.length > 0 ? (
                      <div className="grid grid-cols-4 gap-2">
                        {filteredStickers.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            data-expr-cell
                            onClick={() => pickItem(item)}
                            onMouseEnter={() =>
                              setHover({
                                kind: "item",
                                item,
                                pack: packById.get(item.pack_id),
                              })
                            }
                            aria-label={itemDisplayName(item)}
                            className={cn(
                              "flex flex-col items-center gap-1.5 rounded-2xl p-2",
                              "bg-muted/40 transition-[background-color,transform] duration-150",
                              "hover:bg-muted/70 active:scale-[0.96] cursor-pointer",
                            )}
                          >
                            <StickerMedia
                      src={item.asset_url}
                      alt=""
                      className="size-[4.5rem] object-contain"
                      draggable={false}
                    />
                            <span className="max-w-full truncate text-[11px] text-muted-foreground">
                              {itemDisplayName(item)}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="py-12 text-center text-sm text-muted-foreground">
                        没有匹配「{query.trim()}」的贴图
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {/* 最近 */}
                <section
                  ref={setSectionRef("recent")}
                  data-section="recent"
                  className="scroll-mt-1"
                >
                  <SectionTitle>最近</SectionTitle>
                  {recentForTab.length === 0 ? (
                    <p className="px-1.5 py-6 text-center text-xs text-muted-foreground">
                      还没有最近使用
                    </p>
                  ) : mainTab === "stickers" ? (
                    <div className="grid grid-cols-4 gap-2">
                      {recentForTab.map((entry, i) => {
                        if (entry.kind !== "item") return null
                        const item = resolveRecentItem(entry)
                        return (
                          <button
                            key={`r-${entry.itemId}-${i}`}
                            type="button"
                            data-expr-cell
                            onClick={() => pickItem(item)}
                            onMouseEnter={() =>
                              setHover({
                                kind: "item",
                                item,
                                pack: packById.get(item.pack_id),
                              })
                            }
                            className={cn(
                              "flex flex-col items-center gap-1.5 rounded-2xl p-2",
                              "bg-muted/40 hover:bg-muted/70 active:scale-[0.96] cursor-pointer",
                            )}
                          >
                            <StickerMedia
                      src={entry.assetUrl}
                      alt=""
                      className="size-[4.5rem] object-contain"
                      draggable={false}
                    />
                            <span className="max-w-full truncate text-[11px] text-muted-foreground">
                              {entry.name || entry.mark}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-8 gap-1">
                      {recentForTab.map((entry, i) => {
                        if (entry.kind !== "item") return null
                        return (
                          <NamedCell
                            key={`r-i-${entry.itemId}-${i}`}
                            label={entry.name || entry.mark}
                            caption={entry.name || entry.mark}
                            onClick={() => pickItem(resolveRecentItem(entry))}
                            onHoverEnter={() => {
                              const item = resolveRecentItem(entry)
                              setHover({
                                kind: "item",
                                item,
                                pack: packById.get(item.pack_id),
                              })
                            }}
                          >
                            <StickerMedia
                              src={entry.assetUrl}
                              alt=""
                              className="size-9 object-contain"
                              draggable={false}
                            />
                          </NamedCell>
                        )
                      })}
                    </div>
                  )}
                </section>

                {/* 小表情 Tab：仅自定义包 */}
                {mainTab === "emotes" && (
                  <>
                    {emotePacks.map((pack) => {
                      const items = emotesByPack.get(pack.id) ?? []
                      const sectionId = `emote-pack:${pack.id}`
                      return (
                        <section
                          key={pack.id}
                          ref={setSectionRef(sectionId)}
                          data-section={sectionId}
                          className="scroll-mt-1"
                        >
                          <SectionTitle>{pack.name}</SectionTitle>
                          {items.length === 0 ? (
                            <p className="px-1.5 py-4 text-xs text-muted-foreground">
                              包内暂无条目
                            </p>
                          ) : (
                            <div className="grid grid-cols-8 gap-1">
                              {items.map((item) => (
                                <NamedCell
                                  key={item.id}
                                  label={itemDisplayName(item)}
                                  caption={itemDisplayName(item)}
                                  onClick={() => pickItem(item)}
                                  onHoverEnter={() =>
                                    setHover({ kind: "item", item, pack })
                                  }
                                >
                                  <StickerMedia
                      src={item.asset_url}
                      alt=""
                      className="size-9 object-contain"
                      draggable={false}
                    />
                                </NamedCell>
                              ))}
                            </div>
                          )}
                        </section>
                      )
                    })}

                    {emotePacks.length === 0 && (
                      <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                        暂无小表情包。可在「设置 → 我的贴图库」创建。
                      </p>
                    )}
                  </>
                )}

                {/* 贴图 Tab */}
                {mainTab === "stickers" && (
                  <>
                    {stickerPacks.length === 0 && (
                      <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                        {mode === "reaction"
                          ? "暂无贴图可用于反应"
                          : "暂无贴图包。可在「设置 → 我的贴图库」创建 kind=贴图 的包。"}
                      </p>
                    )}
                    {stickerPacks.map((pack) => {
                      const items = stickersByPack.get(pack.id) ?? []
                      const sectionId = `sticker-pack:${pack.id}`
                      return (
                        <section
                          key={pack.id}
                          ref={setSectionRef(sectionId)}
                          data-section={sectionId}
                          className="scroll-mt-1"
                        >
                          <SectionTitle>
                            {pack.name}
                            {mode === "reaction" ? (
                              <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground/80">
                                · 反应时缩小显示
                              </span>
                            ) : null}
                          </SectionTitle>
                          {items.length === 0 ? (
                            <p className="px-1.5 py-4 text-xs text-muted-foreground">
                              包内暂无条目
                            </p>
                          ) : (
                            <div className="grid grid-cols-4 gap-2">
                              {items.map((item) => (
                                <button
                                  key={item.id}
                                  type="button"
                                  data-expr-cell
                                  onClick={() => pickItem(item)}
                                  onMouseEnter={() =>
                                    setHover({ kind: "item", item, pack })
                                  }
                                  aria-label={itemDisplayName(item)}
                                  className={cn(
                                    "flex flex-col items-center gap-1.5 rounded-2xl p-2",
                                    "bg-muted/40 transition-[background-color,transform] duration-150",
                                    "hover:bg-muted/70 active:scale-[0.96] cursor-pointer",
                                  )}
                                >
                                  <StickerMedia
                      src={item.asset_url}
                      alt=""
                      className="size-[4.5rem] object-contain"
                      draggable={false}
                    />
                                  <span className="max-w-full truncate text-[11px] text-muted-foreground">
                                    {itemDisplayName(item)}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </section>
                      )
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 底部预览栏：失焦保留最后悬停项 */}
      <div
        className="flex min-h-[3.75rem] items-center gap-3 bg-muted/45 px-3 py-2.5"
        aria-live="polite"
      >
        {hover ? (
          <>
            <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background/70">
              <StickerMedia
                src={hover.item.asset_url}
                alt=""
                className="size-10 object-contain"
                draggable={false}
              />
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm font-medium leading-snug tracking-tight">
                {hoverNameLine}
              </p>
              <p className="mt-1.5 truncate text-[11px] leading-snug text-muted-foreground">
                {hoverSourceLine}
              </p>
            </div>

            <div className="flex shrink-0 items-center justify-end pl-2">
              {hoverGuild ? (
                <div
                  className="flex items-center gap-1.5"
                  title={hoverGuild.name}
                >
                  <GuildAvatar
                    guild={hoverGuild}
                    shape="circle"
                    className="size-7"
                  />
                  <span className="max-w-[6rem] truncate text-[11px] font-medium text-muted-foreground">
                    {hoverGuild.name}
                  </span>
                </div>
              ) : hover.pack?.owner_user_id ? (
                <OwnerAvatarBadge
                  userId={hover.pack.owner_user_id}
                  side="top"
                />
              ) : (
                <span className="text-[11px] text-muted-foreground">—</span>
              )}
            </div>
          </>
        ) : (
          <p className="w-full text-center text-[11px] text-muted-foreground/80">
            将鼠标移到表情上可预览名称与来源
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Popover 封装
// ---------------------------------------------------------------------------

export function ExpressionPickerPopover({
  onPick,
  children,
  open,
  onOpenChange,
  side = "top",
  align = "end",
  guildId,
  mode = "composer",
}: {
  onPick: (pick: ExpressionPick) => void
  children: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
  guildId?: string
  mode?: "composer" | "reaction"
}) {
  const [innerOpen, setInnerOpen] = useState(false)
  const controlled = open !== undefined
  const actualOpen = controlled ? open : innerOpen
  const setOpen = (next: boolean) => {
    if (!controlled) setInnerOpen(next)
    onOpenChange?.(next)
  }

  return (
    <Popover open={actualOpen} onOpenChange={setOpen}>
      <PopoverTrigger render={children} />
      <PopoverContent
        className="w-auto overflow-hidden rounded-2xl border-0 p-0 shadow-lg ring-0"
        side={side}
        align={align}
      >
        <ExpressionPickerPanel
          guildId={guildId}
          mode={mode}
          onPick={(pick) => {
            onPick(pick)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export function EmojiPickerPopover({
  onPick,
  children,
  open,
  onOpenChange,
  side = "top",
  align = "end",
  guildId,
  mode = "composer",
  onExpressionPick,
}: {
  onPick: (emoji: string) => void
  children: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
  guildId?: string
  mode?: "composer" | "reaction"
  onExpressionPick?: (pick: ExpressionPick) => void
}) {
  return (
    <ExpressionPickerPopover
      open={open}
      onOpenChange={onOpenChange}
      side={side}
      align={align}
      guildId={guildId}
      mode={mode}
      onPick={(pick) => {
        if (onExpressionPick) {
          onExpressionPick(pick)
          return
        }
        if (pick.type === "unicode") onPick(pick.emoji)
      }}
    >
      {children}
    </ExpressionPickerPopover>
  )
}

export function EmojiGrid({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <ExpressionPickerPanel
      mode="reaction"
      onPick={(pick) => {
        if (pick.type === "unicode") onPick(pick.emoji)
      }}
    />
  )
}
