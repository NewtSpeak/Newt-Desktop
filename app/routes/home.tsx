// 应用壳 index 路由：未选服务器 / 未选频道时的空态引导。

import { useUIStore } from "~/stores/ui"
import { useGuildsStore } from "~/stores/guilds"

export default function HomePage() {
  const selectedGuildId = useUIStore((state) => state.selectedGuildId)
  const hasGuilds = useGuildsStore((state) => state.guilds.length > 0)

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      {selectedGuildId ? (
        <>
          <p className="text-base font-medium">选择一个频道</p>
          <p className="text-sm text-muted-foreground">
            从左侧频道列表中选择一个文字频道开始聊天
          </p>
        </>
      ) : hasGuilds ? (
        <>
          <p className="text-base font-medium">选择一个服务器</p>
          <p className="text-sm text-muted-foreground">
            从最左侧的服务器栏中选择一个服务器
          </p>
        </>
      ) : (
        <>
          <p className="text-base font-medium">欢迎使用 OwlSpeak</p>
          <p className="text-sm text-muted-foreground">
            点击左上角的添加按钮，创建你的第一个服务器或凭邀请码加入
          </p>
        </>
      )}
    </div>
  )
}
