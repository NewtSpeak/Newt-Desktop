// 头像框叠层：环绕子头像。

import { useEffect, useRef } from "react"
import type { ReactNode } from "react"

import type { EquippedSlot } from "~/lib/api/cosmetics"
import { resolveProfileAssetUrl } from "~/lib/user-display"
import { cn } from "~/lib/utils"

function isVideo(mime: string | undefined, url: string | undefined) {
  if (mime?.startsWith("video/")) return true
  return Boolean(url && /\.(mp4|webm)(\?|$)/i.test(url))
}

/**
 * 头像框视频：仅在视口内播放，离屏暂停解码（消息列表性能护栏，
 * 实现模式与 nameplate.tsx 的 IntersectionObserver 懒播放一致）。
 */
function FrameVideo({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) void el.play().catch(() => {})
          else el.pause()
        }
      },
      { threshold: 0.1 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [url])

  return (
    <video
      ref={videoRef}
      src={url}
      className="size-full object-contain"
      loop
      muted
      playsInline
      preload="metadata"
    />
  )
}

/**
 * 纯头像框叠层（不含子头像）：绝对定位外扩 18% 覆盖宿主。
 * 供宿主容器自身 overflow-hidden、无法内嵌 AvatarWithFrame 的场景
 * （如 nav-user 左下角方形按钮）在外层自行叠加。
 */
export function AvatarFrameOverlay({
  frame,
  className,
}: {
  frame?: EquippedSlot | null
  className?: string
}) {
  const asset = frame?.assets?.primary
  const url = resolveProfileAssetUrl(asset?.url)
  if (!url) return null
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-[-18%] overflow-hidden",
        className,
      )}
      aria-hidden
    >
      {isVideo(asset?.mime, url) ? (
        <FrameVideo url={url} />
      ) : (
        <img src={url} alt="" className="size-full object-contain" draggable={false} />
      )}
    </span>
  )
}

export function AvatarWithFrame({
  frame,
  sizeClass = "size-7",
  className,
  children,
}: {
  frame?: EquippedSlot | null
  sizeClass?: string
  className?: string
  children: ReactNode
}) {
  const asset = frame?.assets?.primary
  const url = resolveProfileAssetUrl(asset?.url)
  if (!url) {
    return <span className={cn("relative inline-flex shrink-0", className)}>{children}</span>
  }
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
    >
      <span className={cn("relative z-[1]", sizeClass)}>{children}</span>
      <AvatarFrameOverlay frame={frame} className="z-[2]" />
    </span>
  )
}
