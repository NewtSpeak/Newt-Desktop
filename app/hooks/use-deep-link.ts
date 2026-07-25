// 监听 Tauri 深链与单实例二次启动参数，导航到 OAuth / 邀请页并聚焦窗口。

import { useEffect } from "react"
import { useNavigate } from "react-router"

import { resolveDeepLinkPath } from "~/lib/deep-link"
import { isTauriRuntime } from "~/lib/secure-storage"

function applyUrl(navigate: ReturnType<typeof useNavigate>, raw: string) {
  const path = resolveDeepLinkPath(raw)
  if (path) navigate(path)
}

function applyUrls(
  navigate: ReturnType<typeof useNavigate>,
  urls: string[] | null | undefined,
) {
  if (!urls?.length) return
  for (const u of urls) applyUrl(navigate, u)
}

/**
 * 在根布局挂载：
 * 1. deep-link 插件 getCurrent / onOpenUrl
 * 2. 单实例插件转发的 `owl://deep-link` 事件（Windows/Linux 已运行时二次唤起）
 */
export function useDeepLinkNavigation() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!isTauriRuntime()) return
    const cleanups: Array<() => void> = []

    void (async () => {
      try {
        const mod = await import("@tauri-apps/plugin-deep-link")
        const urls = await mod.getCurrent()
        applyUrls(navigate, urls)
        const un = await mod.onOpenUrl((opened) => {
          applyUrls(navigate, opened)
        })
        cleanups.push(un)
      } catch {
        // 插件未配置或非桌面：忽略
      }

      try {
        const { listen } = await import("@tauri-apps/api/event")
        const un = await listen<string[]>("owl://deep-link", (event) => {
          applyUrls(navigate, event.payload)
        })
        cleanups.push(un)
      } catch {
        // ignore
      }
    })()

    return () => {
      for (const fn of cleanups) fn()
    }
  }, [navigate])
}
