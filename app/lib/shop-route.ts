// 装扮商城导航与路径判定：统一走 /?tab=shop（index 路由）。
// /shop 别名进入后 replace 到上述 URL（模式与 stickers-route 一致）。

import type { Location } from "react-router"

/** 打开装扮商城的目标路径 */
export const SHOP_PATH = "/?tab=shop"

/** 我的装扮（已拥有装扮的管理页） */
export const SHOP_INVENTORY_PATH = "/?tab=shop&view=inventory"

/** 当前是否处于装扮商城（含"我的装扮"子页） */
export function isShopLocation(
  location: Pick<Location, "pathname" | "search">,
): boolean {
  if (location.pathname === "/shop" || location.pathname.startsWith("/shop/")) {
    return true
  }
  if (location.pathname === "/" || location.pathname === "") {
    const tab = new URLSearchParams(location.search).get("tab")
    return tab === "shop"
  }
  return false
}

/** 是否在"我的装扮"子页 */
export function isShopInventoryLocation(
  location: Pick<Location, "pathname" | "search">,
): boolean {
  if (!isShopLocation(location)) return false
  if (location.pathname.startsWith("/shop/inventory")) return true
  const view = new URLSearchParams(location.search).get("view")
  return view === "inventory"
}
