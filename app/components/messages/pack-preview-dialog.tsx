// Pack Preview：消息内点击表情 → 预览包网格 → 整包收藏（Install 引用到贴图库）

import { useEffect, useState } from "react"
import {
  BookmarkIcon,
  Loader2Icon,
  PackageIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/animate-ui/components/radix/dialog"
import { Button } from "~/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { StickerMedia } from "~/components/messages/sticker-media"
import { UserProfilePopover } from "~/components/user-profile-popover"
import { getStickerPack, installStickerPack } from "~/lib/api/stickers"
import { ApiError } from "~/lib/api/http"
import type { StickerPack } from "~/lib/api/types"
import { loadPublicProfile } from "~/lib/public-profile-cache"
import { itemDisplayName } from "~/lib/stickers/format"
import { nameInitials, resolveProfileAssetUrl } from "~/lib/user-display"
import { cn } from "~/lib/utils"
import { useStickersStore } from "~/stores/stickers"

/** 包作者：头像 + 名称，点击打开资料卡 */
function PackOwnerChip({ userId }: { userId: string }) {
  const [name, setName] = useState("用户")
  const [avatar, setAvatar] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    void loadPublicProfile(userId).then((p) => {
      if (cancelled || !p) return
      setName(p.display_name?.trim() || p.username?.trim() || "用户")
      setAvatar(resolveProfileAssetUrl(p.avatar) || undefined)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  return (
    <UserProfilePopover
      userId={userId}
      displayName={name}
      avatarUrl={avatar}
      side="bottom"
    >
      <button
        type="button"
        className="flex max-w-[8.5rem] items-center gap-1.5 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-muted/70 active:scale-[0.97]"
        title={name}
        onClick={(e) => e.stopPropagation()}
      >
        <Avatar className="size-6">
          {avatar ? <AvatarImage src={avatar} alt="" /> : null}
          <AvatarFallback className="text-[9px]">
            {nameInitials(name)}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 truncate text-[12px] font-medium text-muted-foreground">
          {name}
        </span>
      </button>
    </UserProfilePopover>
  )
}

export function PackPreviewDialog() {
  const packId = useStickersStore((s) => s.previewPackId)
  const itemId = useStickersStore((s) => s.previewItemId)
  const guildId = useStickersStore((s) => s.previewGuildId)
  const close = useStickersStore((s) => s.closePackPreview)
  const invalidate = useStickersStore((s) => s.invalidateAvailable)
  const cacheItems = useStickersStore((s) => s.cacheItems)

  const [pack, setPack] = useState<StickerPack | null>(null)
  const [canInstall, setCanInstall] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const open = Boolean(packId)

  useEffect(() => {
    if (!packId) {
      setPack(null)
      setCanInstall(false)
      return
    }
    let cancelled = false
    setLoading(true)
    getStickerPack(packId, {
      guild_id: guildId ?? undefined,
      item_id: itemId ?? undefined,
    })
      .then((res) => {
        if (cancelled) return
        setPack(res.pack)
        setCanInstall(Boolean(res.can_install))
        if (res.pack.items?.length) cacheItems(res.pack.items)
      })
      .catch((err) => {
        if (cancelled) return
        toast.error(err instanceof ApiError ? err.message : "无法加载表情包")
        close()
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [packId, itemId, guildId, cacheItems, close])

  /** 整包收藏：Install 引用到贴图库（跟随作者更新） */
  const onCollectPack = async () => {
    if (!packId) return
    setBusy(true)
    try {
      await installStickerPack(packId, guildId ?? undefined)
      toast.success("已收藏到贴图库")
      invalidate()
      setCanInstall(false)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "收藏失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent
        showCloseButton={false}
        from="top"
        transition={{ type: "spring", stiffness: 180, damping: 28 }}
        className="max-w-[20rem] gap-0 overflow-hidden border-0 p-0 shadow-xl ring-0 sm:max-w-[22rem] dark:ring-0"
      >
        <DialogHeader className="bg-muted/25 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex min-w-0 flex-1 items-center gap-2 text-balance text-sm">
              <PackageIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {pack?.name ?? (loading ? "…" : "表情包")}
              </span>
            </DialogTitle>
            <div className="flex shrink-0 items-center gap-0.5">
              {pack?.owner_user_id ? (
                <PackOwnerChip userId={pack.owner_user_id} />
              ) : null}
              <button
                type="button"
                onClick={close}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="关闭"
              >
                <XIcon className="size-4" />
              </button>
            </div>
          </div>
          <DialogDescription className="sr-only">
            贴图包预览
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[min(60vh,420px)] overflow-y-auto px-3 py-2.5">
          {!pack && loading ? (
            <p className="py-10 text-center text-xs text-muted-foreground">
              …
            </p>
          ) : null}
          {pack && (pack.items?.length ?? 0) === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">
              {pack.allow_browse_full
                ? "包内暂无条目"
                : "作者关闭了完整浏览，仅显示你点开的那一项"}
            </p>
          ) : null}
          {pack?.items && pack.items.length > 0 ? (
            <div className="grid grid-cols-4 gap-1.5">
              {pack.items.map((item) => {
                const highlight = item.id === itemId
                return (
                  <div
                    key={item.id}
                    data-sticker-cell
                    className={cn(
                      "group relative flex flex-col items-center gap-1 rounded-xl border-0 p-2",
                      "bg-muted/40 ring-0 outline-none",
                      "transition-[background-color,transform] duration-150",
                      "hover:bg-muted/65",
                      // 当前点开的项：仅用底色区分，不要描边/ring
                      highlight && "bg-primary/12",
                    )}
                  >
                    <StickerMedia
                      src={item.asset_url}
                      alt={itemDisplayName(item)}
                      width={96}
                      height={96}
                      className="size-full object-contain p-0.5"
                      draggable={false}
                    />
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>

        {/* 仅可收藏时显示底部操作；已收藏 / 自己的包不显示 */}
        {canInstall ? (
          <div className="flex flex-wrap items-center justify-end gap-2 bg-muted/25 px-3 py-2.5">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void onCollectPack()}
            >
              {busy ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <BookmarkIcon className="size-4" />
              )}
              收藏
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
