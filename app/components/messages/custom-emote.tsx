// 自定义小表情 / 贴图缩略：消息内联、反应胶囊统一高度。

import { useEffect, useState } from "react"

import { getStickerItem } from "~/lib/api/stickers"
import {
  isStickerVideoAsset,
  stickerAssetUrl,
} from "~/lib/stickers/format"
import { cn } from "~/lib/utils"
import { useStickersStore } from "~/stores/stickers"

/** 反应栏统一视觉高度（docs 17 R.2：16–20 CSS px） */
export const REACTION_EMOTE_PX = 18
/** 消息内联小表情 */
export const INLINE_EMOTE_PX = 22
/** 贴图消息展示最大边 */
export const STICKER_MSG_MAX = 160

type EmoteImgProps = {
  itemId: string
  mark?: string
  assetUrl?: string
  size?: number
  className?: string
  alt?: string
  onClick?: () => void
  /** 贴图作反应时同样缩放到统一高度 */
  reaction?: boolean
}

export function CustomEmoteImg({
  itemId,
  mark,
  assetUrl: assetUrlProp,
  size = INLINE_EMOTE_PX,
  className,
  alt,
  onClick,
  reaction,
}: EmoteImgProps) {
  const cached = useStickersStore((s) => s.itemCache[itemId])
  const cacheItems = useStickersStore((s) => s.cacheItems)
  const [url, setUrl] = useState(
    () => stickerAssetUrl(assetUrlProp || cached?.asset_url),
  )
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (assetUrlProp) {
      setUrl(stickerAssetUrl(assetUrlProp))
      setFailed(false)
      return
    }
    if (cached?.asset_url) {
      setUrl(stickerAssetUrl(cached.asset_url))
      return
    }
    let cancelled = false
    void getStickerItem(itemId)
      .then((item) => {
        if (cancelled) return
        cacheItems([item])
        setUrl(stickerAssetUrl(item.asset_url))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [itemId, assetUrlProp, cached?.asset_url, cacheItems])

  const dim = reaction ? REACTION_EMOTE_PX : size
  const label = alt || mark || "自定义表情"

  if (failed || !url) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-md bg-muted text-[10px] text-muted-foreground",
          className,
        )}
        style={{ width: dim, height: dim }}
        title={label}
        aria-label={label}
      >
        ?
      </span>
    )
  }

  const isVideo = isStickerVideoAsset(url)
  const media = isVideo ? (
    <video
      src={url}
      width={dim}
      height={dim}
      autoPlay
      loop
      muted
      playsInline
      draggable={false}
      onError={() => setFailed(true)}
      className={cn(
        "inline-block object-contain align-middle",
        onClick && "cursor-pointer",
        className,
      )}
      style={{ width: dim, height: dim }}
      aria-label={label}
    />
  ) : (
    <img
      src={url}
      alt={label}
      width={dim}
      height={dim}
      draggable={false}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn(
        "inline-block object-contain align-middle",
        onClick && "cursor-pointer",
        className,
      )}
      style={{ width: dim, height: dim }}
    />
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex cursor-pointer rounded-md active:scale-[0.96] transition-transform duration-150"
        aria-label={`查看表情包：${label}`}
      >
        {media}
      </button>
    )
  }
  return media
}

/** 贴图消息主体（大图，可点开包预览） */
export function StickerMessageBody({
  itemId,
  packId,
  mark,
  assetUrl,
  onOpenPack,
}: {
  itemId: string
  packId?: string
  mark?: string
  assetUrl?: string
  onOpenPack?: (packId: string, itemId: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => packId && onOpenPack?.(packId, itemId)}
      className={cn(
        "group relative mt-0.5 block max-w-[min(100%,11rem)] cursor-pointer",
        "rounded-2xl p-1.5",
        "bg-muted/40 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.04)]",
        "transition-[transform,box-shadow,background-color] duration-200",
        "hover:bg-muted/70 hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)]",
        "active:scale-[0.96]",
        "focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
      )}
      aria-label={mark ? `贴图 ${mark}` : "贴图"}
    >
      <CustomEmoteImg
        itemId={itemId}
        mark={mark}
        assetUrl={assetUrl}
        size={STICKER_MSG_MAX}
        className="rounded-xl"
      />
    </button>
  )
}
