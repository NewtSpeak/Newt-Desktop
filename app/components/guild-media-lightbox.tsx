// 服务器外观媒体灯箱：图片全屏预览 / 视频放大播放（带控件与声音）。
// 多 Banner 时支持左右切换；点击遮罩或 Esc 关闭。

import { useEffect, useRef } from "react"
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react"

import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { resolveApiUrl } from "~/lib/api/http"
import { cn, isGuildMediaVideo } from "~/lib/utils"

export type GuildMediaItem = {
  /** 相对或绝对 URL（相对路径会经 resolveApiUrl 拼接） */
  url: string
  /** 无障碍标签 */
  label?: string
}

export function GuildMediaLightbox({
  open,
  onOpenChange,
  items,
  index,
  onIndexChange,
  title = "媒体预览",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: GuildMediaItem[]
  index: number
  onIndexChange?: (index: number) => void
  title?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const safeIndex =
    items.length > 0 ? Math.min(Math.max(index, 0), items.length - 1) : 0
  const current = items[safeIndex]
  const src = current ? resolveApiUrl(current.url) : ""
  const isVideo = isGuildMediaVideo(current?.url)
  const multi = items.length > 1

  // 打开 / 切换条目时：视频自动播放并带声音（用户点击手势链路内）
  useEffect(() => {
    if (!open || !isVideo) return
    const el = videoRef.current
    if (!el) return
    el.muted = false
    el.volume = 1
    void el.play().catch(() => {
      /* 策略拦截时仍保留 controls 供手动播 */
    })
  }, [open, isVideo, src])

  // 关闭时暂停视频，避免后台继续出声
  useEffect(() => {
    if (open) return
    const el = videoRef.current
    if (!el) return
    el.pause()
    el.muted = true
  }, [open])

  const go = (delta: -1 | 1) => {
    if (!multi || !onIndexChange) return
    const next = (safeIndex + delta + items.length) % items.length
    onIndexChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "max-h-[min(92vh,900px)] w-[min(96vw,56rem)] max-w-none gap-0 overflow-hidden p-0",
          "rounded-2xl bg-black/95 text-white ring-white/10 sm:max-w-none",
        )}
        // 左右键切换（多图）
        onKeyDown={(event) => {
          if (!multi) return
          if (event.key === "ArrowLeft") {
            event.preventDefault()
            go(-1)
          } else if (event.key === "ArrowRight") {
            event.preventDefault()
            go(1)
          }
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isVideo ? "视频预览，可播放与调节音量" : "图片预览"}
          </DialogDescription>
        </DialogHeader>

        <div className="relative flex min-h-[12rem] max-h-[min(92vh,900px)] items-center justify-center">
          {src && isVideo ? (
            <video
              key={src}
              ref={videoRef}
              src={src}
              controls
              autoPlay
              playsInline
              className="max-h-[min(92vh,900px)] max-w-full object-contain"
              aria-label={current?.label ?? title}
            />
          ) : null}
          {src && !isVideo ? (
            <img
              key={src}
              src={src}
              alt={current?.label ?? title}
              className="max-h-[min(92vh,900px)] max-w-full object-contain"
              draggable={false}
            />
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="关闭预览"
            className="absolute top-3 right-3 z-10 bg-black/50 text-white hover:bg-black/70 hover:text-white"
            onClick={() => onOpenChange(false)}
          >
            <XIcon className="size-4" />
          </Button>

          {multi ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="上一张"
                className="absolute top-1/2 left-2 z-10 -translate-y-1/2 bg-black/45 text-white hover:bg-black/70 hover:text-white"
                onClick={() => go(-1)}
              >
                <ChevronLeftIcon className="size-5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="下一张"
                className="absolute top-1/2 right-2 z-10 -translate-y-1/2 bg-black/45 text-white hover:bg-black/70 hover:text-white"
                onClick={() => go(1)}
              >
                <ChevronRightIcon className="size-5" />
              </Button>
              <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
                {items.map((item, i) => (
                  <button
                    key={`${item.url}-${i}`}
                    type="button"
                    aria-label={`第 ${i + 1} 项`}
                    aria-current={i === safeIndex}
                    className={cn(
                      "size-1.5 rounded-full bg-white/40 transition-[background-color,transform]",
                      i === safeIndex && "scale-125 bg-white",
                    )}
                    onClick={() => onIndexChange?.(i)}
                  />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
