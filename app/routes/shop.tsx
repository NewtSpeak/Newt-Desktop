// 装扮商城路由：/shop（与 /?tab=shop 等价，兼容书签；view=inventory 为我的装扮）。

import { useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router"

import { CosmeticsInventoryView } from "~/components/cosmetics-inventory-view"
import { CosmeticsShopView } from "~/components/cosmetics-shop-view"
import { SHOP_INVENTORY_PATH, SHOP_PATH } from "~/lib/shop-route"

/** 规范化到首页 tab，避免后注册路由未热更新而 404 */
export default function ShopRoute() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const view = searchParams.get("view")

  useEffect(() => {
    if (view === "inventory") {
      navigate(SHOP_INVENTORY_PATH, { replace: true })
      return
    }
    navigate(SHOP_PATH, { replace: true })
  }, [navigate, view])

  if (view === "inventory") return <CosmeticsInventoryView />
  return <CosmeticsShopView />
}
