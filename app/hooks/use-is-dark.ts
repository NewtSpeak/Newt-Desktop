// 当前是否暗色主题：以 settings applyAppearance 写到 <html> 的 dark class 为准。
// 单例 MutationObserver + useSyncExternalStore，避免每个用户名组件各挂一个监听。

import { useSyncExternalStore } from "react"

const listeners = new Set<() => void>()
let observer: MutationObserver | null = null

function readIsDark(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  )
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!observer && typeof document !== "undefined") {
    observer = new MutationObserver(() => {
      for (const fn of listeners) fn()
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && observer) {
      observer.disconnect()
      observer = null
    }
  }
}

/** 当前是否暗色主题（跟随主题切换实时更新） */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, readIsDark, () => false)
}
