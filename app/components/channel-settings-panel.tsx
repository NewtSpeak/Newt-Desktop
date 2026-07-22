// 频道设置中型面板（docs 03 / 04 FR-09–15）
// 概览（改名/主题/慢速/人数/上锁/语音注释）+ 权限覆盖三态编辑器 + 删除。
// 入口：频道右键「管理频道」。

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  CheckIcon,
  FolderSyncIcon,
  HashIcon,
  LockIcon,
  MinusIcon,
  PlusIcon,
  Trash2Icon,
  Volume2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import { Checkbox } from "~/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Input } from "~/components/ui/input"
import { Switch } from "~/components/ui/switch"
import {
  deleteChannel,
  deleteChannelOverwrite,
  listChannelOverwrites,
  updateChannel,
  upsertChannelOverwrite,
} from "~/lib/api/guilds"
import { ApiError } from "~/lib/api/http"
import type { Channel, ChannelOverwrite, GuildMember } from "~/lib/api/types"
import {
  PERMISSION_GROUPS,
  PERMISSION_METAS,
  permissionsToJsonNumber,
  type PermissionMeta,
} from "~/lib/permission-labels"
import {
  ALL_DEFINED,
  Permissions,
  hasPermission,
  toPermissionMask,
} from "~/lib/permissions"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import { useMembersStore } from "~/stores/members"
import {
  memberGuildPermissions,
  useRolesStore,
} from "~/stores/roles"
import { useUIStore } from "~/stores/ui"

type TabId = "overview" | "permissions"
type TriState = "allow" | "inherit" | "deny"

// Zustand selector 必须返回稳定引用：字面量 [] 每次新建 → useSyncExternalStore 无限重渲染
const EMPTY_MEMBERS: GuildMember[] = []

function maskFrom(value: number | string | undefined): bigint {
  if (value === undefined || value === null) return 0n
  try {
    return toPermissionMask(value)
  } catch {
    return 0n
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const expected = new Set(right)
  return left.every((value) => expected.has(value))
}

/** 覆盖签名：用于比较频道与分类是否同步（docs 04 FR-14） */
function overwriteSignature(list: ChannelOverwrite[]): string {
  return list
    .map((o) => {
      const a = String(o.allow_str ?? o.allow ?? 0)
      const d = String(o.deny_str ?? o.deny ?? 0)
      return `${o.type}:${o.target_id}:${a}:${d}`
    })
    .sort()
    .join("|")
}

/** 将分类覆盖完整复制到子频道（先清空子频道覆盖） */
async function syncOverwritesFromParent(
  guildId: string,
  channelId: string,
  parentId: string,
) {
  const [parentList, childList] = await Promise.all([
    listChannelOverwrites(guildId, parentId),
    listChannelOverwrites(guildId, channelId),
  ])
  for (const o of childList) {
    await deleteChannelOverwrite(channelId, o.target_id, o.type)
  }
  for (const o of parentList) {
    await upsertChannelOverwrite(channelId, o.target_id, {
      type: o.type,
      allow: permissionsToJsonNumber(maskFrom(o.allow_str ?? o.allow)),
      deny: permissionsToJsonNumber(maskFrom(o.deny_str ?? o.deny)),
    })
  }
}

function triOf(allow: bigint, deny: bigint, bit: bigint): TriState {
  if ((allow & bit) === bit) return "allow"
  if ((deny & bit) === bit) return "deny"
  return "inherit"
}

function applyTri(
  allow: bigint,
  deny: bigint,
  bit: bigint,
  next: TriState,
): { allow: bigint; deny: bigint } {
  let a = allow & ~bit
  let d = deny & ~bit
  if (next === "allow") a |= bit
  if (next === "deny") d |= bit
  return { allow: a, deny: d }
}

/** 频道覆盖编辑器展示的权限位（按频道类型过滤） */
function overwriteMetas(channelType: Channel["type"]): PermissionMeta[] {
  const textBits = new Set([
    "VIEW_CHANNEL",
    "MANAGE_CHANNELS",
    "MANAGE_ROLES",
    "CREATE_INSTANT_INVITE",
    "SEND_MESSAGES",
    "MANAGE_MESSAGES",
    "EMBED_LINKS",
    "ATTACH_FILES",
    "READ_MESSAGE_HISTORY",
    "MENTION_EVERYONE",
    "ADD_REACTIONS",
    "USE_EXTERNAL_EMOJIS",
    "USE_APPLICATION_COMMANDS",
  ])
  const voiceBits = new Set([
    "VIEW_CHANNEL",
    "MANAGE_CHANNELS",
    "MANAGE_ROLES",
    "CREATE_INSTANT_INVITE",
    "CONNECT",
    "SPEAK",
    "MUTE_MEMBERS",
    "DEAFEN_MEMBERS",
    "MOVE_MEMBERS",
    "USE_VAD",
    "PRIORITY_SPEAKER",
    "STREAM",
    "REQUEST_TO_SPEAK",
    "STAGE_BRING_UP",
    "STAGE_BRING_DOWN",
    "STAGE_MANAGE_QUEUE",
    "STAGE_CHANGE_MODE",
    "STREAM_END_OTHERS",
    "STREAM_QUALITY",
  ])
  const allow =
    channelType === "VOICE"
      ? voiceBits
      : channelType === "TEXT"
        ? textBits
        : new Set([...textBits, ...voiceBits])
  return PERMISSION_METAS.filter((m) => allow.has(m.name))
}

function TriSwitch({
  value,
  disabled,
  onChange,
}: {
  value: TriState
  disabled?: boolean
  onChange: (next: TriState) => void
}) {
  const cycle = () => {
    if (disabled) return
    const order: TriState[] = ["inherit", "allow", "deny"]
    const i = order.indexOf(value)
    onChange(order[(i + 1) % order.length]!)
  }
  return (
    <button
      type="button"
      disabled={disabled}
      title={
        value === "allow"
          ? "允许"
          : value === "deny"
            ? "拒绝"
            : "继承"
      }
      onClick={cycle}
      className={cn(
        "flex size-8 items-center justify-center rounded-md border text-xs font-medium transition-colors",
        value === "allow" &&
          "border-emerald-600/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
        value === "deny" &&
          "border-destructive/50 bg-destructive/15 text-destructive",
        value === "inherit" && "border-border bg-muted/40 text-muted-foreground",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {value === "allow" ? (
        <CheckIcon className="size-3.5" />
      ) : value === "deny" ? (
        <XIcon className="size-3.5" />
      ) : (
        <MinusIcon className="size-3.5" />
      )}
    </button>
  )
}

export function ChannelSettingsPanel() {
  const channelId = useUIStore((s) => s.channelSettingsChannelId)
  const close = useUIStore((s) => s.closeChannelSettings)

  const channel = useChannelsStore((s) => {
    if (!channelId) return undefined
    for (const list of Object.values(s.byGuild)) {
      const hit = list.find((c) => c.id === channelId)
      if (hit) return hit
    }
    return undefined
  })

  const guildId = channel?.guild_id
  const selfId = useAuthStore((s) => s.user?.id)
  const selfMember = useMembersStore((s) =>
    guildId ? s.byGuild[guildId]?.find((m) => m.user_id === selfId) : undefined,
  )
  const roles = useRolesStore((s) => (guildId ? s.byGuild[guildId] : undefined))
  const members = useMembersStore((s) =>
    guildId ? (s.byGuild[guildId] ?? EMPTY_MEMBERS) : EMPTY_MEMBERS,
  )
  const perms = useMemo(
    () => memberGuildPermissions(selfMember, roles),
    [selfMember, roles],
  )
  const isOwner = selfMember?.is_owner === true
  const canManageChannel =
    isOwner || hasPermission(perms, Permissions.MANAGE_CHANNELS)
  const canManageRoles =
    isOwner || hasPermission(perms, Permissions.MANAGE_ROLES)

  const [tab, setTab] = useState<TabId>("overview")
  const [name, setName] = useState("")
  const [topic, setTopic] = useState("")
  const [rateLimit, setRateLimit] = useState(0)
  const [rateLimitExemptRoleIds, setRateLimitExemptRoleIds] = useState<string[]>([])
  const [userLimit, setUserLimit] = useState(0)
  const [voiceNote, setVoiceNote] = useState("")
  const [locked, setLocked] = useState(false)
  const [password, setPassword] = useState("")
  const [passwordConfirm, setPasswordConfirm] = useState("")
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // 覆盖编辑
  const [overwrites, setOverwrites] = useState<ChannelOverwrite[] | null>(null)
  const [parentOverwrites, setParentOverwrites] = useState<
    ChannelOverwrite[] | null
  >(null)
  const [owError, setOwError] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [draftAllow, setDraftAllow] = useState(0n)
  const [draftDeny, setDraftDeny] = useState(0n)
  const [owDirty, setOwDirty] = useState(false)
  const [owSaving, setOwSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const parentCategory = useChannelsStore((s) => {
    if (!channel?.parent_id || !guildId) return undefined
    return s.byGuild[guildId]?.find(
      (c) => c.id === channel.parent_id && c.type === "CATEGORY",
    )
  })

  useEffect(() => {
    if (!channel) return
    setName(channel.name)
    setTopic(channel.topic ?? "")
    setRateLimit(channel.rate_limit_per_user ?? 0)
    setRateLimitExemptRoleIds(channel.rate_limit_exempt_role_ids ?? [])
    setUserLimit(channel.user_limit ?? 0)
    setVoiceNote(channel.voice_note ?? "")
    setLocked(Boolean(channel.locked))
    setPassword("")
    setPasswordConfirm("")
    setDirty(false)
    setTab("overview")
    setSelectedKey(null)
    setOwDirty(false)
  }, [channel?.id])

  // 频道被删除时关闭
  useEffect(() => {
    if (channelId && !channel) close()
  }, [channelId, channel, close])

  const loadOverwrites = useCallback(() => {
    if (!guildId || !channelId || !canManageRoles) return
    setOwError(false)
    const parentId = channel?.parent_id
    Promise.all([
      listChannelOverwrites(guildId, channelId),
      parentId
        ? listChannelOverwrites(guildId, parentId).catch(() => [] as ChannelOverwrite[])
        : Promise.resolve([] as ChannelOverwrite[]),
    ])
      .then(([list, parentList]) => {
        setOverwrites(list)
        setParentOverwrites(parentId ? parentList : null)
        // 默认选中 @everyone 或首项
        const everyone = (roles ?? []).find((r) => r.is_everyone)
        const key =
          everyone &&
          list.find((o) => o.type === "ROLE" && o.target_id === everyone.id)
            ? `ROLE:${everyone.id}`
            : list[0]
              ? `${list[0].type}:${list[0].target_id}`
              : everyone
                ? `ROLE:${everyone.id}`
                : null
        setSelectedKey(key)
      })
      .catch(() => {
        setOwError(true)
        setOverwrites(null)
        setParentOverwrites(null)
      })
  }, [guildId, channelId, canManageRoles, roles, channel?.parent_id])

  useEffect(() => {
    if (tab === "permissions") loadOverwrites()
  }, [tab, loadOverwrites])

  // 选中目标 → 灌入草稿
  useEffect(() => {
    if (!selectedKey || owDirty) return
    const [type, id] = selectedKey.split(":") as ["ROLE" | "MEMBER", string]
    const hit = overwrites?.find(
      (o) => o.type === type && o.target_id === id,
    )
    setDraftAllow(maskFrom(hit?.allow_str ?? hit?.allow))
    setDraftDeny(maskFrom(hit?.deny_str ?? hit?.deny))
  }, [selectedKey, overwrites, owDirty])

  // hooks 必须在任何 early return 之前调用，否则 channel 从空→有时会触发
  // “Rendered more hooks than during the previous render”
  const syncedWithParent = useMemo(() => {
    if (!channel?.parent_id || parentOverwrites === null || overwrites === null) {
      return null
    }
    return (
      overwriteSignature(overwrites) === overwriteSignature(parentOverwrites)
    )
  }, [channel?.parent_id, overwrites, parentOverwrites])

  // ---- 覆盖目标列表 ----
  const targetList = useMemo(() => {
    const roleList = (roles ?? [])
      .slice()
      .sort((a, b) => b.position - a.position)
    const rows: {
      key: string
      type: "ROLE" | "MEMBER"
      id: string
      label: string
      hasRecord: boolean
    }[] = []
    for (const role of roleList) {
      const has = !!overwrites?.some(
        (o) => o.type === "ROLE" && o.target_id === role.id,
      )
      rows.push({
        key: `ROLE:${role.id}`,
        type: "ROLE",
        id: role.id,
        label: role.is_everyone ? "@everyone" : role.name,
        hasRecord: has,
      })
    }
    // 仅展示已有成员覆盖
    for (const o of overwrites ?? []) {
      if (o.type !== "MEMBER") continue
      rows.push({
        key: `MEMBER:${o.target_id}`,
        type: "MEMBER",
        id: o.target_id,
        label: o.target_name || o.target_id.slice(0, 8),
        hasRecord: true,
      })
    }
    return rows
  }, [roles, overwrites])

  if (!channelId || !channel || !guildId) return null

  const Icon =
    channel.type === "VOICE"
      ? Volume2Icon
      : channel.type === "CATEGORY"
        ? FolderSyncIcon
        : HashIcon

  const onSyncWithParent = async () => {
    if (!guildId || !channel.parent_id) return
    const ok = window.confirm(
      "将用分类上的权限覆盖完整替换本频道的覆盖（现有覆盖会被删除）。继续吗？",
    )
    if (!ok) return
    setSyncing(true)
    try {
      await syncOverwritesFromParent(guildId, channel.id, channel.parent_id)
      toast.success("已与分类同步")
      setOwDirty(false)
      loadOverwrites()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "同步失败")
    } finally {
      setSyncing(false)
    }
  }

  const markOverviewDirty = (
    nextName: string,
    nextTopic: string,
    nextRate: number,
    nextUser: number,
    nextVoiceNote: string,
    nextLocked: boolean,
    nextPassword: string,
  ) => {
    const baseDirty =
      nextName !== channel.name ||
      nextTopic !== (channel.topic ?? "") ||
      nextRate !== (channel.rate_limit_per_user ?? 0) ||
      !sameStringSet(rateLimitExemptRoleIds, channel.rate_limit_exempt_role_ids ?? []) ||
      nextUser !== (channel.user_limit ?? 0) ||
      nextVoiceNote !== (channel.voice_note ?? "") ||
      nextLocked !== Boolean(channel.locked)
    const passwordDirty = nextLocked && nextPassword.length > 0
    setDirty(baseDirty || passwordDirty)
  }

  const saveOverview = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error("名称不能为空")
      return
    }
    if (locked && !channel.locked && !password) {
      toast.error("上锁时请设置访问密码")
      return
    }
    if (password && password !== passwordConfirm) {
      toast.error("两次输入的密码不一致")
      return
    }
    if (password && (password.length < 1 || password.length > 64)) {
      toast.error("密码长度需为 1–64 个字符")
      return
    }
    setSaving(true)
    try {
      const body: Parameters<typeof updateChannel>[1] = {
        name: trimmed,
        topic: topic.trim(),
        ...(channel.type === "TEXT"
          ? {
              rate_limit_per_user: rateLimit,
              rate_limit_exempt_role_ids: rateLimitExemptRoleIds,
            }
          : {}),
        ...(channel.type === "VOICE"
          ? { user_limit: userLimit, voice_note: voiceNote.trim() }
          : {}),
      }
      if (channel.type === "TEXT" || channel.type === "VOICE") {
        if (!locked && channel.locked) {
          body.locked = false
        } else if (password) {
          body.password = password
        } else if (locked && !channel.locked) {
          // 理论上已被上面拦截
          body.password = password
        }
      }
      const updated = await updateChannel(channel.id, body)
      useChannelsStore.getState().upsertChannel({ ...channel, ...updated })
      setPassword("")
      setPasswordConfirm("")
      setLocked(Boolean(updated.locked))
      setVoiceNote(updated.voice_note ?? "")
      setDirty(false)
      toast.success("频道已保存")
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    const ok = window.confirm(
      `确定删除${channel.type === "CATEGORY" ? "类别" : "频道"}「${channel.name}」？此操作不可恢复。`,
    )
    if (!ok) return
    try {
      await deleteChannel(channel.id)
      useChannelsStore.getState().removeChannel(guildId, channel.id)
      toast.success("已删除")
      close()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "删除失败")
    }
  }

  const selectedTarget = targetList.find((t) => t.key === selectedKey)

  const saveOverwrite = async () => {
    if (!selectedTarget) return
    setOwSaving(true)
    try {
      if (draftAllow === 0n && draftDeny === 0n) {
        // 全继承 = 删除覆盖（若存在）
        if (selectedTarget.hasRecord) {
          await deleteChannelOverwrite(
            channel.id,
            selectedTarget.id,
            selectedTarget.type,
          )
        }
      } else {
        await upsertChannelOverwrite(channel.id, selectedTarget.id, {
          type: selectedTarget.type,
          allow: permissionsToJsonNumber(draftAllow),
          deny: permissionsToJsonNumber(draftDeny),
        })
      }
      setOwDirty(false)
      toast.success("权限覆盖已保存")
      loadOverwrites()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "保存失败")
    } finally {
      setOwSaving(false)
    }
  }

  const setTri = (bit: bigint, next: TriState) => {
    const r = applyTri(draftAllow, draftDeny, bit, next)
    setDraftAllow(r.allow)
    setDraftDeny(r.deny)
    setOwDirty(true)
  }

  const privateChannel =
    (() => {
      const everyone = (roles ?? []).find((r) => r.is_everyone)
      if (!everyone) return false
      const bit = Permissions.VIEW_CHANNEL
      // 当前编辑 @everyone 时用草稿，否则看 overwrites
      if (selectedKey === `ROLE:${everyone.id}`) {
        return (draftDeny & bit) === bit
      }
      const hit = overwrites?.find(
        (o) => o.type === "ROLE" && o.target_id === everyone.id,
      )
      return (maskFrom(hit?.deny_str ?? hit?.deny) & bit) === bit
    })()

  const togglePrivate = async (on: boolean) => {
    const everyone = (roles ?? []).find((r) => r.is_everyone)
    if (!everyone) return
    const bit = Permissions.VIEW_CHANNEL
    try {
      const hit = overwrites?.find(
        (o) => o.type === "ROLE" && o.target_id === everyone.id,
      )
      let allow = maskFrom(hit?.allow_str ?? hit?.allow)
      let deny = maskFrom(hit?.deny_str ?? hit?.deny)
      const r = applyTri(allow, deny, bit, on ? "deny" : "inherit")
      allow = r.allow
      deny = r.deny
      if (allow === 0n && deny === 0n) {
        if (hit) {
          await deleteChannelOverwrite(channel.id, everyone.id, "ROLE")
        }
      } else {
        await upsertChannelOverwrite(channel.id, everyone.id, {
          type: "ROLE",
          allow: permissionsToJsonNumber(allow),
          deny: permissionsToJsonNumber(deny),
        })
      }
      toast.success(on ? "已设为私密频道" : "已取消私密")
      setSelectedKey(`ROLE:${everyone.id}`)
      setOwDirty(false)
      loadOverwrites()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "操作失败")
    }
  }

  const addMemberOverwrite = (memberId: string) => {
    setSelectedKey(`MEMBER:${memberId}`)
    setDraftAllow(0n)
    setDraftDeny(0n)
    setOwDirty(false)
  }

  const membersWithoutOw = members.filter(
    (m) =>
      !overwrites?.some(
        (o) => o.type === "MEMBER" && o.target_id === m.id,
      ),
  )

  const metas = overwriteMetas(channel.type)
  const groups = PERMISSION_GROUPS.filter((g) =>
    metas.some((m) => m.group === g.id),
  )

  const grantCeiling =
    isOwner || hasPermission(perms, Permissions.ADMINISTRATOR)
      ? ALL_DEFINED
      : perms

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          if (dirty || owDirty) {
            const ok = window.confirm("有未保存的更改，确定关闭吗？")
            if (!ok) return
          }
          close()
        }
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground" />
            {channel.type === "CATEGORY" ? "管理分类" : "管理频道"}
          </DialogTitle>
          <DialogDescription className="truncate">
            {channel.name}
            {parentCategory
              ? ` · 分类：${parentCategory.name}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 px-5">
          {(
            [
              ["overview", "概览"],
              ["permissions", "权限"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (id === "permissions" && (dirty || owDirty) && tab === "overview" && dirty) {
                  const ok = window.confirm("概览有未保存更改，切换将保留草稿在本地")
                  if (!ok) return
                }
                setTab(id)
              }}
              className={cn(
                "px-3 py-2 text-sm",
                tab === id
                  ? "border-b-2 border-primary font-medium"
                  : "text-muted-foreground hover:text-foreground",
                id === "permissions" && !canManageRoles && "opacity-50",
              )}
              disabled={id === "permissions" && !canManageRoles}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {tab === "overview" && (
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  频道名称
                </span>
                <Input
                  value={name}
                  maxLength={100}
                  disabled={!canManageChannel}
                  onChange={(e) => {
                    setName(e.target.value)
                    markOverviewDirty(
                      e.target.value,
                      topic,
                      rateLimit,
                      userLimit,
                      voiceNote,
                      locked,
                      password,
                    )
                  }}
                />
              </label>
              {(channel.type === "TEXT" || channel.type === "VOICE") && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    频道主题
                  </span>
                  <textarea
                    value={topic}
                    maxLength={1024}
                    rows={3}
                    disabled={!canManageChannel}
                    className="rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onChange={(e) => {
                      setTopic(e.target.value)
                      markOverviewDirty(
                        name,
                        e.target.value,
                        rateLimit,
                        userLimit,
                        voiceNote,
                        locked,
                        password,
                      )
                    }}
                  />
                </label>
              )}
              {channel.type === "TEXT" && (
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      慢速模式（秒，0 = 关闭）
                    </span>
                    <Input
                      type="number"
                      min={0}
                      max={21600}
                      value={rateLimit}
                      disabled={!canManageChannel}
                      onChange={(e) => {
                        const v = Math.max(
                          0,
                          Math.min(21600, Number(e.target.value) || 0),
                        )
                        setRateLimit(v)
                        markOverviewDirty(
                          name,
                          topic,
                          v,
                          userLimit,
                          voiceNote,
                          locked,
                          password,
                        )
                      }}
                    />
                  </label>
                  <fieldset className="flex flex-col gap-2 rounded-lg border p-3">
                    <legend className="px-1 text-xs font-medium text-muted-foreground">
                      慢速模式豁免角色
                    </legend>
                    <p className="text-xs text-muted-foreground">
                      默认对所有成员生效；选中的角色不受慢速模式限制。
                    </p>
                    <div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
                      {(roles ?? []).map((role) => {
                        const checked = rateLimitExemptRoleIds.includes(role.id)
                        return (
                          <label
                            key={role.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                          >
                            <Checkbox
                              checked={checked}
                              disabled={!canManageChannel}
                              onCheckedChange={(next) => {
                                const ids = Boolean(next)
                                  ? [...rateLimitExemptRoleIds.filter((id) => id !== role.id), role.id]
                                  : rateLimitExemptRoleIds.filter((id) => id !== role.id)
                                setRateLimitExemptRoleIds(ids)
                                setDirty(
                                  !sameStringSet(ids, channel.rate_limit_exempt_role_ids ?? []) ||
                                    name !== channel.name ||
                                    topic !== (channel.topic ?? "") ||
                                    rateLimit !== (channel.rate_limit_per_user ?? 0) ||
                                    userLimit !== (channel.user_limit ?? 0) ||
                                    voiceNote !== (channel.voice_note ?? "") ||
                                    locked !== Boolean(channel.locked) ||
                                    (locked && password.length > 0),
                                )
                              }}
                            />
                            <span className="truncate">
                              {role.is_everyone ? "@everyone" : role.name}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </fieldset>
                </div>
              )}
              {channel.type === "VOICE" && (
                <>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      人数上限（0 = 不限，最大 99）
                    </span>
                    <Input
                      type="number"
                      min={0}
                      max={99}
                      value={userLimit}
                      disabled={!canManageChannel}
                      onChange={(e) => {
                        const v = Math.max(
                          0,
                          Math.min(99, Number(e.target.value) || 0),
                        )
                        setUserLimit(v)
                        markOverviewDirty(
                          name,
                          topic,
                          rateLimit,
                          v,
                          voiceNote,
                          locked,
                          password,
                        )
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      活动注释
                    </span>
                    <Input
                      value={voiceNote}
                      maxLength={200}
                      placeholder="例如：正在开黑打排位"
                      disabled={!canManageChannel}
                      onChange={(e) => {
                        setVoiceNote(e.target.value)
                        markOverviewDirty(
                          name,
                          topic,
                          rateLimit,
                          userLimit,
                          e.target.value,
                          locked,
                          password,
                        )
                      }}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      显示在频道列表中该语音频道在线成员列表的最上方，提示频道正在做什么
                    </span>
                  </label>
                </>
              )}

              {(channel.type === "TEXT" || channel.type === "VOICE") &&
                canManageChannel && (
                  <div className="flex flex-col gap-3 rounded-xl border px-4 py-3">
                    <label className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          <LockIcon className="size-3.5 text-muted-foreground" />
                          频道上锁
                        </p>
                        <p className="text-xs text-muted-foreground">
                          开启后，成员需输入密码才能访问本频道（文字与语音均生效）
                        </p>
                      </div>
                      <Switch
                        checked={locked}
                        onCheckedChange={(on) => {
                          setLocked(on)
                          if (!on) {
                            setPassword("")
                            setPasswordConfirm("")
                          }
                          markOverviewDirty(
                            name,
                            topic,
                            rateLimit,
                            userLimit,
                            voiceNote,
                            on,
                            on ? password : "",
                          )
                        }}
                      />
                    </label>
                    {locked && (
                      <div className="flex flex-col gap-2 pt-3">
                        <label className="flex flex-col gap-1.5">
                          <span className="text-xs font-medium text-muted-foreground">
                            {channel.locked
                              ? "新密码（留空则保持原密码）"
                              : "访问密码"}
                          </span>
                          <Input
                            type="password"
                            value={password}
                            maxLength={64}
                            placeholder={
                              channel.locked ? "输入新密码以更换" : "设置密码"
                            }
                            onChange={(e) => {
                              setPassword(e.target.value)
                              markOverviewDirty(
                                name,
                                topic,
                                rateLimit,
                                userLimit,
                                voiceNote,
                                locked,
                                e.target.value,
                              )
                            }}
                          />
                        </label>
                        {(password.length > 0 || !channel.locked) && (
                          <label className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-muted-foreground">
                              确认密码
                            </span>
                            <Input
                              type="password"
                              value={passwordConfirm}
                              maxLength={64}
                              placeholder="再次输入密码"
                              onChange={(e) =>
                                setPasswordConfirm(e.target.value)
                              }
                            />
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                )}

              {dirty && canManageChannel && (
                <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3">
                  <span className="text-sm">有未保存的更改</span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => {
                        setName(channel.name)
                        setTopic(channel.topic ?? "")
                        setRateLimit(channel.rate_limit_per_user ?? 0)
                        setRateLimitExemptRoleIds(channel.rate_limit_exempt_role_ids ?? [])
                        setUserLimit(channel.user_limit ?? 0)
                        setVoiceNote(channel.voice_note ?? "")
                        setLocked(Boolean(channel.locked))
                        setPassword("")
                        setPasswordConfirm("")
                        setDirty(false)
                      }}
                    >
                      重置
                    </Button>
                    <Button
                      size="sm"
                      disabled={saving}
                      onClick={() => void saveOverview()}
                    >
                      保存
                    </Button>
                  </div>
                </div>
              )}

              {canManageChannel && (
                <div className="mt-4 rounded-xl border border-destructive/40 p-4">
                  <p className="text-sm font-medium text-destructive">删除频道</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    删除后消息与权限覆盖一并清除，不可恢复。
                  </p>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="mt-3"
                    onClick={() => void onDelete()}
                  >
                    <Trash2Icon className="size-4" />
                    删除
                  </Button>
                </div>
              )}
            </div>
          )}

          {tab === "permissions" && canManageRoles && (
            <div className="flex min-h-[20rem] flex-col gap-3">
              {(channel.type === "TEXT" || channel.type === "VOICE") && (
                <div className="flex flex-col gap-2 rounded-lg border px-3 py-2.5">
                  <label className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm">仅特定角色可见</p>
                      <p className="text-xs text-muted-foreground">
                        开启后对 @everyone 拒绝「查看频道」；再在下方为目标角色允许「查看频道」
                      </p>
                    </div>
                    <Switch
                      checked={privateChannel}
                      onCheckedChange={(c) => void togglePrivate(c)}
                    />
                  </label>
                  {privateChannel && (
                    <p className="text-[11px] text-muted-foreground">
                      提示：在左侧选择角色，将「查看频道」设为允许（✓），即可让该角色看到本频道。
                    </p>
                  )}
                </div>
              )}

              {/* 与分类同步（docs 04 FR-14） */}
              {channel.parent_id && parentCategory && (
                <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm">
                      {syncedWithParent === true
                        ? "已与分类同步"
                        : syncedWithParent === false
                          ? "权限已与分类不同步"
                          : "分类权限"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      分类「{parentCategory.name}」
                      {syncedWithParent === false
                        ? " — 可一键复制分类上的覆盖"
                        : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={syncedWithParent ? "outline" : "default"}
                    disabled={syncing || owDirty}
                    title={
                      owDirty
                        ? "请先保存或放弃当前覆盖草稿"
                        : "用分类覆盖替换本频道覆盖"
                    }
                    onClick={() => void onSyncWithParent()}
                  >
                    <FolderSyncIcon className="size-3.5" />
                    {syncing ? "同步中…" : "与分类同步"}
                  </Button>
                </div>
              )}

              {owError && (
                <p className="text-sm text-destructive">
                  覆盖列表加载失败
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={loadOverwrites}
                  >
                    重试
                  </button>
                </p>
              )}

              <div className="flex min-h-0 flex-1 gap-3">
                {/* 目标列表 */}
                <div className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto rounded-lg border p-1.5">
                  <p className="px-1.5 py-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                    角色
                  </p>
                  {targetList
                    .filter((t) => t.type === "ROLE")
                    .map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => {
                          if (owDirty && t.key !== selectedKey) {
                            const ok = window.confirm(
                              "有未保存的覆盖更改，切换将放弃",
                            )
                            if (!ok) return
                            setOwDirty(false)
                          }
                          setSelectedKey(t.key)
                        }}
                        className={cn(
                          "rounded-md px-2 py-1.5 text-left text-sm",
                          selectedKey === t.key
                            ? "bg-accent"
                            : "hover:bg-accent/50",
                          !t.hasRecord && "text-muted-foreground",
                        )}
                      >
                        {t.label}
                        {t.hasRecord && (
                          <span className="ml-1 text-[10px] text-primary">●</span>
                        )}
                      </button>
                    ))}
                  {targetList.some((t) => t.type === "MEMBER") && (
                    <>
                      <p className="mt-2 px-1.5 py-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                        成员
                      </p>
                      {targetList
                        .filter((t) => t.type === "MEMBER")
                        .map((t) => (
                          <button
                            key={t.key}
                            type="button"
                            onClick={() => {
                              if (owDirty && t.key !== selectedKey) {
                                const ok = window.confirm(
                                  "有未保存的覆盖更改，切换将放弃",
                                )
                                if (!ok) return
                                setOwDirty(false)
                              }
                              setSelectedKey(t.key)
                            }}
                            className={cn(
                              "rounded-md px-2 py-1.5 text-left text-sm",
                              selectedKey === t.key
                                ? "bg-accent"
                                : "hover:bg-accent/50",
                            )}
                          >
                            {t.label}
                          </button>
                        ))}
                    </>
                  )}
                  {membersWithoutOw.length > 0 && (
                    <select
                      className="mt-2 h-8 rounded-md border bg-transparent px-1 text-xs"
                      defaultValue=""
                      onChange={(e) => {
                        const id = e.target.value
                        e.target.value = ""
                        if (id) addMemberOverwrite(id)
                      }}
                    >
                      <option value="" disabled>
                        + 添加成员…
                      </option>
                      {membersWithoutOw.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nickname?.trim() ||
                            m.display_name?.trim() ||
                            m.username}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 三态开关 */}
                <div className="min-w-0 flex-1 overflow-y-auto">
                  {!selectedTarget ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      选择角色或成员以编辑覆盖
                    </p>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <p className="text-sm font-medium">
                        {selectedTarget.label}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          点击切换：继承 → 允许 → 拒绝
                        </span>
                      </p>
                      {groups.map((group) => {
                        const items = metas.filter((m) => m.group === group.id)
                        if (!items.length) return null
                        return (
                          <div key={group.id} className="flex flex-col gap-1">
                            <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                              {group.label}
                            </p>
                            <div className="flex flex-col rounded-lg border">
                              {items.map((meta) => {
                                const state = triOf(
                                  draftAllow,
                                  draftDeny,
                                  meta.bit,
                                )
                                const canGrant =
                                  isOwner ||
                                  hasPermission(perms, Permissions.ADMINISTRATOR) ||
                                  (grantCeiling & meta.bit) === meta.bit
                                return (
                                  <div
                                    key={meta.name}
                                    className="flex items-center justify-between gap-2 px-3 py-2"
                                  >
                                    <div className="min-w-0">
                                      <p className="text-sm">{meta.label}</p>
                                      <p className="text-[11px] text-muted-foreground">
                                        {meta.description}
                                      </p>
                                    </div>
                                    <TriSwitch
                                      value={state}
                                      disabled={!canGrant && state === "inherit"}
                                      onChange={(next) => {
                                        if (
                                          next === "allow" &&
                                          !canGrant
                                        ) {
                                          toast.error(
                                            "你不能授予自己没有的权限",
                                          )
                                          return
                                        }
                                        setTri(meta.bit, next)
                                      }}
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                      {owDirty && (
                        <div className="sticky bottom-0 flex items-center justify-between rounded-xl border bg-card px-4 py-3 shadow-lg">
                          <span className="text-sm">有未保存的覆盖</span>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={owSaving}
                              onClick={() => {
                                setOwDirty(false)
                                // 触发重新灌入
                                const key = selectedKey
                                setSelectedKey(null)
                                requestAnimationFrame(() => setSelectedKey(key))
                              }}
                            >
                              重置
                            </Button>
                            <Button
                              size="sm"
                              disabled={owSaving}
                              onClick={() => void saveOverwrite()}
                            >
                              保存覆盖
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
