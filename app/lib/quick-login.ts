// 使用已记住的「服务器 + 账号密码」一键登录。

import { persistServerConnection, setRuntimeServerBaseUrl } from "~/lib/server-connection"
import type { SavedCredential } from "~/lib/saved-credentials"
import { useAuthStore } from "~/stores/auth"

/**
 * 切换到凭据对应服务器并登录。
 * 调用方负责成功后的 UI 收尾（关闭弹窗、join 邀请等）。
 */
export async function loginWithSavedCredential(
  cred: SavedCredential,
): Promise<void> {
  setRuntimeServerBaseUrl(cred.serverBaseUrl)
  persistServerConnection(cred.serverName)
  await useAuthStore.getState().login(cred.identifier, cred.password)

  // 补全账号元数据中的服务器名
  const accountId = useAuthStore.getState().activeAccountId
  const user = useAuthStore.getState().user
  if (accountId && user) {
    const { registerAccountSession } = await import("~/lib/api/http")
    registerAccountSession({
      accountId,
      user,
      serverBaseUrl: cred.serverBaseUrl,
      serverName: cred.serverName,
    })
    useAuthStore.setState({
      accounts: useAuthStore.getState().accounts.map((a) =>
        a.id === accountId
          ? {
              ...a,
              serverName: cred.serverName,
              serverBaseUrl: cred.serverBaseUrl,
            }
          : a,
      ),
    })
  }
}

export function credentialServerLabel(cred: SavedCredential): string {
  if (cred.serverName?.trim()) return cred.serverName.trim()
  try {
    return new URL(cred.serverBaseUrl).host
  } catch {
    return cred.serverBaseUrl
  }
}

export function credentialServerHost(cred: SavedCredential): string {
  try {
    return new URL(cred.serverBaseUrl).host
  } catch {
    return cred.serverBaseUrl
  }
}
