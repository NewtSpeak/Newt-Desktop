// 资料卡边框（上/下两段式，兼容旧整幅 compact/full 资产）与内特效。

import { useEffect, useRef } from "react"
import type { ReactNode } from "react"

import type { CosmeticAssetView, EquippedSlot } from "~/lib/api/cosmetics"
import { resolveProfileAssetUrl } from "~/lib/user-display"
import { cn } from "~/lib/utils"

function isVideo(mime: string | undefined, url: string | undefined) {
  if (mime?.startsWith("video/")) return true
  return Boolean(url && /\.(mp4|webm)(\?|$)/i.test(url))
}

/** 边框上/下半段：骑跨卡片边缘——图片的高度中心对准卡片顶边/底边，
 * 宽度随外层容器（卡片宽的 110%）铺满，纵向按素材原始比例。 */
function BorderHalf({
  asset,
  edge,
}: {
  asset: CosmeticAssetView
  edge: "top" | "bottom"
}) {
  const url = resolveProfileAssetUrl(asset.url)
  if (!url) return null
  // 上段：bottom-full + 下移自身高度 2/3 → 仅 1/3 超出卡片顶边；
  // 下段：top-full + 上移自身高度 1/2 → 垂直中心对准卡片底边
  const edgeClass =
    edge === "top"
      ? "bottom-full translate-y-2/3"
      : "top-full -translate-y-1/2"
  return isVideo(asset.mime, url) ? (
    <video
      src={url}
      className={cn("absolute inset-x-0 h-auto w-full", edgeClass)}
      autoPlay
      loop
      muted
      playsInline
    />
  ) : (
    <img
      src={url}
      alt=""
      className={cn("absolute inset-x-0 h-auto w-full", edgeClass)}
      draggable={false}
    />
  )
}

export function ProfileCardChrome({
  border,
  effect,
  size = "compact",
  className,
  children,
  playAudio = false,
}: {
  border?: EquippedSlot | null
  effect?: EquippedSlot | null
  size?: "compact" | "full"
  className?: string
  children: ReactNode
  /** 打开卡片时是否播放特效音频 */
  playAudio?: boolean
}) {
  // 新式两段边框：top/bottom 分别锚定卡片顶/底边；缺失时回退旧整幅资产
  const borderTop = border?.assets?.top
  const borderBottom = border?.assets?.bottom
  const splitBorder = Boolean(borderTop || borderBottom)
  const borderAsset = splitBorder
    ? undefined
    : size === "full"
      ? border?.assets?.full || border?.assets?.compact
      : border?.assets?.compact || border?.assets?.full
  const borderUrl = resolveProfileAssetUrl(borderAsset?.url)
  const visual = effect?.assets?.visual
  const visualUrl = resolveProfileAssetUrl(visual?.url)
  const audioUrl = resolveProfileAssetUrl(effect?.assets?.audio?.url)
  const audioRef = useRef<HTMLAudioElement>(null)
  const loop = Boolean((effect?.payload as { audio_loop?: boolean } | undefined)?.audio_loop)

  useEffect(() => {
    const el = audioRef.current
    if (!el || !audioUrl) return
    if (playAudio) {
      el.currentTime = 0
      void el.play().catch(() => {})
    } else {
      el.pause()
    }
  }, [playAudio, audioUrl])

  return (
    // 根容器不裁切：两段式边框外挂在卡片外（上/下各悬出一截、左右各超出 5%）
    // 圆角设在根上（默认 rounded-lg，调用方可覆盖），卡片面与旧边框层继承同一圆角
    <div className={cn("relative rounded-lg", className)}>
      {/* 卡片面：内容、内特效与旧整幅边框仍按圆角裁切；
          h-full 仅在外层显式给定高度时生效（预览 9:16 场景），否则随内容 */}
      <div className="relative h-full overflow-hidden rounded-[inherit]">
        {children}
        {visualUrl ? (
          // 特效横向铺满卡片宽度、按素材原始比例，从卡片顶部开始显示（超出部分被裁切）
          <div
            className="pointer-events-none absolute inset-0 z-[3] overflow-hidden"
            aria-hidden
          >
            {isVideo(visual?.mime, visualUrl) ? (
              <video
                src={visualUrl}
                className="absolute inset-x-0 top-0 h-auto w-full opacity-70 mix-blend-screen"
                autoPlay
                loop
                muted
                playsInline
              />
            ) : (
              <img
                src={visualUrl}
                alt=""
                className="absolute inset-x-0 top-0 h-auto w-full opacity-70 mix-blend-screen"
                draggable={false}
              />
            )}
          </div>
        ) : null}
      </div>
      {splitBorder ? (
        // 外挂层：宽 110%（左右各 -5%），高度对齐卡片，上下两段骑跨卡片顶/底边
        <div
          className="pointer-events-none absolute inset-y-0 -left-[5%] -right-[5%] z-[4]"
          aria-hidden
        >
          {borderTop ? <BorderHalf asset={borderTop} edge="top" /> : null}
          {borderBottom ? <BorderHalf asset={borderBottom} edge="bottom" /> : null}
        </div>
      ) : null}
      {borderUrl ? (
        // 旧整幅边框：仍贴卡片边界并按圆角裁切（根容器已不再裁切，此处自裁）
        <div
          className="pointer-events-none absolute inset-0 z-[4] overflow-hidden rounded-[inherit]"
          aria-hidden
          style={
            isVideo(borderAsset?.mime, borderUrl)
              ? undefined
              : {
                  borderImageSource: `url(${borderUrl})`,
                  borderImageSlice: 30,
                  borderImageWidth: 12,
                  borderImageRepeat: "stretch",
                  borderStyle: "solid",
                  borderWidth: 8,
                }
          }
        >
          {isVideo(borderAsset?.mime, borderUrl) ? (
            <video
              src={borderUrl}
              className="size-full object-fill"
              autoPlay
              loop
              muted
              playsInline
            />
          ) : null}
        </div>
      ) : null}
      {audioUrl ? (
        <audio ref={audioRef} src={audioUrl} loop={loop} preload="none" />
      ) : null}
    </div>
  )
}
