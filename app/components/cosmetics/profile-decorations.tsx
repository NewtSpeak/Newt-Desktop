// 资料卡边框（compact/full）与内特效。

import { useEffect, useRef } from "react"
import type { ReactNode } from "react"

import type { EquippedSlot } from "~/lib/api/cosmetics"
import { resolveProfileAssetUrl } from "~/lib/user-display"
import { cn } from "~/lib/utils"

function isVideo(mime: string | undefined, url: string | undefined) {
  if (mime?.startsWith("video/")) return true
  return Boolean(url && /\.(mp4|webm)(\?|$)/i.test(url))
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
  const borderAsset =
    size === "full"
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
    <div className={cn("relative overflow-hidden rounded-lg", className)}>
      {children}
      {visualUrl ? (
        <div className="pointer-events-none absolute inset-0 z-[3]" aria-hidden>
          {isVideo(visual?.mime, visualUrl) ? (
            <video
              src={visualUrl}
              className="size-full object-cover opacity-70 mix-blend-screen"
              autoPlay
              loop
              muted
              playsInline
            />
          ) : (
            <img
              src={visualUrl}
              alt=""
              className="size-full object-cover opacity-70 mix-blend-screen"
              draggable={false}
            />
          )}
        </div>
      ) : null}
      {borderUrl ? (
        <div
          className="pointer-events-none absolute inset-0 z-[4]"
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
