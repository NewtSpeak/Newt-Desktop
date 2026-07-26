// 我的装扮（首页 /?tab=shop&view=inventory）：已拥有装扮的管理页。
// 与商城同壳同卡片语言，试穿预览 + 装备/卸下；顶部横条展示当前各槽位装备。

import { useEffect, useMemo, useState } from "react"
import { CheckIcon, Loader2Icon, PackageOpenIcon, SparklesIcon } from "lucide-react"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { ItemPreview } from "~/components/cosmetics/item-preview"
import { ShopViewSwitch } from "~/components/cosmetics/shop-nav"
import { Button } from "~/components/ui/button"
import { Skeleton } from "~/components/ui/skeleton"
import { ApiError } from "~/lib/api/http"
import { SHOP_PATH } from "~/lib/shop-route"
import { cn } from "~/lib/utils"
import { useCosmeticsStore } from "~/stores/cosmetics"
import { useUIStore } from "~/stores/ui"
import type { CosmeticInventoryEntry } from "~/lib/api/cosmetics"

function errorMessage(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.message || fallback
  if (e instanceof Error) return e.message
  return fallback
}

/** 库存卡：试穿预览 + 名称/槽位/到期 + 装备状态与操作 */
function InventoryCard({
  entry,
  slotName,
  equipped,
  busy,
  onEquip,
  onUnequip,
}: {
  entry: CosmeticInventoryEntry
  slotName: string
  equipped: boolean
  busy: boolean
  onEquip: () => void
  onUnequip: () => void
}) {
  const item = entry.item
  if (!item) return null
  const canEquip = Boolean(item.slot)
  return (
    <div
      data-inventory-card
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-card/40",
        equipped ? "border-primary/50" : "border-border/60",
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted/40">
        <ItemPreview item={item} />
        {equipped ? (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-primary/90 px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
            <CheckIcon className="size-3" />
            使用中
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{item.name}</div>
          <div className="text-xs text-muted-foreground">
            {slotName}
            {entry.expires_at
              ? ` · 到期 ${new Date(entry.expires_at).toLocaleDateString()}`
              : ""}
          </div>
        </div>
        <div className="mt-auto flex justify-end">
          {equipped ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onUnequip}
              className="transition-transform active:scale-[0.96]"
            >
              {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
              卸下
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy || !canEquip}
              title={canEquip ? undefined : "该装扮暂不可装备"}
              onClick={onEquip}
              className="transition-transform active:scale-[0.96]"
            >
              {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
              装备
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function InventorySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-border/60">
          <Skeleton className="aspect-[4/3] rounded-none" />
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
            <div className="flex justify-end pt-1">
              <Skeleton className="h-8 w-14 rounded-lg" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function CosmeticsInventoryView() {
  const navigate = useNavigate()
  const inventory = useCosmeticsStore((s) => s.inventory)
  const loadout = useCosmeticsStore((s) => s.loadout)
  const categories = useCosmeticsStore((s) => s.categories)
  const loading = useCosmeticsStore((s) => s.loadingInventory)
  const [category, setCategory] = useState<string | undefined>()
  const [busyId, setBusyId] = useState<string | null>(null)

  // 进入页面：清频道选中保持私信侧栏（与商城/贴图库一致）+ 拉库存与装备
  useEffect(() => {
    const ui = useUIStore.getState()
    if (!(ui.selectedGuildId && ui.selectedGuildId !== "@me")) {
      if (ui.selectedChannelId != null || ui.selectedGuildId === "@me") {
        ui.selectGuild(null)
      }
    }
    const store = useCosmeticsStore.getState()
    void store.ensureMeta().catch(() => undefined)
    void store.loadInventory().catch(() => undefined)
    void store.loadLoadout().catch(() => undefined)
  }, [])

  // 列表不做入场动效：切换分类/加载后卡片直接呈现，避免每次操作都闪一遍 stagger

  const slotName = (slot: string) =>
    categories.find((c) => c.slot === slot)?.name ||
    categories.find((c) => c.key === slot)?.name ||
    slot

  const equippedItemIds = useMemo(
    () => new Set(Object.values(loadout).map((s) => s.item_id)),
    [loadout],
  )

  // 本地品类筛选（库存量小，无需服务端）；装备中的排前
  const entries = useMemo(() => {
    const filtered = inventory.filter((entry) => {
      if (!entry.item) return false
      if (!category) return true
      return entry.item.category_key === category
    })
    return [...filtered].sort((a, b) => {
      const ea = a.item && equippedItemIds.has(a.item.id) ? 0 : 1
      const eb = b.item && equippedItemIds.has(b.item.id) ? 0 : 1
      return ea - eb
    })
  }, [inventory, category, equippedItemIds])

  const ownedCategories = useMemo(() => {
    const keys = new Set(
      inventory.map((e) => e.item?.category_key).filter(Boolean) as string[],
    )
    return categories.filter((c) => keys.has(c.key))
  }, [inventory, categories])

  const equipAction = async (action: "equip" | "unequip", slot: string, itemId: string) => {
    setBusyId(itemId)
    try {
      const store = useCosmeticsStore.getState()
      if (action === "equip") {
        await store.equip(slot, itemId)
        toast.success("已装备")
      } else {
        await store.unequip(slot)
        toast.success("已卸下")
      }
    } catch (e) {
      toast.error(errorMessage(e, action === "equip" ? "装备失败" : "卸下失败"))
    } finally {
      setBusyId(null)
    }
  }

  const pill = (active: boolean) =>
    cn(
      "rounded-full px-3 py-1 text-xs transition-[background-color,color,transform] active:scale-[0.96]",
      active
        ? "bg-primary text-primary-foreground"
        : "bg-muted/60 text-muted-foreground hover:bg-muted",
    )

  const equippedSlots = Object.entries(loadout)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶栏：左切换 + 右侧当前装备数 */}
      <header className="relative flex h-12 shrink-0 items-center gap-2 px-3">
        <ShopViewSwitch active="inventory" />
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {inventory.length} 件已拥有
        </span>
      </header>

      {/* 当前装备横条 */}
      {equippedSlots.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pb-2">
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            当前装备
          </span>
          {equippedSlots.map(([slot, eq]) => (
            <span
              key={slot}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 py-1 pr-1 pl-2.5 text-xs text-primary"
            >
              <span className="text-muted-foreground">{slotName(slot)}</span>
              <span className="max-w-28 truncate font-medium">{eq.name}</span>
              <button
                type="button"
                aria-label={`卸下${eq.name}`}
                onClick={() => void equipAction("unequip", slot, eq.item_id)}
                className="rounded-full px-1.5 py-0.5 text-[10px] text-muted-foreground transition-[background-color,color] hover:bg-primary/15 hover:text-foreground"
              >
                卸下
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {/* 品类筛选（仅显示已拥有的品类） */}
      {ownedCategories.length > 1 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pb-2">
          <button type="button" onClick={() => setCategory(undefined)} className={pill(!category)}>
            全部
          </button>
          {ownedCategories.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(category === c.key ? undefined : c.key)}
              className={pill(category === c.key)}
            >
              {c.name}
            </button>
          ))}
        </div>
      ) : null}

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {loading && inventory.length === 0 ? (
          <InventorySkeleton />
        ) : entries.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
              {category ? (
                <SparklesIcon className="size-7 text-muted-foreground/50" />
              ) : (
                <PackageOpenIcon className="size-7 text-muted-foreground/50" />
              )}
            </div>
            <p className="text-base font-semibold">
              {category ? "该品类下暂无装扮" : "还没有装扮"}
            </p>
            <p className="max-w-xs text-[13px] text-muted-foreground text-pretty">
              {category
                ? "换个品类看看，或去商城逛逛。"
                : "去装扮商城领取或用积分兑换你的第一件装扮吧。"}
            </p>
            <Button
              size="sm"
              onClick={() => navigate(SHOP_PATH)}
              className="transition-transform active:scale-[0.96]"
            >
              去商城逛逛
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {entries.map((entry) => {
              const item = entry.item!
              const equipped = equippedItemIds.has(item.id)
              const slot = item.slot || item.category_key
              return (
                <InventoryCard
                  key={entry.id}
                  entry={entry}
                  slotName={slotName(slot)}
                  equipped={equipped}
                  busy={busyId === item.id}
                  onEquip={() => void equipAction("equip", item.slot || "", item.id)}
                  onUnequip={() => void equipAction("unequip", item.slot || "", item.id)}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
