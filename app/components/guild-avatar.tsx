// 服务器头像：有 icon_url 显示图片，否则回退服务器名首两字（与 ServerRail 一致）。
// 图片 URL 经 resolveApiUrl 拼接当前服务器基址（/public-assets 相对路径）。
// selected 时用同图模糊层做「随轮廓的多色光晕」（非矩形 box-shadow / 非描边）。

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { resolveApiUrl } from "~/lib/api/http"
import type { Guild } from "~/lib/api/types"
import { cn } from "~/lib/utils"

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
  const radius = shape === "circle" ? "rounded-full" : "rounded-lg"

  return (
    <span className={cn("relative block size-full overflow-visible", className)}>
      {/* 选中光晕：同图放大模糊，颜色来自图片本身，天然贴合轮廓 */}
      {selected && src ? (
        <img
          src={src}
          alt=""
          aria-hidden
          draggable={false}
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 size-full scale-125 object-cover",
            radius,
            "blur-md saturate-150 opacity-55",
            "dark:scale-[1.35] dark:blur-lg dark:saturate-200 dark:opacity-80"
          )}
        />
      ) : null}
      {/* 无图标选中：主题色软光，亮暗模式不同强度 */}
      {selected && !src ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 scale-125",
            radius,
            "bg-primary/35 blur-md",
            "dark:bg-primary/50 dark:blur-lg"
          )}
        />
      ) : null}

      <Avatar
        className={cn(
          // size-full! 覆盖 Avatar 默认 size-8，避免被样式表顺序盖掉
          "relative z-0 size-full! h-full! w-full! min-h-0 min-w-0 after:border-0",
          radius,
          shape === "circle" ? "after:rounded-full" : "after:rounded-lg",
          // 选中时微抬升 + 轮廓跟随的中性环境阴影（适配亮暗）
          selected &&
            "shadow-[0_2px_8px_-1px_rgb(0_0_0/0.18)] dark:shadow-[0_2px_10px_-1px_rgb(0_0_0/0.55)]"
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
            fallbackClassName
          )}
        >
          {guildInitials(guild.name)}
        </AvatarFallback>
      </Avatar>
    </span>
  )
}
