// 用户资料气泡：悬停显示名称，点击打开精简资料卡（右上角添加好友 / 更多）。

import { useEffect, useState, type ReactNode } from "react"
import { useNavigate } from "react-router"
import {
  BanIcon,
  MailIcon,
  MoreHorizontalIcon,
  UserPlusIcon,
  UserRoundIcon,
  UserXIcon,
} from "lucide-react"
import { toast } from "sonner"

import { presenceDotClass } from "~/components/nav-user"
import { AvatarWithFrame } from "~/components/cosmetics/avatar-frame"
import { ProfileCardChrome } from "~/components/cosmetics/profile-decorations"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip"
import { ApiError } from "~/lib/api/http"
import type { PublicUserProfile } from "~/lib/api/types"
import { getPublicProfile } from "~/lib/api/users"
import {
  nameInitials,
  resolveProfileAssetUrl,
} from "~/lib/user-display"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useCosmeticsStore } from "~/stores/cosmetics"
import { usePresenceStore } from "~/stores/presence"
import { usePrivateChannelsStore } from "~/stores/private-channels"
import {
  blockedOf,
  friendsOf,
  useRelationshipsStore,
} from "~/stores/relationships"
import { useUIStore } from "~/stores/ui"

function presenceLabel(status: string | undefined): string {
  switch (status) {
    case "online":
      return "在线"
    case "idle":
      return "闲置"
    case "dnd":
      return "勿扰"
    case "invisible":
      return "隐身"
    default:
      return "离线"
  }
}

export type UserProfilePopoverProps = {
  userId: string
  /** 本地已解析的显示名（拉取公开资料前的兜底） */
  displayName: string
  /** 本地已解析的头像 URL */
  avatarUrl?: string
  /** 悬停提示文案，默认 displayName */
  tooltip?: string
  /** 自定义触发器；默认渲染小头像 */
  children?: ReactNode
  className?: string
  side?: "top" | "bottom" | "left" | "right"
}

export function UserProfilePopover({
  userId,
  displayName,
  avatarUrl,
  tooltip,
  children,
  className,
  side = "top",
}: UserProfilePopoverProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [profile, setProfile] = useState<PublicUserProfile | null>(null)
  const navigate = useNavigate()
  const presence = usePresenceStore((s) => s.statusByUser[userId])
  const selfId = useAuthStore((s) => s.user?.id)
  // 装扮：订阅 store（本人走 loadout，他人走 equippedByUser 缓存），
  // COSMETIC_LOADOUT_UPDATE 事件实时生效；成员列表已缓存的 listMode 数据可先渲染减少闪现
  const cosmeticsSlots = useCosmeticsStore(
    (s) =>
      (userId === selfId ? s.loadout : s.equippedByUser[userId]) ?? {},
  )
  const avatarFrame = cosmeticsSlots.avatar_frame
  const profileBorder = cosmeticsSlots.profile_border
  const profileEffect = cosmeticsSlots.profile_effect
  const relItems = useRelationshipsStore((s) => s.items)
  const isFriend = friendsOf(relItems).some((r) => r.user.id === userId)
  const isBlocked = blockedOf(relItems).some((r) => r.user.id === userId)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void getPublicProfile(userId)
      .then((data) => {
        if (cancelled) return
        setProfile(data)
        // 公开资料附带的全量装扮写入 store 缓存，供本卡与其他入口复用
        if (data.cosmetics) {
          useCosmeticsStore.getState().setEquippedForUser(userId, data.cosmetics)
        }
      })
      .catch(() => {
        if (!cancelled) setProfile(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, userId])

  const name =
    profile?.display_name?.trim() ||
    displayName ||
    profile?.username ||
    "用户"
  const username = profile?.username
  const resolvedAvatar =
    resolveProfileAssetUrl(profile?.avatar) || avatarUrl
  const banner = resolveProfileAssetUrl(profile?.banner)
  const bio = profile?.bio?.trim()
  const tip = tooltip ?? displayName

  const openDm = () => {
    void usePrivateChannelsStore
      .getState()
      .openDm(userId)
      .then((ch) => {
        useUIStore.getState().selectChannel("@me", ch.id)
        navigate(`/channels/@me/${ch.id}`)
        setOpen(false)
      })
      .catch((e) =>
        toast.error(
          e instanceof ApiError
            ? e.code === "PRIVACY_DENIED"
              ? "无法发送私信"
              : e.message
            : "打开私信失败",
        ),
      )
  }

  const addFriend = () => {
    void useRelationshipsStore
      .getState()
      .sendRequest({ user_id: userId })
      .then(() => toast.success("好友请求已发送"))
      .catch((e) =>
        toast.error(
          e instanceof ApiError
            ? e.code === "PRIVACY_DENIED"
              ? "无法发送好友请求"
              : e.code === "RELATIONSHIP_STATE_CONFLICT"
                ? "已存在关系"
                : e.message
            : "发送失败",
        ),
      )
  }

  const triggerInner = children ?? (
    <span className="relative inline-flex size-5 shrink-0">
      <Avatar className="size-5 rounded-full after:rounded-full after:border-0">
        {avatarUrl ? (
          <AvatarImage
            src={avatarUrl}
            alt=""
            className="rounded-full object-cover"
          />
        ) : null}
        <AvatarFallback className="rounded-full text-[9px] font-semibold">
          {nameInitials(displayName)}
        </AvatarFallback>
      </Avatar>
    </span>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              className={cn(
                "inline-flex shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0 outline-none",
                "transition-opacity hover:opacity-90",
                "focus-visible:ring-2 focus-visible:ring-ring/50",
                className,
              )}
              aria-label={`查看 ${displayName} 的资料`}
            />
          }
        >
          {triggerInner}
        </TooltipTrigger>
        {/* 资料卡打开时隐藏悬停名，避免叠层 */}
        {!open ? (
          <TooltipContent side="top" sideOffset={6}>
            {tip}
          </TooltipContent>
        ) : null}
      </Tooltip>

      <PopoverContent
        side={side}
        sideOffset={8}
        align="start"
        className="w-64 gap-0 overflow-hidden rounded-2xl p-0 shadow-xl"
      >
        {/* 装扮：资料卡边框 + 内特效（compact 档），打开时播放特效音频 */}
        <ProfileCardChrome
          border={profileBorder}
          effect={profileEffect}
          size="compact"
          playAudio={open}
          className="rounded-2xl"
        >
        <div className="relative">
          {banner ? (
            <img
              src={banner}
              alt=""
              className="h-16 w-full object-cover"
              draggable={false}
            />
          ) : (
            <div
              className="h-16 bg-gradient-to-br from-sky-500/70 via-violet-500/60 to-fuchsia-500/50"
              style={
                profile?.accent_color
                  ? { background: profile.accent_color }
                  : undefined
              }
            />
          )}

          {/* 右上角：添加好友 + 更多 */}
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
            {!isFriend && !isBlocked ? (
              <button
                type="button"
                title="添加好友"
                aria-label="添加好友"
                className="flex size-8 items-center justify-center rounded-full bg-black/40 text-white shadow-sm backdrop-blur-md transition-colors hover:bg-black/55"
                onClick={() => void addFriend()}
              >
                <UserPlusIcon className="size-4" />
              </button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger
                title="更多"
                aria-label="更多操作"
                className="flex size-8 items-center justify-center rounded-full bg-black/40 text-white shadow-sm backdrop-blur-md outline-none transition-colors hover:bg-black/55 focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <MoreHorizontalIcon className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom" className="min-w-44">
                <DropdownMenuItem onClick={openDm}>
                  <MailIcon />
                  发送私信
                </DropdownMenuItem>
                {username ? (
                  <DropdownMenuItem
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(username)
                        .then(() => toast.success("已复制用户名"))
                        .catch(() => toast.error("复制失败"))
                    }}
                  >
                    <UserRoundIcon />
                    复制用户名
                  </DropdownMenuItem>
                ) : null}
                {isFriend ? (
                  <DropdownMenuItem
                    onClick={() => {
                      void useRelationshipsStore
                        .getState()
                        .removeFriend(userId)
                        .then(() => toast.success("已移除好友"))
                        .catch((e) =>
                          toast.error(
                            e instanceof ApiError ? e.message : "移除失败",
                          ),
                        )
                    }}
                  >
                    <UserXIcon />
                    移除好友
                  </DropdownMenuItem>
                ) : null}
                {isBlocked ? (
                  <DropdownMenuItem
                    onClick={() => {
                      void useRelationshipsStore
                        .getState()
                        .unblock(userId)
                        .then(() => toast.success("已解除屏蔽"))
                    }}
                  >
                    <UserXIcon />
                    解除屏蔽
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        if (!window.confirm(`确定屏蔽 ${name}？`)) return
                        void useRelationshipsStore
                          .getState()
                          .block(userId)
                          .then(() => toast.success("已屏蔽"))
                      }}
                    >
                      <BanIcon />
                      屏蔽
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="absolute -bottom-7 left-3">
            <span className="relative block size-14">
              <AvatarWithFrame frame={avatarFrame} sizeClass="size-14">
                <Avatar className="size-14 rounded-full ring-4 ring-popover after:rounded-full after:border-0">
                  {resolvedAvatar ? (
                    <AvatarImage
                      src={resolvedAvatar}
                      alt=""
                      className="rounded-full object-cover"
                    />
                  ) : null}
                  <AvatarFallback className="rounded-full text-lg font-semibold">
                    {nameInitials(name)}
                  </AvatarFallback>
                </Avatar>
              </AvatarWithFrame>
              {/* presence 点保持在头像框外层，z 序压过框（参照 member-panel） */}
              <span
                className={cn(
                  "absolute -right-0.5 -bottom-0.5 z-[3] size-3.5 rounded-full ring-[3px] ring-popover",
                  presenceDotClass(presence),
                )}
                title={presenceLabel(presence)}
              />
            </span>
          </div>
        </div>

        <div className="mt-9 px-3 pb-3">
          <p className="truncate text-base leading-tight font-semibold">
            {name}
          </p>
          {username ? (
            <p className="truncate text-[12px] text-muted-foreground">
              @{username}
            </p>
          ) : null}
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                presenceDotClass(presence),
              )}
            />
            {presenceLabel(presence)}
            {isFriend ? " · 好友" : isBlocked ? " · 已屏蔽" : null}
            {profile?.activity_level && profile.activity_level > 0
              ? ` · Lv.${profile.activity_level}`
              : null}
            {loading ? " · 加载中…" : null}
          </p>
          {bio ? (
            <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-foreground/90">
              {bio}
            </p>
          ) : null}
        </div>
        </ProfileCardChrome>
      </PopoverContent>
    </Popover>
  )
}
