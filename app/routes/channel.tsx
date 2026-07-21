// 频道页：按频道 type 分流——TEXT → 消息页（# 头部 + 消息流 + Composer），
// VOICE → 语音频道主视图（舞台/自由讨论布局 + 屏幕共享观看端，docs 10/11）。
// 消息数据全部来自 messages store（REST 拉取 + Gateway 事件驱动）。

import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"
import { HashIcon, UsersIcon } from "lucide-react"
import { toast } from "sonner"

import { Composer } from "~/components/messages/composer"
import {
  MessageList,
  TypingIndicator,
} from "~/components/messages/message-list"
import { VoiceChannelView } from "~/components/voice/voice-channel-view"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import { useGuildsStore } from "~/stores/guilds"
import { useMembersStore } from "~/stores/members"
import { useMessagesStore, type ChatMessage } from "~/stores/messages"
import { useUIStore } from "~/stores/ui"
import { resolveProfileAssetUrl } from "~/lib/user-display"
import { cn } from "~/lib/utils"

/** 频道页头部「成员」图标按钮：切换右侧成员面板开合（docs 02 FR-22） */
function MemberPanelToggle() {
  const open = useUIStore((state) => state.memberPanelOpen)
  return (
    <button
      type="button"
      title={open ? "收起成员面板" : "展开成员面板"}
      aria-label={open ? "收起成员面板" : "展开成员面板"}
      onClick={() => useUIStore.getState().toggleMemberPanel()}
      className={cn(
        "ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        open && "text-foreground",
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
  const channels = useChannelsStore((state) =>
    guildId ? state.byGuild[guildId] : undefined
  )
  const channel = channels?.find((item) => item.id === channelId)
  const user = useAuthStore((state) => state.user)
  const members = useMembersStore((state) =>
    guildId ? state.byGuild[guildId] : undefined
  )
  const unavailable = useMessagesStore((state) =>
    channelId ? Boolean(state.byChannel[channelId]?.unavailable) : false
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

  // URL 是选中状态的事实来源：进入路由时同步 ui store
  useEffect(() => {
    if (guildId && channelId) {
      useUIStore.getState().selectChannel(guildId, channelId)
    }
  }, [guildId, channelId])

  // 角色列表：用户名颜色/渐变与徽章依赖 Role.style / color
  useEffect(() => {
    if (!guildId) return
    void import("~/stores/roles").then((m) =>
      m.useRolesStore.getState().fetchRoles(guildId).catch(() => undefined),
    )
  }, [guildId])

  const channelType = channel?.type

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

  // 切频道时重置本页交互态
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
    Boolean(guildId && state.loaded && !state.guilds.some((item) => item.id === guildId))
  )
  useEffect(() => {
    if (guildGone) navigate("/", { replace: true })
  }, [guildGone, navigate])

  // 频道列表已加载但找不到该频道（404 被移除/不可见）：
  // 历史 404 的场景保留在本页显示空态，其余情况退回首页
  useEffect(() => {
    if (
      !unavailable &&
      channels &&
      channelId &&
      !channels.some((item) => item.id === channelId)
    ) {
      navigate("/", { replace: true })
    }
  }, [channels, channelId, navigate, unavailable])

  // 用户 ID → 显示名（服内昵称 > 系统显示名 > 用户名）
  const resolveName = useCallback(
    (userId: string): string => {
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
    [members, user]
  )

  const resolveAvatarUrl = useCallback(
    (userId: string): string | undefined => {
      const member = members?.find((item) => item.user_id === userId)
      const raw =
        member?.avatar_url?.trim() ||
        (userId === user?.id ? user?.avatar_url?.trim() : undefined)
      return resolveProfileAssetUrl(raw)
    },
    [members, user]
  )

  if (!guildId || !channelId) return null

  // 语音频道：主内容区渲染语音视图（舞台分区/参与者网格/屏幕共享观看端）
  if (channel?.type === "VOICE") {
    return (
      <VoiceChannelView
        guildId={guildId}
        channelId={channelId}
        channelName={channel.name}
      />
    )
  }

  // 历史 404：频道不可用空态
  if (unavailable) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 px-4">
          <HashIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">{channel?.name ?? "频道"}</span>
          <MemberPanelToggle />
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-base font-medium">无法加载此频道</p>
          <p className="text-sm text-muted-foreground">频道不存在或不可用</p>
        </div>
      </div>
    )
  }

  const channelName = channel?.name ?? "频道"

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 频道头部 */}
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <HashIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{channelName}</span>
        <MemberPanelToggle />
      </header>

      {/* 消息流（key 按频道重挂载，隔离滚动与本地交互态） */}
      <MessageList
        key={channelId}
        channelId={channelId}
        guildId={guildId}
        channelName={channelName}
        selfId={user?.id}
        selfName={user?.display_name?.trim() || user?.username || "我"}
        resolveName={resolveName}
        resolveAvatarUrl={resolveAvatarUrl}
        editingId={editingId}
        onStartEdit={setEditingId}
        onStopEdit={() => setEditingId(null)}
        onReply={setReplyTo}
        focusMessageId={focusId}
        onFocusDone={clearAroundParam}
      />

      {/* typing 指示 */}
      <TypingIndicator channelId={channelId} resolveName={resolveName} />

      {/* 输入区（key 按频道重挂载，清空草稿与待发附件） */}
      <Composer
        key={channelId}
        channelId={channelId}
        guildId={guildId}
        channelName={channelName}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onEditLast={editLastOwn}
        resolveName={resolveName}
      />
    </div>
  )
}
