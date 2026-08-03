// 用户名颜色 / 渐变 / 文字装饰：取成员所绑角色中 position 最高且配置了 style/color 的角色。

import type { CSSProperties } from "react"

import type {
  GuildMember,
  Role,
  RoleNameStyle,
  RoleSurfaceStyle,
} from "~/lib/api/types"

export type ResolvedNameStyle = {
  kind: "solid" | "linear" | "radial" | "none"
  colors: string[]
  /** 暗色主题独立配色；空则亮暗共用 colors */
  colorsDark?: string[]
  angle: number
  shape: string
  animated: boolean
  /** 流动周期秒数（默认 4） */
  speed: number
  /** 用于徽章/点缀的主色 */
  primaryColor?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}

const DEFAULT_SPEED = 4

const emptyResolved = (): ResolvedNameStyle => ({
  kind: "none",
  colors: [],
  angle: 90,
  shape: "circle",
  animated: false,
  speed: DEFAULT_SPEED,
})

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

function clampSpeed(speed: number | undefined): number {
  if (typeof speed !== "number" || Number.isNaN(speed)) return DEFAULT_SPEED
  return Math.min(20, Math.max(0.5, speed))
}

function pickDecor(
  style: RoleNameStyle | RoleSurfaceStyle | null | undefined,
): Pick<
  ResolvedNameStyle,
  "bold" | "italic" | "underline" | "strikethrough"
> {
  const s = style as RoleNameStyle | null | undefined
  return {
    bold: Boolean(s?.bold) || undefined,
    italic: Boolean(s?.italic) || undefined,
    underline: Boolean(s?.underline) || undefined,
    strikethrough: Boolean(s?.strikethrough) || undefined,
  }
}

function hasDecor(
  d: Pick<ResolvedNameStyle, "bold" | "italic" | "underline" | "strikethrough">,
): boolean {
  return Boolean(d.bold || d.italic || d.underline || d.strikethrough)
}

function surfaceToResolved(
  style: RoleSurfaceStyle | RoleNameStyle | null | undefined,
): ResolvedNameStyle | null {
  const decor = pickDecor(style)
  if (!style?.type) {
    if (!hasDecor(decor)) return null
    return { ...emptyResolved(), ...decor }
  }
  if (style.type === "solid" && style.colors?.[0]) {
    const color = normalizeHex(style.colors[0])
    if (!color) {
      return hasDecor(decor) ? { ...emptyResolved(), ...decor } : null
    }
    const darkColor = normalizeHex(style.colors_dark?.[0])
    return {
      kind: "solid",
      colors: [color],
      colorsDark: darkColor ? [darkColor] : undefined,
      angle: 90,
      shape: "circle",
      animated: false,
      speed: DEFAULT_SPEED,
      primaryColor: color,
      ...decor,
    }
  }
  if (
    (style.type === "linear" || style.type === "radial") &&
    style.colors &&
    style.colors.length >= 2
  ) {
    const colors = style.colors
      .map((c) => normalizeHex(c))
      .filter((c): c is string => Boolean(c))
    if (colors.length < 2) {
      return hasDecor(decor) ? { ...emptyResolved(), ...decor } : null
    }
    const colorsDark = (style.colors_dark ?? [])
      .map((c) => normalizeHex(c))
      .filter((c): c is string => Boolean(c))
    return {
      kind: style.type,
      colors,
      colorsDark: colorsDark.length >= 2 ? colorsDark : undefined,
      angle: style.angle ?? 90,
      shape: style.shape || "circle",
      animated: Boolean(style.animated),
      speed: clampSpeed(style.speed),
      primaryColor: colors[0],
      ...decor,
    }
  }
  return hasDecor(decor) ? { ...emptyResolved(), ...decor } : null
}

function roleHasDisplayStyle(role: Role): boolean {
  if (normalizeHex(role.color)) return true
  const parsed = parseStyle(role.style)
  return Boolean(surfaceToResolved(parsed))
}

/**
 * 解析成员展示名样式：
 * 1. 若设置了 name_style_role_id 且仍持有该角色 → 用该角色 style/color；
 * 2. 否则取持有角色中 position 最高且有 style 的角色；
 * 3. 再回退最高有 color 的角色纯色。
 *
 * 特殊：服主（is_owner）即使未写入 member_roles，也视同持有内置 managed 管理员角色
 *（建服种子 @admin 默认带渐变样式；历史上所有者未必被绑进该角色）。
 */
export function resolveMemberNameStyle(
  member:
    | Pick<GuildMember, "role_ids" | "name_style_role_id" | "is_owner">
    | undefined,
  roles: Role[] | undefined,
): ResolvedNameStyle {
  const empty = emptyResolved()
  if (!member || !roles?.length) return empty

  // 统一 string 比较，避免 UUID 序列化差异导致 has 失败
  const heldIds = new Set(
    (member.role_ids ?? []).map((id) => String(id).toLowerCase()),
  )
  const everyone = roles.find((r) => r.is_everyone)

  // 服主视同持有 managed 管理员角色（用于用户名样式，不改变真实 role_ids）
  if (member.is_owner) {
    for (const role of roles) {
      if (role.managed && !role.is_everyone) {
        heldIds.add(String(role.id).toLowerCase())
      }
    }
  }

  const holds = (role: Role) =>
    role.is_everyone || heldIds.has(String(role.id).toLowerCase())

  const styleFromRole = (role: Role): ResolvedNameStyle | null => {
    const fromStyle = surfaceToResolved(parseStyle(role.style))
    if (fromStyle && fromStyle.kind !== "none") return fromStyle
    // style 为空对象时回退 color，避免 managed admin 仅有 color 时被跳过
    const color = normalizeHex(role.color)
    if (color) {
      return {
        ...emptyResolved(),
        kind: "solid",
        colors: [color],
        primaryColor: color,
      }
    }
    return null
  }

  // 1. 本人偏好角色
  const preferredId = member.name_style_role_id
    ? String(member.name_style_role_id).trim().toLowerCase()
    : ""
  if (preferredId) {
    const preferred = roles.find(
      (r) => String(r.id).toLowerCase() === preferredId,
    )
    if (preferred && holds(preferred)) {
      const resolved = styleFromRole(preferred)
      if (resolved) return resolved
    }
  }

  // 2. 自动：持有角色 + @everyone，按 position 降序（优先真正有样式的角色）
  const bound = roles
    .filter((role) => holds(role))
    .sort((a, b) => {
      // 同 position 时 managed 管理员优先（@admin position 通常最高）
      if (b.position !== a.position) return b.position - a.position
      if (a.managed !== b.managed) return a.managed ? -1 : 1
      return 0
    })

  for (const role of bound) {
    if (!roleHasDisplayStyle(role) && !role.is_everyone) continue
    const resolved = styleFromRole(role)
    if (resolved) return resolved
  }

  // @everyone color 最后
  if (everyone) {
    const color = normalizeHex(everyone.color)
    if (color) {
      return {
        ...emptyResolved(),
        kind: "solid",
        colors: [color],
        primaryColor: color,
      }
    }
  }

  return empty
}

/**
 * 解析角色色点/icon 样式：
 * icon_sync → 与文字同；独立 icon；否则主色纯色。
 */
export function resolveRoleIconResolved(
  role: Pick<Role, "style" | "color"> | undefined,
): ResolvedNameStyle {
  const empty = emptyResolved()
  if (!role) return empty
  const raw = parseStyle(role.style)
  if (raw?.type) {
    if (raw.icon_sync) {
      const text = surfaceToResolved(raw)
      if (text && text.kind !== "none") return text
    } else if (raw.icon?.type) {
      const icon = surfaceToResolved(raw.icon)
      if (icon && icon.kind !== "none") return icon
    } else {
      const text = surfaceToResolved(raw)
      if (text?.primaryColor) {
        return {
          ...emptyResolved(),
          kind: "solid",
          colors: [text.primaryColor],
          primaryColor: text.primaryColor,
        }
      }
    }
  }
  const color = normalizeHex(role.color)
  if (color) {
    return {
      ...emptyResolved(),
      kind: "solid",
      colors: [color],
      primaryColor: color,
    }
  }
  return empty
}

/** 按亮暗主题选用色标：暗色主题优先 colorsDark，缺省共用 colors */
function themeColors(style: ResolvedNameStyle, dark: boolean): string[] {
  return dark && style.colorsDark?.length ? style.colorsDark : style.colors
}

/** 文字 CSS（渐变用 background-clip:text）+ 装饰；dark 为当前是否暗色主题 */
export function nameStyleToCSS(
  style: ResolvedNameStyle,
  dark = false,
): CSSProperties {
  const decor: CSSProperties = {}
  if (style.bold) decor.fontWeight = 700
  if (style.italic) decor.fontStyle = "italic"
  const lines: string[] = []
  if (style.underline) lines.push("underline")
  if (style.strikethrough) lines.push("line-through")
  if (lines.length) {
    decor.textDecorationLine = lines.join(" ")
    decor.textDecorationThickness = "from-font"
  }

  if (style.kind === "none" || style.colors.length === 0) {
    return decor
  }
  const colors = themeColors(style, dark)
  if (style.kind === "solid") {
    return { ...decor, color: colors[0] }
  }
  const stops = style.animated
    ? [...colors, colors[0]].join(", ")
    : colors.join(", ")
  const gradient =
    style.kind === "linear"
      ? `linear-gradient(${style.angle}deg, ${stops})`
      : `radial-gradient(${style.shape}, ${stops})`
  return {
    ...decor,
    backgroundImage: gradient,
    backgroundSize: style.animated ? "200% 200%" : undefined,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    WebkitTextFillColor: "transparent",
    ...(style.animated
      ? { animationDuration: `${clampSpeed(style.speed)}s` }
      : {}),
  }
}

/** 色点/icon 填充 CSS（背景渐变，非文字 clip）；dark 为当前是否暗色主题 */
export function iconStyleToFillCSS(
  style: ResolvedNameStyle,
  dark = false,
): CSSProperties {
  if (style.kind === "none" || style.colors.length === 0) return {}
  const colors = themeColors(style, dark)
  if (style.kind === "solid") {
    return { backgroundColor: colors[0] }
  }
  const stops = style.animated
    ? [...colors, colors[0]].join(", ")
    : colors.join(", ")
  const gradient =
    style.kind === "linear"
      ? `linear-gradient(${style.angle}deg, ${stops})`
      : `radial-gradient(${style.shape}, ${stops})`
  return {
    backgroundImage: gradient,
    backgroundColor: "transparent",
    backgroundSize: style.animated ? "200% 200%" : undefined,
    ...(style.animated
      ? { animationDuration: `${clampSpeed(style.speed)}s` }
      : {}),
  }
}

export type MemberRoleBadgeView = {
  id: string
  name: string
  color?: string
  iconStyle?: ResolvedNameStyle
  badgeBackground?: ResolvedNameStyle
  badgeBackgroundImageUrl?: string
  badgeIconUrl?: string
  badgeShowName?: boolean
  badgeTextColor?: string
  badgeCustom?: boolean
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}

/** 角色徽章（最高 3 个；含自定义徽章背景/icon/文字装饰） */
export function memberRoleBadges(
  member: Pick<GuildMember, "role_ids"> | undefined,
  roles: Role[] | undefined,
): MemberRoleBadgeView[] {
  if (!member || !roles?.length) return []
  return roles
    .filter((role) => !role.is_everyone && member.role_ids.includes(role.id))
    .sort((a, b) => b.position - a.position)
    .slice(0, 3)
    .map((role) => {
      const iconStyle = resolveRoleIconResolved(role)
      const raw = parseStyle(role.style)
      const badge = raw?.badge
      const badgeBg = badge?.background
        ? surfaceToResolved(badge.background)
        : null
      const bgImage = badge?.background_image_url?.trim() || undefined
      const badgeCustom = Boolean(
        badge?.enabled ||
          badge?.icon_url ||
          bgImage ||
          (badgeBg && badgeBg.kind !== "none") ||
          badge?.bold ||
          badge?.italic ||
          badge?.underline ||
          badge?.strikethrough,
      )
      return {
        id: role.id,
        name: role.name,
        color: iconStyle.primaryColor || normalizeHex(role.color),
        iconStyle: iconStyle.kind !== "none" ? iconStyle : undefined,
        badgeBackground:
          badgeBg && badgeBg.kind !== "none" ? badgeBg : undefined,
        badgeBackgroundImageUrl: bgImage,
        badgeIconUrl: badge?.icon_url?.trim() || undefined,
        badgeShowName: badge?.show_name !== false,
        badgeTextColor: normalizeHex(badge?.text_color),
        badgeCustom,
        bold: Boolean(badge?.bold) || undefined,
        italic: Boolean(badge?.italic) || undefined,
        underline: Boolean(badge?.underline) || undefined,
        strikethrough: Boolean(badge?.strikethrough) || undefined,
      }
    })
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
