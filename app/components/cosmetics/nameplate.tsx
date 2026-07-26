// 成员列表铭牌背景：底色 + 视频/渐变/静态图。

import { useEffect, useRef } from "react"

import type { EquippedSlot } from "~/lib/api/cosmetics"
import { resolveProfileAssetUrl } from "~/lib/user-display"
import { cn } from "~/lib/utils"

type GradientPayload = {
  type?: string
  colors?: string[]
  angle?: number
  shape?: string
  animated?: boolean
  speed?: number
}

function gradientCss(g: GradientPayload | undefined): string | undefined {
  if (!g?.colors?.length) return undefined
  if (g.type === "solid" || g.colors.length === 1) {
    return g.colors[0]
  }
  if (g.type === "radial") {
    const shape = g.shape === "ellipse" ? "ellipse" : "circle"
    return `radial-gradient(${shape}, ${g.colors.join(", ")})`
  }
  const angle = typeof g.angle === "number" ? g.angle : 90
  return `linear-gradient(${angle}deg, ${g.colors.join(", ")})`
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
  }
  const mode = payload.mode || "gradient"
  const baseColor = payload.base_color || "#1e1f22"
  const opacity =
    typeof payload.video_opacity === "number" ? payload.video_opacity : 0.85
  const videoUrl = resolveProfileAssetUrl(nameplate?.assets?.video?.url)
  const imageUrl = resolveProfileAssetUrl(
    nameplate?.assets?.static?.url || nameplate?.assets?.primary?.url,
  )
  const grad = gradientCss(payload.gradient)
  const animated = Boolean(payload.gradient?.animated)

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
        "pointer-events-none absolute inset-0 -z-0 overflow-hidden rounded-md",
        className,
      )}
      aria-hidden
    >
      <span className="absolute inset-0" style={{ background: baseColor }} />
      {mode === "gradient" && grad ? (
        <span
          className={cn(
            "absolute inset-0 opacity-80",
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
      {(mode === "video" || videoUrl) && videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          className="absolute inset-0 size-full object-cover"
          style={{ opacity }}
          muted
          loop
          playsInline
          preload="metadata"
        />
      ) : null}
      <span className="absolute inset-0 bg-background/25" />
    </span>
  )
}
