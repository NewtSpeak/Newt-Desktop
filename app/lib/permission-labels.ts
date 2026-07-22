// 权限位中文标签与分组（docs 04 §3.5 / 18 角色编辑器）。
// 仅用于 UI 展示；安全边界仍以服务端 403/404 为准。

import { Permissions, type PermissionName } from "~/lib/permissions"

export type PermissionGroupId =
  | "general"
  | "membership"
  | "text"
  | "voice"
  | "stage"
  | "advanced"

export type PermissionMeta = {
  bit: bigint
  name: PermissionName
  label: string
  description: string
  group: PermissionGroupId
  /** 危险位：UI 红色警示 */
  danger?: boolean
}

export const PERMISSION_GROUPS: {
  id: PermissionGroupId
  label: string
}[] = [
  { id: "general", label: "常规服务器权限" },
  { id: "membership", label: "成员管理" },
  { id: "text", label: "文本频道" },
  { id: "voice", label: "语音频道" },
  { id: "stage", label: "舞台与共享" },
  { id: "advanced", label: "高级权限" },
]

/**
 * 编辑器展示的权限位（按 docs 04 分组；高位扩展功能不在此列表，由服务端保留）。
 * 频道覆盖编辑器会再按 TEXT/VOICE 过滤子集。
 */
export const PERMISSION_METAS: PermissionMeta[] = [
  // 常规
  {
    bit: Permissions.VIEW_CHANNEL,
    name: "VIEW_CHANNEL",
    label: "查看频道",
    description: "允许成员查看频道（默认频道可见性基线）。",
    group: "general",
  },
  {
    bit: Permissions.MANAGE_CHANNELS,
    name: "MANAGE_CHANNELS",
    label: "管理频道",
    description: "创建、编辑、删除、排序频道与分类。",
    group: "general",
  },
  {
    bit: Permissions.MANAGE_ROLES,
    name: "MANAGE_ROLES",
    label: "管理角色",
    description: "创建与编辑低于自身层级的角色，并分配权限。",
    group: "general",
  },
  {
    bit: Permissions.MANAGE_GUILD,
    name: "MANAGE_GUILD",
    label: "管理服务器",
    description: "修改服务器名称、图标等概览设置，以及邀请管理等。",
    group: "general",
  },
  {
    bit: Permissions.CREATE_INSTANT_INVITE,
    name: "CREATE_INSTANT_INVITE",
    label: "创建邀请",
    description: "生成邀请链接，邀请他人加入服务器。",
    group: "general",
  },
  {
    bit: Permissions.CHANGE_NICKNAME,
    name: "CHANGE_NICKNAME",
    label: "修改昵称",
    description: "允许成员修改自己的服内昵称。",
    group: "general",
  },
  {
    bit: Permissions.MANAGE_NICKNAMES,
    name: "MANAGE_NICKNAMES",
    label: "管理昵称",
    description: "修改其他成员的服内昵称。",
    group: "general",
  },
  {
    bit: Permissions.VIEW_AUDIT_LOG,
    name: "VIEW_AUDIT_LOG",
    label: "查看审计日志",
    description: "查看服务器管理操作记录。",
    group: "general",
  },
  {
    bit: Permissions.MANAGE_EXPRESSIONS,
    name: "MANAGE_EXPRESSIONS",
    label: "管理表情",
    description: "管理服务器自定义表情等表达内容。",
    group: "general",
  },
  {
    bit: Permissions.MANAGE_WEBHOOKS,
    name: "MANAGE_WEBHOOKS",
    label: "管理 Webhook",
    description: "创建与管理 Webhook。",
    group: "general",
  },

  // 成员
  {
    bit: Permissions.KICK_MEMBERS,
    name: "KICK_MEMBERS",
    label: "踢出成员",
    description: "将成员移出服务器（受角色层级限制）。",
    group: "membership",
  },
  {
    bit: Permissions.BAN_MEMBERS,
    name: "BAN_MEMBERS",
    label: "封禁成员",
    description: "封禁用户并阻止其再加入。",
    group: "membership",
  },
  {
    bit: Permissions.MODERATE_MEMBERS,
    name: "MODERATE_MEMBERS",
    label: "禁言成员",
    description: "对成员施加临时限制（超时/禁言等）。",
    group: "membership",
  },

  // 文本
  {
    bit: Permissions.SEND_MESSAGES,
    name: "SEND_MESSAGES",
    label: "发送消息",
    description: "在文本频道中发送消息。",
    group: "text",
  },
  {
    bit: Permissions.MANAGE_MESSAGES,
    name: "MANAGE_MESSAGES",
    label: "管理消息",
    description: "删除他人消息、置顶等。",
    group: "text",
  },
  {
    bit: Permissions.EMBED_LINKS,
    name: "EMBED_LINKS",
    label: "嵌入链接",
    description: "消息中的链接可展开预览。",
    group: "text",
  },
  {
    bit: Permissions.ATTACH_FILES,
    name: "ATTACH_FILES",
    label: "上传文件",
    description: "在消息中上传附件。",
    group: "text",
  },
  {
    bit: Permissions.READ_MESSAGE_HISTORY,
    name: "READ_MESSAGE_HISTORY",
    label: "查看消息历史",
    description: "阅读频道中进入前的历史消息。",
    group: "text",
  },
  {
    bit: Permissions.MENTION_EVERYONE,
    name: "MENTION_EVERYONE",
    label: "提及 @everyone",
    description: "使用 @everyone 与 @here，以及不可提及角色。",
    group: "text",
  },
  {
    bit: Permissions.ADD_REACTIONS,
    name: "ADD_REACTIONS",
    label: "添加回应",
    description: "对消息添加表情回应。",
    group: "text",
  },
  {
    bit: Permissions.USE_EXTERNAL_EMOJIS,
    name: "USE_EXTERNAL_EMOJIS",
    label: "使用外部表情",
    description: "使用其他服务器的表情。",
    group: "text",
  },
  {
    bit: Permissions.USE_APPLICATION_COMMANDS,
    name: "USE_APPLICATION_COMMANDS",
    label: "使用应用命令",
    description: "使用斜杠命令与应用交互。",
    group: "text",
  },

  // 语音
  {
    bit: Permissions.CONNECT,
    name: "CONNECT",
    label: "连接",
    description: "加入语音频道。",
    group: "voice",
  },
  {
    bit: Permissions.SPEAK,
    name: "SPEAK",
    label: "说话",
    description: "在语音频道中发言。",
    group: "voice",
  },
  {
    bit: Permissions.MUTE_MEMBERS,
    name: "MUTE_MEMBERS",
    label: "服务器静音",
    description: "服务器级静音其他成员。",
    group: "voice",
  },
  {
    bit: Permissions.DEAFEN_MEMBERS,
    name: "DEAFEN_MEMBERS",
    label: "服务器闭听",
    description: "服务器级闭听其他成员。",
    group: "voice",
  },
  {
    bit: Permissions.MOVE_MEMBERS,
    name: "MOVE_MEMBERS",
    label: "移动成员",
    description: "将成员移动到其他语音频道。",
    group: "voice",
  },
  {
    bit: Permissions.USE_VAD,
    name: "USE_VAD",
    label: "使用语音活动",
    description: "使用语音活动检测（关闭则强制按键说话）。",
    group: "voice",
  },
  {
    bit: Permissions.PRIORITY_SPEAKER,
    name: "PRIORITY_SPEAKER",
    label: "优先发言",
    description: "使用优先发言时降低他人音量。",
    group: "voice",
  },
  {
    bit: Permissions.STREAM,
    name: "STREAM",
    label: "视频 / 屏幕共享",
    description: "在语音频道中开启视频或屏幕共享。",
    group: "voice",
  },

  // 舞台与共享
  {
    bit: Permissions.REQUEST_TO_SPEAK,
    name: "REQUEST_TO_SPEAK",
    label: "请求发言",
    description: "在舞台频道申请上麦。",
    group: "stage",
  },
  {
    bit: Permissions.STAGE_BRING_UP,
    name: "STAGE_BRING_UP",
    label: "抱上麦",
    description: "将观众抱为发言者。",
    group: "stage",
  },
  {
    bit: Permissions.STAGE_BRING_DOWN,
    name: "STAGE_BRING_DOWN",
    label: "抱下麦",
    description: "将发言者移回观众席。",
    group: "stage",
  },
  {
    bit: Permissions.STAGE_MANAGE_QUEUE,
    name: "STAGE_MANAGE_QUEUE",
    label: "管理麦序",
    description: "管理舞台申请队列。",
    group: "stage",
  },
  {
    bit: Permissions.STAGE_CHANGE_MODE,
    name: "STAGE_CHANGE_MODE",
    label: "切换舞台模式",
    description: "切换自由上麦 / 申请上麦等模式。",
    group: "stage",
  },
  {
    bit: Permissions.STREAM_END_OTHERS,
    name: "STREAM_END_OTHERS",
    label: "结束他人共享",
    description: "结束其他成员的屏幕共享。",
    group: "stage",
  },
  {
    bit: Permissions.STREAM_QUALITY,
    name: "STREAM_QUALITY",
    label: "高画质共享",
    description: "使用更高的屏幕共享画质档位。",
    group: "stage",
  },

  // 高级
  {
    bit: Permissions.ADMINISTRATOR,
    name: "ADMINISTRATOR",
    label: "管理员",
    description:
      "拥有全部权限，并忽略频道权限拒绝。请谨慎授予——持有者等同于服务器管理者。",
    group: "advanced",
    danger: true,
  },
]

/** 掩码是否包含某位 */
export function maskHas(mask: bigint, bit: bigint): boolean {
  return (mask & bit) === bit
}

/** 切换某位 */
export function maskToggle(mask: bigint, bit: bigint, on: boolean): bigint {
  return on ? mask | bit : mask & ~bit
}

/**
 * BigInt 掩码 → JSON number（仅低 52 位，与服务端 feature-bits 保留策略一致）。
 * 高位扩展功能由服务端在 update 时合并保留。
 */
export function permissionsToJsonNumber(mask: bigint): number {
  const low = mask & ((1n << 52n) - 1n)
  return Number(low)
}
