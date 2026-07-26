// Discord 风格私信侧栏：好友入口 + 私信列表 + 消息请求折叠。
// 在 Home / 好友页 / @me 私信会话时显示。

import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router"
import {
  CheckCheckIcon,
  ChevronDownIcon,
  LogOutIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  StickerIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { AvatarWithFrame } from "~/components/cosmetics/avatar-frame"
import { presenceDotClass } from "~/components/nav-user"
import { FRIENDS_PATH, isFriendsLocation } from "~/lib/friends-route"
import { SHOP_PATH, isShopLocation } from "~/lib/shop-route"
import { STICKERS_PATH, isStickersLocation } from "~/lib/stickers-route"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
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
import { Input } from "~/components/ui/input"
import { PanelResizeHandle } from "~/components/panel-resize-handle"
import { VoicePanel } from "~/components/voice-panel"
import type { PrivateChannel } from "~/lib/api/social"
import { isGroupDmSystemMessage } from "~/lib/api/types"
import { ApiError } from "~/lib/api/http"
import { dragWindowOnMouseDown } from "~/lib/window-drag"
import {
  nameInitials,
  resolveProfileAssetUrl,
} from "~/lib/user-display"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useCosmeticsStore } from "~/stores/cosmetics"
import {
  dmDisplayName,
  sortPrivateChannels,
  usePrivateChannelsStore,
} from "~/stores/private-channels"
import { usePresenceStore } from "~/stores/presence"
import {
  channelUnreadCount,
  formatUnreadBadge,
  useReadStatesStore,
} from "~/stores/read-states"
import {
  friendsOf,
  pendingIncomingOf,
  useRelationshipsStore,
} from "~/stores/relationships"
import { useUIStore } from "~/stores/ui"

function peerOf(ch: PrivateChannel, selfId?: string) {
  return ch.recipients.find((r) => r.id !== selfId) ?? ch.recipients[0]
}

function DmRow({
  ch,
  selfId,
  active,
  onOpen,
  onClose,
}: {
  ch: PrivateChannel
  selfId?: string
  active: boolean
  onOpen: () => void
  onClose: () => void
}) {
  const unread = useReadStatesStore((s) => channelUnreadCount(s, ch.id))
  const mentions = useReadStatesStore((s) => s.mentionsByChannel[ch.id] ?? 0)
  const peer = peerOf(ch, selfId)
  const peerPresence = usePresenceStore((s) =>
    peer?.id ? s.statusByUser[peer.id] : undefined,
  )
  // 对方头像框：只订阅单槽引用；无缓存则无框降级，不单独发请求
  const peerAvatarFrame = useCosmeticsStore((s) =>
    peer?.id ? s.equippedByUser[peer.id]?.avatar_frame : undefined,
  )
  const title = dmDisplayName(ch, selfId)
  const avatarSrc =
    ch.type === "GROUP_DM"
      ? undefined
      : resolveProfileAssetUrl(peer?.avatar_url)

  const preview = (() => {
    const lm = ch.last_message
    if (!lm) return null
    if (ch.message_request) return "消息请求"
    if (isGroupDmSystemMessage(lm.type)) return lm.content || "系统消息"
    const author =
      lm.author_id === selfId
        ? "你"
        : ch.recipients.find((r) => r.id === lm.author_id)?.display_name?.trim() ||
          ch.recipients.find((r) => r.id === lm.author_id)?.username ||
          ""
    const body = lm.content?.trim() || "发送了一条消息"
    if (ch.type === "GROUP_DM" && author) return `${author}: ${body}`
    if (lm.author_id === selfId) return `你: ${body}`
    return body
  })()

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={cn(
          "group dm-row relative flex w-full min-h-12 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none",
          "transition-[background-color] duration-150 ease-out",
          "focus-visible:ring-2 focus-visible:ring-ring/40",
          active
            ? "bg-muted text-foreground"
            : "text-foreground hover:bg-muted/70",
        )}
        onClick={onOpen}
      >
        <span className="relative size-9 shrink-0">
          {ch.type === "GROUP_DM" ? (
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-full text-muted-foreground",
                "bg-black/[0.06] dark:bg-white/10",
                "outline outline-1 outline-black/10 dark:outline-white/10",
              )}
            >
              <UsersIcon className="size-4" />
            </span>
          ) : (
            /* 1:1 私信：对方头像套装扮头像框（群聊为群图标不套） */
            <AvatarWithFrame frame={peerAvatarFrame} sizeClass="size-9">
              <Avatar className="size-9 after:border-0">
                {avatarSrc ? (
                  <AvatarImage
                    src={avatarSrc}
                    alt=""
                    className="object-cover"
                  />
                ) : null}
                <AvatarFallback className="text-xs font-medium">
                  {nameInitials(title)}
                </AvatarFallback>
              </Avatar>
            </AvatarWithFrame>
          )}
          {ch.type !== "GROUP_DM" ? (
            <span
              title={peerPresence ? "在线状态" : "离线"}
              className={cn(
                // z-[3]：在线点保持压在头像框（z-[2]）之上
                "absolute -right-0.5 -bottom-0.5 z-[3] size-2.5 rounded-full ring-2 ring-card",
                presenceDotClass(peerPresence),
              )}
            />
          ) : null}
        </span>

        <span className="min-w-0 flex-1 py-0.5">
          <span
            className={cn(
              "block truncate text-[13px] leading-snug text-foreground antialiased",
              unread > 0 || active ? "font-semibold" : "font-medium",
            )}
          >
            {title}
          </span>
          {preview ? (
            <span
              className={cn(
                "mt-0.5 block truncate text-[12px] leading-snug antialiased",
                ch.message_request
                  ? "font-medium text-amber-600 dark:text-amber-400"
                  : unread > 0
                    ? "text-foreground/80"
                    : "text-muted-foreground",
              )}
            >
              {preview}
            </span>
          ) : null}
        </span>

        {mentions > 0 ? (
          <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white tabular-nums">
            {formatUnreadBadge(mentions)}
          </span>
        ) : unread > 0 ? (
          <span
            className="size-2 shrink-0 rounded-full bg-primary"
            aria-label={`${unread} 条未读`}
          />
        ) : null}
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={onOpen}>打开会话</ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            useReadStatesStore.getState().ack(ch.id)
            toast.success("已标为已读")
          }}
        >
          <CheckCheckIcon className="size-3.5" />
          标为已读
        </ContextMenuItem>
        {ch.message_request ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() =>
                void usePrivateChannelsStore
                  .getState()
                  .acceptRequest(ch.id)
                  .then(() => toast.success("已接受"))
                  .catch((e) =>
                    toast.error(e instanceof ApiError ? e.message : "失败"),
                  )
              }
            >
              接受请求
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() =>
                void usePrivateChannelsStore
                  .getState()
                  .rejectRequest(ch.id)
                  .then(() => toast.success("已忽略"))
              }
            >
              忽略
            </ContextMenuItem>
          </>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onClose}>
          {ch.type === "GROUP_DM" ? (
            <>
              <LogOutIcon className="size-3.5" />
              离开群组
            </>
          ) : (
            <>
              <XIcon className="size-3.5" />
              关闭私信
            </>
          )}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function DmSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const selfId = useAuthStore((s) => s.user?.id)
  const channels = usePrivateChannelsStore((s) => s.channels)
  const selectedChannelId = useUIStore((s) => s.selectedChannelId)
  const channelListWidth = useUIStore((s) => s.channelListWidth)
  const setChannelListWidth = useUIStore((s) => s.setChannelListWidth)
  // 勿在 selector 内 filter/map 出新数组，否则会触发无限重渲染
  const relItems = useRelationshipsStore((s) => s.items)
  const friends = useMemo(() => friendsOf(relItems), [relItems])
  const pendingCount = useMemo(
    () => pendingIncomingOf(relItems).length,
    [relItems],
  )

  const [groupOpen, setGroupOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [groupName, setGroupName] = useState("")
  const [groupBusy, setGroupBusy] = useState(false)
  const [requestsOpen, setRequestsOpen] = useState(true)
  const [filter, setFilter] = useState("")

  useEffect(() => {
    void usePrivateChannelsStore.getState().refresh().catch(() => undefined)
    if (!useRelationshipsStore.getState().loaded) {
      void useRelationshipsStore.getState().refresh().catch(() => undefined)
    }
  }, [])

  const requests = useMemo(
    () => sortPrivateChannels(channels.filter((c) => c.message_request)),
    [channels],
  )
  const normal = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return sortPrivateChannels(
      channels.filter((c) => {
        if (c.message_request) return false
        if (!q) return true
        return dmDisplayName(c, selfId).toLowerCase().includes(q)
      }),
    )
  }, [channels, filter, selfId])

  const openFriends = () => {
    useUIStore.getState().selectGuild(null)
    // 走 index 路由 + query，避免仅注册在后加 /friends 上时热更新未同步导致 404
    navigate(FRIENDS_PATH)
  }

  const openStickers = () => {
    useUIStore.getState().selectGuild(null)
    navigate(STICKERS_PATH)
  }

  const openShop = () => {
    useUIStore.getState().selectGuild(null)
    navigate(SHOP_PATH)
  }

  /** 关闭会话后回到私信落地页（非好友页） */
  const openDmHome = () => {
    useUIStore.getState().selectGuild(null)
    navigate("/")
  }

  const openCh = (channelId: string) => {
    useUIStore.getState().selectChannel("@me", channelId)
    navigate(`/channels/@me/${channelId}`)
  }

  const closeCh = async (ch: PrivateChannel) => {
    try {
      if (ch.type === "GROUP_DM") {
        await usePrivateChannelsStore.getState().leaveGroup(ch.id)
        toast.success("已离开群组")
      } else {
        await usePrivateChannelsStore.getState().closeChannel(ch.id)
        toast.success("已关闭私信")
      }
      if (selectedChannelId === ch.id) {
        openDmHome()
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败")
    }
  }

  const createGroup = async () => {
    if (picked.length < 1) return
    setGroupBusy(true)
    try {
      const ch = await usePrivateChannelsStore
        .getState()
        .createGroup(picked, groupName)
      setGroupOpen(false)
      setPicked([])
      setGroupName("")
      openCh(ch.id)
      toast.success("群组已创建")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "创建失败")
    } finally {
      setGroupBusy(false)
    }
  }

  const friendsActive = isFriendsLocation(location)
  const stickersActive = isStickersLocation(location)
  const shopActive = isShopLocation(location)

  return (
    <aside
      className="relative flex shrink-0 flex-col gap-2 overflow-visible bg-transparent"
      style={{ width: channelListWidth }}
      onMouseDown={dragWindowOnMouseDown}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white text-foreground dark:bg-card dark:text-card-foreground">
        {/* 顶栏：搜索 + 新建 */}
        <div className="flex shrink-0 items-center gap-1.5 px-2.5 py-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/70"
              aria-hidden
            />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="查找私信"
              className="h-8 border-0 bg-muted/70 py-0 pr-2.5 pl-8 text-[13px] shadow-none focus-visible:ring-1"
              aria-label="查找私信"
            />
          </div>
          <button
            type="button"
            title="创建群组私信"
            aria-label="创建群组私信"
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground",
              "transition-[background-color,color,transform] duration-150 ease-out",
              "hover:bg-muted hover:text-foreground active:scale-[0.96]",
            )}
            onClick={() => {
              if (!useRelationshipsStore.getState().loaded) {
                void useRelationshipsStore
                  .getState()
                  .refresh()
                  .catch(() => undefined)
              }
              setGroupOpen(true)
            }}
          >
            <PlusIcon className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {/* 好友入口 */}
          <button
            type="button"
            onClick={openFriends}
            className={cn(
              "mb-1 flex min-h-12 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px]",
              "transition-[background-color] duration-150 ease-out",
              friendsActive
                ? "bg-muted font-semibold text-foreground"
                : "font-medium text-foreground hover:bg-muted/70",
            )}
          >
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-full",
                friendsActive
                  ? "bg-primary/15 text-primary"
                  : "bg-black/[0.06] text-muted-foreground dark:bg-white/10",
              )}
            >
              <UsersIcon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">好友</span>
            {pendingCount > 0 ? (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white tabular-nums">
                {formatUnreadBadge(pendingCount)}
              </span>
            ) : null}
          </button>

          {/* 装扮商城入口 */}
          <button
            type="button"
            onClick={openShop}
            className={cn(
              "mb-1 flex min-h-12 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px]",
              "transition-[background-color] duration-150 ease-out",
              shopActive
                ? "bg-muted font-semibold text-foreground"
                : "font-medium text-foreground hover:bg-muted/70",
            )}
          >
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-full",
                shopActive
                  ? "bg-primary/15 text-primary"
                  : "bg-black/[0.06] text-muted-foreground dark:bg-white/10",
              )}
            >
              <SparklesIcon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">装扮商城</span>
          </button>

          {/* 贴图库入口 */}
          <button
            type="button"
            onClick={openStickers}
            className={cn(
              "mb-1 flex min-h-12 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px]",
              "transition-[background-color] duration-150 ease-out",
              stickersActive
                ? "bg-muted font-semibold text-foreground"
                : "font-medium text-foreground hover:bg-muted/70",
            )}
          >
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-full",
                stickersActive
                  ? "bg-primary/15 text-primary"
                  : "bg-black/[0.06] text-muted-foreground dark:bg-white/10",
              )}
            >
              <StickerIcon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">贴图库</span>
          </button>

          {/* 消息请求折叠 */}
          {requests.length > 0 ? (
            <div className="mt-2 mb-1">
              <button
                type="button"
                onClick={() => setRequestsOpen((v) => !v)}
                className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground"
              >
                <ChevronDownIcon
                  className={cn(
                    "size-3 transition-transform duration-200 ease-out",
                    !requestsOpen && "-rotate-90",
                  )}
                />
                消息请求
                <span className="ml-auto tabular-nums text-amber-600 dark:text-amber-400">
                  {requests.length}
                </span>
              </button>
              {requestsOpen ? (
                <div className="flex flex-col gap-0.5">
                  {requests.map((ch) => (
                    <DmRow
                      key={ch.id}
                      ch={ch}
                      selfId={selfId}
                      active={ch.id === selectedChannelId}
                      onOpen={() => openCh(ch.id)}
                      onClose={() => void closeCh(ch)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 私信列表 */}
          <p className="mt-2.5 mb-1 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground/90">
            私信
          </p>
          {normal.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-[13px] text-muted-foreground">暂无会话</p>
              <p className="mt-1 text-[11px] text-muted-foreground/80">
                从右上角好友页发起私信
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {normal.map((ch) => (
                <DmRow
                  key={ch.id}
                  ch={ch}
                  selfId={selfId}
                  active={ch.id === selectedChannelId}
                  onOpen={() => openCh(ch.id)}
                  onClose={() => void closeCh(ch)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <VoicePanel />

      {/* 创建群组 — 紧凑好友选择器 */}
      <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
        <DialogContent className="gap-3 sm:max-w-sm">
          <DialogHeader className="gap-1">
            <DialogTitle className="text-base">创建群组私信</DialogTitle>
            <DialogDescription className="text-[13px]">
              选择好友（最多 9 人）
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="群名称（可选）"
            value={groupName}
            maxLength={100}
            onChange={(e) => setGroupName(e.target.value)}
            className="h-9"
          />
          <div className="max-h-52 overflow-y-auto rounded-xl bg-muted/40 p-1 ring-1 ring-black/5 dark:ring-white/10">
            {friends.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                还没有好友
              </p>
            ) : (
              friends.map((rel) => {
                const checked = picked.includes(rel.user.id)
                const full = !checked && picked.length >= 9
                const name =
                  rel.nickname?.trim() ||
                  rel.user.display_name?.trim() ||
                  rel.user.username
                const av = resolveProfileAssetUrl(rel.user.avatar_url)
                return (
                  <label
                    key={rel.user.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px]",
                      "transition-colors duration-150 hover:bg-background/80",
                      checked && "bg-background shadow-sm",
                      full && "pointer-events-none opacity-40",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 accent-primary"
                      checked={checked}
                      disabled={full}
                      onChange={() => {
                        setPicked((prev) =>
                          checked
                            ? prev.filter((id) => id !== rel.user.id)
                            : [...prev, rel.user.id],
                        )
                      }}
                    />
                    <Avatar className="size-7 after:border-0">
                      {av ? (
                        <AvatarImage src={av} alt="" className="object-cover" />
                      ) : null}
                      <AvatarFallback className="text-[10px]">
                        {nameInitials(name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {name}
                    </span>
                  </label>
                )
              })
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setGroupOpen(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              disabled={groupBusy || picked.length < 1}
              className="min-w-20 active:scale-[0.96]"
              onClick={() => void createGroup()}
            >
              <UserPlusIcon className="size-3.5" />
              创建
              {picked.length > 0 ? (
                <span className="tabular-nums">· {picked.length}</span>
              ) : null}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PanelResizeHandle
        edge="end"
        width={channelListWidth}
        onWidthChange={setChannelListWidth}
        label="调整私信列表宽度"
      />
    </aside>
  )
}
