import { useEffect, useState } from "react"

/** 是否运行在 Tauri 环境（桌面或移动 App） */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

/** 是否为移动端 UA（Android / iOS，含 Tauri App WebView） */
export function isMobileUa(): boolean {
  if (typeof navigator === "undefined") return false
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

/** 是否为 Tauri 移动 App（Android / iOS），非 Windows/macOS 桌面壳 */
export function isMobileAppRuntime(): boolean {
  return isTauriRuntime() && isMobileUa()
}

/** 是否运行在 Tauri 桌面窗口中（无系统标题栏，内容顶到窗口边缘） */
export function useIsTauri() {
  const [isTauri, setIsTauri] = useState(false)

  useEffect(() => {
    setIsTauri(isTauriRuntime())
  }, [])

  return isTauri
}

/** 是否运行在 macOS 的 Tauri 桌面窗口中（交通灯悬浮于窗口左上角） */
export function useIsMacDesktop() {
  const [isMacDesktop, setIsMacDesktop] = useState(false)

  useEffect(() => {
    setIsMacDesktop(isTauriRuntime() && navigator.userAgent.includes("Mac") && !isMobileUa())
  }, [])

  return isMacDesktop
}

/** 是否运行在 Tauri 移动 App（Android / iOS） */
export function useIsMobileApp() {
  // 初始即同步判断，避免 Titlebar 等控件先闪后藏
  const [isMobileApp, setIsMobileApp] = useState(() => {
    if (typeof window === "undefined") return false
    return isMobileAppRuntime()
  })

  useEffect(() => {
    setIsMobileApp(isMobileAppRuntime())
  }, [])

  return isMobileApp
}

/**
 * 是否显示自定义窗口三键（最小化 / 最大化 / 关闭）。
 * 仅 Windows/Linux 桌面 Tauri；macOS 用系统交通灯；移动 App 绝不显示。
 */
export function useShowWindowControls() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const tauri = isTauriRuntime()
    const mobile = isMobileUa()
    const mac = navigator.userAgent.includes("Mac") && !mobile
    setShow(tauri && !mobile && !mac)
  }, [])

  return show
}
