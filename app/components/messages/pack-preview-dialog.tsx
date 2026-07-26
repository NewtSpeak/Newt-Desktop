// Pack Preview：消息内点击表情 → 预览包网格 → Install / Copy（docs 17 §13.1）

import { useEffect, useRef, useState } from "react"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import {
  CopyIcon,
  DownloadIcon,
  Loader2Icon,
  PackageIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { StickerMedia } from "~/components/messages/sticker-media"
import {
  copyStickerItem,
  getStickerPack,
  installStickerPack,
  listMyStickerPacks,
} from "~/lib/api/stickers"
import { ApiError, resolveApiUrl } from "~/lib/api/http"
import type { StickerItem, StickerPack } from "~/lib/api/types"
import { cn } from "~/lib/utils"
import { useStickersStore } from "~/stores/stickers"

gsap.registerPlugin(useGSAP)

export function PackPreviewDialog() {
  const packId = useStickersStore((s) => s.previewPackId)
  const itemId = useStickersStore((s) => s.previewItemId)
  const guildId = useStickersStore((s) => s.previewGuildId)
  const close = useStickersStore((s) => s.closePackPreview)
  const invalidate = useStickersStore((s) => s.invalidateAvailable)
  const cacheItems = useStickersStore((s) => s.cacheItems)

  const [pack, setPack] = useState<StickerPack | null>(null)
  const [canInstall, setCanInstall] = useState(false)
  const [canCopy, setCanCopy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)

  const open = Boolean(packId)

  useEffect(() => {
    if (!packId) {
      setPack(null)
      return
    }
    setLoading(true)
    getStickerPack(packId, {
      guild_id: guildId ?? undefined,
      item_id: itemId ?? undefined,
    })
      .then((res) => {
        setPack(res.pack)
        setCanInstall(res.can_install)
        setCanCopy(res.can_copy)
        if (res.pack.items?.length) cacheItems(res.pack.items)
      })
      .catch((err) => {
        toast.error(err instanceof ApiError ? err.message : "无法加载表情包")
        close()
      })
      .finally(() => setLoading(false))
  }, [packId, itemId, guildId, cacheItems, close])

  useGSAP(
    () => {
      if (!gridRef.current || !pack?.items?.length) return
      const prefersReduced =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      if (prefersReduced) return
      gsap.from(gridRef.current.querySelectorAll("[data-sticker-cell]"), {
        opacity: 0,
        scale: 0.88,
        y: 8,
        duration: 0.28,
        stagger: 0.03,
        ease: "power2.out",
        clearProps: "transform,opacity",
      })
    },
    { dependencies: [pack?.id, pack?.items?.length], scope: gridRef },
  )

  const onInstall = async () => {
    if (!packId) return
    setBusy(true)
    try {
      await installStickerPack(packId, guildId ?? undefined)
      toast.success("已加入贴图库")
      invalidate()
      setCanInstall(false)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Install 失败")
    } finally {
      setBusy(false)
    }
  }

  const onCopy = async (item: StickerItem) => {
    setBusy(true)
    try {
      const mine = await listMyStickerPacks()
      const target = mine.find(
        (p) => p.kind === item.kind && p.status === "active",
      )
      if (!target) {
        toast.error(
          `请先创建一个 ${item.kind === "emote" ? "小表情" : "贴图"} 包再复制`,
        )
        return
      }
      await copyStickerItem(target.id, item.id)
      toast.success(`已复制到「${target.name}」`)
      invalidate()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "复制失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent
        showCloseButton={false}
        className="max-w-md gap-0 overflow-hidden border-0 p-0 shadow-xl ring-0 sm:max-w-lg dark:ring-0"
      >
        <DialogHeader className="bg-muted/25 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-balance">
                <PackageIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {pack?.name ?? (loading ? "加载中…" : "表情包")}
                </span>
              </DialogTitle>
              <DialogDescription className="mt-1 text-pretty">
                {pack
                  ? `${pack.kind === "emote" ? "小表情" : "贴图"} · ${
                      pack.scope === "guild" ? "服独属" : "账号级"
                    }${pack.description ? ` · ${pack.description}` : ""}`
                  : "预览与收藏"}
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.96]"
              aria-label="关闭"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </DialogHeader>

        <div className="max-h-[min(60vh,420px)] overflow-y-auto px-4 py-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              加载表情…
            </div>
          )}
          {!loading && pack && (pack.items?.length ?? 0) === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {pack.allow_browse_full
                ? "包内暂无条目"
                : "作者关闭了完整浏览，仅显示你点开的那一项"}
            </p>
          )}
          {!loading && pack?.items && pack.items.length > 0 && (
            <div
              ref={gridRef}
              className="grid grid-cols-4 gap-2 sm:grid-cols-5"
            >
              {pack.items.map((item) => {
                const highlight = item.id === itemId
                return (
                  <div
                    key={item.id}
                    data-sticker-cell
                    className={cn(
                      "group relative flex flex-col items-center gap-1 rounded-xl border-0 p-2",
                      "bg-muted/40 ring-0 outline-none",
                      "transition-[background-color,transform] duration-150",
                      "hover:bg-muted/65",
                      // 当前点开的项：仅用底色区分，不要描边/ring
                      highlight && "bg-primary/12",
                    )}
                  >
                    <StickerMedia
                      src={item.asset_url}
                      alt={item.name || item.mark}
                      width={64}
                      height={64}
                      className="size-14"
                      draggable={false}
                    />
                    <span className="max-w-full truncate text-[10px] text-muted-foreground tabular-nums">
                      {item.name || item.mark}
                    </span>
                    {canCopy && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onCopy(item)}
                        className={cn(
                          "absolute top-1 right-1 rounded-md bg-background/90 p-1 shadow-sm",
                          "opacity-0 transition-opacity duration-150 group-hover:opacity-100",
                          "hover:text-primary active:scale-[0.96]",
                        )}
                        aria-label="复制到我的包"
                        title="复制到我的包"
                      >
                        <CopyIcon className="size-3" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {(canInstall || canCopy) && pack && (
          <div className="flex items-center justify-end gap-2 bg-muted/25 px-4 py-3">
            {canCopy && !canInstall && (
              <p className="mr-auto text-xs text-muted-foreground">
                仅可单条复制，不可整包安装
              </p>
            )}
            {canInstall && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void onInstall()}
                className="active:scale-[0.96] transition-transform"
              >
                {busy ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <DownloadIcon className="size-4" />
                )}
                加入贴图库
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
