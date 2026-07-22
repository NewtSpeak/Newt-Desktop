// 贴图 / 小表情媒体：按扩展名自动 img 或静音循环 video。

import type { CSSProperties } from "react"

import {
  isStickerVideoAsset,
  stickerAssetUrl,
} from "~/lib/stickers/format"
import { cn } from "~/lib/utils"

type StickerMediaProps = {
  src?: string | null
  alt?: string
  className?: string
  width?: number
  height?: number
  draggable?: boolean
  style?: CSSProperties
  onError?: () => void
}

export function StickerMedia({
  src,
  alt = "",
  className,
  width,
  height,
  draggable = false,
  style,
  onError,
}: StickerMediaProps) {
  const url = stickerAssetUrl(src)
  if (!url) return null
  if (isStickerVideoAsset(url)) {
    return (
      <video
        src={url}
        width={width}
        height={height}
        autoPlay
        loop
        muted
        playsInline
        draggable={draggable}
        onError={onError}
        className={cn("object-contain", className)}
        style={style}
        aria-label={alt || undefined}
      />
    )
  }
  return (
    <img
      src={url}
      alt={alt}
      width={width}
      height={height}
      draggable={draggable}
      loading="lazy"
      onError={onError}
      className={cn("object-contain", className)}
      style={style}
    />
  )
}
