// 装扮商城（首页 /?tab=shop）：全部已上架装扮（单品+捆绑包），积分购买。
// 外壳照贴图库（h-12 居中搜索 header + 滚动区 + 响应式网格）；
// 差异化核心是"实景试穿"预览：头像框套真头像、铭牌真实渲染渐变/视频、
// 资料卡边框/特效包住迷你占位卡。列表不做入场动效（操作后直接呈现）。

import { useEffect, useMemo, useState } from "react"
import {
  CoinsIcon,
  Loader2Icon,
  PackageIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react"
import { toast } from "sonner"

import { ItemPreview } from "~/components/cosmetics/item-preview"
import { ShopViewSwitch } from "~/components/cosmetics/shop-nav"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Skeleton } from "~/components/ui/skeleton"
import { ApiError } from "~/lib/api/http"
import { resolveProfileAssetUrl } from "~/lib/user-display"
import { cn } from "~/lib/utils"
import { useCosmeticsStore } from "~/stores/cosmetics"
import { useUIStore } from "~/stores/ui"
import type { CosmeticBundle, CosmeticItem } from "~/lib/api/cosmetics"

/** 品类 key → 中文名（与后端 cosmetics.SeedCategories 保持一致；未知 key 原样显示） */
const CATEGORY_LABELS: Record<string, string> = {
  avatar_frame: "头像框",
  profile_border: "资料卡片边框",
  profile_effect: "资料卡内特效",
  nameplate: "铭牌",
}

function categoryLabel(key: string | undefined): string {
  if (!key) return ""
  return CATEGORY_LABELS[key] ?? key
}

function errorMessage(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.message || fallback
  if (e instanceof Error) return e.message
  return fallback
}

/** 单品卡：试穿预览 + 名称/tag + 价格与购买三态按钮 */
function ShopItemCard({
  item,
  points,
  busy,
  onAcquire,
}: {
  item: CosmeticItem
  points: number
  busy: boolean
  onAcquire: () => void
}) {
  const owned = Boolean(item.owned)
  const free = item.price_points <= 0
  const insufficient = !free && points < item.price_points
  return (
    <div
      data-shop-card
      className="flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted/40">
        <ItemPreview item={item} />
        {owned ? (
          <span className="absolute top-2 right-2 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[10px] font-medium text-white">
            已拥有
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{item.name}</span>
            {item.tags?.map((t) => (
              <span
                key={t.id}
                title={t.name}
                className="size-2 shrink-0 rounded-full"
                style={{ background: t.color || "var(--muted-foreground)" }}
              />
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="shrink-0 rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] leading-4 text-muted-foreground">
              {categoryLabel(item.category_key)}
            </span>
            {item.description ? (
              <span className="line-clamp-2 min-w-0 text-xs text-muted-foreground">
                {item.description}
              </span>
            ) : null}
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between gap-2">
          {free ? (
            <span className="text-xs font-medium text-emerald-500">免费领取</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-amber-500">
              <CoinsIcon className="size-3.5" />
              <span className="tabular-nums">{item.price_points}</span>
            </span>
          )}
          {owned ? (
            <Button size="sm" variant="outline" disabled>
              已拥有
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy || insufficient}
              title={insufficient ? "积分不足" : undefined}
              onClick={onAcquire}
              className="transition-transform active:scale-[0.96]"
            >
              {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
              {free ? "领取" : "兑换"}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/** 捆绑包卡（紫调，沿用设置页视觉） */
function ShopBundleCard({
  bundle,
  points,
  busy,
  onAcquire,
}: {
  bundle: CosmeticBundle
  points: number
  busy: boolean
  onAcquire: () => void
}) {
  const preview = resolveProfileAssetUrl(bundle.preview_url)
  const owned = Boolean(bundle.owned_all)
  const free = bundle.price_points <= 0
  const insufficient = !free && points < bundle.price_points
  return (
    <div
      data-shop-card
      className="flex flex-col overflow-hidden rounded-xl border border-violet-500/30 bg-violet-500/5"
    >
      <div className="relative aspect-[4/3] bg-muted/40">
        {preview ? (
          <img src={preview} alt="" className="size-full object-cover" draggable={false} />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <PackageIcon className="size-8 opacity-40" />
          </div>
        )}
        <span className="absolute top-2 left-2 rounded-full bg-violet-600/90 px-2 py-0.5 text-[10px] font-medium text-white">
          捆绑包 · {bundle.item_ids?.length ?? bundle.items?.length ?? 0} 件
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="truncate text-sm font-medium">{bundle.name}</div>
        <div className="line-clamp-2 text-xs text-muted-foreground">
          {bundle.description || "多件装扮打包，一次拥有"}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2">
          {free ? (
            <span className="text-xs font-medium text-emerald-500">免费领取</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-amber-500">
              <CoinsIcon className="size-3.5" />
              <span className="tabular-nums">{bundle.price_points}</span>
            </span>
          )}
          {owned ? (
            <span className="text-xs text-muted-foreground">已全部拥有</span>
          ) : (
            <Button
              size="sm"
              disabled={busy || insufficient}
              title={insufficient ? "积分不足" : undefined}
              onClick={onAcquire}
              className="transition-transform active:scale-[0.96]"
            >
              {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
              {free ? "领取" : "兑换"}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function ShopSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-border/60">
          <Skeleton className="aspect-[4/3] rounded-none" />
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <div className="flex items-center justify-between pt-1">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-8 w-14 rounded-lg" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function CosmeticsShopView() {
  const categories = useCosmeticsStore((s) => s.categories)
  const tags = useCosmeticsStore((s) => s.tags)
  const items = useCosmeticsStore((s) => s.shopItems)
  const bundles = useCosmeticsStore((s) => s.shopBundles)
  const points = useCosmeticsStore((s) => s.points)
  const loading = useCosmeticsStore((s) => s.loadingShop)
  const filter = useCosmeticsStore((s) => s.shopFilter)
  const [q, setQ] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)

  // 进入商城：清频道选中保持私信侧栏（与贴图库一致）；
  // loadShop({}) 重置全局筛选，避免与设置页商店的筛选状态串味。
  useEffect(() => {
    const ui = useUIStore.getState()
    if (!(ui.selectedGuildId && ui.selectedGuildId !== "@me")) {
      if (ui.selectedChannelId != null || ui.selectedGuildId === "@me") {
        ui.selectGuild(null)
      }
    }
    const store = useCosmeticsStore.getState()
    void store.ensureMeta().catch(() => undefined)
    void store.loadShop({}).catch(() => undefined)
    void store.loadPoints().catch(() => undefined)
  }, [])

  // 搜索：300ms 防抖走服务端筛选
  useEffect(() => {
    const timer = setTimeout(() => {
      const store = useCosmeticsStore.getState()
      const next = q.trim() || undefined
      if (store.shopFilter.q === next) return
      void store.loadShop({ ...store.shopFilter, q: next }).catch(() => undefined)
    }, 300)
    return () => clearTimeout(timer)
  }, [q])

  // 列表不做入场动效：筛选/加载后卡片直接呈现，避免每次操作都闪一遍 stagger

  const setCategory = (key?: string) => {
    void useCosmeticsStore
      .getState()
      .loadShop({ ...filter, category: key })
      .catch(() => undefined)
  }
  const setTag = (key?: string) => {
    void useCosmeticsStore
      .getState()
      .loadShop({ ...filter, tag: key })
      .catch(() => undefined)
  }

  const acquire = async (type: "item" | "bundle", id: string, free: boolean) => {
    setBusyId(id)
    try {
      if (free) await useCosmeticsStore.getState().claim(type, id)
      else await useCosmeticsStore.getState().purchase(type, id)
      toast.success(free ? "领取成功" : "兑换成功，可在设置 → 我的装扮中装备")
    } catch (e) {
      toast.error(errorMessage(e, free ? "领取失败" : "兑换失败"))
    } finally {
      setBusyId(null)
    }
  }

  const enabledCategories = useMemo(
    () => categories.filter((c) => c.enabled !== false),
    [categories],
  )
  const empty = !loading && items.length === 0 && bundles.length === 0

  const pill = (active: boolean) =>
    cn(
      "rounded-full px-3 py-1 text-xs transition-[background-color,color,transform] active:scale-[0.96]",
      active
        ? "bg-primary text-primary-foreground"
        : "bg-muted/60 text-muted-foreground hover:bg-muted",
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶栏：左切换 + 居中搜索 + 右侧余额 */}
      <header className="relative flex h-12 shrink-0 items-center gap-2 px-3">
        <ShopViewSwitch active="shop" />
        <div className="pointer-events-none absolute inset-x-0 flex justify-center px-4 sm:px-44 md:px-56">
          <div className="pointer-events-auto relative w-full max-w-md">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索装扮…"
              aria-label="搜索装扮"
              className="h-9 border-0 bg-muted/70 py-0 pr-3 pl-8 text-[13px] shadow-none focus-visible:ring-1"
            />
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1.5 text-xs">
            <CoinsIcon className="size-3.5 text-amber-500" />
            <span className="font-semibold tabular-nums">
              <span key={points} className="t-number-pop">
                {points}
              </span>
            </span>
          </span>
        </div>
      </header>

      {/* 筛选条：品类 + 主题标签 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pb-2">
        <button type="button" onClick={() => setCategory(undefined)} className={pill(!filter.category)}>
          全部
        </button>
        {enabledCategories.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCategory(filter.category === c.key ? undefined : c.key)}
            className={pill(filter.category === c.key)}
          >
            {c.name}
          </button>
        ))}
        {tags.length > 0 ? (
          <>
            <span className="mx-1 h-4 w-px bg-border/60" aria-hidden />
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTag(filter.tag === t.key ? undefined : t.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-[background-color,color,transform] active:scale-[0.96]",
                  filter.tag === t.key
                    ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted/70",
                )}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: t.color || "currentColor" }}
                />
                {t.name}
              </button>
            ))}
          </>
        ) : null}
      </div>

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          <ShopSkeleton />
        ) : empty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
              <SparklesIcon className="size-7 text-muted-foreground/50" />
            </div>
            <p className="text-base font-semibold">暂无上架装扮</p>
            <p className="max-w-xs text-[13px] text-muted-foreground text-pretty">
              {filter.category || filter.tag || filter.q
                ? "当前筛选下没有结果，换个品类或关键词试试。"
                : "商店还没有上架商品，敬请期待。"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {bundles.length > 0 ? (
              <section>
                <p className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  捆绑包
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {bundles.map((b) => (
                    <ShopBundleCard
                      key={b.id}
                      bundle={b}
                      points={points}
                      busy={busyId === b.id}
                      onAcquire={() => void acquire("bundle", b.id, b.price_points <= 0)}
                    />
                  ))}
                </div>
              </section>
            ) : null}
            {items.length > 0 ? (
              <section>
                {bundles.length > 0 ? (
                  <p className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    单品
                  </p>
                ) : null}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {items.map((item) => (
                    <ShopItemCard
                      key={item.id}
                      item={item}
                      points={points}
                      busy={busyId === item.id}
                      onAcquire={() => void acquire("item", item.id, item.price_points <= 0)}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
