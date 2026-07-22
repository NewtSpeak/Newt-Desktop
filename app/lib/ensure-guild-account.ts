// 选中服务器/进入频道前：若该服归属其他账号，静默切换会话身份。
// 不调用完整 switchAccount（避免清空 UI、重排服务器列表）。

import { toast } from "sonner"

import { useAuthStore } from "~/stores/auth"
import { useGuildsStore } from "~/stores/guilds"

/**
 * 确保当前激活会话与 guild 的 account_id 一致。
 * 需要时走 silentActivateAccount：只换 token / 左下角头像，保留列表顺序。
 */
export async function ensureGuildAccount(guildId: string): Promise<boolean> {
  if (!guildId || guildId === "@me") return true
  const guild = useGuildsStore.getState().guilds.find((g) => g.id === guildId)
  const accountId = guild?.account_id
  if (!accountId) return true
  const active = useAuthStore.getState().activeAccountId
  if (accountId === active) return true
  try {
    await useAuthStore.getState().silentActivateAccount(accountId)
    return true
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "切换身份失败，无法打开该服务器",
    )
    return false
  }
}
