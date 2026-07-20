// 文字频道页：# 频道头部 + 消息流 + typing 指示 + Composer。
// 消息数据全部来自 messages store（REST 拉取 + Gateway 事件驱动）。

import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"
import { HashIcon } from "lucide-react"
import { toast } from "sonner"

import { Composer } from "~/components/messages/composer"
import { MessageList, TypingIndicator } from "~/components/messages/message-list"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import { useMembersStore } from "~/stores/members"
import { useMessagesStore, type ChatMessage } from "~/stores/messages"
import { useUIStore } from "~/stores/ui"

export default function ChannelPage() {
  const { guildId, channelId } = useParams<{ guildId: string; channelId: string }>()
  const navigate = useNavigate()
  const channels = useChannelsStore((state) => (guildId ? state.byGuild[guildId] : undefined))
  const channel = channels?.find((item) => item.id === channelId)
  const user = useAuthStore((state) => state.user)
  const members = useMembersStore((state) => (guildId ? state.byGuild[guildId] : undefined))
  const unavailable = useMessagesStore((state) =>
    channelId ? Boolean(state.byChannel[channelId]?.unavailable) : false,
  )
  const channelMessages = useMessagesStore((state) =>
    channelId ? state.byChannel[channelId]?.messages : undefined,
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
      { replace: true },
    )
  }, [setSearchParams])

  // URL 是选中状态的事实来源：进入路由时同步 ui store
  useEffect(() => {
    if (guildId && channelId) {
      useUIStore.getState().selectChannel(guildId, channelId)
    }
  }, [guildId, channelId])

  // 进入频道拉取最近 50 条；带 around 参数时改走锚点上下文加载
  useEffect(() => {
    if (!channelId) return
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
            void useMessagesStore.getState().loadInitial(channelId).catch(() => undefined)
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
    void useMessagesStore.getState().loadInitial(channelId).catch(() => undefined)
  }, [channelId, around, clearAroundParam])

  // 切频道时重置本页交互态
  useEffect(() => {
    setReplyTo(null)
    setEditingId(null)
  }, [channelId])

  // 正在回复/编辑的消息被删除（本端或远端）时退出对应状态
  useEffect(() => {
    if (replyTo && channelMessages && !channelMessages.some((item) => item.id === replyTo.id)) {
      setReplyTo(null)
    }
    if (editingId && channelMessages && !channelMessages.some((item) => item.id === editingId)) {
      setEditingId(null)
    }
  }, [channelMessages, replyTo, editingId])

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

  // 用户 ID → 显示名（昵称 > 用户名 > ID 片段）
  const resolveName = useCallback(
    (userId: string): string => {
      const member = members?.find((item) => item.user_id === userId)
      if (member) return member.nickname || member.username
      if (userId === user?.id) return user.username
      return `用户${userId.slice(0, 6)}`
    },
    [members, user],
  )

  if (!guildId || !channelId) return null

  // 历史 404：频道不可用空态
  if (unavailable) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <HashIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">{channel?.name ?? "频道"}</span>
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
    const list = useMessagesStore.getState().byChannel[channelId]?.messages ?? []
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
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <HashIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{channelName}</span>
      </header>

      {/* 消息流（key 按频道重挂载，隔离滚动与本地交互态） */}
      <MessageList
        key={channelId}
        channelId={channelId}
        channelName={channelName}
        selfId={user?.id}
        selfName={user?.username ?? "我"}
        resolveName={resolveName}
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
