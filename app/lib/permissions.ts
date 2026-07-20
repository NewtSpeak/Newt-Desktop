// RBAC 权限位与计算（移植自 Owl-Server internal/rbac/permissions.go，
// 位定义与 frontend/app/lib/permissions.ts 的权限位表一致）。
//
// int64 位掩码统一用 BigInt 处理（位 46+ 超出 Number 安全整数按位运算范围）。
//
// 注意：用户端平面当前没有 roles API，拿不到角色权限掩码；本库先作为纯函数工具备着，
// UI 不要依赖它做门槛判断——一切以服务端 404/403 为准（docs 03）。

// ---------------------------------------------------------------------------
// 权限位（与 permissions.go 的 iota 顺序一一对应）
// ---------------------------------------------------------------------------

export const Permissions = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  SEND_TTS_MESSAGES: 1n << 12n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  VIEW_GUILD_INSIGHTS: 1n << 19n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_EXPRESSIONS: 1n << 30n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  MODERATE_MEMBERS: 1n << 39n,
  VIEW_CREATOR_MONETIZATION_ANALYTICS: 1n << 40n,
  USE_SOUNDBOARD: 1n << 41n,
  CREATE_GUILD_EXPRESSIONS: 1n << 42n,
  CREATE_EVENTS: 1n << 43n,
  USE_EXTERNAL_SOUNDS: 1n << 44n,
  SEND_VOICE_MESSAGES: 1n << 45n,
  // 舞台协管节点（docs 11 §7.2）与屏幕共享节点（docs 14 §7.4）
  STAGE_BRING_UP: 1n << 46n,
  STAGE_BRING_DOWN: 1n << 47n,
  STAGE_MANAGE_QUEUE: 1n << 48n,
  STAGE_CHANGE_MODE: 1n << 49n,
  STREAM_END_OTHERS: 1n << 50n,
  STREAM_QUALITY: 1n << 51n,
  // AI 时代扩展功能节点
  MANAGE_BOTS: 1n << 52n,
  MANAGE_BADGES: 1n << 53n,
  MANAGE_CUSTOMIZATION: 1n << 54n,
} as const

export type PermissionName = keyof typeof Permissions

/** 全部已定义位（permissions.go：AllDefined = (1 << 55) - 1） */
export const ALL_DEFINED: bigint = (1n << 55n) - 1n

/** @everyone 默认权限（permissions.go DefaultEveryone） */
export const DEFAULT_EVERYONE: bigint =
  Permissions.VIEW_CHANNEL |
  Permissions.SEND_MESSAGES |
  Permissions.READ_MESSAGE_HISTORY |
  Permissions.CONNECT |
  Permissions.SPEAK |
  Permissions.CHANGE_NICKNAME |
  Permissions.ADD_REACTIONS |
  Permissions.USE_VAD

// ---------------------------------------------------------------------------
// 输入类型
// ---------------------------------------------------------------------------

export type RolePermissions = {
  id: string
  /** 角色权限掩码（服务端 int64；可传 bigint / number / 十进制字符串） */
  permissions: bigint
  /** 是否 @everyone 角色 */
  everyone: boolean
}

export type ChannelOverwriteInput = {
  targetId: string
  /** true = 成员级覆盖，false = 角色级覆盖 */
  member: boolean
  allow: bigint
  deny: bigint
}

/** 服务端 int64 掩码（number 或字符串）→ BigInt */
export function toPermissionMask(value: bigint | number | string): bigint {
  if (typeof value === "bigint") return value
  return BigInt(value)
}

// ---------------------------------------------------------------------------
// 计算（与 rbac.GuildPermissions / rbac.ChannelPermissions 语义一致）
// ---------------------------------------------------------------------------

/** 服级权限：owner 短路 → 角色并集 → 含 ADMINISTRATOR 短路为全权限 */
export function computeGuildPermissions(owner: boolean, roles: RolePermissions[]): bigint {
  if (owner) return ALL_DEFINED
  let result = 0n
  for (const role of roles) {
    result |= role.permissions
  }
  if ((result & Permissions.ADMINISTRATOR) !== 0n) return ALL_DEFINED
  return result & ALL_DEFINED
}

/**
 * 频道级权限：
 *   owner / ADMINISTRATOR 短路 → @everyone 覆盖 → 角色覆盖（deny 并集先清、allow 并集后加）
 *   → 成员覆盖。overwrites 传该频道的全部覆盖，函数内部自行筛选与本人相关的条目。
 */
export function computeChannelPermissions(
  owner: boolean,
  userId: string,
  roles: RolePermissions[],
  overwrites: ChannelOverwriteInput[],
): bigint {
  let base = computeGuildPermissions(owner, roles)
  if (owner || (base & Permissions.ADMINISTRATOR) !== 0n || base === ALL_DEFINED) {
    return ALL_DEFINED
  }

  const roleIds = new Set(roles.map((role) => role.id))
  const everyoneId = roles.find((role) => role.everyone)?.id

  // 1. @everyone 覆盖
  for (const overwrite of overwrites) {
    if (!overwrite.member && overwrite.targetId === everyoneId) {
      base = applyOverwrite(base, overwrite)
    }
  }

  // 2. 角色覆盖：先并集，再统一先清 deny 后加 allow
  let roleAllow = 0n
  let roleDeny = 0n
  for (const overwrite of overwrites) {
    if (overwrite.member || overwrite.targetId === everyoneId) continue
    if (roleIds.has(overwrite.targetId)) {
      roleDeny |= overwrite.deny
      roleAllow |= overwrite.allow
    }
  }
  base &= ~roleDeny
  base |= roleAllow

  // 3. 成员覆盖
  for (const overwrite of overwrites) {
    if (overwrite.member && overwrite.targetId === userId) {
      base = applyOverwrite(base, overwrite)
    }
  }
  return base & ALL_DEFINED
}

/** current 是否包含 required 的全部位 */
export function hasPermission(current: bigint, required: bigint): boolean {
  return (current & required) === required
}

function applyOverwrite(base: bigint, overwrite: ChannelOverwriteInput): bigint {
  base &= ~overwrite.deny
  base |= overwrite.allow & ~overwrite.deny
  return base
}
