// Discord 风格顶栏收件箱：紧凑列表 + 行内操作 + 角标动效。

import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import {
  BellIcon,
  CheckIcon,
  ShieldAlertIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover"
import { ApiError } from "~/lib/api/http"
import type { NotificationItem } from "~/lib/api/social"
import { FRIENDS_PATH } from "~/lib/friends-route"
import { cn } from "~/lib/utils"
import { useNotificationsStore } from "~/stores/notifications-inbox"
import { useRelationshipsStore } from "~/stores/relationships"
import { useUIStore } from "~/stores/ui"

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const diff = Date.now() - t
  const min = Math.floor(diff / 60_000)
  if (min < 1) return "刚刚"
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} 天前`
  return new Date(iso).toLocaleDateString()
}

function payloadUser(payload: Record<string, unknown>): {
  id?: string
  username?: string
  display_name?: string
} {
  const user = payload.user as Record<string, unknown> | undefined
  if (user && typeof user === "object") {
    return {
      id: typeof user.id === "string" ? user.id : undefined,
      username: typeof user.username === "string" ? user.username : undefined,
      display_name:
        typeof user.display_name === "string" ? user.display_name : undefined,
    }
  }
  return {
    id: typeof payload.user_id === "string" ? payload.user_id : undefined,
    username:
      typeof payload.username === "string" ? payload.username : undefined,
    display_name:
      typeof payload.display_name === "string"
        ? payload.display_name
        : undefined,
  }
}

function notifTitle(item: NotificationItem): string {
  const u = payloadUser(item.payload)
  const name = u.display_name || u.username || "某人"
  switch (item.type) {
    case "FRIEND_REQUEST":
      return `${name} 请求添加你为好友`
    case "FRIEND_ACCEPT":
      return `${name} 接受了你的好友请求`
    case "GUILD_MODERATION":
      return (
        (typeof item.payload.title === "string" && item.payload.title) ||
        "服务器管理通知"
      )
    case "SYSTEM_ANNOUNCE":
      return (
        (typeof item.payload.title === "string" && item.payload.title) ||
        "系统公告"
      )
    case "ACCOUNT_SECURITY":
      return "账号安全提醒"
    default:
      return "通知"
  }
}

function notifIcon(type: string) {
  switch (type) {
    case "FRIEND_REQUEST":
    case "FRIEND_ACCEPT":
      return (
        <span className="flex size-8 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <UserPlusIcon className="size-3.5" />
        </span>
      )
    case "GUILD_MODERATION":
    case "ACCOUNT_SECURITY":
      return (
        <span className="flex size-8 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <ShieldAlertIcon className="size-3.5" />
        </span>
      )
    default:
      return (
        <span className="flex size-8 items-center justify-center rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-400">
          <BellIcon className="size-3.5" />
        </span>
      )
  }
}

function NotificationRow({ item }: { item: NotificationItem }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const user = payloadUser(item.payload)

  const accept = async () => {
    if (!user.id) return
    setBusy(true)
    try {
      await useRelationshipsStore.getState().accept(user.id)
      toast.success("已接受好友请求")
      void useNotificationsStore.getState().remove(item.id)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败")
    } finally {
      setBusy(false)
    }
  }

  const ignore = async () => {
    if (!user.id) return
    setBusy(true)
    try {
      await useRelationshipsStore.getState().ignoreOrCancel(user.id)
      void useNotificationsStore.getState().remove(item.id)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        "group relative flex gap-2.5 border-b px-3 py-2.5 last:border-0",
        "transition-colors duration-150",
        !item.read && "bg-primary/[0.04]",
      )}
    >
      {notifIcon(item.type)}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug font-medium">{notifTitle(item)}</p>
        {typeof item.payload.body === "string" && item.payload.body ? (
          <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">
            {item.payload.body}
          </p>
        ) : null}
        <p
          className="mt-1 text-[11px] text-muted-foreground/80 tabular-nums"
          title={item.created_at}
        >
          {relativeTime(item.created_at)}
        </p>
        {item.type === "FRIEND_REQUEST" && user.id ? (
          <div className="mt-2 flex gap-1.5">
            <Button
              size="sm"
              className="h-7 px-2.5 text-[12px] active:scale-[0.96]"
              disabled={busy}
              onClick={() => void accept()}
            >
              <CheckIcon className="size-3" />
              接受
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-[12px]"
              disabled={busy}
              onClick={() => void ignore()}
            >
              忽略
            </Button>
          </div>
        ) : null}
        {item.type === "FRIEND_ACCEPT" ? (
          <button
            type="button"
            className="mt-1.5 text-[12px] text-primary transition-opacity hover:opacity-80"
            onClick={() => {
              useUIStore.getState().selectGuild(null)
              navigate(FRIENDS_PATH)
            }}
          >
            查看好友
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="删除通知"
        className={cn(
          "absolute top-1.5 right-1.5 flex size-8 items-center justify-center rounded-md text-muted-foreground",
          "opacity-70 transition-[opacity,background-color,color] duration-150",
          "hover:bg-muted hover:text-foreground hover:opacity-100",
          "group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40",
        )}
        onClick={() =>
          void useNotificationsStore
            .getState()
            .remove(item.id)
            .catch(() => undefined)
        }
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  )
}

export function NotificationsInboxButton({
  className,
}: {
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const items = useNotificationsStore((s) => s.items)
  const unread = useNotificationsStore((s) => s.unreadCount)
  const hasMore = useNotificationsStore((s) => s.hasMore)

  useEffect(() => {
    if (!open) return
    void useNotificationsStore
      .getState()
      .refresh()
      .then(() => useNotificationsStore.getState().ackAll())
      .catch(() => undefined)
  }, [open])

  const badge = unread > 0 ? (unread > 99 ? "99+" : String(unread)) : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={badge ? `通知，${badge} 条未读` : "通知"}
        className={cn(
          "relative flex size-8 items-center justify-center rounded-lg text-muted-foreground outline-none",
          "transition-[background-color,color,transform] duration-150 ease-out",
          "hover:bg-muted hover:text-foreground active:scale-[0.96]",
          "focus-visible:ring-2 focus-visible:ring-ring/50",
          className,
        )}
      >
        <BellIcon className="size-4" />
        {/* transitions-dev notification badge */}
        <span className="t-badge" data-open={badge ? "true" : "false"}>
          {badge ? (
            <span className="t-badge-dot tabular-nums">{badge}</span>
          ) : null}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="w-[min(100vw-1rem,22rem)] gap-0 overflow-hidden p-0 shadow-lg"
      >
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <span className="text-sm font-semibold">收件箱</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[12px]"
            onClick={() =>
              void useNotificationsStore
                .getState()
                .ackAll()
                .catch(() => undefined)
            }
          >
            全部已读
          </Button>
        </div>
        <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
                <BellIcon className="size-5 text-muted-foreground/40" />
              </div>
              <p className="text-[13px] text-muted-foreground">
                暂时没有新通知
              </p>
            </div>
          ) : (
            items.map((item) => <NotificationRow key={item.id} item={item} />)
          )}
        </div>
        {hasMore ? (
          <div className="border-t p-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="w-full text-[12px]"
              onClick={() =>
                void useNotificationsStore
                  .getState()
                  .loadMore()
                  .catch(() => undefined)
              }
            >
              加载更多
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
