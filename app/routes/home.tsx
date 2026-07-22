// Home：私信落地页（未选具体会话时的空白主内容）。
// 左侧私信侧栏由 ChannelList → DmSidebar 提供；好友页见 /friends。

import { MessageCircleIcon } from "lucide-react"

import { useGuildsStore } from "~/stores/guilds"
import { useUIStore } from "~/stores/ui"

export default function HomePage() {
  const selectedGuildId = useUIStore((state) => state.selectedGuildId)
  const hasGuilds = useGuildsStore((state) => state.guilds.length > 0)

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
