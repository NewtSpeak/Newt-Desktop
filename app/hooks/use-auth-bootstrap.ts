// 冷启动会话引导。
//
// 只要 store 处于初始 "loading" 态就触发 bootstrap（单飞去重在 store 内部），
// 而不是模块级"只跑一次"标记：dev 下 HMR 会重建 store（状态回到 loading），
// 旧标记会让 bootstrap 永远不再执行，界面卡死在「正在恢复会话…」。

import { useEffect } from "react"

import { useAuthStore } from "~/stores/auth"

export function useAuthBootstrap() {
  const status = useAuthStore((state) => state.status)
  useEffect(() => {
    if (status === "loading") void useAuthStore.getState().bootstrap()
  }, [status])
  return status
}
