// 已下载待安装时的全局轻提示条（桌面端）

import { useEffect, useState } from "react"
import { DownloadIcon, XIcon } from "lucide-react"

import { Button } from "~/components/ui/button"
import { cn } from "~/lib/utils"
import { useSettingsStore } from "~/stores/settings"
import { useUpdaterStore } from "~/stores/updater"

export function UpdateReadyBanner() {
  const supported = useUpdaterStore((s) => s.supported)
  const status = useUpdaterStore((s) => s.status)
  const installNow = useUpdaterStore((s) => s.installNow)
  const busy = useUpdaterStore((s) => s.busy)
  const openPanel = useSettingsStore((s) => s.openPanel)
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)

  const version = status?.latestVersion ?? null

  useEffect(() => {
    // 新版本到来时重新展示
    if (version && dismissedVersion && version !== dismissedVersion) {
      setDismissedVersion(null)
    }
  }, [version, dismissedVersion])

  if (
    !supported ||
    status?.phase !== "ready" ||
    !version ||
    dismissedVersion === version
  ) {
    return null
  }

  return (
    <div
      className={cn(
        "pointer-events-auto fixed right-4 bottom-4 z-70 flex max-w-sm items-start gap-3 rounded-2xl border border-border/60 bg-card/95 p-3.5 shadow-lg backdrop-blur-md",
      )}
      role="status"
    >
      <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
        <DownloadIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">新版本 v{version} 已就绪</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          安装包已下载到本地。可立即安装，或关闭应用时自动更新。
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void installNow()}
          >
            立即更新
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openPanel("about")}
          >
            查看详情
          </Button>
        </div>
      </div>
      <button
        type="button"
        aria-label="关闭提示"
        className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => setDismissedVersion(version)}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  )
}
