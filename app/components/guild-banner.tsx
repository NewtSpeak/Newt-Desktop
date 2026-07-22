// 服务器外观：
//   - banner 列表（guild.banners）：可轮播；右上角可逐张关闭（仅本会话隐藏）
//   - 横幅（guild.banner_url）：与 banner 分离；全部 banner 关掉后回退显示，本身不可关闭
// 轮播规则：图片 5s 切下一张；视频播完切下一张；放大预览时暂停，关闭预览后图片重新计时 5s。
// 展示：宽度铺满列表，高度按原始比例等比缩放。

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react"
import { ExpandIcon, XIcon } from "lucide-react"

import { GuildMediaLightbox } from "~/components/guild-media-lightbox"
import { resolveApiUrl } from "~/lib/api/http"
import type { Guild } from "~/lib/api/types"
import { cn, isGuildMediaVideo } from "~/lib/utils"

const IMAGE_INTERVAL_MS = 5000

const actionBtnClass = cn(
  "flex size-6 items-center justify-center rounded-md",
  "bg-black/45 text-white shadow-sm backdrop-blur-[2px]",
  "transition-[background-color,opacity,transform] hover:bg-black/65 active:scale-95",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
)

export function GuildBannerCarousel({
  guild,
  className,
}: {
  guild: Pick<Guild, "id" | "banners" | "banner_url" | "name">
  className?: string
}) {
  /** 多 banner 列表（可关闭） */
  const carouselUrls = useMemo(() => {
    if (!guild.banners || guild.banners.length === 0) return [] as string[]
    return [...guild.banners]
      .sort((a, b) => a.position - b.position)
      .map((b) => b.url)
      .filter(Boolean)
  }, [guild.banners])

  /** 单张服务器横幅（不可关闭；banner 全部关掉后回退显示） */
  const heroUrl = useMemo(
    () => guild.banner_url?.trim() || "",
    [guild.banner_url],
  )

  const [index, setIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  /** 本会话内已关闭的 banner URL（不影响横幅 banner_url） */
  const [hiddenBannerUrls, setHiddenBannerUrls] = useState<string[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)

  // 切换服务器时恢复全部 banner
  useEffect(() => {
    setHiddenBannerUrls([])
    setIndex(0)
    setLightboxOpen(false)
  }, [guild.id])

  // 远端 banner 列表变化时清理已不存在的 hidden 项
  useEffect(() => {
    setHiddenBannerUrls((prev) => {
      const next = prev.filter((url) => carouselUrls.includes(url))
      return next.length === prev.length ? prev : next
    })
  }, [carouselUrls])

  const visibleBanners = useMemo(
    () => carouselUrls.filter((url) => !hiddenBannerUrls.includes(url)),
    [carouselUrls, hiddenBannerUrls],
  )

  /** 仍在展示可关闭的 banner 轮播；否则若有横幅则回退到横幅 */
  const showingBanners = visibleBanners.length > 0
  const displayUrls = showingBanners
    ? visibleBanners
    : heroUrl
      ? [heroUrl]
      : []
  /** 当前是回退到的服务器横幅（非 banner 列表） */
  const isHeroFallback = !showingBanners && Boolean(heroUrl)
  /** 仅 banner 可关；横幅本身不支持关闭 */
  const canCloseCurrent = showingBanners
  const multi = displayUrls.length > 1

  useEffect(() => {
    if (displayUrls.length > 0 && index >= displayUrls.length) {
      setIndex(0)
    }
  }, [displayUrls.length, index])

  const safeIndex =
    displayUrls.length > 0 ? Math.min(index, displayUrls.length - 1) : 0
  const currentPath = displayUrls[safeIndex]
  const current = currentPath ? resolveApiUrl(currentPath) : ""
  const isVideo = isGuildMediaVideo(currentPath)

  const goNext = useCallback(() => {
    setIndex((prev) => {
      const len = displayUrls.length
      if (len <= 1) return 0
      return (prev + 1) % len
    })
  }, [displayUrls.length])

  // 图片：5s 切下一张；放大时暂停；缩小后依赖 deps 变化重新计时 5s
  useEffect(() => {
    if (!showingBanners || !multi || lightboxOpen || isVideo) return
    const timer = window.setTimeout(() => {
      goNext()
    }, IMAGE_INTERVAL_MS)
    return () => window.clearTimeout(timer)
  }, [
    showingBanners,
    multi,
    lightboxOpen,
    isVideo,
    safeIndex,
    currentPath,
    goNext,
  ])

  // 缩略视频：静音播放；单条循环，多条播完切下一条；灯箱打开时暂停
  useEffect(() => {
    const el = videoRef.current
    if (!el || !isVideo) return
    if (lightboxOpen) {
      el.pause()
      return
    }
    el.muted = true
    el.loop = !multi
    void el.play().catch(() => {
      /* 自动播放策略拦截时忽略 */
    })
  }, [isVideo, current, lightboxOpen, multi])

  const onVideoEnded = useCallback(() => {
    if (lightboxOpen) return
    if (multi) {
      goNext()
      return
    }
    // 单条：手动重播（loop 属性偶发不可靠时兜底）
    const el = videoRef.current
    if (!el) return
    el.currentTime = 0
    void el.play().catch(() => undefined)
  }, [goNext, lightboxOpen, multi])

  const openLightbox = useCallback(() => {
    setLightboxOpen(true)
  }, [])

  /**
   * 关闭当前这一张 banner（本会话）；全部 banner 关掉后自动回退到横幅。
   * 横幅模式下不隐藏，仅关闭已打开的灯箱预览。
   */
  const closeCurrentBanner = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
      setLightboxOpen(false)
      if (!canCloseCurrent || !currentPath) return
      setHiddenBannerUrls((prev) =>
        prev.includes(currentPath) ? prev : [...prev, currentPath],
      )
      setIndex((prev) => {
        const remaining = visibleBanners.length - 1
        if (remaining <= 0) return 0
        return prev >= remaining ? 0 : prev
      })
    },
    [canCloseCurrent, currentPath, visibleBanners.length],
  )

  if (displayUrls.length === 0) return null

  const items = displayUrls.map((url, i) => ({
    url,
    label: isHeroFallback
      ? `${guild.name} 横幅`
      : `${guild.name} banner ${i + 1}`,
  }))

  return (
    <div className={cn("shrink-0 px-2 pt-2 pb-1", className)}>
      <div
        role="button"
        tabIndex={0}
        aria-label={
          isHeroFallback ? `${guild.name} 横幅` : `${guild.name} banner`
        }
        className={cn(
          // 宽度固定（铺满列表），高度随媒体原始比例变化
          "group relative w-full cursor-zoom-in overflow-hidden rounded-xl outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
        onClick={openLightbox}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            openLightbox()
          }
        }}
      >
        {isVideo ? (
          <video
            key={current}
            ref={videoRef}
            src={current}
            autoPlay
            muted
            playsInline
            preload="metadata"
            loop={!multi}
            aria-hidden
            onEnded={onVideoEnded}
            className="pointer-events-none block h-auto w-full"
          />
        ) : (
          <img
            key={current}
            src={current}
            alt=""
            className="pointer-events-none block h-auto w-full"
            draggable={false}
          />
        )}

        {/* 右上角：放大 | 关闭（仅 banner 可关；横幅无关闭） */}
        <div
          className={cn(
            "absolute top-1.5 right-1.5 z-10 flex items-center gap-1",
            "opacity-0 transition-opacity",
            "group-hover:opacity-100 group-focus-within:opacity-100",
          )}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label="放大预览"
            title="放大预览"
            className={actionBtnClass}
            onClick={(event) => {
              event.stopPropagation()
              openLightbox()
            }}
          >
            <ExpandIcon className="size-3.5" />
          </button>
          {canCloseCurrent ? (
            <button
              type="button"
              aria-label="关闭当前 banner"
              title={
                visibleBanners.length > 1
                  ? "关闭当前这一张 banner"
                  : heroUrl
                    ? "关闭 banner，保留服务器横幅"
                    : "关闭当前 banner"
              }
              className={actionBtnClass}
              onClick={closeCurrentBanner}
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>

        {showingBanners && multi ? (
          <div
            className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1.5"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {displayUrls.map((url, dot) => (
              <button
                key={url}
                type="button"
                aria-label={`第 ${dot + 1} 张 banner`}
                aria-current={dot === safeIndex}
                onClick={() => setIndex(dot)}
                className={cn(
                  "size-1.5 rounded-full bg-white/45 shadow-sm transition-[background-color,transform]",
                  dot === safeIndex && "scale-125 bg-white",
                )}
              />
            ))}
          </div>
        ) : null}
      </div>

      <GuildMediaLightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        items={items}
        index={safeIndex}
        onIndexChange={setIndex}
        title={isHeroFallback ? `${guild.name} 横幅` : `${guild.name} Banner`}
      />
    </div>
  )
}
