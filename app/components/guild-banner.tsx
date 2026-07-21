// 服务器 banner 轮播：优先 banners 列表（position 升序），否则回退 banner_url。
// 独立圆角卡片（非通栏铺满）；多张时自动轮播 + 底部指示点。

import { useEffect, useMemo, useState } from "react"

import { resolveApiUrl } from "~/lib/api/http"
import type { Guild } from "~/lib/api/types"
import { cn } from "~/lib/utils"

const AUTO_INTERVAL_MS = 5000

export function GuildBannerCarousel({
  guild,
  className,
}: {
  guild: Pick<Guild, "banners" | "banner_url" | "name">
  className?: string
}) {
  const urls = useMemo(() => {
    if (guild.banners && guild.banners.length > 0) {
      return [...guild.banners]
        .sort((a, b) => a.position - b.position)
        .map((b) => b.url)
        .filter(Boolean)
    }
    const single = guild.banner_url?.trim()
    return single ? [single] : []
  }, [guild.banners, guild.banner_url])

  const [index, setIndex] = useState(0)

  useEffect(() => {
    // 仅在越界时收敛，避免 urls 为空时 index===0 仍反复 setState
    if (urls.length > 0 && index >= urls.length) setIndex(0)
  }, [urls.length, index])

  // 多张自动轮播
  useEffect(() => {
    if (urls.length <= 1) return
    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % urls.length)
    }, AUTO_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [urls.length])

  if (urls.length === 0) return null

  const safeIndex = Math.min(index, urls.length - 1)
  const current = resolveApiUrl(urls[safeIndex]!)

  return (
    // 外层留白：卡片与频道列表两侧/上下留出间距，不铺满整列
    <div className={cn("shrink-0 px-2 pt-2 pb-1", className)}>
      <div
        className="relative overflow-hidden rounded-xl"
        aria-label={`${guild.name} 横幅`}
      >
        <img
          key={current}
          src={current}
          alt={`${guild.name} banner`}
          className="h-24 w-full object-cover transition-opacity duration-500"
          draggable={false}
        />
        {urls.length > 1 && (
          <div className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1.5">
            {urls.map((url, dot) => (
              <button
                key={url}
                type="button"
                aria-label={`第 ${dot + 1} 张 banner`}
                aria-current={dot === safeIndex}
                onClick={() => setIndex(dot)}
                className={cn(
                  "size-1.5 rounded-full bg-white/45 shadow-sm transition-[background-color,transform]",
                  dot === safeIndex && "scale-125 bg-white"
                )}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
