// 我的装扮：库存列表 + 装备/卸下。

import { useEffect } from "react"
import { toast } from "sonner"

import { SectionTitle, GroupLabel } from "~/components/settings/section"
import { settingsAnchorDomId } from "~/components/settings/settings-toc"
import { Button } from "~/components/ui/button"
import { ApiError } from "~/lib/api/http"
import { resolveProfileAssetUrl } from "~/lib/user-display"
import { useCosmeticsStore } from "~/stores/cosmetics"

function errorMessage(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.message || fallback
  if (e instanceof Error) return e.message
  return fallback
}

export function CosmeticsInventorySection() {
  const inventory = useCosmeticsStore((s) => s.inventory)
  const loadout = useCosmeticsStore((s) => s.loadout)
  const categories = useCosmeticsStore((s) => s.categories)
  const loading = useCosmeticsStore((s) => s.loadingInventory)

  useEffect(() => {
    const store = useCosmeticsStore.getState()
    void store.ensureMeta()
    void store.loadInventory()
    void store.loadLoadout()
  }, [])

  const slotName = (slot: string) =>
    categories.find((c) => c.slot === slot)?.name || slot

  const equippedItemIds = new Set(
    Object.values(loadout).map((s) => s.item_id),
  )

  return (
    <div className="space-y-6">
      {/* 标题 + 描述（对齐 section.tsx 现行 API；锚点供子菜单跳转） */}
      <div id={settingsAnchorDomId("cosmetics-inventory")} className="scroll-mt-6">
        <SectionTitle>我的装扮</SectionTitle>
        <p className="-mt-3 text-sm text-muted-foreground">
          管理已获得的装扮，按槽位装备或卸下。装备后将对所有服务器可见。
        </p>
      </div>

      <div>
        <GroupLabel>当前装备</GroupLabel>
        {Object.keys(loadout).length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">尚未装备任何装扮</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {Object.entries(loadout).map(([slot, eq]) => (
              <li
                key={slot}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">
                    {slotName(slot)}
                  </div>
                  <div className="truncate text-sm font-medium">{eq.name}</div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void useCosmeticsStore
                      .getState()
                      .unequip(slot)
                      .then(() => toast.success("已卸下"))
                      .catch((e) => toast.error(errorMessage(e, "卸下失败")))
                  }
                >
                  卸下
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <GroupLabel>库存</GroupLabel>
        {loading ? (
          <p className="mt-2 text-sm text-muted-foreground">加载中…</p>
        ) : inventory.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            库存为空，去商店领取或兑换吧
          </p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {inventory.map((entry) => {
              const item = entry.item
              if (!item) return null
              const preview = resolveProfileAssetUrl(item.preview_url)
              const equipped = equippedItemIds.has(item.id)
              const slot = item.slot || ""
              return (
                <li
                  key={entry.id}
                  className="flex items-center gap-3 rounded-xl border border-border/50 p-2"
                >
                  <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {preview ? (
                      <img
                        src={preview}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {item.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {slotName(slot || item.category_key)}
                      {entry.expires_at
                        ? ` · 到期 ${new Date(entry.expires_at).toLocaleDateString()}`
                        : ""}
                    </div>
                  </div>
                  {equipped ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void useCosmeticsStore
                          .getState()
                          .unequip(slot)
                          .then(() => toast.success("已卸下"))
                          .catch((e) =>
                            toast.error(errorMessage(e, "卸下失败")),
                          )
                      }
                    >
                      卸下
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={!slot}
                      onClick={() =>
                        void useCosmeticsStore
                          .getState()
                          .equip(slot, item.id)
                          .then(() => toast.success("已装备"))
                          .catch((e) =>
                            toast.error(errorMessage(e, "装备失败")),
                          )
                      }
                    >
                      装备
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
