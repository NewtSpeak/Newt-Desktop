// 单条消息渲染：作者分组首条/后续两种形态、悬停操作条（反应/回复/编辑/撤回）、
// 右键菜单（复制/回复/编辑/撤回/反应/复制 ID）、反应 chip（圆角矩形；贴图贴齐上/下/左）、
// 内联编辑态、回复引用摘要、(已编辑) 标记、本人被提及高亮。

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  AtSignIcon,
  CopyIcon,
  CornerUpLeftIcon,
  CrownIcon,
  EyeIcon,
  HashIcon,
  HistoryIcon,
  LinkIcon,
  LockIcon,
  PencilIcon,
  ReplyIcon,
  SmilePlusIcon,
  Trash2Icon,
  Volume2Icon,
} from "lucide-react"

import { AdminMemberMenuSection } from "~/components/admin/admin-member-menu"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "~/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Button } from "~/components/ui/button"
import {
  isEphemeralMessage,
  isGroupDmSystemMessage,
  MESSAGE_TYPE_STICKER,
  MESSAGE_TYPE_SYSTEM_ADMIN,
  type Channel,
  type GuildMember,
  type Role,
} from "~/lib/api/types"
import { ApiError } from "~/lib/api/http"
import { copyText } from "~/lib/clipboard"
import {
  contentMentionsUser,
  type MentionResolver,
} from "~/lib/markdown"
import { memberRoleBadges, resolveMemberNameStyle } from "~/lib/name-style"
import { hasPermission, Permissions } from "~/lib/permissions"
import {
  customReactionKey,
  isCustomReactionKey,
  parseCustomReactionItemId,
} from "~/lib/stickers/format"
import { AvatarWithFrame } from "~/components/cosmetics/avatar-frame"
import { MemberStyledName } from "~/components/member-styled-name"
import { RoleBadgePills, StyledDisplayName } from "~/components/styled-name"
import {
  memberDisplayName,
  nameInitials,
  resolveProfileAssetUrl,
} from "~/lib/user-display"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import { useCosmeticsStore } from "~/stores/cosmetics"
import { useMembersStore } from "~/stores/members"
import { useMessagesStore, type ChatMessage } from "~/stores/messages"
import {
  memberGuildPermissions,
  useRolesStore,
} from "~/stores/roles"
import { useStickersStore } from "~/stores/stickers"
import { cn } from "~/lib/utils"
import { MessageAttachments } from "./attachments"
import {
  TipTapComposerEditor,
  type ComposerAtQuery,
  type TipTapComposerHandle,
} from "./composer-tiptap"
import { CustomEmoteImg, StickerMessageBody } from "./custom-emote"
import { EditHistoryDialog } from "./edit-history-dialog"
import { EmojiPickerPopover, type ExpressionPick } from "./emoji-picker"
import { streamIdleLevel } from "~/lib/message-stream"
import { MessageCard } from "./message-card"
import { MessageContent } from "./message-content"

/** AS.5：作者 / MANAGE_MESSAGES / 系统管理员可看完整编辑历史 */
function canViewMessageEditHistory(opts: {
  isOwn: boolean
  systemAdmin: boolean
  guildPerms: bigint
  editCount: number
}): boolean {
  if ((opts.editCount ?? 0) <= 0) return false
  if (opts.systemAdmin || opts.isOwn) return true
  return (
    hasPermission(opts.guildPerms, Permissions.MANAGE_MESSAGES) ||
    hasPermission(opts.guildPerms, Permissions.ADMINISTRATOR)
  )
}

// ---------------------------------------------------------------------------
// 时间格式
// ---------------------------------------------------------------------------

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function shortTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** 组首条的「今天 14:32」式时间 */
export function groupTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const time = shortTime(iso)
  if (sameDay(date, now)) return `今天 ${time}`
  if (sameDay(date, yesterday)) return `昨天 ${time}`
  return `${date.toLocaleDateString("zh-CN")} ${time}`
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN")
}

/** 限定可见范围角标：仅作者 + 指定身份组/用户（及管理消息权限）可见 */
function RestrictedVisibilityBadge({
  roleIds,
  userIds,
  roles,
  resolveName,
  className,
}: {
  roleIds?: string[]
  userIds?: string[]
  roles: Role[] | undefined
  resolveName?: (userId: string) => string
  className?: string
}) {
  const roleNames = (roleIds ?? []).map((id) => {
    const role = roles?.find((item) => item.id === id)
    return role?.name ?? "未知身份组"
  })
  const userNames = (userIds ?? []).map((id) =>
    resolveName?.(id)?.trim() || id.slice(0, 8),
  )
  const parts: string[] = []
  if (roleNames.length > 0) {
    parts.push(
      roleNames.length === 1
        ? `身份组「${roleNames[0]}」`
        : `${roleNames.length} 个身份组`,
    )
  }
  if (userNames.length > 0) {
    parts.push(
      userNames.length === 1
        ? `用户 ${userNames[0]}`
        : `${userNames.length} 位用户`,
    )
  }
  const titleBits: string[] = []
  if (roleNames.length > 0) titleBits.push(`身份组：${roleNames.join("、")}`)
  if (userNames.length > 0) titleBits.push(`用户：${userNames.join("、")}`)
  const title =
    titleBits.length > 0
      ? `仅自己与以下范围可见；${titleBits.join("；")}`
      : "限定可见"
  const label = parts.length > 0 ? parts.join(" + ") : "限定"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[10px] text-amber-700 select-none dark:text-amber-300",
        className,
      )}
      title={title}
    >
      <LockIcon className="size-3" aria-hidden />
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// 头像：有 avatar_url 时展示图片，否则按用户 ID 哈希色块 + 首字符
// ---------------------------------------------------------------------------

const AVATAR_COLORS = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-cyan-500",
  "bg-blue-500",
  "bg-violet-500",
  "bg-fuchsia-500",
]

function AuthorAvatar({
  userId,
  name,
  avatarUrl,
}: {
  userId: string
  name: string
  avatarUrl?: string
}) {
  let hash = 0
  for (let index = 0; index < userId.length; index++) {
    hash = (hash * 31 + userId.charCodeAt(index)) | 0
  }
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
  // 有头像 URL：色块垫底 + 图片覆盖，避免加载瞬间露出文字首字母头像
  if (avatarUrl) {
    return (
      // block：inline span 会忽略 size-9 并在基线下留缝，垫底色块随 inset-0 撑高露出
      <span
        className="relative block size-9 shrink-0 overflow-hidden rounded-full select-none"
        aria-hidden
      >
        {/* inset-px + 自带圆角：垫底色块永远到不了容器圆周边缘，
            任何 DPI 舍入/抗锯齿场景都不可能露出色边 */}
        <span className={cn("absolute inset-px rounded-full", color)} />
        {/* block：img 默认 inline 会在基线下留缝，让垫底色块从底部露出；
            不叠自己的 rounded-full——双重圆角裁切的抗锯齿边会让垫底色露出 1px 描边，
            方形铺满、只由容器裁圆 */}
        <img
          src={avatarUrl}
          alt=""
          className="relative block size-9 object-cover"
          draggable={false}
        />
      </span>
    )
  }
  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white select-none",
        color
      )}
      aria-hidden
    >
      {(name || "?").slice(0, 1).toUpperCase()}
    </div>
  )
}

/** 系统管理员临场发言：扁平纯色皇冠头像（无渐变） */
function SystemAdminAvatar({ size = "md" }: { size?: "sm" | "md" }) {
  const box = size === "sm" ? "size-4" : "size-9"
  const icon = size === "sm" ? "size-2.5" : "size-4"
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-amber-600 text-white select-none",
        box
      )}
      title="系统超级管理员"
      aria-label="系统超级管理员"
    >
      <CrownIcon className={cn("text-white", icon)} aria-hidden />
    </div>
  )
}

/** 系统管理员徽章：尺寸与角色徽章一致（h-3.5 / text-[9px]），纯色无渐变 */
function SystemAdminBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-3.5 shrink-0 items-center rounded-full bg-amber-600 px-1.5 text-[9px] font-medium text-white",
        className
      )}
      title="系统超级管理员"
    >
      系统超级管理员
    </span>
  )
}

function isSystemAdminMessage(type: string | undefined): boolean {
  return type === MESSAGE_TYPE_SYSTEM_ADMIN
}

/** 回复指示：lucide Reply，仅左右翻转（不上下翻转） */
function ReplyCornerIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex origin-center", className)}
      style={{ transform: "scaleX(-1)" }}
      aria-hidden
    >
      <ReplyIcon className="size-full" />
    </span>
  )
}

// ---------------------------------------------------------------------------
// 反应 chip（圆角矩形；贴图贴齐上/下/左，仅右侧为计数留边）
// ---------------------------------------------------------------------------

function ReactionGlyph({ emoji }: { emoji: string }) {
  if (isCustomReactionKey(emoji)) {
    const itemId = parseCustomReactionItemId(emoji)
    if (itemId) {
      return (
        <CustomEmoteImg
          itemId={itemId}
          reaction
          // 填满左侧方格；圆角与 chip 同档（左侧贴边时与 chip 同心）
          className="size-full rounded-md object-cover"
        />
      )
    }
  }
  return (
    <span className="flex size-full items-center justify-center text-[15px] leading-none">
      {emoji}
    </span>
  )
}

function ReactionPills({
  message,
  channelId,
  guildId,
  selfId,
}: {
  message: ChatMessage
  channelId: string
  guildId?: string
  selfId?: string
}) {
  const toggleReaction = useMessagesStore((state) => state.toggleReaction)
  const [pickerOpen, setPickerOpen] = useState(false)
  if (message.reactions.length === 0) return null

  const applyPick = (pick: ExpressionPick) => {
    const key =
      pick.type === "unicode"
        ? pick.emoji
        : customReactionKey(pick.item.id)
    void toggleReaction(channelId, message.id, key).catch(() => undefined)
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {message.reactions.map((entry) => {
        const mine = selfId !== undefined && entry.userIds.includes(selfId)
        const label = isCustomReactionKey(entry.emoji)
          ? `自定义表情反应，共 ${entry.userIds.length} 人`
          : `${entry.emoji} 反应，共 ${entry.userIds.length} 人`
        return (
          <button
            key={entry.emoji}
            type="button"
            aria-label={`${label}${mine ? "，包含你" : ""}`}
            onClick={() =>
              void toggleReaction(channelId, message.id, entry.emoji).catch(
                () => undefined,
              )
            }
            className={cn(
              // 圆角矩形；overflow-hidden 让贴图贴合左圆角
              "relative flex h-7 items-center overflow-hidden rounded-md",
              // 上/下/左无内边距；仅右侧给计数文字留边
              "pr-2",
              "transition-[background-color,transform] duration-150",
              "active:scale-[0.96] cursor-pointer",
              mine
                ? "bg-primary/15"
                : "bg-muted hover:bg-muted/80",
            )}
          >
            {/* 贴图区：高满 chip、正方形、贴齐上/下/左；圆角裁切 */}
            <span className="h-full w-7 shrink-0 overflow-hidden rounded-md">
              <ReactionGlyph emoji={entry.emoji} />
            </span>
            <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
              {entry.userIds.length}
            </span>
          </button>
        )
      })}
      <EmojiPickerPopover
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        guildId={guildId}
        mode="reaction"
        onPick={(emoji) =>
          void toggleReaction(channelId, message.id, emoji).catch(
            () => undefined,
          )
        }
        onExpressionPick={applyPick}
      >
        <button
          type="button"
          aria-label="添加反应"
          className="flex h-7 items-center rounded-md bg-muted px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground active:scale-[0.96] cursor-pointer"
        >
          +
        </button>
      </EmojiPickerPopover>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 内联编辑框（TipTap：支持 # 频道链接 / @ 提及，与底部 Composer 一致）
// ---------------------------------------------------------------------------

function filterEditMembers(
  members: GuildMember[],
  query: string,
): GuildMember[] {
  const lowered = query.toLowerCase()
  return members
    .filter((member) => {
      const name = memberDisplayName(member).toLowerCase()
      return (
        name.includes(lowered) ||
        member.username.toLowerCase().includes(lowered) ||
        (member.nickname ?? "").toLowerCase().includes(lowered) ||
        (member.display_name ?? "").toLowerCase().includes(lowered)
      )
    })
    .slice(0, 8)
}

function filterEditChannels(channels: Channel[], query: string): Channel[] {
  const lowered = query.toLowerCase()
  return channels
    .filter((ch) => ch.type === "TEXT" || ch.type === "VOICE")
    .filter((ch) => !lowered || ch.name.toLowerCase().includes(lowered))
    .slice(0, 8)
}

function InlineEditor({
  channelId,
  guildId,
  message,
  resolveName,
  onDone,
}: {
  channelId: string
  guildId?: string
  message: ChatMessage
  resolveName: MentionResolver
  onDone: () => void
}) {
  const edit = useMessagesStore((state) => state.edit)
  const gid = guildId ?? message.guild_id ?? ""
  const members = useMembersStore((s) => s.byGuild[gid]) ?? []
  const guildChannels = useChannelsStore((s) => s.byGuild[gid]) ?? []

  const [value, setValue] = useState(message.content)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mention, setMention] = useState<ComposerAtQuery | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const tipTapRef = useRef<TipTapComposerHandle | null>(null)

  const mentionCandidates = useMemo(
    () =>
      mention?.kind === "mention"
        ? filterEditMembers(members, mention.query)
        : [],
    [mention, members],
  )
  const channelCandidates = useMemo(
    () =>
      mention?.kind === "channel"
        ? filterEditChannels(guildChannels, mention.query)
        : [],
    [mention, guildChannels],
  )
  const activeCount =
    mention?.kind === "channel"
      ? channelCandidates.length
      : mentionCandidates.length
  const mentionOpen = Boolean(mention && activeCount > 0)

  const onMentionQuery = useCallback((query: ComposerAtQuery | null) => {
    setMention(query)
    if (query) setMentionIndex(0)
  }, [])

  const insertMention = useCallback(
    (member: GuildMember) => {
      if (!mention || mention.kind !== "mention") return
      const handle = tipTapRef.current
      if (!handle) return
      const queryLen = mention.query.length + 1
      const already = handle.getMarkdown().includes(`<@${member.user_id}>`)
      if (already) handle.deleteBeforeCaret(queryLen)
      else {
        handle.insertMention(
          member.user_id,
          memberDisplayName(member) || member.username,
          queryLen,
        )
      }
      setMention(null)
      requestAnimationFrame(() => handle.focus())
    },
    [mention],
  )

  const insertChannelMention = useCallback(
    (channel: Channel) => {
      if (!mention || mention.kind !== "channel") return
      if (channel.type !== "TEXT" && channel.type !== "VOICE") return
      const handle = tipTapRef.current
      if (!handle) return
      const queryLen = mention.query.length + 1
      const already = handle.getMarkdown().includes(`<#${channel.id}>`)
      if (already) handle.deleteBeforeCaret(queryLen)
      else {
        handle.insertChannelMention(
          channel.id,
          channel.name,
          channel.type,
          queryLen,
        )
      }
      setMention(null)
      requestAnimationFrame(() => handle.focus())
    },
    [mention],
  )

  const save = async () => {
    const content = (tipTapRef.current?.getMarkdown() ?? value).trim()
    if (content === "" && (message.attachments?.length ?? 0) === 0) return
    if (content === message.content) {
      onDone()
      return
    }
    setSaving(true)
    setError(null)
    try {
      await edit(channelId, message.id, content)
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "编辑失败，请重试")
      setSaving(false)
    }
  }

  const onKeyDownCapture = (event: React.KeyboardEvent) => {
    if (!mention || activeCount === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      event.stopPropagation()
      setMentionIndex((i) => (i + 1) % activeCount)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      event.stopPropagation()
      setMentionIndex((i) => (i - 1 + activeCount) % activeCount)
      return
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault()
      event.stopPropagation()
      if (mention.kind === "channel") {
        const ch = channelCandidates[mentionIndex]
        if (ch) insertChannelMention(ch)
      } else {
        const m = mentionCandidates[mentionIndex]
        if (m) insertMention(m)
      }
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      setMention(null)
    }
  }

  return (
    <div className="relative mt-0.5" onKeyDownCapture={onKeyDownCapture}>
      {mention?.kind === "mention" && mentionCandidates.length > 0 && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-72 rounded-lg border bg-popover p-1 shadow-lg">
          <p className="px-2 py-1 text-xs text-muted-foreground select-none">
            成员
          </p>
          {mentionCandidates.map((member, index) => {
            const name = memberDisplayName(member)
            const avatar = resolveProfileAssetUrl(member.avatar_url)
            return (
              <button
                key={member.user_id}
                type="button"
                onMouseEnter={() => setMentionIndex(index)}
                onClick={() => insertMention(member)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  index === mentionIndex && "bg-muted",
                )}
              >
                {avatar ? (
                  <img
                    src={avatar}
                    alt=""
                    className="size-6 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
                    {nameInitials(name)}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-medium">
                  {name}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {mention?.kind === "channel" && channelCandidates.length > 0 && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-72 rounded-lg border bg-popover p-1 shadow-lg">
          <p className="px-2 py-1 text-xs text-muted-foreground select-none">
            链接到频道
          </p>
          {channelCandidates.map((channel, index) => {
            const isVoice = channel.type === "VOICE"
            return (
              <button
                key={channel.id}
                type="button"
                onMouseEnter={() => setMentionIndex(index)}
                onClick={() => insertChannelMention(channel)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  index === mentionIndex && "bg-muted",
                )}
              >
                {isVoice ? (
                  <Volume2Icon className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <HashIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">
                  {channel.name}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {isVoice ? "语音" : "文字"}
                  {channel.locked ? " · 上锁" : ""}
                </span>
              </button>
            )
          })}
          <p className="px-2 pt-1 pb-0.5 text-[10px] text-muted-foreground/80 select-none">
            回车链接 · Esc 保持纯文本 #
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-muted/40">
        <TipTapComposerEditor
          channelId={channelId}
          channelName=""
          variant="inline-edit"
          hideToolbar
          initialMarkdown={message.content}
          disabled={saving}
          onChange={setValue}
          onSubmit={() => void save()}
          onEditLast={() => undefined}
          onEscapeReply={() => {
            if (mentionOpen) {
              setMention(null)
              return
            }
            onDone()
          }}
          onMentionQuery={onMentionQuery}
          mentionOpen={mentionOpen}
          editorRef={tipTapRef}
          resolveMentionLabel={resolveName}
          placeholder="编辑消息… 输入 # 可链接频道"
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saving}
          title="Esc"
          onClick={() => {
            setMention(null)
            onDone()
          }}
          className={cn(
            "inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium",
            "text-muted-foreground transition-colors",
            "hover:bg-muted hover:text-foreground",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          取消
          <kbd className="ml-1.5 rounded bg-muted px-1 py-px text-[10px] font-normal text-muted-foreground">
            Esc
          </kbd>
        </button>
        <button
          type="button"
          disabled={saving}
          title="Enter"
          onClick={() => void save()}
          className={cn(
            "inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium",
            "bg-primary text-primary-foreground transition-colors",
            "hover:bg-primary/90",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {saving ? "保存中…" : "保存"}
          {!saving && (
            <kbd className="ml-1.5 rounded bg-primary-foreground/15 px-1 py-px text-[10px] font-normal">
              Enter
            </kbd>
          )}
        </button>
        <span className="text-[11px] text-muted-foreground select-none">
          输入 <span className="font-medium text-foreground/70">#</span>{" "}
          可链接频道
        </span>
        {error && (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 消息流正文（信息流 / 撤回预览共用，保证渲染完全一致）
// ---------------------------------------------------------------------------

function MessageStreamBody({
  message,
  resolveName,
  resolveAvatarUrl,
  selfId,
  guildId,
  /** 撤回预览等场景可隐藏「(已编辑)」角标 */
  showEdited = true,
  /** 撤回预览 / 编辑历史等只读场景禁用卡片交互按钮 */
  interactiveCard = true,
}: {
  message: ChatMessage
  resolveName: MentionResolver
  resolveAvatarUrl?: (userId: string) => string | undefined
  selfId?: string
  guildId?: string
  showEdited?: boolean
  interactiveCard?: boolean
}) {
  const gId = guildId ?? message.guild_id
  const ephemeral = isEphemeralMessage(message)
  const streaming = message.stream_status === "STREAMING"
  const hasContent = Boolean(message.content?.trim())
  const hasCard = message.card != null && message.card !== ""
  const stickers = message.sticker_items ?? []
  const showStickers =
    message.type === MESSAGE_TYPE_STICKER || stickers.length > 0
  const hasAttachments = (message.attachments?.length ?? 0) > 0
  const reconcileStreamMessage = useMessagesStore(
    (state) => state.reconcileStreamMessage
  )
  const [refreshing, setRefreshing] = useState(false)
  // 流式空闲检测：每 5s 重算 slow/stale，避免每条 delta 都挂 interval
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!streaming) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [streaming, message.streamLastActivityAt])

  const idleLevel = useMemo(
    () => streamIdleLevel(message, now),
    [message, now]
  )

  const onRefreshStream = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await reconcileStreamMessage(message.channel_id, message.id)
    } catch {
      // 失败静默；用户可再点
    } finally {
      setRefreshing(false)
    }
  }, [
    refreshing,
    reconcileStreamMessage,
    message.channel_id,
    message.id,
  ])

  return (
    <div
      className="min-w-0"
      data-stream-status={streaming ? "STREAMING" : undefined}
      data-stream-idle={streaming ? idleLevel : undefined}
    >
      <div
        className="text-sm"
        // 流式生成中：礼貌播报正文增长，避免 assertive 打断用户
        aria-live={streaming ? "polite" : undefined}
        aria-busy={streaming && idleLevel === "active" ? true : undefined}
        aria-relevant={streaming ? "additions text" : undefined}
      >
        {hasContent ? (
          <span className="inline-block w-full align-top">
            <MessageContent
              content={message.content}
              resolveMention={resolveName}
              resolveMentionAvatar={resolveAvatarUrl}
              selfId={selfId}
              guildId={gId}
            />
            {streaming && idleLevel === "active" ? (
              <span
                className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-foreground/70 align-baseline"
                aria-hidden
                title="生成中"
              />
            ) : null}
          </span>
        ) : streaming && idleLevel === "active" ? (
          <span
            className="inline-flex items-center gap-1.5 text-muted-foreground"
            role="status"
          >
            <span
              className="inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-foreground/50"
              aria-hidden
            />
            生成中…
          </span>
        ) : null}
        {showStickers
          ? stickers.map((ref) => (
              <StickerMessageBody
                key={ref.item_id}
                itemId={ref.item_id}
                packId={ref.pack_id}
                mark={ref.mark}
                assetUrl={ref.asset_url}
                onOpenPack={(packId, itemId) =>
                  useStickersStore.getState().openPackPreview(packId, {
                    itemId,
                    guildId: gId,
                  })
                }
              />
            ))
          : null}
        {showEdited && !streaming && message.edit_count > 0 ? (
          <span
            className="ml-1 align-baseline text-[10px] text-muted-foreground select-none tabular-nums"
            title={`已编辑 ×${message.edit_count}${message.edited_at ? `，最后编辑 ${fullTime(message.edited_at)}` : ""}`}
          >
            (已编辑)
          </span>
        ) : null}
      </div>
      {streaming && idleLevel !== "active" ? (
        <div
          className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"
          role="status"
        >
          <span>
            {idleLevel === "stale"
              ? "生成可能已中断"
              : "生成较慢，仍在等待…"}
          </span>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
            disabled={refreshing}
            aria-label="从服务器刷新流式消息内容"
            onClick={() => void onRefreshStream()}
          >
            {refreshing ? "刷新中…" : "刷新内容"}
          </button>
        </div>
      ) : null}
      {hasCard ? (
        <MessageCard
          card={message.card}
          messageId={message.id}
          channelId={message.channel_id}
          interactive={interactiveCard}
        />
      ) : null}
      <MessageAttachments attachments={message.attachments} />
      {ephemeral ? (
        <p className="mt-1.5">
          <span
            className="inline-flex select-none items-center gap-1 rounded-full border border-primary/25 bg-primary/8 px-2 py-0.5 text-[11px] text-primary"
            title="这条消息只有你能看到，其他成员不可见，也不会产生未读提醒"
          >
            <EyeIcon className="size-3" aria-hidden />
            仅你可见
          </span>
        </p>
      ) : null}
      {!hasContent &&
      !streaming &&
      !hasCard &&
      !showStickers &&
      !hasAttachments ? (
        <span className="text-sm text-muted-foreground">（无内容）</span>
      ) : null}
    </div>
  )
}

/** 撤回确认：预览区与信息流正文同组件，无描边/边框 */
function DeleteMessageConfirmDialog({
  open,
  onOpenChange,
  message,
  isOwn,
  error,
  onConfirm,
  resolveName,
  resolveAvatarUrl,
  selfId,
  guildId,
  displayName,
  authorStyle,
  authorBadges,
  systemAdmin,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  message: ChatMessage
  isOwn: boolean
  error: string | null
  onConfirm: () => void
  resolveName: MentionResolver
  resolveAvatarUrl?: (userId: string) => string | undefined
  selfId?: string
  guildId?: string
  displayName: string
  authorStyle?: ReturnType<typeof resolveMemberNameStyle> | null
  authorBadges?: ReturnType<typeof memberRoleBadges>
  systemAdmin?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>撤回消息</DialogTitle>
          <DialogDescription>
            确定要撤回这条消息吗？撤回后所有人将无法再看到，此操作无法撤销。
            {!isOwn && (
              <span className="mt-1 block text-amber-600 dark:text-amber-400">
                你正在撤回他人消息，该操作将被记录。
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        {/* 与信息流一致：无 border / outline / ring，仅可滚动 */}
        <div className="max-h-56 min-w-0 overflow-y-auto outline-none ring-0">
          <p className="mb-0.5 flex min-w-0 items-center gap-1.5 leading-5">
            <StyledDisplayName
              name={displayName}
              style={systemAdmin ? null : authorStyle ?? null}
              className="truncate text-sm font-semibold"
            />
            {systemAdmin ? (
              <SystemAdminBadge />
            ) : authorBadges && authorBadges.length > 0 ? (
              <RoleBadgePills badges={authorBadges} />
            ) : null}
            <span
              className="shrink-0 text-xs text-muted-foreground"
              title={fullTime(message.created_at)}
            >
              {groupTime(message.created_at)}
            </span>
          </p>
          <MessageStreamBody
            message={message}
            resolveName={resolveName}
            resolveAvatarUrl={resolveAvatarUrl}
            selfId={selfId}
            guildId={guildId}
            interactiveCard={false}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            撤回消息
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// 悬停操作条
// ---------------------------------------------------------------------------

function HoverActions({
  message,
  channelId,
  guildId,
  isOwn,
  displayName,
  authorStyle,
  authorBadges,
  systemAdmin,
  resolveName,
  resolveAvatarUrl,
  selfId,
  onReply,
  onEdit,
  ephemeral = false,
}: {
  message: ChatMessage
  channelId: string
  guildId?: string
  isOwn: boolean
  displayName: string
  authorStyle?: ReturnType<typeof resolveMemberNameStyle> | null
  authorBadges?: ReturnType<typeof memberRoleBadges>
  systemAdmin?: boolean
  resolveName: MentionResolver
  resolveAvatarUrl?: (userId: string) => string | undefined
  selfId?: string
  onReply: () => void
  onEdit: () => void
  /** ephemeral 消息：不可回复/反应（服务端拒绝，操作入口一并隐藏） */
  ephemeral?: boolean
}) {
  const toggleReaction = useMessagesStore((state) => state.toggleReaction)
  const remove = useMessagesStore((state) => state.remove)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const applyReactionPick = (pick: ExpressionPick) => {
    const key =
      pick.type === "unicode"
        ? pick.emoji
        : customReactionKey(pick.item.id)
    void toggleReaction(channelId, message.id, key).catch(() => undefined)
  }

  const doDelete = async () => {
    try {
      await remove(channelId, message.id)
      setConfirmOpen(false)
    } catch (error) {
      // 服务端裁决：对他人消息无 MANAGE_MESSAGES 时收敛为通用提示
      setDeleteError(
        error instanceof ApiError ? error.message : "撤回失败，请重试"
      )
    }
  }

  const iconButton =
    "rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"

  return (
    <>
      <div
        className={cn(
          "absolute -top-3.5 right-4 hidden items-center gap-0.5 rounded-lg border bg-background p-0.5 shadow-sm group-hover/message:flex",
          pickerOpen && "flex"
        )}
      >
        {!ephemeral && (
          <EmojiPickerPopover
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            guildId={guildId}
            mode="reaction"
            onPick={(emoji) =>
              void toggleReaction(channelId, message.id, emoji).catch(
                () => undefined,
              )
            }
            onExpressionPick={applyReactionPick}
          >
            <button type="button" aria-label="添加反应" className={iconButton}>
              <SmilePlusIcon className="size-4" />
            </button>
          </EmojiPickerPopover>
        )}
        {!ephemeral && (
          <button
            type="button"
            aria-label="回复"
            className={iconButton}
            onClick={onReply}
          >
            <CornerUpLeftIcon className="size-4" />
          </button>
        )}
        {isOwn && (
          <button
            type="button"
            aria-label="编辑"
            className={iconButton}
            onClick={onEdit}
          >
            <PencilIcon className="size-4" />
          </button>
        )}
        <button
          type="button"
          aria-label="撤回消息"
          title="撤回消息"
          className={cn(iconButton, "hover:text-destructive")}
          onClick={(event) => {
            // Shift+点击跳过确认
            if (event.shiftKey) void doDelete()
            else {
              setDeleteError(null)
              setConfirmOpen(true)
            }
          }}
        >
          <Trash2Icon className="size-4" />
        </button>
      </div>

      <DeleteMessageConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        message={message}
        isOwn={isOwn}
        error={deleteError}
        onConfirm={() => void doDelete()}
        resolveName={resolveName}
        resolveAvatarUrl={resolveAvatarUrl}
        selfId={selfId}
        guildId={guildId}
        displayName={displayName}
        authorStyle={authorStyle}
        authorBadges={authorBadges}
        systemAdmin={systemAdmin}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// 回复引用摘要条
// ---------------------------------------------------------------------------

function ReplyPreview({
  replyToId,
  channelId,
  guildId,
  resolveName,
  resolveAvatarUrl,
  selfId,
  onJump,
}: {
  replyToId: string
  channelId: string
  guildId?: string
  resolveName: MentionResolver
  resolveAvatarUrl?: (userId: string) => string | undefined
  selfId?: string
  onJump: (messageId: string) => void
}) {
  const referenced = useMessagesStore((state) =>
    state.byChannel[channelId]?.messages.find(
      (message) => message.id === replyToId
    )
  )
  const member = useMembersStore((state) =>
    guildId
      ? state.byGuild[guildId]?.find((m) => m.user_id === referenced?.author_id)
      : undefined
  )
  const roles = useRolesStore((state) =>
    guildId ? state.byGuild[guildId] : undefined
  )

  if (!referenced) {
    return (
      <p className="mb-0.5 flex items-center gap-1 pl-11 text-xs text-muted-foreground italic">
        <ReplyCornerIcon className="size-3.5 shrink-0 text-muted-foreground/80" />
        原消息已删除
      </p>
    )
  }
  const systemAdmin = isSystemAdminMessage(referenced.type)
  // 临场超管：固定展示名与皇冠头像，禁止回落到本人资料头像/昵称
  const name = systemAdmin
    ? "系统超级管理员"
    : (member ? memberDisplayName(member) : null) ||
      resolveName(referenced.author_id) ||
      referenced.author_username ||
      "未知用户"
  const avatarUrl = systemAdmin
    ? undefined
    : resolveAvatarUrl?.(referenced.author_id)
  const badges = systemAdmin ? [] : memberRoleBadges(member, roles)
  const hasContent = Boolean(referenced.content?.trim())
  const hasAttachments = (referenced.attachments?.length ?? 0) > 0

  return (
    <button
      type="button"
      onClick={() => onJump(referenced.id)}
      className="mb-0.5 flex max-w-full min-w-0 items-center gap-1.5 pl-11 text-left text-xs text-muted-foreground hover:text-foreground"
    >
      <ReplyCornerIcon className="size-3.5 shrink-0 text-muted-foreground/80" />
      {systemAdmin ? (
        <SystemAdminAvatar size="sm" />
      ) : avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="size-4 shrink-0 rounded-full object-cover"
          draggable={false}
        />
      ) : (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground">
          {(name || "?").slice(0, 1).toUpperCase()}
        </span>
      )}
      {systemAdmin ? (
        <StyledDisplayName name={name} style={null} className="shrink-0 text-xs" />
      ) : (
        <MemberStyledName
          guildId={guildId}
          userId={referenced.author_id}
          member={member}
          roles={roles}
          name={name}
          className="shrink-0 text-xs"
        />
      )}
      {systemAdmin ? (
        <SystemAdminBadge className="shrink-0" />
      ) : (
        <RoleBadgePills badges={badges} className="shrink-0" />
      )}
      {/* 正文：Markdown + 自定义小表情 */}
      {hasContent ? (
        <MessageContent
          content={referenced.content}
          resolveMention={resolveName}
          resolveMentionAvatar={systemAdmin ? undefined : resolveAvatarUrl}
          selfId={selfId}
          guildId={guildId}
          compact
          className="min-w-0 flex-1 text-xs text-muted-foreground"
        />
      ) : (
        <span className="min-w-0 truncate">
          {hasAttachments
            ? "[附件]"
            : referenced.type === MESSAGE_TYPE_STICKER ||
                (referenced.sticker_items?.length ?? 0) > 0
              ? "[贴图]"
              : ""}
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// 消息行
// ---------------------------------------------------------------------------

export type MessageRowProps = {
  message: ChatMessage
  channelId: string
  guildId?: string
  /** 与上一条同作者且间隔 < 7 分钟：合并进组，不显示头像行 */
  grouped: boolean
  selfId?: string
  resolveName: MentionResolver
  /** 作者头像绝对 URL（可选） */
  resolveAvatarUrl?: (userId: string) => string | undefined
  editing: boolean
  onStartEdit: (messageId: string) => void
  onStopEdit: () => void
  onReply: (message: ChatMessage) => void
  onJump: (messageId: string) => void
  /** 跳转定位后的闪烁高亮 */
  flashing: boolean
}

export const MessageRow = memo(function MessageRow({
  message,
  channelId,
  guildId,
  grouped,
  selfId,
  resolveName,
  resolveAvatarUrl,
  editing,
  onStartEdit,
  onStopEdit,
  onReply,
  onJump,
  flashing,
}: MessageRowProps) {
  const isOwn = selfId !== undefined && message.author_id === selfId
  const mentioned =
    selfId !== undefined && contentMentionsUser(message.content, selfId)
  const ephemeral = isEphemeralMessage(message)
  // 实时到达的 ephemeral 行才做入场动效（历史加载/切频道重挂不动）
  const ephemeralFresh =
    ephemeral && Date.now() - new Date(message.created_at).getTime() < 5_000
  const systemAdmin = isSystemAdminMessage(message.type)
  const groupSystem = isGroupDmSystemMessage(message.type)
  const selfUser = useAuthStore((state) => state.user)
  const viewerIsSystemAdmin = Boolean(selfUser?.system_admin)
  // 连发合并时不因 reply_to 强制展开头像栏——回复引用条已单独展示
  const showHeader = !grouped && !groupSystem
  const remove = useMessagesStore((state) => state.remove)
  const editVisibility = useMessagesStore((state) => state.editVisibility)
  const toggleReaction = useMessagesStore((state) => state.toggleReaction)
  const [ctxDeleteOpen, setCtxDeleteOpen] = useState(false)
  const [ctxDeleteError, setCtxDeleteError] = useState<string | null>(null)
  const [editHistoryOpen, setEditHistoryOpen] = useState(false)
  const isRestricted =
    (message.visible_role_ids?.length ?? 0) > 0 ||
    (message.visible_user_ids?.length ?? 0) > 0
  const authorMember = useMembersStore((state) =>
    guildId
      ? state.byGuild[guildId]?.find((m) => m.user_id === message.author_id)
      : undefined
  )
  // 展示名：服内昵称优先；系统超管固定文案
  const displayName = systemAdmin
    ? "系统超级管理员"
    : (authorMember
        ? memberDisplayName(authorMember)
        : null) ||
      resolveName(message.author_id) ||
      message.author_username ||
      "未知用户"
  const selfMember = useMembersStore((state) =>
    guildId && selfId
      ? state.byGuild[guildId]?.find((m) => m.user_id === selfId)
      : undefined
  )
  const roles = useRolesStore((state) =>
    guildId ? state.byGuild[guildId] : undefined
  )
  // 作者头像框：只订阅 avatar_frame 单槽引用，避免无关装扮变更触发重渲；
  // 本人走 loadout，他人走 equippedByUser 缓存（不在 store 则无框降级，不单独发请求）
  const authorAvatarFrame = useCosmeticsStore((state) =>
    isOwn
      ? state.loadout.avatar_frame
      : state.equippedByUser[message.author_id]?.avatar_frame,
  )
  const selfGuildPerms = useMemo(
    () => memberGuildPermissions(selfMember, roles),
    [selfMember, roles],
  )
  const showEditHistory = canViewMessageEditHistory({
    isOwn,
    systemAdmin: viewerIsSystemAdmin,
    guildPerms: selfGuildPerms,
    editCount: message.edit_count ?? 0,
  })
  // 临场发言不套角色色/角色徽章，统一皇冠 + 固定中文徽章
  const authorStyle = systemAdmin
    ? null
    : resolveMemberNameStyle(authorMember, roles)
  const authorBadges = systemAdmin ? [] : memberRoleBadges(authorMember, roles)
  // 本人头像优先 auth 会话资料，避免成员缓存未就绪时回落文字头像
  const authorAvatarUrl = systemAdmin
    ? undefined
    : resolveAvatarUrl?.(message.author_id) ||
      (isOwn
        ? resolveProfileAssetUrl(selfUser?.avatar_url)
        : resolveProfileAssetUrl(authorMember?.avatar_url))

  // 群组私信系统灰条：居中轻提示，无头像/菜单
  if (groupSystem) {
    return (
      <div
        id={`message-${message.id}`}
        className="px-4 py-1.5 text-center text-xs text-muted-foreground"
      >
        {message.content || "系统消息"}
      </div>
    )
  }

  const doDelete = async () => {
    try {
      await remove(channelId, message.id)
      setCtxDeleteOpen(false)
    } catch (error) {
      setCtxDeleteError(
        error instanceof ApiError ? error.message : "撤回失败，请重试"
      )
    }
  }

  const body = (
    <div
      id={`message-${message.id}`}
      className={cn(
        "group/message relative px-4 py-0.5 transition-colors hover:bg-muted/40",
        showHeader && "mt-2.5",
        mentioned && "bg-amber-500/10 hover:bg-amber-500/15",
        ephemeral && "bg-primary/[0.03]",
        ephemeralFresh && "ephemeral-enter",
        flashing && "animate-pulse bg-primary/15"
      )}
      data-ephemeral={ephemeral || undefined}
    >
      {message.reply_to_id && (
        <ReplyPreview
          replyToId={message.reply_to_id}
          channelId={channelId}
          guildId={guildId ?? message.guild_id}
          resolveName={resolveName}
          resolveAvatarUrl={resolveAvatarUrl}
          selfId={selfId}
          onJump={onJump}
        />
      )}
      {/* items-start：头像贴消息块顶部，不随多行正文垂直居中 */}
      <div className="flex items-start gap-2.5">
        {showHeader ? (
          systemAdmin ? (
            <SystemAdminAvatar />
          ) : (
            <AvatarWithFrame
              frame={authorAvatarFrame}
              sizeClass="size-9"
              className="mt-0.5 shrink-0 self-start"
            >
              <AuthorAvatar
                userId={message.author_id}
                name={displayName}
                avatarUrl={authorAvatarUrl}
              />
            </AvatarWithFrame>
          )
        ) : (
          <span className="w-9 shrink-0 self-start pt-0.5 text-right text-[10px] leading-5 text-muted-foreground opacity-0 select-none group-hover/message:opacity-100">
            {shortTime(message.created_at)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {showHeader && (
            <p className="flex min-w-0 items-center gap-1.5 leading-5">
              {systemAdmin ? (
                <StyledDisplayName
                  name={displayName}
                  style={null}
                  className="min-w-0 truncate text-sm font-semibold"
                />
              ) : (
                <MemberStyledName
                  guildId={guildId ?? message.guild_id}
                  userId={message.author_id}
                  member={authorMember}
                  roles={roles}
                  name={displayName}
                  className="min-w-0 truncate text-sm font-semibold"
                />
              )}
              {systemAdmin ? (
                <SystemAdminBadge />
              ) : (
                <RoleBadgePills badges={authorBadges} />
              )}
              {message.author_is_bot ? (
                <span
                  className="shrink-0 rounded bg-primary/15 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-primary"
                  title="机器人"
                >
                  BOT
                </span>
              ) : null}
              <span
                className="shrink-0 text-xs text-muted-foreground"
                title={fullTime(message.created_at)}
              >
                {groupTime(message.created_at)}
              </span>
              {/* 限定可见角标：顶到用户名行最右侧 */}
              {!editing &&
                ((message.visible_role_ids?.length ?? 0) > 0 ||
                  (message.visible_user_ids?.length ?? 0) > 0) && (
                  <RestrictedVisibilityBadge
                    className="ml-auto shrink-0"
                    roleIds={message.visible_role_ids}
                    userIds={message.visible_user_ids}
                    roles={roles}
                    resolveName={resolveName}
                  />
                )}
            </p>
          )}
          {/* 无 header 时（连续消息）角标仍跟在正文后 */}
          {!showHeader &&
            !editing &&
            ((message.visible_role_ids?.length ?? 0) > 0 ||
              (message.visible_user_ids?.length ?? 0) > 0) && (
              <div className="mb-0.5 flex justify-end">
                <RestrictedVisibilityBadge
                  roleIds={message.visible_role_ids}
                  userIds={message.visible_user_ids}
                  roles={roles}
                  resolveName={resolveName}
                />
              </div>
            )}
          {editing ? (
            <InlineEditor
              channelId={channelId}
              guildId={guildId ?? message.guild_id}
              message={message}
              resolveName={resolveName}
              onDone={onStopEdit}
            />
          ) : (
            <MessageStreamBody
              message={message}
              resolveName={resolveName}
              resolveAvatarUrl={resolveAvatarUrl}
              selfId={selfId}
              guildId={guildId ?? message.guild_id}
            />
          )}
          <ReactionPills
            message={message}
            channelId={channelId}
            guildId={guildId ?? message.guild_id}
            selfId={selfId}
          />
        </div>
      </div>
      {!editing && (
        <HoverActions
          message={message}
          channelId={channelId}
          guildId={guildId ?? message.guild_id}
          isOwn={isOwn}
          displayName={displayName}
          authorStyle={authorStyle}
          authorBadges={authorBadges}
          systemAdmin={systemAdmin}
          resolveName={resolveName}
          resolveAvatarUrl={resolveAvatarUrl}
          selfId={selfId}
          onReply={() => onReply(message)}
          onEdit={() => onStartEdit(message.id)}
          ephemeral={ephemeral}
        />
      )}
    </div>
  )

  if (editing) return body

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger className="block w-full">{body}</ContextMenuTrigger>
        <ContextMenuContent className="min-w-52">
          {message.content ? (
            <ContextMenuItem
              onClick={() => void copyText("消息内容", message.content)}
            >
              <CopyIcon />
              复制文本
            </ContextMenuItem>
          ) : null}
          {!ephemeral && (
            <ContextMenuItem onClick={() => onReply(message)}>
              <CornerUpLeftIcon />
              回复
            </ContextMenuItem>
          )}
          {isOwn && (
            <ContextMenuItem onClick={() => onStartEdit(message.id)}>
              <PencilIcon />
              编辑消息
            </ContextMenuItem>
          )}
          {showEditHistory ? (
            <ContextMenuItem onClick={() => setEditHistoryOpen(true)}>
              <HistoryIcon />
              查看编辑历史
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                ×{message.edit_count}
              </span>
            </ContextMenuItem>
          ) : null}
          {!ephemeral && (
            <ContextMenuItem
              onClick={() =>
                void toggleReaction(channelId, message.id, "👍").catch(
                  () => undefined
                )
              }
            >
              <SmilePlusIcon />
              添加 👍 反应
            </ContextMenuItem>
          )}
          {isOwn && isRestricted && (
            <ContextMenuItem
              onClick={() =>
                void editVisibility(channelId, message.id, []).catch(
                  () => undefined,
                )
              }
            >
              <LockIcon />
              改为所有人可见
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => void copyText("消息 ID", message.id)}>
            <HashIcon />
            复制消息 ID
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() =>
              void copyText(
                "消息链接",
                `${window.location.origin}/channels/${message.guild_id}/${channelId}?around=${message.id}`
              )
            }
          >
            <LinkIcon />
            复制消息链接
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => void copyText("作者 ID", message.author_id)}
          >
            <AtSignIcon />
            复制作者 ID
          </ContextMenuItem>
          <ContextMenuItem onClick={() => void copyText("作者名", displayName)}>
            <CopyIcon />
            复制作者名
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onClick={() => {
              setCtxDeleteError(null)
              setCtxDeleteOpen(true)
            }}
          >
            <Trash2Icon />
            撤回消息
          </ContextMenuItem>
          {message.guild_id ? (
            <AdminMemberMenuSection
              guildId={message.guild_id}
              targetUserId={message.author_id}
            />
          ) : null}
        </ContextMenuContent>
      </ContextMenu>

      <DeleteMessageConfirmDialog
        open={ctxDeleteOpen}
        onOpenChange={setCtxDeleteOpen}
        message={message}
        isOwn={isOwn}
        error={ctxDeleteError}
        onConfirm={() => void doDelete()}
        resolveName={resolveName}
        resolveAvatarUrl={resolveAvatarUrl}
        selfId={selfId}
        guildId={guildId ?? message.guild_id}
        displayName={displayName}
        authorStyle={authorStyle}
        authorBadges={authorBadges}
        systemAdmin={systemAdmin}
      />

      {showEditHistory ? (
        <EditHistoryDialog
          open={editHistoryOpen}
          onOpenChange={setEditHistoryOpen}
          channelId={channelId}
          message={message}
          resolveName={resolveName}
          resolveAvatarUrl={resolveAvatarUrl}
          selfId={selfId}
          guildId={guildId ?? message.guild_id}
        />
      ) : null}
    </>
  )
})

// ---------------------------------------------------------------------------
// 乐观 / 失败消息行
// ---------------------------------------------------------------------------

export function PendingRow({
  nonce,
  channelId,
  guildId,
  content,
  attachments,
  stickerPreview,
  visibleRoleIds,
  visibleUserIds,
  status,
  errorMessage,
  selfName,
  selfId,
  resolveName,
  avatarUrl,
  /** 与上一条本人消息合并分组：不重复渲染头像/昵称，避免连发时文字头像闪一下 */
  grouped = false,
}: {
  nonce: string
  channelId: string
  guildId?: string
  content: string
  attachments?: { id: string; filename: string }[] | null
  stickerPreview?: {
    item_id: string
    pack_id?: string
    mark?: string
    asset_url?: string
  }[]
  visibleRoleIds?: string[]
  visibleUserIds?: string[]
  status: "sending" | "failed"
  errorMessage?: string
  selfName: string
  selfId?: string
  resolveName: MentionResolver
  avatarUrl?: string
  grouped?: boolean
}) {
  const retryPending = useMessagesStore((state) => state.retryPending)
  const discardPending = useMessagesStore((state) => state.discardPending)
  const selfUser = useAuthStore((state) => state.user)
  const roles = useRolesStore((state) =>
    guildId ? state.byGuild[guildId] : undefined,
  )
  const failed = status === "failed"
  const attachmentList = attachments ?? []
  const resolvedAvatar =
    avatarUrl || resolveProfileAssetUrl(selfUser?.avatar_url)
  // 拉黑等隐私错误：不提供重试（需先解除拉黑）
  const isBlockFail =
    Boolean(errorMessage) &&
    (errorMessage!.includes("拉黑") ||
      errorMessage!.includes("好友验证") ||
      errorMessage!.includes("无法给对方发送"))

  return (
    <div
      className={cn(
        "px-4 py-0.5",
        grouped ? "mt-0" : "mt-2.5",
        failed ? "" : "opacity-50",
      )}
    >
      <div className="flex items-start gap-2.5">
        {grouped ? (
          <span className="w-9 shrink-0" aria-hidden />
        ) : (
          <span className="mt-0.5 shrink-0 self-start">
            <AuthorAvatar
              userId={selfId ?? "self"}
              name={selfName}
              avatarUrl={resolvedAvatar}
            />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {!grouped && (
            <p className="flex items-baseline gap-2 leading-5">
              <MemberStyledName
                guildId={guildId}
                userId={selfId}
                name={selfName}
                className="text-sm font-semibold"
              />
              <span className="text-xs text-muted-foreground">
                {failed ? "发送失败" : "发送中…"}
              </span>
            </p>
          )}
          {grouped && (
            <p className="text-[10px] leading-4 text-muted-foreground">
              {failed ? "发送失败" : "发送中…"}
            </p>
          )}
          <div className="flex items-start gap-1.5">
            <div className={cn("min-w-0 flex-1 text-sm", failed && "text-destructive/90")}>
              {content && (
                <MessageContent
                  content={content}
                  resolveMention={resolveName}
                  selfId={selfId}
                  guildId={guildId}
                />
              )}
              {stickerPreview?.map((ref) => (
                <StickerMessageBody
                  key={ref.item_id}
                  itemId={ref.item_id}
                  packId={ref.pack_id}
                  mark={ref.mark}
                  assetUrl={ref.asset_url}
                />
              ))}
              {attachmentList.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  [
                  {attachmentList
                    .map((attachment) => attachment.filename)
                    .join("、")}
                  ]
                </p>
              )}
              {((visibleRoleIds?.length ?? 0) > 0 ||
                (visibleUserIds?.length ?? 0) > 0) && (
                <RestrictedVisibilityBadge
                  roleIds={visibleRoleIds}
                  userIds={visibleUserIds}
                  roles={roles}
                  resolveName={resolveName}
                />
              )}
            </div>
            {/* 发送失败：红色感叹号 */}
            {failed ? (
              <span
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-sm"
                title={errorMessage ?? "发送失败"}
                aria-label={errorMessage ?? "发送失败"}
              >
                <span className="text-[11px] font-bold leading-none">!</span>
              </span>
            ) : null}
          </div>
          {failed && (
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-red-600 dark:text-red-500">
                {errorMessage ?? "发送失败"}
              </span>
              {!isBlockFail ? (
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() =>
                    void retryPending(channelId, nonce).catch(() => undefined)
                  }
                >
                  重试
                </button>
              ) : null}
              <button
                type="button"
                className="font-medium text-muted-foreground hover:underline"
                onClick={() => discardPending(channelId, nonce)}
              >
                取消发送
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
