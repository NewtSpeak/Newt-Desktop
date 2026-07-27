// 带角色色 / 渐变的显示名、色点与角色徽章；支持流动速度与自定义徽章 icon。

import type { CSSProperties } from "react"

import { useIsDark } from "~/hooks/use-is-dark"
import { cn } from "~/lib/utils"
import {
  iconStyleToFillCSS,
  nameStyleToCSS,
  type MemberRoleBadgeView,
  type ResolvedNameStyle,
} from "~/lib/name-style"
import { resolveApiUrl } from "~/lib/api/http"

export function StyledDisplayName({
  name,
  style,
  className,
  prefix,
}: {
  name: string
  style?: ResolvedNameStyle | null
  className?: string
  prefix?: string
}) {
  const dark = useIsDark()
  const resolved = style ?? {
    kind: "none" as const,
    colors: [],
    angle: 90,
    shape: "circle",
    animated: false,
    speed: 4,
  }
  const css = nameStyleToCSS(resolved, dark)
  const isGradient = resolved.kind === "linear" || resolved.kind === "radial"

  return (
    <span
      className={cn(
        "inline",
        // 未指定加粗时保持 medium；指定 bold 时由 style.fontWeight 覆盖
        !resolved.bold && "font-medium",
        isGradient && resolved.animated && "name-gradient-animated",
        className,
      )}
      style={css}
    >
      {prefix}
      {name}
    </span>
  )
}

/** 角色色点 / icon（纯色或线性/径向渐变 + 可选流动） */
export function RoleStyleDot({
  style,
  className,
  title,
  fallbackColor,
}: {
  style?: ResolvedNameStyle | null
  className?: string
  title?: string
  fallbackColor?: string
}) {
  const dark = useIsDark()
  const resolved = style ?? {
    kind: "none" as const,
    colors: [],
    angle: 90,
    shape: "circle",
    animated: false,
    speed: 4,
  }
  const fill = iconStyleToFillCSS(resolved, dark)
  const isGradient = resolved.kind === "linear" || resolved.kind === "radial"
  const css: CSSProperties =
    fill.backgroundImage || fill.backgroundColor
      ? fill
      : fallbackColor
        ? { backgroundColor: fallbackColor }
        : { backgroundColor: "transparent" }

  return (
    <span
      title={title}
      aria-hidden={!title}
      className={cn(
        "inline-block size-3 shrink-0 rounded-full border border-black/10 dark:border-white/15",
        isGradient && resolved.animated && "name-gradient-animated",
        className,
      )}
      style={css}
    />
  )
}

/** 单枚角色徽章（背景图/渐变 + 可选 icon 或回退纯色标签） */
export function RoleBadgePill({
  badge,
  className,
}: {
  badge: MemberRoleBadgeView
  className?: string
}) {
  const dark = useIsDark()
  const fill = badge.badgeBackground
    ? iconStyleToFillCSS(badge.badgeBackground, dark)
    : {}
  const hasGradient = Boolean(fill.backgroundImage || fill.backgroundColor)
  const bgImageUrl = badge.badgeBackgroundImageUrl
    ? resolveApiUrl(badge.badgeBackgroundImageUrl)
    : undefined
  const hasBgImage = Boolean(bgImageUrl)
  const animated =
    badge.badgeBackground &&
    (badge.badgeBackground.kind === "linear" ||
      badge.badgeBackground.kind === "radial") &&
    badge.badgeBackground.animated
  const showName = badge.badgeShowName !== false
  const iconUrl = badge.badgeIconUrl
    ? resolveApiUrl(badge.badgeIconUrl)
    : undefined

  const textClass = cn(
    "truncate",
    badge.bold && "font-bold",
    badge.italic && "italic",
    badge.underline && "underline",
    badge.strikethrough && "line-through",
  )

  // 纯色文字标签：胶囊
  if (!badge.badgeCustom && !iconUrl && !hasGradient && !hasBgImage) {
    return (
      <span
        title={badge.name}
        className={cn(
          "inline-flex h-3.5 max-w-16 items-center truncate rounded-full px-1.5 text-[9px] font-medium",
          className,
        )}
        style={
          badge.color
            ? {
                backgroundColor: `${badge.color}22`,
                color: badge.color,
                boxShadow: `inset 0 0 0 1px ${badge.color}55`,
              }
            : {
                backgroundColor: "var(--color-muted)",
                color: "var(--color-muted-foreground)",
              }
        }
      >
        <span className={textClass}>{badge.name}</span>
      </span>
    )
  }

  const layers: string[] = []
  if (fill.backgroundImage) layers.push(String(fill.backgroundImage))
  if (bgImageUrl) layers.push(`url(${JSON.stringify(bgImageUrl)})`)

  const style: CSSProperties = layers.length
    ? {
        backgroundImage: layers.join(", "),
        backgroundSize: layers.map(() => "cover").join(", "),
        backgroundPosition: layers.map(() => "center").join(", "),
        backgroundRepeat: "no-repeat",
        color: badge.badgeTextColor || "#fff",
        ...(fill.animationDuration
          ? { animationDuration: fill.animationDuration }
          : {}),
      }
    : fill.backgroundColor
      ? { backgroundColor: fill.backgroundColor, color: badge.badgeTextColor || "#fff" }
      : {
          backgroundColor: badge.color || "var(--color-muted-foreground)",
          color: badge.badgeTextColor || "#fff",
        }

  const nameVisible = showName || !iconUrl
  // 有 icon：上/下/左无边距；仅右侧为文字留边（纯 icon 时为正圆）
  const shapeClass = iconUrl
    ? nameVisible
      ? "pr-1.5"
      : "w-3.5"
    : "px-1.5"

  return (
    <span
      title={badge.name}
      className={cn(
        // 胶囊；overflow-hidden 让 icon 贴合左侧圆弧
        "relative inline-flex h-3.5 max-w-20 items-center overflow-hidden rounded-full text-[9px] font-medium text-white",
        shapeClass,
        animated && "name-gradient-animated",
        className,
      )}
      style={style}
    >
      {iconUrl ? (
        <img
          src={iconUrl}
          alt=""
          // 贴齐上/下/左，正方形填满高度；左侧圆弧由胶囊裁切
          className="h-full w-3.5 shrink-0 rounded-full object-cover"
          draggable={false}
        />
      ) : null}
      {nameVisible ? (
        <span className={cn(textClass, iconUrl && "ml-1")}>{badge.name}</span>
      ) : null}
    </span>
  )
}

/** 角色小徽章条 */
export function RoleBadgePills({
  badges,
  className,
}: {
  badges: MemberRoleBadgeView[]
  className?: string
}) {
  if (badges.length === 0) return null
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {badges.map((badge) => (
        <RoleBadgePill key={badge.id} badge={badge} />
      ))}
    </span>
  )
}
