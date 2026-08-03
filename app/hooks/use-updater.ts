// 挂载即订阅桌面端更新事件，并初始化状态。

import { useEffect } from "react"
import {
  isDesktopUpdaterSupported,
  type MirrorProbeResult,
  type UpdateStatus,
} from "~/lib/updater"
import { useUpdaterStore } from "~/stores/updater"

/** 在 App 根挂载：拉取初始状态 + 监听 Rust 推送 */
export function useUpdaterBootstrap() {
  const init = useUpdaterStore((s) => s.init)
  const applyStatus = useUpdaterStore((s) => s.applyStatus)
  const applyProbe = useUpdaterStore((s) => s.applyProbe)

  useEffect(() => {
    if (!isDesktopUpdaterSupported()) return
    void init()

    let disposed = false
    const stops: Array<() => void> = []

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event")
        const stopStatus = await listen<UpdateStatus>(
          "updater://status",
          (event) => {
            if (!disposed) applyStatus(event.payload)
          },
        )
        const stopProbe = await listen<MirrorProbeResult>(
          "updater://mirror-probe",
          (event) => {
            if (!disposed) applyProbe(event.payload)
          },
        )
        if (disposed) {
          stopStatus()
          stopProbe()
        } else {
          stops.push(stopStatus, stopProbe)
        }
      } catch (error) {
        console.warn("updater: 订阅状态事件失败", error)
      }
    })()

    return () => {
      disposed = true
      for (const stop of stops) stop()
    }
  }, [init, applyStatus, applyProbe])
}
