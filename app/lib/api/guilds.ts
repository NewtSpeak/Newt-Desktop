// 服务器 / 频道 / 成员 / 邀请（clientapi resources.go）。

import { api } from "./http"
import type {
  Channel,
  ChannelOverwrite,
  ChannelType,
  Guild,
  GuildBanner,
  GuildInvite,
  GuildMember,
  MemberRecord,
  Role,
  RoleNameStyle,
} from "./types"

/** 我加入的服务器列表 */
export const listMyGuilds = () => api<Guild[]>("/users/@me/guilds")

/** 创建服务器（name 2-100 字符），创建者自动成为 owner 与成员 */
export const createGuild = (name: string) =>
  api<Guild>("/guilds", { method: "POST", body: JSON.stringify({ name }) })

// ---------------------------------------------------------------------------
// 服管设置（docs 18；guildapi guild.go / assets.go）
// ---------------------------------------------------------------------------

/** 更新服务器（需 MANAGE_GUILD；restriction_reason_required 仅系统管） */
export const patchGuild = (
  guildId: string,
  patch: {
    name?: string
    description?: string
    /**
     * 默认着陆文字频道。
     * 后端用 *string：JSON null/omit = 不改；空串 "" = 清空；uuid = 设置。
     * 客户端传 null 时序列化为 ""，避免「清空不生效」。
     */
    default_channel_id?: string | null
    restriction_badge_visible?: boolean
    restriction_reason_required?: boolean
  },
) => {
  const body: Record<string, unknown> = { ...patch }
  if ("default_channel_id" in patch) {
    body.default_channel_id = patch.default_channel_id ?? ""
  }
  return api<Guild>(`/guilds/${guildId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

/** 上传服务器图标（multipart 字段 file，PNG/JPEG/WebP/GIF/MP4，需 MANAGE_GUILD）→ GUILD_UPDATE 广播 */
export const uploadGuildIcon = async (guildId: string, file: File) => {
  const form = new FormData()
  form.append("file", file)
  // 后端返回 { url, guild }；兼容若将来直接返回 Guild
  const raw = await api<{ url?: string; guild?: Guild } & Partial<Guild>>(
    `/guilds/${guildId}/icon`,
    { method: "POST", body: form },
  )
  if (raw && typeof raw === "object" && "guild" in raw && raw.guild) {
    return raw.guild
  }
  return raw as Guild
}

/** 移除服务器图标（需 MANAGE_GUILD）→ 返回更新后的 Guild */
export const deleteGuildIcon = (guildId: string) =>
  api<Guild>(`/guilds/${guildId}/icon`, { method: "DELETE" })

// ---------------------------------------------------------------------------
// 服务器横幅 / 多 banner（docs 协议/服务器外观资产.md）
// ---------------------------------------------------------------------------

/** 上传单张服务器横幅（banner_url；multipart 字段 file，需 MANAGE_GUILD） */
export const uploadGuildBanner = async (guildId: string, file: File) => {
  const form = new FormData()
  form.append("file", file)
  const raw = await api<{ url?: string; guild?: Guild } & Partial<Guild>>(
    `/guilds/${guildId}/banner`,
    { method: "POST", body: form },
  )
  if (raw && typeof raw === "object" && "guild" in raw && raw.guild) {
    return raw.guild
  }
  return raw as Guild
}

/** 移除单张服务器横幅（清空 banner_url） */
export const deleteGuildBanner = (guildId: string) =>
  api<Guild>(`/guilds/${guildId}/banner`, { method: "DELETE" })

/** 列出多 banner（position 升序） */
export const listGuildBanners = (guildId: string) =>
  api<{ guild_id: string; banners: GuildBanner[]; limit: number }>(
    `/guilds/${guildId}/banners`,
  )

/** 新增多 banner（追加末尾；超上限 400 BANNER_LIMIT_REACHED） */
export const addGuildBanner = async (guildId: string, file: File) => {
  const form = new FormData()
  form.append("file", file)
  return api<{ banner: GuildBanner; banners: GuildBanner[] }>(
    `/guilds/${guildId}/banners`,
    { method: "POST", body: form },
  )
}

/** 删除指定 banner（按 id）→ 返回剩余列表 */
export const removeGuildBanner = (guildId: string, bannerId: string) =>
  api<{ banners: GuildBanner[] }>(
    `/guilds/${guildId}/banners/${bannerId}`,
    { method: "DELETE" },
  )

/** 重排序多 banner（全量有序 ID 数组） */
export const reorderGuildBanners = (guildId: string, bannerIds: string[]) =>
  api<{ banners: GuildBanner[] }>(`/guilds/${guildId}/banners`, {
    method: "PATCH",
    body: JSON.stringify({ banner_ids: bannerIds }),
  })

/** 转让所有权（仅所有者；新所有者须为本服成员）→ GUILD_UPDATE */
export const transferGuildOwnership = (guildId: string, newOwnerUserId: string) =>
  api<void>(`/guilds/${guildId}/transfer-ownership`, {
    method: "POST",
    body: JSON.stringify({ new_owner_user_id: newOwnerUserId }),
  })

/** 删除服务器（仅所有者；confirm_name 必须与当前名称一致，docs 02 FR-27） */
export const deleteGuild = (guildId: string, confirmName: string) =>
  api<void>(`/guilds/${guildId}`, {
    method: "DELETE",
    body: JSON.stringify({ confirm_name: confirmName }),
  })

/** 当前用户可见的频道列表；非成员/服不存在一律 404 */
export const listChannels = (guildId: string) => api<Channel[]>(`/guilds/${guildId}/channels`)

export type CreateChannelInput = {
  name: string
  type: ChannelType
  topic?: string
  position?: number
  parent_id?: string | null
  user_limit?: number
  rate_limit_per_user?: number
  rate_limit_exempt_role_ids?: string[]
  /** 访问密码（TEXT/VOICE 上锁） */
  password?: string
  /** 语音频道活动注释 */
  voice_note?: string
  /** 私密频道：@everyone 不可见 */
  private?: boolean
  /** 私密频道可见角色 id */
  visible_role_ids?: string[]
}

/** 创建频道 / 分类（需 MANAGE_CHANNELS）；type=CATEGORY 时为创建类别 */
export const createChannel = (guildId: string, input: CreateChannelInput) =>
  api<Channel>(`/guilds/${guildId}/channels`, {
    method: "POST",
    body: JSON.stringify(input),
  })

/** 批量排序频道 / 类别（需 MANAGE_CHANNELS）；支持跨分类移动 parent_id */
export type ChannelReorderItem = {
  id: string
  position: number
  /** null / 省略 = 根级；分类 id = 归入该类别 */
  parent_id?: string | null
}

export const reorderChannels = (guildId: string, items: ChannelReorderItem[]) =>
  api<void>(`/guilds/${guildId}/channels`, {
    method: "PATCH",
    body: JSON.stringify(items),
  })

/** 更新频道（PATCH /channels/:id，需 MANAGE_CHANNELS）→ CHANNEL_UPDATE */
export type UpdateChannelInput = {
  name?: string
  topic?: string
  user_limit?: number
  rate_limit_per_user?: number
  rate_limit_exempt_role_ids?: string[]
  /** 是否允许限定可见消息 */
  allow_restricted_visibility?: boolean
  /** 默认可见身份组；传 [] 清空 */
  default_visible_role_ids?: string[]
  /** 强制使用默认可见范围 */
  force_default_visibility?: boolean
  /** null = 移出分类 */
  parent_id?: string | null
  /** 设置/更换访问密码 */
  password?: string
  /** false = 关锁并清空密码 */
  locked?: boolean
  /** 语音频道活动注释；空串清空 */
  voice_note?: string
}

export const updateChannel = (channelId: string, input: UpdateChannelInput) =>
  api<Channel>(`/channels/${channelId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })

/** 删除频道 / 分类（需 MANAGE_CHANNELS） */
export const deleteChannel = (channelId: string) =>
  api<void>(`/channels/${channelId}`, { method: "DELETE" })

/** 输入密码解锁上锁频道 */
export const unlockChannel = (channelId: string, password: string) =>
  api<{ channel_id: string; unlocked: boolean; already?: boolean }>(
    `/channels/${channelId}/unlock`,
    {
      method: "POST",
      body: JSON.stringify({ password }),
    },
  )

/** 查询当前用户对该频道的解锁状态 */
export const getChannelUnlockStatus = (channelId: string) =>
  api<{ channel_id: string; locked: boolean; unlocked: boolean }>(
    `/channels/${channelId}/unlock-status`,
  )

// ---------------------------------------------------------------------------
// 频道权限覆盖（docs 04 FR-09–15；需 MANAGE_ROLES）
// ---------------------------------------------------------------------------

/** 列出频道既有覆盖 */
export const listChannelOverwrites = (guildId: string, channelId: string) =>
  api<ChannelOverwrite[]>(
    `/guilds/${guildId}/channels/${channelId}/overwrites`,
  )

/** 创建/更新覆盖（targetId 为 role_id 或 member 记录 id） */
export const upsertChannelOverwrite = (
  channelId: string,
  targetId: string,
  input: { type: "ROLE" | "MEMBER"; allow: number; deny: number },
) =>
  api<ChannelOverwrite>(`/channels/${channelId}/overwrites/${targetId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  })

/** 删除覆盖 */
export const deleteChannelOverwrite = (
  channelId: string,
  targetId: string,
  type?: "ROLE" | "MEMBER",
) =>
  api<void>(
    `/channels/${channelId}/overwrites/${targetId}${type ? `?type=${type}` : ""}`,
    { method: "DELETE" },
  )

/** 创建服务器邀请（需 CREATE_INSTANT_INVITE）；不传参 = 不过期、不限次 */
export const createGuildInvite = (
  guildId: string,
  input?: { ttl_seconds?: number; max_uses?: number },
) => {
  const body: Record<string, number> = {}
  // 后端 binding：ttl_seconds min=60；max_uses min=1；0/缺省表示不限
  if (input?.ttl_seconds && input.ttl_seconds >= 60) {
    body.ttl_seconds = input.ttl_seconds
  }
  if (input?.max_uses && input.max_uses >= 1) {
    body.max_uses = input.max_uses
  }
  return api<GuildInvite>(`/guilds/${guildId}/invites`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}
/** 服务器成员列表（需本人是成员） */
export const listMembers = (guildId: string) => api<GuildMember[]>(`/guilds/${guildId}/members`)

/** 凭邀请码加入服务器；404 无效/过期、403 BANNED；已是成员幂等返回 200 */
export const joinInvite = (code: string) =>
  api<MemberRecord>(`/invites/${encodeURIComponent(code)}/join`, { method: "POST" })

/** 服务器全量角色（成员即可见） */
export const listRoles = (guildId: string) => api<Role[]>(`/guilds/${guildId}/roles`)

/** 创建/更新角色请求体（guildapi roleRequest） */
export type RoleWriteInput = {
  name: string
  /** int64 位掩码；JS 安全整数范围内用 number，高位由服务端合并保留 */
  permissions: number
  /** @everyone 固定 0；自定义角色 ≥1 */
  position: number
  color?: string
  hoist?: boolean
  mentionable?: boolean
}

/** 创建角色（需 MANAGE_ROLES + 防提权）→ GUILD_ROLE_CREATE */
export const createRole = (guildId: string, input: RoleWriteInput) =>
  api<Role>(`/guilds/${guildId}/roles`, {
    method: "POST",
    body: JSON.stringify(input),
  })

/** 更新角色（需 MANAGE_ROLES + 层级；内置 managed 权限/层级锁定）→ GUILD_ROLE_UPDATE */
export const updateRole = (guildId: string, roleId: string, input: RoleWriteInput) =>
  api<Role>(`/guilds/${guildId}/roles/${roleId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })

/** 角色名样式类型（PUT /roles/{id}/style，customization/style.go） */
export type RoleStyleType = "" | "solid" | "linear" | "radial"

/** 编辑器用表面样式（type 必填联合，与 types.RoleSurfaceStyle 对齐） */
export type RoleStyleSurface = {
  type: RoleStyleType
  colors?: string[]
  /** 暗色主题独立配色；空则亮暗共用 colors */
  colors_dark?: string[]
  angle?: number
  shape?: "circle" | "ellipse"
  animated?: boolean
  speed?: number
}

export type RoleStyleBadge = {
  enabled?: boolean
  background?: RoleStyleSurface
  background_image_url?: string
  icon_url?: string
  show_name?: boolean
  text_color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}

export type RoleStyle = RoleStyleSurface & {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  icon_sync?: boolean
  icon?: RoleStyleSurface
  badge?: RoleStyleBadge
}

function parseSurface(
  obj: RoleNameStyle | RoleStyleSurface | null | undefined,
): RoleStyleSurface {
  if (!obj?.type) return { type: "" }
  const type = obj.type as RoleStyleType
  if (type !== "solid" && type !== "linear" && type !== "radial") {
    return { type: "" }
  }
  return {
    type,
    colors: obj.colors?.length ? [...obj.colors] : undefined,
    colors_dark: obj.colors_dark?.length ? [...obj.colors_dark] : undefined,
    angle: obj.angle,
    shape:
      obj.shape === "ellipse" || obj.shape === "circle" ? obj.shape : undefined,
    animated: Boolean(obj.animated) || undefined,
    speed:
      typeof obj.speed === "number" && obj.speed >= 0.5 && obj.speed <= 20
        ? obj.speed
        : undefined,
  }
}

/** 解析 Role.style（JSON 字符串或对象）为可编辑草稿 */
export function parseRoleStyle(
  raw: string | RoleNameStyle | undefined | null,
): RoleStyle {
  if (!raw) return { type: "" }
  let obj: RoleNameStyle | null = null
  if (typeof raw === "object") {
    obj = raw
  } else {
    const text = raw.trim()
    if (text && text !== "{}") {
      try {
        obj = JSON.parse(text) as RoleNameStyle
      } catch {
        obj = null
      }
    }
  }
  if (!obj) return { type: "" }
  const base = parseSurface(obj)
  const icon = obj.icon ? parseSurface(obj.icon) : undefined
  const badgeRaw = obj.badge
  const badgeBg = badgeRaw?.background
    ? parseSurface(badgeRaw.background as RoleNameStyle)
    : undefined
  const badge: RoleStyleBadge | undefined = badgeRaw
    ? {
        enabled: Boolean(badgeRaw.enabled) || undefined,
        background: badgeBg?.type ? badgeBg : undefined,
        background_image_url:
          badgeRaw.background_image_url?.trim() || undefined,
        icon_url: badgeRaw.icon_url?.trim() || undefined,
        show_name: badgeRaw.show_name,
        text_color: badgeRaw.text_color?.trim() || undefined,
        bold: Boolean(badgeRaw.bold) || undefined,
        italic: Boolean(badgeRaw.italic) || undefined,
        underline: Boolean(badgeRaw.underline) || undefined,
        strikethrough: Boolean(badgeRaw.strikethrough) || undefined,
      }
    : undefined
  const hasBadge =
    badge &&
    (badge.enabled ||
      badge.background ||
      badge.background_image_url ||
      badge.icon_url ||
      badge.text_color ||
      badge.bold ||
      badge.italic ||
      badge.underline ||
      badge.strikethrough)
  const hasTextDecor =
    Boolean(obj.bold) ||
    Boolean(obj.italic) ||
    Boolean(obj.underline) ||
    Boolean(obj.strikethrough)
  if (!base.type && !hasBadge && !hasTextDecor) return { type: "" }
  return {
    type: base.type,
    colors: base.colors,
    colors_dark: base.colors_dark,
    angle: base.angle,
    shape: base.shape,
    animated: base.animated,
    speed: base.speed,
    bold: Boolean(obj.bold) || undefined,
    italic: Boolean(obj.italic) || undefined,
    underline: Boolean(obj.underline) || undefined,
    strikethrough: Boolean(obj.strikethrough) || undefined,
    icon_sync: Boolean(obj.icon_sync) || undefined,
    icon: icon?.type ? icon : undefined,
    badge: hasBadge ? badge : undefined,
  }
}

/** icon 实际应用的表面样式（sync / 独立 / 回退主色） */
export function resolveRoleIconStyle(
  style: RoleStyle | null | undefined,
): RoleStyleSurface | null {
  if (!style?.type) return null
  if (style.icon_sync) {
    return {
      type: style.type,
      colors: style.colors,
      angle: style.angle,
      shape: style.shape,
      animated: style.animated,
      speed: style.speed,
    }
  }
  if (style.icon?.type) return style.icon
  if (style.colors?.[0]) return { type: "solid", colors: [style.colors[0]] }
  return null
}

/**
 * 更新角色名样式（纯色 / 线性 / 径向 + 速度 + icon 同步/独立）。
 * 需 MANAGE_CUSTOMIZATION 或 MANAGE_ROLES → GUILD_ROLE_UPDATE。
 * type 为空对象表示清除样式。
 */
export const updateRoleStyle = (
  guildId: string,
  roleId: string,
  style: RoleStyle,
) =>
  api<Role>(`/guilds/${guildId}/roles/${roleId}/style`, {
    method: "PUT",
    body: JSON.stringify(style),
  })

async function uploadRoleBadgeAsset(
  guildId: string,
  roleId: string,
  path: "badge-icon" | "badge-background",
  file: File,
): Promise<{ role: Role; icon_url?: string; background_image_url?: string }> {
  const { apiBaseURL, ensureAccessToken } = await import("./http")
  const token = await ensureAccessToken()
  const headers = new Headers()
  headers.set("Content-Type", file.type || "application/octet-stream")
  if (token) headers.set("Authorization", `Bearer ${token}`)
  const response = await fetch(
    `${apiBaseURL()}/guilds/${guildId}/roles/${roleId}/${path}`,
    { method: "PUT", headers, body: file },
  )
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string }
    }
    throw new Error(body.error?.message ?? `上传失败（${response.status}）`)
  }
  return response.json() as Promise<{
    role: Role
    icon_url?: string
    background_image_url?: string
  }>
}

/** 上传角色徽章 icon（原始字节，Content-Type 为文件 MIME） */
export async function uploadRoleBadgeIcon(
  guildId: string,
  roleId: string,
  file: File,
) {
  return uploadRoleBadgeAsset(guildId, roleId, "badge-icon", file)
}

export const deleteRoleBadgeIcon = (guildId: string, roleId: string) =>
  api<Role>(`/guilds/${guildId}/roles/${roleId}/badge-icon`, {
    method: "DELETE",
  })

/** 上传角色徽章背景图 */
export async function uploadRoleBadgeBackground(
  guildId: string,
  roleId: string,
  file: File,
) {
  return uploadRoleBadgeAsset(guildId, roleId, "badge-background", file)
}

export const deleteRoleBadgeBackground = (guildId: string, roleId: string) =>
  api<Role>(`/guilds/${guildId}/roles/${roleId}/badge-background`, {
    method: "DELETE",
  })

/** 删除角色（@everyone / managed 不可删）→ GUILD_ROLE_DELETE */
export const deleteRole = (guildId: string, roleId: string) =>
  api<void>(`/guilds/${guildId}/roles/${roleId}`, { method: "DELETE" })

/** 批量排序角色（body: [{id, position}]；@everyone/managed 不可参与）→ 逐条 GUILD_ROLE_UPDATE */
export const reorderRoles = (
  guildId: string,
  items: { id: string; position: number }[],
) =>
  api<void>(`/guilds/${guildId}/roles`, {
    method: "PATCH",
    body: JSON.stringify(items),
  })

/** 给成员绑定角色（需 MANAGE_ROLES + 层级；memberId 为成员记录 ID 或 user_id） */
export const assignMemberRole = (guildId: string, memberId: string, roleId: string) =>
  api<void>(`/guilds/${guildId}/members/${memberId}/roles/${roleId}`, { method: "PUT" })

/** 解绑成员角色（同 assignMemberRole 语义） */
export const removeMemberRole = (guildId: string, memberId: string, roleId: string) =>
  api<void>(`/guilds/${guildId}/members/${memberId}/roles/${roleId}`, { method: "DELETE" })

// ---------------------------------------------------------------------------
// 邀请管理（docs 18 §5.7；publicinvite list/delete）
// ---------------------------------------------------------------------------

/** 本服有效邀请列表（需 CREATE_INSTANT_INVITE 或 MANAGE_GUILD） */
export const listGuildInvites = (guildId: string) =>
  api<GuildInvite[]>(`/guilds/${guildId}/invites`)

/** 撤销邀请（按 code；需 CREATE_INSTANT_INVITE 或 MANAGE_GUILD） */
export const revokeGuildInvite = (guildId: string, code: string) =>
  api<void>(`/guilds/${guildId}/invites/${encodeURIComponent(code)}`, {
    method: "DELETE",
  })

/** 踢出成员（需 KICK_MEMBERS + 层级；memberId 为成员记录 ID 或 user_id） */
export const kickMember = (guildId: string, memberId: string) =>
  api<void>(`/guilds/${guildId}/members/${memberId}`, { method: "DELETE" })

/** 主动退出服务器（所有者不可退，需先转让；路径 @me） */
export const leaveGuild = (guildId: string) =>
  api<void>(`/guilds/${guildId}/members/@me`, { method: "DELETE" })

/**
 * 修改成员昵称（本人 CHANGE_NICKNAME / 他人 MANAGE_NICKNAMES；空串清空）。
 * @param memberId 成员记录 ID、user_id 或 "@me"（本人）
 */
export const updateMemberNickname = (
  guildId: string,
  memberId: string,
  nickname: string,
) =>
  api<void>(`/guilds/${guildId}/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify({ nickname }),
  })

/**
 * 本人选用用户名样式来源角色（PATCH /members/@me/name-style）。
 * roleId 为 null 表示清除，恢复自动（最高有样式的持有角色）。
 * 不改变角色绑定，只切换展示用的 style 来源。
 */
export const updateMyNameStylePreference = (
  guildId: string,
  roleId: string | null,
) =>
  api<{ id: string; name_style_role_id?: string | null }>(
    `/guilds/${guildId}/members/@me/name-style`,
    {
      method: "PATCH",
      body: JSON.stringify({ role_id: roleId }),
    },
  )

/** 封禁用户（需 BAN_MEMBERS + 层级；按 user_id，效果 = 移除成员 + 禁止再加入） */
export const banUser = (guildId: string, userId: string, reason?: string) =>
  api<void>(`/guilds/${guildId}/bans/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ reason: reason ?? "" }),
  })

/** 解封（需 BAN_MEMBERS） */
export const unbanUser = (guildId: string, userId: string) =>
  api<void>(`/guilds/${guildId}/bans/${userId}`, { method: "DELETE" })

export type GuildBan = {
  id?: string
  guild_id?: string
  user_id: string
  reason?: string
  created_by?: string
  created_at?: string
}

/** 封禁列表（需 BAN_MEMBERS） */
export const listBans = (guildId: string) =>
  api<GuildBan[] | { bans?: GuildBan[]; items?: GuildBan[] }>(
    `/guilds/${guildId}/bans`,
  ).then((raw) => {
    if (Array.isArray(raw)) return raw
    return raw.bans ?? raw.items ?? []
  })
