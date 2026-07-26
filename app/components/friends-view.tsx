// 好友页主内容（多列卡片 + 双击私信 + 右键操作菜单）。
// 由 home（?tab=friends）与 /friends 路由共用，避免仅依赖后加路由导致 404。

import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router"
import {
  AtSignIcon,
  BanIcon,
  CheckIcon,
  HashIcon,
  MailIcon,
  MessageCircleIcon,
  UserPlusIcon,
  UserRoundIcon,
  UsersIcon,
  UserXIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { AvatarWithFrame } from "~/components/cosmetics/avatar-frame"
import { presenceDotClass } from "~/components/nav-user"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "~/components/ui/context-menu"
import { Input } from "~/components/ui/input"
import { ApiError } from "~/lib/api/http"
import type { Relationship } from "~/lib/api/social"
import { copyText } from "~/lib/clipboard"
import {
  loadPublicProfile,
  peekPublicProfile,
} from "~/lib/public-profile-cache"
import {
  nameInitials,
  resolveProfileAssetUrl,
} from "~/lib/user-display"
import { cn } from "~/lib/utils"
import { useCosmeticsStore } from "~/stores/cosmetics"
import { useGuildsStore } from "~/stores/guilds"
import { usePrivateChannelsStore } from "~/stores/private-channels"
import { usePresenceStore } from "~/stores/presence"
import {
  blockedOf,
  friendsOf,
  pendingIncomingOf,
  pendingOutgoingOf,
  useRelationshipsStore,
} from "~/stores/relationships"
import { useUIStore } from "~/stores/ui"

type HomeTab = "online" | "all" | "pending" | "blocked" | "add"

function displayName(rel: Relationship): string {
  return (
    rel.nickname?.trim() ||
    rel.user.display_name?.trim() ||
    rel.user.username
  )
}

function presenceLabel(
  presence: string | undefined,
): string {
  if (presence === "online") return "在线"
  if (presence === "idle") return "闲置"
  if (presence === "dnd") return "勿扰"
  return "离线"
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

/** 从关系数据 / 公开资料缓存解析卡片展示字段 */
function seedFriendCardProfile(userId: string, user: Relationship["user"]) {
  const cached = peekPublicProfile(userId)
  const bio = user.bio?.trim() || cached?.bio?.trim() || undefined
  const banner =
    resolveProfileAssetUrl(user.banner_url) ||
    resolveProfileAssetUrl(cached?.banner) ||
    undefined
  const accent =
    user.accent_color?.trim() || cached?.accent_color?.trim() || undefined
  return { bio, banner, accent }
}

/** 多列好友卡片：双击开私信；右键打开与该用户相关的全部操作；有横幅时展示资料背景 */
function FriendCard({
  rel,
  variant,
  onOpenDm,
}: {
  rel: Relationship
  variant: "friend" | "incoming" | "outgoing" | "blocked"
  onOpenDm?: (userId: string) => void
}) {
  const presence = usePresenceStore((s) => s.statusByUser[rel.user.id])
  // 头像框：只订阅单槽引用（关系响应附带的装扮已写入 cosmetics store 缓存），
  // 无缓存则无框降级，不单独发请求
  const avatarFrame = useCosmeticsStore(
    (s) => s.equippedByUser[rel.user.id]?.avatar_frame,
  )
  const name = displayName(rel)
  const av = resolveProfileAssetUrl(rel.user.avatar_url)
  const userId = rel.user.id
  const username = rel.user.username

  // 签名 / 横幅 / 主题色：关系数据优先，否则拉公开资料（带缓存）
  const [profileExtras, setProfileExtras] = useState(() =>
    seedFriendCardProfile(userId, rel.user),
  )

  useEffect(() => {
    const seeded = seedFriendCardProfile(userId, rel.user)
    setProfileExtras(seeded)
    // 缓存已命中则 seed 已带上；未命中时拉公开资料补全横幅/签名
    if (peekPublicProfile(userId) !== undefined) return

    let cancelled = false
    void loadPublicProfile(userId).then((profile) => {
      if (cancelled || !profile) return
      setProfileExtras((prev) => ({
        bio: prev.bio || profile.bio?.trim() || undefined,
        banner:
          prev.banner ||
          resolveProfileAssetUrl(profile.banner) ||
          undefined,
        accent:
          prev.accent || profile.accent_color?.trim() || undefined,
      }))
    })
    return () => {
      cancelled = true
    }
  }, [userId, rel.user.bio, rel.user.banner_url, rel.user.accent_color])

  const { bio, banner, accent } = profileExtras

  const accept = () => {
    void useRelationshipsStore
      .getState()
      .accept(userId)
      .then(() => toast.success("已接受"))
      .catch((e) => toast.error(errorMessage(e, "失败")))
  }

  const ignoreOrCancel = (okMsg: string) => {
    void useRelationshipsStore
      .getState()
      .ignoreOrCancel(userId)
      .then(() => toast.success(okMsg))
      .catch((e) => toast.error(errorMessage(e, "操作失败")))
  }

  const removeFriend = () => {
    if (!window.confirm(`确定移除好友 ${name}？`)) return
    void useRelationshipsStore
      .getState()
      .removeFriend(userId)
      .then(() => toast.success("已移除好友"))
      .catch((e) => toast.error(errorMessage(e, "移除失败")))
  }

  const blockUser = () => {
    if (!window.confirm(`确定屏蔽 ${name}？`)) return
    void useRelationshipsStore
      .getState()
      .block(userId)
      .then(() => toast.success("已屏蔽"))
      .catch((e) => toast.error(errorMessage(e, "屏蔽失败")))
  }

  const unblockUser = () => {
    void useRelationshipsStore
      .getState()
      .unblock(userId)
      .then(() => toast.success("已解除屏蔽"))
      .catch((e) => toast.error(errorMessage(e, "操作失败")))
  }

  const relationHint =
    variant === "blocked"
      ? "已屏蔽"
      : variant === "incoming"
        ? "收到的好友请求"
        : variant === "outgoing"
          ? "已发出请求"
          : null

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={cn(
          "friend-row group relative flex w-full cursor-default flex-col overflow-hidden text-left outline-none",
          "rounded-2xl border-0",
          // 无横幅时用主题色 / 默认 muted；有横幅时底层仍垫一层，避免透明缝
          banner ? "bg-muted/50" : accent ? "bg-muted/40" : "bg-muted/35",
          "transition-[background-color,transform,box-shadow] duration-150 ease-out",
          "hover:shadow-sm",
          banner ? "hover:bg-muted/60" : "hover:bg-muted/55",
          "focus-visible:ring-2 focus-visible:ring-ring/40",
          "active:scale-[0.99]",
        )}
        style={
          !banner && accent
            ? { background: `color-mix(in oklab, ${accent} 28%, transparent)` }
            : undefined
        }
        onDoubleClick={() => {
          if (variant === "friend" || variant === "incoming" || variant === "outgoing") {
            onOpenDm?.(userId)
          }
        }}
      >
        {/* 整卡资料横幅背景：低透明度 + 遮罩，保证文字可读 */}
        {banner ? (
          <>
            <img
              src={banner}
              alt=""
              aria-hidden
              className="pointer-events-none absolute inset-0 size-full object-cover opacity-[0.28] transition-[opacity,transform] duration-300 ease-out group-hover:scale-[1.02] group-hover:opacity-[0.34]"
              draggable={false}
            />
            {/* 再叠一层半透明底，压住复杂纹理 */}
            <div
              className="pointer-events-none absolute inset-0 bg-background/55 dark:bg-background/60"
              aria-hidden
            />
          </>
        ) : null}

        <div className="relative z-10 flex items-start gap-3 p-3.5">
          <span className="relative size-12 shrink-0">
            {/* 好友头像套装扮头像框；在线点在框之上（z-[3] > 框 z-[2]） */}
            <AvatarWithFrame frame={avatarFrame} sizeClass="size-12">
              <Avatar className="size-12 ring-2 ring-background/80 after:border-0">
                {av ? (
                  <AvatarImage src={av} alt="" className="object-cover" />
                ) : null}
                <AvatarFallback className="bg-muted text-sm font-semibold">
                  {nameInitials(name)}
                </AvatarFallback>
              </Avatar>
            </AvatarWithFrame>
            {/* 在线状态仅用头像角标圆点表示（不透明色） */}
            {variant !== "blocked" ? (
              <span
                className={cn(
                  "absolute -right-0.5 -bottom-0.5 z-[3] size-3.5 rounded-full",
                  "ring-[2.5px] ring-card",
                  presenceDotClass(presence),
                )}
                title={presenceLabel(presence)}
                aria-label={presenceLabel(presence)}
              />
            ) : null}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-snug tracking-tight">
              {name}
            </p>
            <p className="mt-0.5 truncate text-[12px] leading-snug text-muted-foreground">
              @{username}
            </p>
            {relationHint ? (
              <p className="mt-1.5 truncate text-[11px] font-medium text-muted-foreground/90">
                {relationHint}
              </p>
            ) : bio ? (
              <p
                className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground"
                title={bio}
              >
                {bio}
              </p>
            ) : (
              <p className="mt-1.5 truncate text-[11px] text-muted-foreground/55">
                暂无个性签名
              </p>
            )}
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="min-w-48">
        {variant === "friend" ? (
          <>
            <ContextMenuGroup>
              <ContextMenuLabel>快捷操作</ContextMenuLabel>
              <ContextMenuItem onClick={() => onOpenDm?.(userId)}>
                <MessageCircleIcon />
                发送私信
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuLabel>复制</ContextMenuLabel>
              <ContextMenuItem
                onClick={() => void copyText("用户名", username)}
              >
                <UserRoundIcon />
                复制用户名
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => void copyText("显示名", name)}
              >
                <AtSignIcon />
                复制显示名
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => void copyText("提及", `<@${userId}>`)}
              >
                <AtSignIcon />
                复制 @提及
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => void copyText("用户 ID", userId)}
              >
                <HashIcon />
                复制用户 ID
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuLabel>关系</ContextMenuLabel>
              <ContextMenuItem onClick={removeFriend}>
                <UserXIcon />
                移除好友
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" onClick={blockUser}>
                <BanIcon />
                屏蔽
              </ContextMenuItem>
            </ContextMenuGroup>
          </>
        ) : null}

        {variant === "incoming" ? (
          <>
            <ContextMenuGroup>
              <ContextMenuLabel>好友请求</ContextMenuLabel>
              <ContextMenuItem onClick={accept}>
                <CheckIcon />
                接受
              </ContextMenuItem>
              <ContextMenuItem onClick={() => ignoreOrCancel("已忽略")}>
                <XIcon />
                忽略
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onOpenDm?.(userId)}>
                <MailIcon />
                发送私信
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuLabel>复制</ContextMenuLabel>
              <ContextMenuItem
                onClick={() => void copyText("用户名", username)}
              >
                <UserRoundIcon />
                复制用户名
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => void copyText("用户 ID", userId)}
              >
                <HashIcon />
                复制用户 ID
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={blockUser}>
              <BanIcon />
              屏蔽
            </ContextMenuItem>
          </>
        ) : null}

        {variant === "outgoing" ? (
          <>
            <ContextMenuGroup>
              <ContextMenuLabel>好友请求</ContextMenuLabel>
              <ContextMenuItem onClick={() => ignoreOrCancel("已取消")}>
                <XIcon />
                取消请求
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onOpenDm?.(userId)}>
                <MailIcon />
                发送私信
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuLabel>复制</ContextMenuLabel>
              <ContextMenuItem
                onClick={() => void copyText("用户名", username)}
              >
                <UserRoundIcon />
                复制用户名
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => void copyText("用户 ID", userId)}
              >
                <HashIcon />
                复制用户 ID
              </ContextMenuItem>
            </ContextMenuGroup>
          </>
        ) : null}

        {variant === "blocked" ? (
          <>
            <ContextMenuGroup>
              <ContextMenuLabel>屏蔽</ContextMenuLabel>
              <ContextMenuItem onClick={unblockUser}>
                <UserXIcon />
                解除屏蔽
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuLabel>复制</ContextMenuLabel>
              <ContextMenuItem
                onClick={() => void copyText("用户名", username)}
              >
                <UserRoundIcon />
                复制用户名
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => void copyText("用户 ID", userId)}
              >
                <HashIcon />
                复制用户 ID
              </ContextMenuItem>
            </ContextMenuGroup>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}

const cardGridClass =
  "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"

export function FriendsView() {
  const navigate = useNavigate()
  const hasGuilds = useGuildsStore((state) => state.guilds.length > 0)
  const items = useRelationshipsStore((s) => s.items)
  const loaded = useRelationshipsStore((s) => s.loaded)
  const [tab, setTab] = useState<HomeTab>("all")
  const [username, setUsername] = useState("")
  const [busy, setBusy] = useState(false)

  // 进入好友页时清掉具体频道选中，保持私信侧栏可见
  useEffect(() => {
    const ui = useUIStore.getState()
    if (ui.selectedGuildId && ui.selectedGuildId !== "@me") return
    if (ui.selectedChannelId != null || ui.selectedGuildId === "@me") {
      ui.selectGuild(null)
    }
  }, [])

  const openDm = async (userId: string) => {
    try {
      const ch = await usePrivateChannelsStore.getState().openDm(userId)
      useUIStore.getState().selectChannel("@me", ch.id)
      navigate(`/channels/@me/${ch.id}`)
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.code === "PRIVACY_DENIED"
            ? "无法发送私信"
            : error.message
          : "打开私信失败",
      )
    }
  }

  useEffect(() => {
    if (!loaded) {
      void useRelationshipsStore.getState().refresh().catch(() => undefined)
    }
  }, [loaded])

  const friends = useMemo(() => friendsOf(items), [items])
  const incoming = useMemo(() => pendingIncomingOf(items), [items])
  const outgoing = useMemo(() => pendingOutgoingOf(items), [items])
  const blocked = useMemo(() => blockedOf(items), [items])
  const presenceMap = usePresenceStore((s) => s.statusByUser)

  const onlineFriends = useMemo(
    () => friends.filter((f) => Boolean(presenceMap[f.user.id])),
    [friends, presenceMap],
  )

  const sendRequest = async () => {
    const name = username.trim()
    if (!name) return
    setBusy(true)
    try {
      await useRelationshipsStore.getState().sendRequest(name)
      toast.success("好友请求已发送")
      setUsername("")
      setTab("pending")
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.code === "USER_NOT_FOUND"
            ? "找不到该用户"
            : error.code === "PRIVACY_DENIED"
              ? "无法发送好友请求"
              : error.message
          : "发送失败",
      )
    } finally {
      setBusy(false)
    }
  }

  const tabs: { id: HomeTab; label: string; count?: number }[] = [
    { id: "online", label: "在线", count: onlineFriends.length },
    { id: "all", label: "全部", count: friends.length },
    { id: "pending", label: "待处理", count: incoming.length || undefined },
    { id: "blocked", label: "已屏蔽" },
  ]

  const list =
    tab === "online"
      ? onlineFriends
      : tab === "all"
        ? friends
        : tab === "blocked"
          ? blocked
          : []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶栏 */}
      <header className="flex h-12 shrink-0 items-center gap-1 border-0 border-b-0 px-3 shadow-none">
        <UsersIcon className="mr-1 size-4 text-muted-foreground" />
        <span className="mr-2 text-sm font-semibold">好友</span>
        <span className="mx-1" aria-hidden />
        {tabs.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[13px] transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97]",
                active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {t.label}
              {t.count != null && t.count > 0 ? (
                <span
                  className={cn(
                    "ml-1.5 inline-flex min-w-4 justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                    t.id === "pending"
                      ? "bg-red-600 text-white"
                      : "bg-muted-foreground/20 text-muted-foreground",
                  )}
                >
                  {t.count}
                </span>
              ) : null}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setTab("add")}
          className={cn(
            "ml-auto rounded-md px-2.5 py-1 text-[13px] font-medium text-white transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97]",
            tab === "add"
              ? "bg-emerald-600"
              : "bg-emerald-600/90 hover:bg-emerald-600",
          )}
        >
          添加好友
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {tab === "add" && (
          <div className="mx-auto flex max-w-md flex-col gap-4 px-2 py-10">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-balance">
                添加好友
              </h2>
              <p className="mt-1.5 text-[13px] text-muted-foreground text-pretty">
                输入对方的全局用户名发送好友请求。
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                value={username}
                placeholder="用户名"
                maxLength={32}
                className="h-10"
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void sendRequest()
                }}
              />
              <Button
                className="h-10 shrink-0 active:scale-[0.96]"
                disabled={busy || !username.trim()}
                onClick={() => void sendRequest()}
              >
                <UserPlusIcon className="size-4" />
                发送
              </Button>
            </div>
          </div>
        )}

        {tab === "pending" && (
          <div className="flex flex-col gap-6">
            <section>
              <h3 className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                收到的请求 — {incoming.length}
              </h3>
              {incoming.length === 0 ? (
                <p className="px-1 text-[13px] text-muted-foreground">
                  暂无收到的请求
                </p>
              ) : (
                <div className={cardGridClass}>
                  {incoming.map((rel) => (
                    <FriendCard
                      key={rel.id + rel.type}
                      rel={rel}
                      variant="incoming"
                      onOpenDm={(id) => void openDm(id)}
                    />
                  ))}
                </div>
              )}
            </section>
            <section>
              <h3 className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                已发出 — {outgoing.length}
              </h3>
              {outgoing.length === 0 ? (
                <p className="px-1 text-[13px] text-muted-foreground">
                  暂无发出的请求
                </p>
              ) : (
                <div className={cardGridClass}>
                  {outgoing.map((rel) => (
                    <FriendCard
                      key={rel.id + rel.type}
                      rel={rel}
                      variant="outgoing"
                      onOpenDm={(id) => void openDm(id)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {(tab === "online" || tab === "all") && (
          <>
            {list.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
                  <UsersIcon className="size-7 text-muted-foreground/50" />
                </div>
                <p className="text-base font-semibold">
                  {tab === "online" ? "没有在线好友" : "还没有好友"}
                </p>
                <p className="max-w-xs text-[13px] text-muted-foreground text-pretty">
                  通过「添加好友」发送请求；对方接受后会出现在这里。
                  <br />
                  双击卡片打开私信，右键查看更多操作。
                </p>
                <Button
                  size="sm"
                  className="mt-1 active:scale-[0.96]"
                  onClick={() => setTab("add")}
                >
                  <UserPlusIcon className="size-3.5" />
                  添加好友
                </Button>
              </div>
            ) : (
              <>
                <h3 className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {tab === "online" ? "在线" : "全部好友"} — {list.length}
                </h3>
                <div className={cardGridClass}>
                  {list.map((rel) => (
                    <FriendCard
                      key={rel.id + rel.type}
                      rel={rel}
                      variant="friend"
                      onOpenDm={(id) => void openDm(id)}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {tab === "blocked" && (
          <>
            {blocked.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                <UserXIcon className="size-10 text-muted-foreground/30" />
                <p className="text-base font-semibold">屏蔽列表为空</p>
                <p className="text-[13px] text-muted-foreground">
                  在好友卡片上右键可屏蔽用户
                </p>
              </div>
            ) : (
              <div className={cardGridClass}>
                {blocked.map((rel) => (
                  <FriendCard
                    key={rel.id + rel.type}
                    rel={rel}
                    variant="blocked"
                  />
                ))}
              </div>
            )}
          </>
        )}

        {!hasGuilds && tab !== "add" && (
          <p className="mt-10 text-center text-[11px] text-muted-foreground">
            也可以先从左上角创建或加入服务器开始使用。
          </p>
        )}
      </div>
    </div>
  )
}
