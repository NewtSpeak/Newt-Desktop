// 消息输入区：TipTap 有限 Markdown 编辑器（Enter 发送 / Shift+Enter 换行）、
// 行内 @chip、格式工具栏与快捷键、4000 字计数、typing 节流、@成员补全面板、
// 附件三入口（+ 按钮 / 拖拽 / 粘贴图片）与 presign+直传进度。

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  CrownIcon,
  FileIcon,
  LockIcon,
  PlusIcon,
  SendIcon,
  SmileIcon,
  XIcon,
} from "lucide-react"

import { presignAttachment, uploadAttachmentWithProgress } from "~/lib/api/attachments"
import { ApiError } from "~/lib/api/http"
import { sendTyping } from "~/lib/api/messages"
import type { DmBlockState } from "~/lib/api/social"
import { MESSAGE_TYPE_SYSTEM_ADMIN, type GuildMember } from "~/lib/api/types"
import {
  memberDisplayName,
  nameInitials,
  resolveProfileAssetUrl,
} from "~/lib/user-display"
import { cn } from "~/lib/utils"
import { useMembersStore } from "~/stores/members"
import { useMessagesStore, type ChatMessage } from "~/stores/messages"
import { formatBytes } from "./attachments"
import {
  TipTapComposerEditor,
  type TipTapComposerHandle,
} from "./composer-tiptap"
import { useStickersStore } from "~/stores/stickers"
import {
  EmojiPickerPopover,
  type ExpressionPick,
} from "./emoji-picker"

const MAX_CONTENT = 4000
const MAX_ATTACHMENTS = 10
const TYPING_THROTTLE_MS = 8000

// ---------------------------------------------------------------------------
// 上传项
// ---------------------------------------------------------------------------

type UploadItem = {
  localId: string
  file: File
  status: "uploading" | "done" | "error"
  /** 0-1 */
  progress: number
  attachmentId?: string
  error?: string
  abort?: () => void
  /** 图片缩略 object URL */
  previewUrl?: string
}

function ProgressRing({ progress }: { progress: number }) {
  const radius = 14
  const circumference = 2 * Math.PI * radius
  return (
    <svg viewBox="0 0 36 36" className="size-9 -rotate-90">
      <circle cx="18" cy="18" r={radius} fill="none" strokeWidth="3" className="stroke-muted" />
      <circle
        cx="18"
        cy="18"
        r={radius}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        className="stroke-primary transition-[stroke-dashoffset]"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(1, progress))}
      />
    </svg>
  )
}

function AttachmentTrayCard({ item, onRemove }: { item: UploadItem; onRemove: () => void }) {
  return (
    <div
      className={cn(
        "relative flex w-44 shrink-0 flex-col gap-1 rounded-lg border p-2",
        item.status === "error" && "border-destructive/60 bg-destructive/5",
      )}
    >
      <div className="flex h-16 items-center justify-center overflow-hidden rounded-md bg-muted/50">
        {item.previewUrl ? (
          <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />
        ) : (
          <FileIcon className="size-8 text-muted-foreground" />
        )}
        {item.status === "uploading" && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/60">
            <ProgressRing progress={item.progress} />
          </div>
        )}
      </div>
      <p className="truncate text-xs font-medium" title={item.file.name}>
        {item.file.name}
      </p>
      <p className="text-[10px] text-muted-foreground">
        {item.status === "error" ? (
          <span className="text-destructive">{item.error ?? "上传失败"}</span>
        ) : (
          formatBytes(item.file.size)
        )}
      </p>
      <button
        type="button"
        aria-label={`移除 ${item.file.name}`}
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 rounded-full border bg-background p-0.5 text-muted-foreground shadow-sm hover:text-destructive"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// @ 提及补全
// ---------------------------------------------------------------------------

function filterMembers(members: GuildMember[], query: string): GuildMember[] {
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

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

export type ComposerProps = {
  channelId: string
  guildId: string
  channelName: string
  /** 正在回复的消息（null 表示无） */
  replyTo: ChatMessage | null
  onCancelReply: () => void
  /** 输入框为空时按 ↑：编辑自己最近一条消息 */
  onEditLast: () => void
  resolveName: (userId: string) => string
  /** 解析用户头像（私信需从 recipients 取，不能只靠 guild members） */
  resolveAvatarUrl?: (userId: string) => string | undefined
  /**
   * 1:1 私信拉黑状态：
   * - blocked_by_me：我拉黑了对方 →「请解除拉黑之后再发送消息！」
   * - blocked_by_peer：对方拉黑了我 →「对方开启了好友验证…」
   */
  dmBlockState?: DmBlockState | null
}

export function Composer({
  channelId,
  guildId,
  channelName,
  replyTo,
  onCancelReply,
  onEditLast,
  resolveName,
  resolveAvatarUrl,
  dmBlockState = null,
}: ComposerProps) {
  const send = useMessagesStore((state) => state.send)
  const discardPending = useMessagesStore((state) => state.discardPending)
  const members = useMembersStore((state) => state.byGuild[guildId]) ?? []

  const [value, setValue] = useState("")
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  /** 发送失败后从错误码推断的对端拉黑（本地 relationships 看不到对方拉黑我） */
  const [peerBlockHint, setPeerBlockHint] = useState(false)

  const tipTapRef = useRef<TipTapComposerHandle | null>(null)
  const lastTypingRef = useRef(0)
  const uploadsRef = useRef(uploads)
  uploadsRef.current = uploads

  // 频道切换：清空本地输入态（上传中的先中止）；编辑器自身也会随 channelId 清空
  useEffect(() => {
    setPeerBlockHint(false)
    setInlineError(null)
    setMention(null)
    setValue("")
    return () => {
      for (const item of uploadsRef.current) {
        item.abort?.()
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      }
    }
  }, [channelId])

  // 服务端/关系 store 给出的拉黑状态优先；发送时发现对端拉黑则本地提示
  const blockState: DmBlockState | "" =
    dmBlockState === "blocked_by_me" || dmBlockState === "blocked_by_peer"
      ? dmBlockState
      : peerBlockHint
        ? "blocked_by_peer"
        : ""
  const isBlocked = Boolean(blockState)
  const blockHintText =
    blockState === "blocked_by_me"
      ? "请解除拉黑之后再发送消息！"
      : blockState === "blocked_by_peer"
        ? "对方开启了好友验证，您暂时无法给对方发送消息！"
        : null

  // 429 冷却倒计时
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  // -------------------------------------------------------------------------
  // 附件上传
  // -------------------------------------------------------------------------

  const patchUpload = (localId: string, patch: Partial<UploadItem>) =>
    setUploads((items) =>
      items.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
    )

  const startUpload = useCallback(
    async (item: UploadItem) => {
      try {
        const presigned = await presignAttachment(channelId, {
          filename: item.file.name,
          size: item.file.size,
          mime: item.file.type || undefined,
        })
        const { promise, abort } = uploadAttachmentWithProgress(
          presigned,
          item.file,
          (loaded, total) => patchUpload(item.localId, { progress: total > 0 ? loaded / total : 0 }),
        )
        patchUpload(item.localId, { abort })
        const result = await promise
        patchUpload(item.localId, {
          status: "done",
          progress: 1,
          attachmentId: result.attachment_id,
          abort: undefined,
        })
      } catch (error) {
        if (error instanceof ApiError && error.code === "UPLOAD_ABORTED") return
        const message =
          error instanceof ApiError
            ? error.code === "FILE_TOO_LARGE"
              ? "文件超过本服务器单文件上限"
              : error.message
            : "上传失败"
        patchUpload(item.localId, { status: "error", error: message, abort: undefined })
      }
    },
    [channelId],
  )

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      setInlineError(null)
      const room = MAX_ATTACHMENTS - uploadsRef.current.length
      if (room <= 0) {
        setInlineError(`一条消息最多 ${MAX_ATTACHMENTS} 个附件`)
        return
      }
      const accepted = files.slice(0, room)
      if (files.length > room) {
        setInlineError(`一条消息最多 ${MAX_ATTACHMENTS} 个附件，多余的文件未加入`)
      }
      const items: UploadItem[] = accepted.map((file) => ({
        localId: crypto.randomUUID(),
        file,
        status: "uploading",
        progress: 0,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      }))
      setUploads((current) => [...current, ...items])
      // 加入即开始 presign + 直传（不等用户点发送）
      for (const item of items) void startUpload(item)
    },
    [startUpload],
  )

  const removeUpload = (localId: string) => {
    setUploads((items) => {
      const target = items.find((item) => item.localId === localId)
      target?.abort?.()
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return items.filter((item) => item.localId !== localId)
    })
  }

  // 拖拽入窗口
  useEffect(() => {
    let depth = 0
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return
      depth++
      setDragOver(true)
    }
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragOver(false)
    }
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault()
    }
    const onDrop = (event: DragEvent) => {
      depth = 0
      setDragOver(false)
      if (!event.dataTransfer?.files.length) return
      event.preventDefault()
      addFiles([...event.dataTransfer.files])
    }
    window.addEventListener("dragenter", onDragEnter)
    window.addEventListener("dragleave", onDragLeave)
    window.addEventListener("dragover", onDragOver)
    window.addEventListener("drop", onDrop)
    return () => {
      window.removeEventListener("dragenter", onDragEnter)
      window.removeEventListener("dragleave", onDragLeave)
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("drop", onDrop)
    }
  }, [addFiles])

  // -------------------------------------------------------------------------
  // typing 节流
  // -------------------------------------------------------------------------

  const reportTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastTypingRef.current < TYPING_THROTTLE_MS) return
    lastTypingRef.current = now
    void sendTyping(channelId).catch(() => undefined)
  }, [channelId])

  const onEditorChange = useCallback(
    (markdown: string) => {
      setValue(markdown)
      if (markdown.trim() !== "") reportTyping()
    },
    [reportTyping],
  )

  // -------------------------------------------------------------------------
  // @ 补全
  // -------------------------------------------------------------------------

  const mentionCandidates = useMemo(
    () => (mention ? filterMembers(members, mention.query) : []),
    [mention, members],
  )

  const onMentionQuery = useCallback(
    (query: { start: number; query: string } | null) => {
      setMention(query)
      if (query) setMentionIndex(0)
    },
    [],
  )

  /** 在输入框光标处插入 @chip，替换正在输入的 @query */
  const insertMention = useCallback(
    (member: GuildMember) => {
      if (!mention) return
      const handle = tipTapRef.current
      if (!handle) return

      const queryLen = mention.query.length + 1 // 含 @
      const already = handle.getMarkdown().includes(`<@${member.user_id}>`)

      if (already) {
        handle.deleteBeforeCaret(queryLen)
      } else {
        const label = memberDisplayName(member) || member.username
        handle.insertMention(member.user_id, label, queryLen)
      }
      setMention(null)
      requestAnimationFrame(() => handle.focus())
    },
    [mention],
  )

  // mention 面板键盘：捕获阶段优先于 TipTap 内部 Enter 发送
  const onComposerKeyDownCapture = (event: React.KeyboardEvent) => {
    if (!mention || mentionCandidates.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      event.stopPropagation()
      setMentionIndex((index) => (index + 1) % mentionCandidates.length)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      event.stopPropagation()
      setMentionIndex(
        (index) =>
          (index - 1 + mentionCandidates.length) % mentionCandidates.length,
      )
      return
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault()
      event.stopPropagation()
      insertMention(mentionCandidates[mentionIndex])
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      setMention(null)
    }
  }

  // -------------------------------------------------------------------------
  // 发送
  // -------------------------------------------------------------------------

  const overCount = [...value].length - MAX_CONTENT
  const uploading = uploads.some((item) => item.status === "uploading")
  const failedUploads = uploads.filter((item) => item.status === "error")
  const doneAttachmentIds = uploads
    .filter((item) => item.status === "done" && item.attachmentId)
    .map((item) => item.attachmentId!)
  const canSend =
    !isBlocked &&
    cooldown <= 0 &&
    overCount <= 0 &&
    !uploading &&
    failedUploads.length === 0 &&
    (value.trim() !== "" || doneAttachmentIds.length > 0)

  const sendSticker = async (item: {
    id: string
    pack_id: string
    mark: string
    asset_url: string
  }) => {
    if (isBlocked || cooldown > 0) return
    setInlineError(null)
    setPeerBlockHint(false)
    try {
      await send(channelId, {
        content: "",
        replyToId: replyTo?.id,
        stickerItems: [{ item_id: item.id }],
        stickerPreview: [
          {
            item_id: item.id,
            pack_id: item.pack_id,
            mark: item.mark,
            asset_url: item.asset_url,
          },
        ],
      })
      onCancelReply()
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "SLOWMODE_RATE_LIMITED" && error.retryAfterSeconds) {
          setCooldown(error.retryAfterSeconds)
          return
        }
        if (
          error.code === "DM_BLOCKED" ||
          error.code === "BLOCKED_BY_PEER" ||
          /拉黑|屏蔽|好友验证/i.test(error.message)
        ) {
          setPeerBlockHint(true)
          return
        }
        setInlineError(error.message)
      } else {
        setInlineError("发送失败，请重试")
      }
    }
  }

  const onExpressionPick = (pick: ExpressionPick) => {
    if (pick.type === "unicode") {
      tipTapRef.current?.insertEmoji(pick.emoji)
      tipTapRef.current?.focus()
      return
    }
    if (pick.type === "emote") {
      useStickersStore.getState().cacheItems([pick.item])
      tipTapRef.current?.insertCustomEmote({
        itemId: pick.item.id,
        mark: pick.item.mark,
        assetUrl: pick.item.asset_url,
        animated: pick.item.animated,
      })
      tipTapRef.current?.focus()
      return
    }
    // 贴图：独立发送
    useStickersStore.getState().cacheItems([pick.item])
    void sendSticker(pick.item)
  }

  const doSend = async () => {
    if (isBlocked) return
    if (!canSend) return
    const handle = tipTapRef.current
    const content = (handle?.getMarkdown() ?? value).trim()
    const attachments = uploads
      .filter((item) => item.status === "done" && item.attachmentId)
      .map((item) => ({
        id: item.attachmentId!,
        filename: item.file.name,
        mime: item.file.type,
        size: item.file.size,
      }))
    setInlineError(null)
    // 先清空输入（乐观回显由 store 的 pending 队列负责）
    handle?.clear()
    setValue("")
    setMention(null)
    for (const item of uploads) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    }
    setUploads([])
    onCancelReply()
    lastTypingRef.current = 0
    try {
      await send(channelId, {
        content,
        replyToId: replyTo?.id,
        attachmentIds: attachments.map((attachment) => attachment.id),
        attachments,
      })
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 429) {
          setCooldown(error.retryAfterSeconds ?? 5)
          setInlineError("发送过快，请稍候")
          return
        }
        // 拉黑：保留 failed pending（红叹号），并切换输入区锁态文案
        if (
          error.code === "BLOCKED_BY_SELF" ||
          error.code === "BLOCKED_BY_PEER"
        ) {
          if (error.code === "BLOCKED_BY_PEER") setPeerBlockHint(true)
          // 不 discard pending，message-item 展示红色感叹号
          return
        }
        if (error.status === 403 || error.status === 404) {
          // 其他无权限/频道不可用：pending 重试无意义，移除并内联提示
          setInlineError(
            error.status === 403 ? error.message : "频道不可用，消息未能发送",
          )
          const pendingQueue =
            useMessagesStore.getState().pendingByChannel[channelId] ?? []
          const failed = pendingQueue.filter((item) => item.status === "failed")
          if (failed.length > 0)
            discardPending(channelId, failed[failed.length - 1].nonce)
          return
        }
      }
      // 其他错误：保留 failed pending 行供重试
    }
  }

  const pickFiles = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.multiple = true
    input.onchange = () => addFiles([...(input.files ?? [])])
    input.click()
  }

  const mentionOpen = Boolean(mention && mentionCandidates.length > 0)

  return (
    <div
      className="relative px-4 pt-1 pb-3"
      onKeyDownCapture={onComposerKeyDownCapture}
    >
      {/* 拖放遮罩 */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/80">
          <div className="rounded-2xl border-2 border-dashed border-primary px-10 py-8 text-center">
            <p className="text-lg font-semibold">拖放以上传到 #{channelName}</p>
            <p className="mt-1 text-sm text-muted-foreground">每条消息最多 10 个附件</p>
          </div>
        </div>
      )}

      {/* 内联错误 / 冷却提示 */}
      {(inlineError || cooldown > 0) && (
        <p className="pb-1 text-xs text-destructive" role="alert">
          {cooldown > 0 ? `发送过快，请稍候 ${cooldown} 秒` : inlineError}
        </p>
      )}

      {/* @ 补全面板（带头像）；chip 本身在输入框内渲染 */}
      {mentionOpen && (
        <div
          data-mention-panel
          className="absolute bottom-full left-4 z-30 mb-1 w-72 rounded-lg border bg-popover p-1 shadow-lg"
        >
          <p className="px-2 py-1 text-xs text-muted-foreground select-none">成员</p>
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
                <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  @{member.username}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* 输入框本体：灰色半透明 + 高斯模糊，无阴影 */}
      <div
        className={cn(
          "overflow-hidden rounded-2xl border-0 shadow-none",
          "bg-muted/55 backdrop-blur-2xl",
          "supports-[backdrop-filter]:bg-muted/40",
        )}
      >
        {/* 回复条 */}
        {replyTo && (
          <div className="flex items-center justify-between border-0 px-3 py-1.5 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 truncate text-muted-foreground">
              正在回复
              {(() => {
                const isSystemAdmin = replyTo.type === MESSAGE_TYPE_SYSTEM_ADMIN
                // 临场超管：固定皇冠头像 + 名称，禁止回落到本人资料
                if (isSystemAdmin) {
                  return (
                    <span className="inline-flex items-center gap-1 font-medium text-foreground">
                      <span
                        className="flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-600 text-white"
                        title="系统超级管理员"
                      >
                        <CrownIcon className="size-2.5 text-white" aria-hidden />
                      </span>
                      系统超级管理员
                    </span>
                  )
                }
                const authorId = replyTo.author_id
                const m = members.find((item) => item.user_id === authorId)
                const name =
                  resolveName(authorId) || replyTo.author_username
                const avatar =
                  resolveAvatarUrl?.(authorId) ||
                  resolveProfileAssetUrl(m?.avatar_url)
                return (
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    {avatar ? (
                      <img
                        src={avatar}
                        alt=""
                        className="size-4 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[9px]">
                        {nameInitials(name)}
                      </span>
                    )}
                    @{name}
                  </span>
                )
              })()}
            </span>
            <button
              type="button"
              aria-label="取消回复"
              onClick={onCancelReply}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        )}

        {/* 待发附件区 */}
        {uploads.length > 0 && (
          <div className="flex gap-2 overflow-x-auto border-0 p-2">
            {uploads.map((item) => (
              <AttachmentTrayCard
                key={item.localId}
                item={item}
                onRemove={() => removeUpload(item.localId)}
              />
            ))}
          </div>
        )}

        {/* 拉黑态：红锁 + 红字（仍保留会话窗口，仅禁止发送） */}
        {isBlocked && blockHintText ? (
          <div
            className="flex items-center gap-2 px-3 py-2.5"
            role="status"
            aria-live="polite"
          >
            <LockIcon
              className="size-4 shrink-0 text-red-600 dark:text-red-500"
              aria-hidden
            />
            <p className="text-[13px] font-medium text-red-600 dark:text-red-500">
              {blockHintText}
            </p>
          </div>
        ) : (
          <TipTapComposerEditor
            channelId={channelId}
            channelName={channelName}
            disabled={isBlocked}
            onChange={onEditorChange}
            onSubmit={() => void doSend()}
            onEditLast={onEditLast}
            onEscapeReply={replyTo ? onCancelReply : undefined}
            onMentionQuery={onMentionQuery}
            mentionOpen={mentionOpen}
            onPasteFiles={addFiles}
            editorRef={tipTapRef}
            resolveMentionLabel={resolveName}
            leadingActions={
              <button
                type="button"
                aria-label="添加附件"
                onClick={pickFiles}
                disabled={uploads.length >= MAX_ATTACHMENTS}
                className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-40"
                title={
                  uploads.length >= MAX_ATTACHMENTS
                    ? "一条消息最多 10 个附件"
                    : "上传文件"
                }
              >
                <PlusIcon className="size-5" />
              </button>
            }
            trailingActions={
              <>
                <EmojiPickerPopover
                  guildId={guildId || undefined}
                  mode="composer"
                  onPick={(emoji) => {
                    tipTapRef.current?.insertEmoji(emoji)
                    tipTapRef.current?.focus()
                  }}
                  onExpressionPick={onExpressionPick}
                >
                  <button
                    type="button"
                    aria-label="插入表情或贴图"
                    className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-foreground/5 hover:text-foreground active:scale-[0.96] cursor-pointer"
                  >
                    <SmileIcon className="size-5" />
                  </button>
                </EmojiPickerPopover>
                <button
                  type="button"
                  aria-label="发送"
                  onClick={() => void doSend()}
                  disabled={!canSend}
                  className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-primary hover:bg-foreground/5 disabled:opacity-40"
                  title={
                    uploading
                      ? "附件上传中…"
                      : failedUploads.length > 0
                        ? "有附件上传失败，移除或等待重试后再发送"
                        : undefined
                  }
                >
                  <SendIcon className="size-5" />
                </button>
              </>
            }
          />
        )}
      </div>

      {/* 字数计数（接近/超出上限时显示） */}
      {[...value].length > MAX_CONTENT - 200 && (
        <p
          className={cn(
            "pt-0.5 text-right text-xs",
            overCount > 0 ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {overCount > 0 ? `-${overCount}` : `${[...value].length}/${MAX_CONTENT}`}
        </p>
      )}
    </div>
  )
}
