// 频道页：按频道 type 分流——TEXT → 消息页（# 头部 + 消息流 + Composer），
// VOICE → 语音频道主视图（舞台/自由讨论布局 + 屏幕共享观看端，docs 10/11）。
// 消息数据全部来自 messages store（REST 拉取 + Gateway 事件驱动）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"
import {
  HashIcon,
  KeyRoundIcon,
  LockIcon,
  MailIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { AvatarWithFrame } from "~/components/cosmetics/avatar-frame"
import { Composer } from "~/components/messages/composer"
import { presenceDotClass } from "~/components/nav-user"
import { ApiError } from "~/lib/api/http"
import {
  MessageList,
  TypingIndicator,
} from "~/components/messages/message-list"
import { VoiceChannelView } from "~/components/voice/voice-channel-view"
import { useAuthStore } from "~/stores/auth"
import { useChannelUnlocksStore } from "~/stores/channel-unlocks"
import { useChannelsStore } from "~/stores/channels"
import { useCosmeticsStore } from "~/stores/cosmetics"
import { useGuildsStore } from "~/stores/guilds"
import { useMembersStore } from "~/stores/members"
import { useMessagesStore, type ChatMessage } from "~/stores/messages"
import type { DmBlockState } from "~/lib/api/social"
import {
  dmDisplayName,
  usePrivateChannelsStore,
} from "~/stores/private-channels"
import {
  friendsOf,
  isBlockedByMe,
  useRelationshipsStore,
} from "~/stores/relationships"
import { usePresenceStore } from "~/stores/presence"
import { useUIStore } from "~/stores/ui"
import { nameInitials, resolveProfileAssetUrl } from "~/lib/user-display"
import { cn } from "~/lib/utils"

/** 右侧面板开关：服内=成员；私信=资料/群成员（docs 02 FR-22） */
function MemberPanelToggle({
  label = "成员",
  className,
}: {
  label?: string
  className?: string
}) {
  const open = useUIStore((state) => state.memberPanelOpen)
  return (
    <button
      type="button"
      title={open ? `收起${label}` : `展开${label}`}
      aria-label={open ? `收起${label}` : `展开${label}`}
      onClick={() => useUIStore.getState().toggleMemberPanel()}
      className={cn(
        "rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground active:scale-[0.96]",
        open && "bg-muted text-foreground",
        className
      )}
    >
      <UsersIcon className="size-4" />
    </button>
  )
}

export default function ChannelPage() {
  const { guildId, channelId } = useParams<{
    guildId: string
    channelId: string
  }>()
  const navigate = useNavigate()
  const isDm = guildId === "@me"
  const channels = useChannelsStore((state) =>
    guildId && !isDm ? state.byGuild[guildId] : undefined
  )
  const channel = channels?.find((item) => item.id === channelId)
  const privateChannels = usePrivateChannelsStore((s) => s.channels)
  const dmChannel = isDm
    ? privateChannels.find((c) => c.id === channelId)
    : undefined
  const user = useAuthStore((state) => state.user)
  const members = useMembersStore((state) =>
    guildId && !isDm ? state.byGuild[guildId] : undefined
  )
  const unavailable = useMessagesStore((state) =>
    channelId ? Boolean(state.byChannel[channelId]?.unavailable) : false
  )
  const channelLocked = useMessagesStore((state) =>
    channelId ? Boolean(state.byChannel[channelId]?.locked) : false
  )
  const channelMessages = useMessagesStore((state) =>
    channelId ? state.byChannel[channelId]?.messages : undefined
  )

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // 搜索结果跳转定位（?around=消息ID）：加载目标前后上下文并高亮闪烁
  const [searchParams, setSearchParams] = useSearchParams()
  const around = searchParams.get("around")
  const [focusId, setFocusId] = useState<string | null>(null)

  const clearAroundParam = useCallback(() => {
    setFocusId(null)
    setSearchParams(
      (params) => {
        params.delete("around")
        return params
      },
      { replace: true }
    )
  }, [setSearchParams])

  // URL 是选中状态的事实来源：进入路由时同步 ui store；
  // 多账号时先确保会话切到该服归属账号，避免用错身份发消息。
  useEffect(() => {
    if (guildId && channelId) {
      if (!isDm) {
        void import("~/lib/ensure-guild-account").then(async (m) => {
          const ok = await m.ensureGuildAccount(guildId)
          if (!ok) {
            navigate("/", { replace: true })
            return
          }
          useUIStore.getState().selectChannel(guildId, channelId)
        })
      } else {
        useUIStore.getState().selectChannel(guildId, channelId)
      }
    }
  }, [guildId, channelId, isDm, navigate])

  // 私信：确保列表里有该频道元数据（显示名）
  useEffect(() => {
    if (!isDm) return
    void usePrivateChannelsStore
      .getState()
      .refresh()
      .catch(() => undefined)
  }, [isDm, channelId])

  // 角色列表：用户名颜色/渐变与徽章依赖 Role.style / color
  useEffect(() => {
    if (!guildId || isDm) return
    void import("~/stores/roles").then((m) => {
      const store = m.useRolesStore.getState()
      if (store.byGuild[guildId] !== undefined) return
      void store.fetchRoles(guildId).catch(() => undefined)
    })
  }, [guildId, isDm])

  const channelType = isDm ? "TEXT" : channel?.type

  // 进入频道拉取最近 50 条；带 around 参数时改走锚点上下文加载。
  // 语音频道不走消息域（主视图由 VoiceChannelView 承担）。
  useEffect(() => {
    if (!channelId || channelType === "VOICE") return
    if (around) {
      let cancelled = false
      void useMessagesStore
        .getState()
        .loadAround(channelId, around)
        .then((found) => {
          if (cancelled) return
          if (found) {
            setFocusId(around)
          } else {
            // 目标被删/不可见（竞态容错 FR-19）
            toast.error("无法定位该消息")
            clearAroundParam()
            void useMessagesStore
              .getState()
              .loadInitial(channelId)
              .catch(() => undefined)
          }
        })
        .catch(() => {
          if (cancelled) return
          toast.error("无法定位该消息")
          clearAroundParam()
        })
      return () => {
        cancelled = true
      }
    }
    void useMessagesStore
      .getState()
      .loadInitial(channelId)
      .catch(() => undefined)
  }, [channelId, channelType, around, clearAroundParam])

  // 切频道时仅重置本页交互态；消息 store 按频道缓存并自行去重。
  // 不要在这里清空频道状态，否则会与上方 loadInitial 产生竞态并触发重复请求。
  useEffect(() => {
    setReplyTo(null)
    setEditingId(null)
  }, [channelId])

  // 正在回复/编辑的消息被删除（本端或远端）时退出对应状态
  useEffect(() => {
    if (
      replyTo &&
      channelMessages &&
      !channelMessages.some((item) => item.id === replyTo.id)
    ) {
      setReplyTo(null)
    }
    if (
      editingId &&
      channelMessages &&
      !channelMessages.some((item) => item.id === editingId)
    ) {
      setEditingId(null)
    }
  }, [channelMessages, replyTo, editingId])

  // 正在浏览的服务器消失（被踢/Ban/删服，GUILD_DELETE / GUILD_MEMBER_REMOVE）：导航走
  const guildGone = useGuildsStore((state) =>
    Boolean(
      guildId &&
      !isDm &&
      state.loaded &&
      !state.guilds.some((item) => item.id === guildId)
    )
  )
  useEffect(() => {
    if (guildGone) navigate("/", { replace: true })
  }, [guildGone, navigate])

  // 频道列表已加载但找不到该频道（404 被移除/不可见）：
  // 历史 404 的场景保留在本页显示空态，其余情况退回首页（私信跳过服频道列表校验）
  useEffect(() => {
    if (isDm) return
    if (
      !unavailable &&
      channels &&
      channelId &&
      !channels.some((item) => item.id === channelId)
    ) {
      navigate("/", { replace: true })
    }
  }, [channels, channelId, navigate, unavailable, isDm])

  // 用户 ID → 显示名（服内昵称 > 系统显示名 > 用户名；私信用 recipients）
  const resolveName = useCallback(
    (userId: string): string => {
      if (isDm && dmChannel) {
        const r = dmChannel.recipients.find((x) => x.id === userId)
        if (r) return r.display_name?.trim() || r.username
      }
      const member = members?.find((item) => item.user_id === userId)
      if (member) {
        return (
          member.nickname?.trim() ||
          member.display_name?.trim() ||
          member.username ||
          `用户${userId.slice(0, 6)}`
        )
      }
      if (userId === user?.id) {
        return user.display_name?.trim() || user.username
      }
      return `用户${userId.slice(0, 6)}`
    },
    [members, user, isDm, dmChannel]
  )

  const resolveAvatarUrl = useCallback(
    (userId: string): string | undefined => {
      if (isDm && dmChannel) {
        const r = dmChannel.recipients.find((x) => x.id === userId)
        if (r?.avatar_url) return resolveProfileAssetUrl(r.avatar_url)
      }
      const member = members?.find((item) => item.user_id === userId)
      const raw =
        member?.avatar_url?.trim() ||
        (userId === user?.id ? user?.avatar_url?.trim() : undefined)
      return resolveProfileAssetUrl(raw)
    },
    [members, user, isDm, dmChannel]
  )

  // 以下 hooks 必须始终按相同顺序调用，不得放在 early return 之后
  // （文字频道 ↔ 语音频道切换时否则会触发 “Rendered fewer hooks than expected”）
  const channelName = isDm
    ? dmChannel
      ? dmDisplayName(dmChannel, user?.id)
      : "私信"
    : (channel?.name ?? "频道")

  // Composer / MessageList 内 guild 相关 API 在私信用空串占位
  const guildIdForChat = isDm ? "" : (guildId ?? "")
  const isMessageRequest = Boolean(isDm && dmChannel?.message_request)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState("")
  const [renameBusy, setRenameBusy] = useState(false)
  // 勿在 selector 内 friendsOf() 返回新数组，否则 useSyncExternalStore 无限更新
  const relItems = useRelationshipsStore((s) => s.items)
  const friends = useMemo(() => friendsOf(relItems), [relItems])

  // 1:1 拉黑：本地 relationships 可判断「我拉黑了对方」；「对方拉黑我」靠 channel.block_state
  const dmPeerId =
    isDm && dmChannel?.type === "DM"
      ? (dmChannel.recipients.find((r) => r.id !== user?.id)?.id ??
        dmChannel.recipients[0]?.id)
      : undefined
  const dmBlockState = useMemo((): DmBlockState | null => {
    if (!isDm || !dmChannel || dmChannel.type !== "DM") return null
    if (isBlockedByMe(relItems, dmPeerId)) return "blocked_by_me"
    if (dmChannel.block_state === "blocked_by_me") return "blocked_by_me"
    if (dmChannel.block_state === "blocked_by_peer") return "blocked_by_peer"
    return null
  }, [isDm, dmChannel, relItems, dmPeerId])
  const invitableFriends = useMemo(() => {
    if (!dmChannel || dmChannel.type !== "GROUP_DM") return []
    const memberIds = new Set(dmChannel.recipients.map((r) => r.id))
    if (user?.id) memberIds.add(user.id)
    return friends.filter((f) => !memberIds.has(f.user.id))
  }, [dmChannel, friends, user?.id])

  const dmPeer =
    isDm && dmChannel?.type !== "GROUP_DM"
      ? (dmChannel?.recipients.find((r) => r.id !== user?.id) ??
        dmChannel?.recipients[0])
      : undefined
  const dmPeerAvatar = resolveProfileAssetUrl(dmPeer?.avatar_url)
  const dmPeerPresence = usePresenceStore((s) =>
    dmPeer?.id ? s.statusByUser[dmPeer.id] : undefined
  )
  // DM 头部对方头像框：只订阅单槽引用；无缓存则无框降级，不单独发请求
  const dmPeerAvatarFrame = useCosmeticsStore((s) =>
    dmPeer?.id ? s.equippedByUser[dmPeer.id]?.avatar_frame : undefined
  )

  const onStopEditCallback = useCallback(
    () => setEditingId(null),
    [setEditingId]
  )
  // 悬浮 Composer 高度：列表底部留白，避免最后几条消息被挡住
  const composerDockRef = useRef<HTMLDivElement>(null)
  const [bottomInset, setBottomInset] = useState(88)
  useEffect(() => {
    const el = composerDockRef.current
    if (!el) return
    const update = () => {
      setBottomInset(Math.ceil(el.getBoundingClientRect().height))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [channelId])

  const messageListProps = useMemo(
    () => ({
      channelId: channelId ?? "",
      guildId: guildIdForChat,
      channelName,
      selfId: user?.id,
      selfName: user?.display_name?.trim() || user?.username || "我",
      resolveName,
      resolveAvatarUrl,
      editingId,
      onStartEdit: setEditingId,
      onStopEdit: onStopEditCallback,
      onReply: setReplyTo,
      focusMessageId: focusId,
      onFocusDone: clearAroundParam,
      bottomInset,
    }),
    [
      channelId,
      guildIdForChat,
      channelName,
      user?.id,
      user?.display_name?.trim(),
      user?.username,
      resolveName,
      resolveAvatarUrl,
      editingId,
      setEditingId,
      setReplyTo,
      focusId,
      clearAroundParam,
      onStopEditCallback,
      bottomInset,
    ]
  )

  // —— 以下为条件渲染（所有 hooks 已调用完毕）——
  if (!guildId || !channelId) return null

  // 语音频道：主内容区渲染语音视图（舞台分区/参与者网格/屏幕共享观看端）
  if (!isDm && channel?.type === "VOICE") {
    return (
      <VoiceChannelView
        guildId={guildId}
        channelId={channelId}
        channelName={channel.name}
      />
    )
  }

  // 上锁未解锁：引导输入密码
  if (channelLocked && channelId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-0 border-b-0 px-4 shadow-none">
          <LockIcon className="size-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-medium">{channelName}</span>
          {!isDm ? <MemberPanelToggle /> : null}
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <LockIcon className="size-10 text-muted-foreground" />
          <p className="text-base font-medium">频道已上锁</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            输入访问密码后即可查看消息
          </p>
          <Button
            onClick={() => {
              useChannelUnlocksStore.getState().requestUnlock(channelId, () => {
                void useMessagesStore.getState().loadInitial(channelId)
              })
            }}
          >
            <KeyRoundIcon className="size-4" />
            输入密码解锁
          </Button>
        </div>
      </div>
    )
  }

  // 历史 404：频道不可用空态
  if (unavailable) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-0 border-b-0 px-4 shadow-none">
          {isDm ? (
            <MailIcon className="size-4 text-muted-foreground" />
          ) : (
            <HashIcon className="size-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{channelName}</span>
          {!isDm ? <MemberPanelToggle /> : null}
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-base font-medium">无法加载此频道</p>
          <p className="text-sm text-muted-foreground">频道不存在或不可用</p>
        </div>
      </div>
    )
  }

  // 空输入框按 ↑：编辑自己最近一条消息
  const editLastOwn = () => {
    if (!user) return
    const list =
      useMessagesStore.getState().byChannel[channelId]?.messages ?? []
    for (let index = list.length - 1; index >= 0; index--) {
      if (list[index].author_id === user.id) {
        setEditingId(list[index].id)
        return
      }
    }
  }

  const submitRename = async () => {
    if (!channelId) return
    setRenameBusy(true)
    try {
      await usePrivateChannelsStore
        .getState()
        .renameGroup(channelId, renameDraft.trim())
      toast.success("已改名")
      setRenameOpen(false)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "改名失败")
    } finally {
      setRenameBusy(false)
    }
  }

  const acceptMessageRequest = async () => {
    if (!channelId) return
    try {
      await usePrivateChannelsStore.getState().acceptRequest(channelId)
      toast.success("已接受消息请求")
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "接受失败")
    }
  }

  const rejectMessageRequest = async (alsoBlock: boolean) => {
    if (!channelId || !dmChannel) return
    try {
      const other = dmChannel.recipients[0]
      await usePrivateChannelsStore.getState().rejectRequest(channelId)
      if (alsoBlock && other?.id) {
        const { useRelationshipsStore } = await import("~/stores/relationships")
        await useRelationshipsStore.getState().block(other.id)
        toast.success("已忽略并屏蔽")
      } else {
        toast.success("已忽略请求")
      }
      navigate("/", { replace: true })
      useUIStore.getState().selectGuild(null)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "操作失败")
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 频道 / 私信顶栏（无底部分割线） */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-0 border-b-0 px-3 shadow-none">
        {isDm ? (
          dmChannel?.type === "GROUP_DM" ? (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted ring-1 ring-black/5 dark:ring-white/10">
              <UsersIcon className="size-3.5 text-muted-foreground" />
            </span>
          ) : (
            <span className="relative size-8 shrink-0">
              {/* DM 头部对方头像套装扮头像框；在线点 z-[3] 压在框（z-[2]）之上 */}
              <AvatarWithFrame frame={dmPeerAvatarFrame} sizeClass="size-8">
                <Avatar className="size-8 after:border-0">
                  {dmPeerAvatar ? (
                    <AvatarImage
                      src={dmPeerAvatar}
                      alt=""
                      className="object-cover"
                    />
                  ) : null}
                  <AvatarFallback className="text-[11px] font-medium">
                    {nameInitials(channelName)}
                  </AvatarFallback>
                </Avatar>
              </AvatarWithFrame>
              <span
                className={cn(
                  "absolute -right-0.5 -bottom-0.5 z-[3] size-2.5 rounded-full ring-2 ring-card",
                  presenceDotClass(dmPeerPresence)
                )}
              />
            </span>
          )
        ) : (
          <HashIcon className="size-4 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {channelName}
          </span>
          {isMessageRequest ? (
            <span className="text-[11px] text-amber-600 dark:text-amber-400">
              消息请求 · 接受后可正常聊天
            </span>
          ) : isDm && dmChannel?.type !== "GROUP_DM" ? (
            <span className="text-[11px] text-muted-foreground">
              {dmPeerPresence === "online"
                ? "在线"
                : dmPeerPresence === "idle"
                  ? "闲置"
                  : dmPeerPresence === "dnd"
                    ? "勿扰"
                    : "离线"}
            </span>
          ) : null}
        </div>
        {isDm && dmChannel && !isMessageRequest ? (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <MemberPanelToggle
              label={dmChannel.type === "GROUP_DM" ? "成员" : "资料"}
            />
            {dmChannel.type === "GROUP_DM" ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1 px-2 text-[12px]"
                  onClick={() => {
                    if (!useRelationshipsStore.getState().loaded) {
                      void useRelationshipsStore
                        .getState()
                        .refresh()
                        .catch(() => undefined)
                    }
                    setInviteOpen(true)
                  }}
                >
                  <UserPlusIcon className="size-3.5" />
                  邀请
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-[12px] text-muted-foreground"
                  onClick={() => {
                    setRenameDraft(dmChannel.name ?? "")
                    setRenameOpen(true)
                  }}
                >
                  改名
                </Button>
              </>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-[12px] text-muted-foreground hover:text-destructive"
              onClick={() => {
                if (!dmChannel || !channelId) return
                void (async () => {
                  try {
                    if (dmChannel.type === "GROUP_DM") {
                      await usePrivateChannelsStore
                        .getState()
                        .leaveGroup(channelId)
                      toast.success("已离开群组")
                    } else {
                      await usePrivateChannelsStore
                        .getState()
                        .closeChannel(channelId)
                      toast.success("已关闭私信")
                    }
                    useUIStore.getState().selectGuild(null)
                    navigate("/", { replace: true })
                  } catch (e) {
                    toast.error(e instanceof ApiError ? e.message : "操作失败")
                  }
                })()
              }}
            >
              {dmChannel.type === "GROUP_DM" ? "离开" : "关闭"}
            </Button>
          </div>
        ) : null}
        {!isDm ? <MemberPanelToggle className="ml-auto" /> : null}
      </header>

      {/* 消息请求：单行操作条 */}
      {isMessageRequest ? (
        <div className="flex flex-wrap items-center gap-2 bg-muted/40 px-4 py-2">
          <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">
            接受后进入正常私信；忽略将从列表隐藏。
          </p>
          <div className="flex shrink-0 gap-1.5">
            <Button
              size="sm"
              className="h-7 active:scale-[0.96]"
              onClick={() => void acceptMessageRequest()}
            >
              接受
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-7"
              onClick={() => void rejectMessageRequest(false)}
            >
              忽略
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-destructive"
              onClick={() => void rejectMessageRequest(true)}
            >
              屏蔽
            </Button>
          </div>
        </div>
      ) : null}

      {/* 群组邀请好友 */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="gap-3 sm:max-w-sm">
          <DialogHeader className="gap-1">
            <DialogTitle className="text-base">邀请好友</DialogTitle>
            <DialogDescription className="text-[13px]">
              仅可邀请你的好友，群组最多 10 人
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-56 overflow-y-auto rounded-xl bg-muted/40 p-1 ring-1 ring-black/5 dark:ring-white/10">
            {invitableFriends.length === 0 ? (
              <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
                没有可邀请的好友
              </p>
            ) : (
              invitableFriends.map((rel) => {
                const n =
                  rel.nickname?.trim() ||
                  rel.user.display_name?.trim() ||
                  rel.user.username
                const av = resolveProfileAssetUrl(rel.user.avatar_url)
                return (
                  <button
                    key={rel.user.id}
                    type="button"
                    disabled={inviteBusy}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-background/80 active:scale-[0.99] disabled:opacity-50"
                    onClick={() => {
                      if (!channelId) return
                      setInviteBusy(true)
                      void usePrivateChannelsStore
                        .getState()
                        .invite(channelId, rel.user.id)
                        .then(() => {
                          toast.success("已邀请")
                          setInviteOpen(false)
                        })
                        .catch((e) =>
                          toast.error(
                            e instanceof ApiError ? e.message : "邀请失败"
                          )
                        )
                        .finally(() => setInviteBusy(false))
                    }}
                  >
                    <Avatar className="size-8 after:border-0">
                      {av ? (
                        <AvatarImage src={av} alt="" className="object-cover" />
                      ) : null}
                      <AvatarFallback className="text-[10px]">
                        {nameInitials(n)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {n}
                    </span>
                    <UserPlusIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                )
              })
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setInviteOpen(false)}
            >
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 群组改名 */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="gap-3 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">修改群名称</DialogTitle>
            <DialogDescription className="text-[13px]">
              所有成员都会看到新的名称
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameDraft}
            maxLength={100}
            autoFocus
            placeholder="群名称"
            className="h-9"
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void submitRename()
              }
            }}
          />
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRenameOpen(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="active:scale-[0.96]"
              disabled={renameBusy}
              onClick={() => void submitRename()}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 消息流铺满；输入区悬浮于列表之上（毛玻璃在输入框本体，非整底背景） */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <MessageList key={`message-list:${channelId}`} {...messageListProps} />

        <div
          ref={composerDockRef}
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-transparent"
        >
          <div className="pointer-events-auto relative">
            <TypingIndicator
              channelId={channelId}
              resolveName={resolveName}
              resolveAvatarUrl={resolveAvatarUrl}
            />
            <Composer
              key={`composer:${channelId}`}
              channelId={channelId}
              guildId={guildIdForChat}
              channelName={channelName}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              onEditLast={editLastOwn}
              resolveName={resolveName}
              resolveAvatarUrl={resolveAvatarUrl}
              dmBlockState={dmBlockState}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
