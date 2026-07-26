// 冷启动会话引导。
//
// 只要 store 处于初始 "loading" 态就触发 bootstrap（单飞去重在 store 内部），
// 而不是模块级"只跑一次"标记：dev 下 HMR 会重建 store（状态回到 loading），
// 旧标记会让 bootstrap 永远不再执行，界面卡死在「正在恢复会话…」。
//
// 额外：组件级硬超时。即使 store bootstrap 因未捕获异常卡死，也强制进入欢迎页。

import { useEffect } from "react"

import { useAuthStore } from "~/stores/auth"

/** 比 store 内超时略长，作为最后兜底 */
const UI_BOOTSTRAP_HARD_TIMEOUT_MS = 6_000

export function useAuthBootstrap() {
  const status = useAuthStore((state) => state.status)

  useEffect(() => {
    if (status === "loading") {
      void useAuthStore.getState().bootstrap()
    }
  }, [status])

  // 硬超时：无论 bootstrap 是否抛错/挂起，禁止 loading 超过此时间
  useEffect(() => {
    if (status !== "loading") return
    const timer = window.setTimeout(() => {
      const current = useAuthStore.getState().status
      if (current !== "loading") return
      console.error(
        "auth: UI 硬超时，强制进入未登录欢迎页（bootstrap 可能已挂起）",
      )
      useAuthStore.setState({
        status: "unauthenticated",
        user: null,
        activeAccountId: null,
        accounts: useAuthStore.getState().accounts,
      })
    }, UI_BOOTSTRAP_HARD_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  return status
}
