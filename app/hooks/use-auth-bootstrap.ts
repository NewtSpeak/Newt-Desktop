// 冷启动会话引导：整个应用生命周期内只触发一次静默续期。

import { useEffect } from "react"

import { useAuthStore } from "~/stores/auth"

let started = false

export function useAuthBootstrap() {
  const status = useAuthStore((state) => state.status)
  useEffect(() => {
    if (started) return
    started = true
    void useAuthStore.getState().bootstrap()
  }, [])
  return status
}
