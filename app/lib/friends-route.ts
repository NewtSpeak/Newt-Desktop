// 好友页导航与路径判定：统一走 /?tab=friends（index 路由，始终存在）。
// /friends 仍保留为兼容别名，进入后会 replace 到上述 URL。

import type { Location } from "react-router"

/** 打开好友页的目标路径（query on index） */
export const FRIENDS_PATH = "/?tab=friends"

/** 当前是否处于好友页（含 /friends 别名与 /?tab=friends） */
export function isFriendsLocation(
  location: Pick<Location, "pathname" | "search">,
): boolean {
  if (
    location.pathname === "/friends" ||
    location.pathname.startsWith("/friends/")
  ) {
    return true
  }
  if (location.pathname === "/" || location.pathname === "") {
    const tab = new URLSearchParams(location.search).get("tab")
    return tab === "friends"
  }
  return false
}
