// Home：私信落地页 / 好友页（?tab=friends）/ 贴图库（?tab=stickers）。
// 左侧私信侧栏由 ChannelList → DmSidebar 提供。
// 主内容挂在 index 路由上，不依赖后加子路由，避免热更新未注册时 404。

import { MessageCircleIcon } from "lucide-react"
import { useSearchParams } from "react-router"

import { CreateStickerPackView } from "~/components/create-sticker-pack-view"
import { FriendsView } from "~/components/friends-view"
import { ManageStickerPacksView } from "~/components/manage-sticker-packs-view"
import { StickerLibraryView } from "~/components/sticker-library-view"
import { useGuildsStore } from "~/stores/guilds"
import { useUIStore } from "~/stores/ui"

export default function HomePage() {
  const [searchParams] = useSearchParams()
  const selectedGuildId = useUIStore((state) => state.selectedGuildId)
  const hasGuilds = useGuildsStore((state) => state.guilds.length > 0)
  const tab = searchParams.get("tab")
  const showFriends = tab === "friends"
  const showStickers = tab === "stickers"
  const stickersView = searchParams.get("view")
  const showCreatePack = showStickers && stickersView === "create"
  const showManagePacks = showStickers && stickersView === "manage"

  // 好友页：复用 index 路由，URL 为 /?tab=friends
  if (showFriends) {
    return <FriendsView />
  }

  // 贴图库 / 创建向导 / 管理页
  if (showCreatePack) {
    return <CreateStickerPackView />
  }
  if (showManagePacks) {
    return <ManageStickerPacksView />
  }
  if (showStickers) {
    return <StickerLibraryView />
  }

  // 已选中真实服务器但尚未选频道时，提示从左侧选频道
  if (selectedGuildId && selectedGuildId !== "@me") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-base font-medium text-balance">选择一个频道</p>
        <p className="max-w-xs text-sm text-muted-foreground text-pretty">
          从左侧频道列表中选择一个文字频道开始聊天
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
        <MessageCircleIcon className="size-7 text-muted-foreground/50" />
      </div>
      <p className="text-base font-semibold">私信</p>
      <p className="max-w-xs text-[13px] text-muted-foreground text-pretty">
        从左侧选择一段对话，或在右上角打开好友列表开始聊天。
      </p>
      {!hasGuilds ? (
        <p className="mt-4 text-[11px] text-muted-foreground">
          也可以先从左上角创建或加入服务器开始使用。
        </p>
      ) : null}
    </div>
  )
}
