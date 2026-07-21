// 用户名颜色 / 渐变样式：取成员所绑角色中 position 最高且配置了 style/color 的角色。

import type { CSSProperties } from "react"

import type { GuildMember, Role, RoleNameStyle } from "~/lib/api/types"

export type ResolvedNameStyle = {
  kind: "solid" | "linear" | "radial" | "none"
  colors: string[]
  angle: number
  shape: string
  animated: boolean
  /** 用于徽章/点缀的主色 */
  primaryColor?: string
}

function parseStyle(raw: Role["style"]): RoleNameStyle | null {
  if (!raw) return null
  if (typeof raw === "object") return raw
  const text = raw.trim()
  if (!text || text === "{}") return null
  try {
    return JSON.parse(text) as RoleNameStyle
  } catch {
    return null
  }
}

function normalizeHex(color: string | undefined): string | undefined {
  if (!color?.trim()) return undefined
  const c = color.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c
  if (/^[0-9a-fA-F]{6}$/.test(c)) return `#${c}`
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    const [, r, g, b] = c
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return c.startsWith("#") || c.startsWith("rgb") || c.startsWith("hsl")
    ? c
    : undefined
}

/**
 * 解析成员展示名样式：优先最高 position 的 Role.Style；
 * 否则回退最高有 color 的角色纯色。
 */
export function resolveMemberNameStyle(
  member: Pick<GuildMember, "role_ids"> | undefined,
  roles: Role[] | undefined,
): ResolvedNameStyle {
  const empty: ResolvedNameStyle = {
    kind: "none",
    colors: [],
    angle: 90,
    shape: "circle",
    animated: false,
  }
  if (!member || !roles?.length) return empty

  const bound = roles
    .filter((role) => !role.is_everyone && member.role_ids.includes(role.id))
    .sort((a, b) => b.position - a.position)

  for (const role of bound) {
    const style = parseStyle(role.style)
    if (style?.type === "solid" && style.colors?.[0]) {
      const color = normalizeHex(style.colors[0])
      if (color) {
        return {
          kind: "solid",
          colors: [color],
          angle: 90,
          shape: "circle",
          animated: Boolean(style.animated),
          primaryColor: color,
        }
      }
    }
    if (
      (style?.type === "linear" || style?.type === "radial") &&
      style.colors &&
      style.colors.length >= 2
    ) {
      const colors = style.colors
        .map((c) => normalizeHex(c))
        .filter((c): c is string => Boolean(c))
      if (colors.length >= 2) {
        return {
          kind: style.type,
          colors,
          angle: style.angle ?? 90,
          shape: style.shape || "circle",
          animated: Boolean(style.animated),
          primaryColor: colors[0],
        }
      }
    }
  }

  for (const role of bound) {
    const color = normalizeHex(role.color)
    if (color) {
      return {
        kind: "solid",
        colors: [color],
        angle: 90,
        shape: "circle",
        animated: false,
        primaryColor: color,
      }
    }
  }

  return empty
}

/** 转为 CSS（渐变用 background-clip:text） */
export function nameStyleToCSS(style: ResolvedNameStyle): CSSProperties {
  if (style.kind === "none" || style.colors.length === 0) return {}
  if (style.kind === "solid") {
    return { color: style.colors[0] }
  }
  const gradient =
    style.kind === "linear"
      ? `linear-gradient(${style.angle}deg, ${style.colors.join(", ")})`
      : `radial-gradient(${style.shape}, ${style.colors.join(", ")})`
  return {
    backgroundImage: gradient,
    backgroundSize: style.animated ? "200% 200%" : undefined,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    WebkitTextFillColor: "transparent",
  }
}

/** 角色彩色小徽章（最高 3 个有颜色的角色） */
export function memberRoleBadges(
  member: Pick<GuildMember, "role_ids"> | undefined,
  roles: Role[] | undefined,
): { id: string; name: string; color?: string }[] {
  if (!member || !roles?.length) return []
  return roles
    .filter((role) => !role.is_everyone && member.role_ids.includes(role.id))
    .sort((a, b) => b.position - a.position)
    .slice(0, 3)
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: normalizeHex(role.color),
    }))
}

/** 从消息正文提取 <@uuid> */
export function extractMentionIds(content: string): string[] {
  const ids: string[] = []
  const re = /<@([0-9a-zA-Z-]{1,36})>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content))) {
    if (!ids.includes(match[1]!)) ids.push(match[1]!)
  }
  return ids
}
