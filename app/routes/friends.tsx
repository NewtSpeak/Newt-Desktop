// 好友页路由：/friends（与 /?tab=friends 等价，兼容书签与旧入口）。

import { useEffect } from "react"
import { useNavigate } from "react-router"

import { FriendsView } from "~/components/friends-view"

/** 规范化到首页 tab，避免部分会话里后注册的 /friends 路由未热更新而 404 */
export default function FriendsRoute() {
  const navigate = useNavigate()

  useEffect(() => {
    navigate("/?tab=friends", { replace: true })
  }, [navigate])

  // 重定向前先渲染，保证已有 /friends 路由的会话也能立刻看到内容
  return <FriendsView />
}
