// 装扮商城 / 我的装扮 分段切换（两个视图 header 共用）。

import { useNavigate } from "react-router"

import { SHOP_INVENTORY_PATH, SHOP_PATH } from "~/lib/shop-route"
import { cn } from "~/lib/utils"

export function ShopViewSwitch({ active }: { active: "shop" | "inventory" }) {
  const navigate = useNavigate()
  const seg = (isActive: boolean) =>
    cn(
      "rounded-full px-3 py-1 text-xs transition-[background-color,color,transform] active:scale-[0.96]",
      isActive
        ? "bg-background font-medium text-foreground shadow-xs"
        : "text-muted-foreground hover:text-foreground",
    )
  return (
    <div className="inline-flex shrink-0 items-center rounded-full bg-muted/60 p-0.5">
      <button
        type="button"
        onClick={() => active !== "shop" && navigate(SHOP_PATH)}
        className={seg(active === "shop")}
        aria-current={active === "shop" ? "page" : undefined}
      >
        商城
      </button>
      <button
        type="button"
        onClick={() => active !== "inventory" && navigate(SHOP_INVENTORY_PATH)}
        className={seg(active === "inventory")}
        aria-current={active === "inventory" ? "page" : undefined}
      >
        我的装扮
      </button>
    </div>
  )
}
