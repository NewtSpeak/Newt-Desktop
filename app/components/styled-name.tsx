// 带角色色 / 渐变的显示名；animated 时做缓慢流动。

import { cn } from "~/lib/utils"
import {
  nameStyleToCSS,
  type ResolvedNameStyle,
} from "~/lib/name-style"

export function StyledDisplayName({
  name,
  style,
  className,
  prefix,
}: {
  name: string
  style?: ResolvedNameStyle | null
  className?: string
  /** 可选前缀如 @ */
  prefix?: string
}) {
  const resolved = style ?? {
    kind: "none" as const,
    colors: [],
    angle: 90,
    shape: "circle",
    animated: false,
  }
  const css = nameStyleToCSS(resolved)
  const isGradient = resolved.kind === "linear" || resolved.kind === "radial"

  return (
    <span
      className={cn(
        "inline font-medium",
        isGradient && resolved.animated && "animate-[name-gradient_4s_ease_infinite]",
        className,
      )}
      style={css}
    >
      {prefix}
      {name}
    </span>
  )
}

/** 角色小徽章条 */
export function RoleBadgePills({
  badges,
  className,
}: {
  badges: { id: string; name: string; color?: string }[]
  className?: string
}) {
  if (badges.length === 0) return null
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {badges.map((badge) => (
        <span
          key={badge.id}
          title={badge.name}
          className="inline-flex h-3.5 max-w-16 items-center truncate rounded-full px-1.5 text-[9px] font-medium text-white"
          style={{
            backgroundColor: badge.color || "var(--color-muted-foreground)",
          }}
        >
          <span className="truncate">{badge.name}</span>
        </span>
      ))}
    </span>
  )
}
