// 成员列表铭牌背景：底色 + 视频/渐变/静态图。

import { useEffect, useRef } from "react"

import type { EquippedSlot } from "~/lib/api/cosmetics"
import { resolveProfileAssetUrl } from "~/lib/user-display"
import { cn } from "~/lib/utils"

type GradientPayload = {
  type?: string
  colors?: string[]
  from?: string
  to?: string
  angle?: number
  shape?: string
  animated?: boolean
  speed?: number
}

// 色标来源两种写法等价：colors 数组，或 from/to 两端色（支持 #RRGGBBAA 透明度）
function gradientColors(g: GradientPayload): string[] {
  if (g.colors?.length) return g.colors
  return [g.from, g.to].filter(
    (c): c is string => typeof c === "string" && c.trim() !== "",
  )
}

function gradientCss(g: GradientPayload | undefined): string | undefined {
  if (!g) return undefined
  const colors = gradientColors(g)
  if (!colors.length) return undefined
  if (g.type === "solid" || colors.length === 1) {
    return colors[0]
  }
  if (g.type === "radial") {
    const shape = g.shape === "ellipse" ? "ellipse" : "circle"
    return `radial-gradient(${shape}, ${colors.join(", ")})`
  }
  const angle = typeof g.angle === "number" ? g.angle : 90
  return `linear-gradient(${angle}deg, ${colors.join(", ")})`
}

export function NameplateBackground({
  nameplate,
  className,
}: {
  nameplate?: EquippedSlot | null
  className?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const payload = (nameplate?.payload ?? {}) as {
    mode?: string
    base_color?: string
    gradient?: GradientPayload
    video_opacity?: number
    /**
     * 视频合成方式：normal（默认，原样播放——自带 alpha 通道的素材
     * 透明区域天然透出渐变/底色）| screen（黑底无 alpha 素材扣黑用）
     */
    video_blend?: string
  }
  const baseColor = payload.base_color || "#1e1f22"
  const opacity =
    typeof payload.video_opacity === "number" ? payload.video_opacity : 1
  const videoUrl = resolveProfileAssetUrl(nameplate?.assets?.video?.url)
  const imageUrl = resolveProfileAssetUrl(
    nameplate?.assets?.static?.url || nameplate?.assets?.primary?.url,
  )
  const grad = gradientCss(payload.gradient)
  const animated = Boolean(payload.gradient?.animated)
  // screen 抠黑仅在显式配置时启用；默认原样播放（alpha 素材原生透明）
  const keyOutBlack = payload.video_blend === "screen"
  // mode 未显式配置时按已有资产推断：有视频 → video；有渐变 → gradient；有图 → image。
  // video 模式 = 底色 + 渐变底衬（若配置）+ 视频亮部（黑底经 screen 混合扣除）；
  // gradient / image 模式互斥，不再出现视频资产无条件盖住渐变的问题。
  const mode =
    payload.mode ||
    (videoUrl ? "video" : grad ? "gradient" : imageUrl ? "image" : "gradient")

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
  }, [videoUrl])

  if (!nameplate) return null

  return (
    <span
      className={cn(
        // isolate：把视频 screen 混合限定在铭牌图层栈内，不与页面背景混合
        "pointer-events-none absolute inset-0 -z-0 isolate overflow-hidden rounded-md",
        className,
      )}
      aria-hidden
    >
      <span className="absolute inset-0" style={{ background: baseColor }} />
      {(mode === "gradient" || mode === "video") && grad ? (
        <span
          className={cn(
            "absolute inset-0",
            animated && "name-gradient-animated",
          )}
          style={
            grad.includes("gradient")
              ? { backgroundImage: grad }
              : { background: grad }
          }
        />
      ) : null}
      {mode === "image" && imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 size-full object-cover opacity-80"
          draggable={false}
        />
      ) : null}
      {mode === "video" && videoUrl ? (
        // 黑底扣除：screen 混合下黑色像素不贡献颜色 → 透出下方渐变/底色；
        // 非黑内容原样叠加显示。video_blend=normal 时视频原样覆盖。
        <video
          ref={videoRef}
          src={videoUrl}
          // 高度贴齐铭牌行、宽度按素材比例自适应、靠右显示
          className={cn(
            "absolute inset-y-0 right-0 h-full w-auto",
            keyOutBlack && "mix-blend-screen",
          )}
          style={{ opacity }}
          muted
          loop
          playsInline
          preload="metadata"
        />
      ) : null}
    </span>
  )
}
