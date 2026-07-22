// 服务器头像：有 icon_url 显示图片/MP4 视频，否则回退服务器名首两字（与 ServerRail 一致）。
// 媒体 URL 经 resolveApiUrl 拼接当前服务器基址（/public-assets 相对路径）。
// selected 时用同图/视频模糊层做「随轮廓的多色光晕」（非矩形 box-shadow / 非描边）。
// MP4：默认静音循环；悬浮/聚焦到头像时解除静音播放声音（服务器列表等场景）。

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react"

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { resolveApiUrl } from "~/lib/api/http"
import type { Guild } from "~/lib/api/types"
import { cn, isGuildMediaVideo } from "~/lib/utils"

function guildInitials(name: string): string {
  return name.trim().slice(0, 2) || "?"
}

export function GuildAvatar({
  guild,
  className,
  fallbackClassName,
  /** 选中态：图片轮廓多色光晕 / 无图时用主题色软光 */
  selected = false,
  /** square=圆角方（服务器栏）；circle=正圆（标题旁等） */
  shape = "square",
}: {
  guild: Pick<Guild, "name" | "icon_url">
  className?: string
  fallbackClassName?: string
  selected?: boolean
  shape?: "square" | "circle"
}) {
  const icon = guild.icon_url?.trim()
  const src = icon ? resolveApiUrl(icon) : undefined
  const isVideo = Boolean(src && isGuildMediaVideo(icon ?? src))
  const radius = shape === "circle" ? "rounded-full" : "rounded-lg"
  const videoRef = useRef<HTMLVideoElement>(null)
  const [unmuted, setUnmuted] = useState(false)

  // 源变更时恢复静音
  useEffect(() => {
    setUnmuted(false)
    const el = videoRef.current
    if (el) {
      el.muted = true
      el.volume = 0
    }
  }, [src])

  // 保证视频持续循环；静音状态同步到 DOM（部分环境仅改 prop 不立即生效）
  useEffect(() => {
    const el = videoRef.current
    if (!el || !isVideo) return
    el.muted = !unmuted
    el.volume = unmuted ? 1 : 0
    void el.play().catch(() => {
      /* 自动播放被拦截时忽略，悬停手势再试 */
    })
  }, [isVideo, unmuted, src])

  const setHoverSound = useCallback(
    (on: boolean) => {
      if (!isVideo) return
      setUnmuted(on)
      const el = videoRef.current
      if (!el) return
      el.muted = !on
      el.volume = on ? 1 : 0
      void el.play().catch(() => {
        /* ignore */
      })
    },
    [isVideo],
  )

  const onHoverStart = useCallback(
    (_event: SyntheticEvent) => {
      setHoverSound(true)
    },
    [setHoverSound],
  )

  const onHoverEnd = useCallback(() => {
    setHoverSound(false)
  }, [setHoverSound])

  const shellClass = cn(
    "relative z-0 size-full! h-full! w-full! min-h-0 min-w-0 overflow-hidden",
    radius,
    selected &&
      "shadow-[0_2px_8px_-1px_rgb(0_0_0/0.18)] dark:shadow-[0_2px_10px_-1px_rgb(0_0_0/0.55)]",
  )

  return (
    <span
      className={cn("relative block size-full overflow-visible", className)}
      title={
        isVideo
          ? `${guild.name}（视频头像，悬停播放声音）`
          : undefined
      }
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onPointerEnter={onHoverStart}
      onPointerLeave={onHoverEnd}
      onFocus={onHoverStart}
      onBlur={onHoverEnd}
    >
      {/* 选中光晕：同媒体放大模糊，颜色来自画面本身，天然贴合轮廓 */}
      {selected && src && !isVideo ? (
        <img
          src={src}
          alt=""
          aria-hidden
          draggable={false}
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 size-full scale-125 object-cover",
            radius,
            "blur-md saturate-150 opacity-55",
            "dark:scale-[1.35] dark:blur-lg dark:saturate-200 dark:opacity-80",
          )}
        />
      ) : null}
      {selected && src && isVideo ? (
        <video
          src={src}
          aria-hidden
          muted
          loop
          playsInline
          autoPlay
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 size-full scale-125 object-cover",
            radius,
            "blur-md saturate-150 opacity-55",
            "dark:scale-[1.35] dark:blur-lg dark:saturate-200 dark:opacity-80",
          )}
        />
      ) : null}
      {selected && !src ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 scale-125",
            radius,
            "bg-primary/35 blur-md",
            "dark:bg-primary/50 dark:blur-lg",
          )}
        />
      ) : null}

      {/* 视频不用 AvatarImage（其加载态会盖住 <video>），独立铺满容器 */}
      {src && isVideo ? (
        <span
          className={cn(
            shellClass,
            "flex after:pointer-events-none after:absolute after:inset-0 after:border-0",
            shape === "circle" ? "after:rounded-full" : "after:rounded-lg",
          )}
        >
          <video
            ref={videoRef}
            src={src}
            autoPlay
            loop
            muted={!unmuted}
            playsInline
            preload="auto"
            aria-label={`${guild.name} 图标`}
            className={cn("size-full object-cover", radius)}
          />
        </span>
      ) : (
        <Avatar
          className={cn(
            shellClass,
            "after:border-0",
            shape === "circle" ? "after:rounded-full" : "after:rounded-lg",
          )}
        >
          {src ? (
            <AvatarImage
              src={src}
              alt={`${guild.name} 图标`}
              className={cn("size-full! object-cover", radius)}
            />
          ) : null}
          <AvatarFallback
            className={cn(
              "size-full! bg-transparent text-xs font-semibold",
              radius,
              fallbackClassName,
            )}
          >
            {guildInitials(guild.name)}
          </AvatarFallback>
        </Avatar>
      )}
    </span>
  )
}
