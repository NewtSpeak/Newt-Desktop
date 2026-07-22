// 贴图库主内容：展示可收藏（allow_browse_full）的小表情 / 贴图包，
// 顶部居中搜索（包名 + 表情名）+ 右侧创建入口。

import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router"
import {
  ImageIcon,
  Loader2Icon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  Settings2Icon,
  SmileIcon,
  StickerIcon,
} from "lucide-react"

import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { listAvailableStickers } from "~/lib/api/stickers"
import type { StickerItem, StickerPack } from "~/lib/api/types"
import { StickerMedia } from "~/components/messages/sticker-media"
import { itemDisplayName } from "~/lib/stickers/format"
import {
  STICKERS_CREATE_PATH,
  STICKERS_MANAGE_PATH,
} from "~/lib/stickers-route"
import { cn } from "~/lib/utils"
import { useStickersStore } from "~/stores/stickers"
import { useUIStore } from "~/stores/ui"

type PackWithItems = {
  pack: StickerPack
  items: StickerItem[]
}

function kindLabel(kind: StickerPack["kind"]): string {
  return kind === "emote" ? "小表情" : "贴图"
}

function scopeLabel(pack: StickerPack): string {
  return pack.scope === "guild" ? "服独属" : "账号级"
}

export function StickerLibraryView() {
  const navigate = useNavigate()
  const openPackPreview = useStickersStore((s) => s.openPackPreview)
  const cacheItems = useStickersStore((s) => s.cacheItems)

  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [packs, setPacks] = useState<StickerPack[]>([])
  const [items, setItems] = useState<StickerItem[]>([])

  // 进入贴图库时清掉具体频道选中，保持私信侧栏可见
  useEffect(() => {
    const ui = useUIStore.getState()
    if (ui.selectedGuildId && ui.selectedGuildId !== "@me") return
    if (ui.selectedChannelId != null || ui.selectedGuildId === "@me") {
      ui.selectGuild(null)
    }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listAvailableStickers()
      const nextPacks = (data.packs ?? []).filter(
        (p) => p.status === "active" && p.allow_browse_full,
      )
      const nextItems = (data.items ?? []).filter((i) => i.status === "active")
      setPacks(nextPacks)
      setItems(nextItems)
      cacheItems(nextItems)
    } catch {
      setPacks([])
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [cacheItems])

  useEffect(() => {
    void reload()
  }, [reload])

  const itemsByPack = useMemo(() => {
    const map = new Map<string, StickerItem[]>()
    for (const item of items) {
      const list = map.get(item.pack_id)
      if (list) list.push(item)
      else map.set(item.pack_id, [item])
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
    }
    return map
  }, [items])

  const filtered = useMemo((): PackWithItems[] => {
    const q = query.trim().toLowerCase()
    const rows: PackWithItems[] = packs.map((pack) => ({
      pack,
      items: itemsByPack.get(pack.id) ?? [],
    }))
    if (!q) return rows
    return rows.filter(({ pack, items: packItems }) => {
      if (pack.name.toLowerCase().includes(q)) return true
      if (pack.description?.toLowerCase().includes(q)) return true
      return packItems.some((item) => {
        const name = item.name?.toLowerCase() ?? ""
        const mark = item.mark.toLowerCase()
        return name.includes(q) || mark.includes(q)
      })
    })
  }, [packs, itemsByPack, query])

  const openCreate = () => {
    useUIStore.getState().selectGuild(null)
    navigate(STICKERS_CREATE_PATH)
  }

  const openManage = () => {
    useUIStore.getState().selectGuild(null)
    navigate(STICKERS_MANAGE_PATH)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶栏：居中搜索 + 右侧管理 / 创建 */}
      <header className="relative flex h-12 shrink-0 items-center px-3">
        <div className="pointer-events-none absolute inset-x-0 flex justify-center px-4 sm:px-44 md:px-56">
          <div className="pointer-events-auto relative w-full max-w-md">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/70"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索贴图包或表情名称"
              className="h-9 border-0 bg-muted/70 py-0 pr-3 pl-8 text-[13px] shadow-none focus-visible:ring-1"
              aria-label="搜索贴图包或表情名称"
            />
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={openManage}
            className="h-9 gap-1.5 border-0 shadow-none active:scale-[0.97] transition-transform"
          >
            <Settings2Icon className="size-3.5" />
            <span className="hidden sm:inline">管理我的贴图包</span>
            <span className="sm:hidden">管理</span>
          </Button>
          <Button
            size="sm"
            onClick={openCreate}
            className="h-9 gap-1.5 active:scale-[0.97] transition-transform"
          >
            <PlusIcon className="size-3.5" />
            <span className="hidden sm:inline">创建贴图包</span>
            <span className="sm:hidden">创建</span>
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            加载贴图库…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
              <StickerIcon className="size-7 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium">
              {query.trim() ? "没有匹配的贴图包" : "暂无可浏览的贴图包"}
            </p>
            <p className="max-w-xs text-[13px] text-muted-foreground text-pretty">
              {query.trim()
                ? "试试其他关键词，或清空搜索"
                : "仅显示允许完整浏览（可收藏）的小表情包与贴图包。你可以创建自己的包，或从消息中预览并 Install 他人的包。"}
            </p>
            {!query.trim() ? (
              <Button
                size="sm"
                onClick={openCreate}
                className="mt-1 gap-1.5 active:scale-[0.97]"
              >
                <PlusIcon className="size-3.5" />
                创建贴图包
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map(({ pack, items: packItems }) => {
              const previewItems = packItems.slice(0, 4)
              const matchQuery = query.trim().toLowerCase()
              const matchedItems = matchQuery
                ? packItems.filter((item) => {
                    const name = item.name?.toLowerCase() ?? ""
                    const mark = item.mark.toLowerCase()
                    return name.includes(matchQuery) || mark.includes(matchQuery)
                  })
                : []
              return (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => openPackPreview(pack.id)}
                  className={cn(
                    "group flex flex-col gap-2.5 rounded-2xl bg-muted/40 p-3 text-left",
                    "transition-[background-color,transform] duration-150 ease-out",
                    "hover:bg-muted/70 active:scale-[0.99]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background/70">
                      {pack.cover_url ? (
                        <StickerMedia
                          src={pack.cover_url}
                          alt=""
                          className="size-12"
                          draggable={false}
                        />
                      ) : pack.kind === "emote" ? (
                        <SmileIcon className="size-5 text-muted-foreground" />
                      ) : (
                        <ImageIcon className="size-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{pack.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                        {kindLabel(pack.kind)} · {scopeLabel(pack)} ·{" "}
                        {pack.item_count ?? packItems.length} 张
                      </p>
                    </div>
                    <PackageIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>

                  {previewItems.length > 0 ? (
                    <div className="grid grid-cols-4 gap-1.5">
                      {previewItems.map((item) => (
                        <div
                          key={item.id}
                          className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-background/50"
                          title={itemDisplayName(item)}
                        >
                          <StickerMedia
                            src={item.asset_url}
                            alt={itemDisplayName(item)}
                            className="size-full p-0.5"
                            draggable={false}
                          />
                        </div>
                      ))}
                      {Array.from({
                        length: Math.max(0, 4 - previewItems.length),
                      }).map((_, i) => (
                        <div
                          key={`empty-${i}`}
                          className="aspect-square rounded-lg bg-background/30"
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg bg-background/40 px-2 py-4 text-center text-[11px] text-muted-foreground">
                      暂无表情
                    </div>
                  )}

                  {matchedItems.length > 0 && !pack.name.toLowerCase().includes(matchQuery) ? (
                    <p className="truncate text-[11px] text-primary/90">
                      匹配表情：
                      {matchedItems
                        .slice(0, 3)
                        .map((i) => itemDisplayName(i))
                        .join("、")}
                      {matchedItems.length > 3 ? "…" : ""}
                    </p>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
