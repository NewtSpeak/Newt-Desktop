// 贴图库导航与路径判定：统一走 /?tab=stickers（index 路由）。
// /stickers 别名进入后 replace 到上述 URL。

import type { Location } from "react-router"

/** 打开贴图库的目标路径 */
export const STICKERS_PATH = "/?tab=stickers"

/** 创建贴图包向导 */
export const STICKERS_CREATE_PATH = "/?tab=stickers&view=create"

/** 管理我的贴图包 */
export const STICKERS_MANAGE_PATH = "/?tab=stickers&view=manage"

/** 当前是否处于贴图库（含创建 / 管理子页） */
export function isStickersLocation(
  location: Pick<Location, "pathname" | "search">,
): boolean {
  if (
    location.pathname === "/stickers" ||
    location.pathname.startsWith("/stickers/")
  ) {
    return true
  }
  if (location.pathname === "/" || location.pathname === "") {
    const tab = new URLSearchParams(location.search).get("tab")
    return tab === "stickers"
  }
  return false
}

/** 是否在创建向导页 */
export function isStickersCreateLocation(
  location: Pick<Location, "pathname" | "search">,
): boolean {
  if (!isStickersLocation(location)) return false
  if (location.pathname.startsWith("/stickers/create")) return true
  const view = new URLSearchParams(location.search).get("view")
  return view === "create"
}

/** 是否在管理页 */
export function isStickersManageLocation(
  location: Pick<Location, "pathname" | "search">,
): boolean {
  if (!isStickersLocation(location)) return false
  if (location.pathname.startsWith("/stickers/manage")) return true
  const view = new URLSearchParams(location.search).get("view")
  return view === "manage"
}
