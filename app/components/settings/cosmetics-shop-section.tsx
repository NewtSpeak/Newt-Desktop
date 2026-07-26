// 装扮商店：品类 Tab、标签筛选、兑换/领取。

import { useEffect, useState } from "react"
import { CoinsIcon, PackageIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"

import { SectionTitle, GroupLabel, SettingRow } from "~/components/settings/section"
import { settingsAnchorDomId } from "~/components/settings/settings-toc"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { resolveProfileAssetUrl } from "~/lib/user-display"
import { ApiError } from "~/lib/api/http"
import { useCosmeticsStore } from "~/stores/cosmetics"
import { cn } from "~/lib/utils"
import type { CosmeticBundle, CosmeticItem } from "~/lib/api/cosmetics"

function errorMessage(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.message || fallback
  if (e instanceof Error) return e.message
  return fallback
}

function ShopItemCard({
  item,
  points,
  onAcquire,
  onEquip,
}: {
  item: CosmeticItem
  points: number
  onAcquire: () => void
  onEquip?: () => void
}) {
  const preview = resolveProfileAssetUrl(item.preview_url)
  const owned = Boolean(item.owned)
  const free = item.price_points <= 0
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40">
      <div className="relative aspect-[4/3] bg-muted/40">
        {preview ? (
          <img src={preview} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <SparklesIcon className="size-8 opacity-40" />
          </div>
        )}
        {owned ? (
          <span className="absolute top-2 right-2 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[10px] font-medium text-white">
            已拥有
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{item.name}</div>
          <div className="line-clamp-2 text-xs text-muted-foreground">
            {item.description || item.category_key}
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-amber-500">
            <CoinsIcon className="size-3.5" />
            {free ? "免费" : item.price_points}
          </span>
          {owned ? (
            onEquip ? (
              <Button size="sm" variant="secondary" onClick={onEquip}>
                装备
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">在库存中装备</span>
            )
          ) : (
            <Button
              size="sm"
              disabled={!free && points < item.price_points}
              onClick={onAcquire}
            >
              {free ? "领取" : "兑换"}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function ShopBundleCard({
  bundle,
  points,
  onAcquire,
}: {
  bundle: CosmeticBundle
  points: number
  onAcquire: () => void
}) {
  const preview = resolveProfileAssetUrl(bundle.preview_url)
  const owned = Boolean(bundle.owned_all)
  const free = bundle.price_points <= 0
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-violet-500/30 bg-violet-500/5">
      <div className="relative aspect-[4/3] bg-muted/40">
        {preview ? (
          <img src={preview} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <PackageIcon className="size-8 opacity-40" />
          </div>
        )}
        <span className="absolute top-2 left-2 rounded-full bg-violet-600/90 px-2 py-0.5 text-[10px] font-medium text-white">
          捆绑包
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="truncate text-sm font-medium">{bundle.name}</div>
        <div className="line-clamp-2 text-xs text-muted-foreground">
          {bundle.description || `${bundle.item_ids?.length ?? 0} 件装扮`}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-amber-500">
            <CoinsIcon className="size-3.5" />
            {free ? "免费" : bundle.price_points}
          </span>
          {owned ? (
            <span className="text-xs text-muted-foreground">已全部拥有</span>
          ) : (
            <Button
              size="sm"
              disabled={!free && points < bundle.price_points}
              onClick={onAcquire}
            >
              {free ? "领取" : "兑换"}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export function CosmeticsShopSection() {
  const categories = useCosmeticsStore((s) => s.categories)
  const tags = useCosmeticsStore((s) => s.tags)
  const items = useCosmeticsStore((s) => s.shopItems)
  const bundles = useCosmeticsStore((s) => s.shopBundles)
  const points = useCosmeticsStore((s) => s.points)
  const loading = useCosmeticsStore((s) => s.loadingShop)
  const filter = useCosmeticsStore((s) => s.shopFilter)
  const [q, setQ] = useState(filter.q ?? "")

  useEffect(() => {
    const store = useCosmeticsStore.getState()
    void store.ensureMeta()
    void store.loadShop()
    void store.loadPoints()
    void store.loadInventory()
    void store.loadLoadout()
  }, [])

  const setCategory = (key?: string) => {
    void useCosmeticsStore.getState().loadShop({
      ...filter,
      category: key,
    })
  }

  const setTag = (key?: string) => {
    void useCosmeticsStore.getState().loadShop({
      ...filter,
      tag: key,
    })
  }

  const acquire = async (type: "item" | "bundle", id: string, free: boolean) => {
    try {
      if (free) await useCosmeticsStore.getState().claim(type, id)
      else await useCosmeticsStore.getState().purchase(type, id)
      toast.success(free ? "领取成功" : "兑换成功")
    } catch (e) {
      toast.error(errorMessage(e, free ? "领取失败" : "兑换失败"))
    }
  }

  return (
    <div className="space-y-6">
      {/* 标题 + 描述（对齐 section.tsx 现行 API；锚点供子菜单跳转） */}
      <div id={settingsAnchorDomId("cosmetics-shop")} className="scroll-mt-6">
        <SectionTitle>装扮商店</SectionTitle>
        <p className="-mt-3 text-sm text-muted-foreground">
          浏览并兑换头像框、资料卡边框、特效与铭牌；支持主题标签筛选。
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
        <div className="inline-flex items-center gap-2 text-sm">
          <CoinsIcon className="size-4 text-amber-500" />
          <span className="text-muted-foreground">我的积分</span>
          <span className="font-semibold tabular-nums">{points}</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled
          title="即将推出"
          className="opacity-60"
        >
          服务器货币兑换（即将推出）
        </Button>
      </div>

      <div>
        <GroupLabel>品类</GroupLabel>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategory(undefined)}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition-colors",
              !filter.category
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:bg-muted",
            )}
          >
            全部
          </button>
          {categories.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs transition-colors",
                filter.category === c.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {tags.length > 0 ? (
        <div>
          <GroupLabel>主题标签</GroupLabel>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTag(undefined)}
              className={cn(
                "rounded-full px-3 py-1 text-xs transition-colors",
                !filter.tag
                  ? "bg-primary/20 text-primary ring-1 ring-primary/40"
                  : "bg-muted/40 text-muted-foreground",
              )}
            >
              全部主题
            </button>
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTag(t.key)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs transition-colors",
                  filter.tag === t.key
                    ? "bg-primary/20 text-primary ring-1 ring-primary/40"
                    : "bg-muted/40 text-muted-foreground",
                )}
                style={
                  t.color
                    ? { borderColor: t.color, boxShadow: filter.tag === t.key ? `0 0 0 1px ${t.color}` : undefined }
                    : undefined
                }
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索装扮…"
          className="max-w-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void useCosmeticsStore.getState().loadShop({ ...filter, q: q.trim() || undefined })
            }
          }}
        />
        <Button
          variant="secondary"
          onClick={() =>
            void useCosmeticsStore.getState().loadShop({
              ...filter,
              q: q.trim() || undefined,
            })
          }
        >
          搜索
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : (
        <>
          {bundles.length > 0 ? (
            <div>
              <GroupLabel>捆绑包</GroupLabel>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {bundles.map((b) => (
                  <ShopBundleCard
                    key={b.id}
                    bundle={b}
                    points={points}
                    onAcquire={() =>
                      void acquire("bundle", b.id, b.price_points <= 0)
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <GroupLabel>单品</GroupLabel>
            {items.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">暂无上架装扮</p>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => (
                  <ShopItemCard
                    key={item.id}
                    item={item}
                    points={points}
                    onAcquire={() =>
                      void acquire("item", item.id, item.price_points <= 0)
                    }
                    onEquip={
                      item.owned && item.slot
                        ? () => {
                            void useCosmeticsStore
                              .getState()
                              .equip(item.slot!, item.id)
                              .then(() => toast.success("已装备"))
                              .catch((e) =>
                                toast.error(errorMessage(e, "装备失败")),
                              )
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <SettingRow
        label="关于积分"
        description="积分可通过每日活跃自动获得（详见「活跃度」页），也可由管理员发放。使用服务器内货币兑换积分的入口已预留，当前尚未开放。"
      />
    </div>
  )
}
