import { useEffect, useState } from "react"

/** 是否运行在 Tauri 桌面窗口中（无系统标题栏，内容顶到窗口边缘） */
export function useIsTauri() {
  const [isTauri, setIsTauri] = useState(false)

  useEffect(() => {
    setIsTauri("__TAURI_INTERNALS__" in window)
  }, [])

  return isTauri
}

/** 是否运行在 macOS 的 Tauri 桌面窗口中（交通灯悬浮于窗口左上角） */
export function useIsMacDesktop() {
  const [isMacDesktop, setIsMacDesktop] = useState(false)

  useEffect(() => {
    setIsMacDesktop(
      "__TAURI_INTERNALS__" in window && navigator.userAgent.includes("Mac"),
    )
  }, [])

  return isMacDesktop
}
