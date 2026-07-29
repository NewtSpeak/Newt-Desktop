// 多账号身份键：同一 Newt-Server 上不同用户、或不同服务器上的账号各自独立。

/** 由服务器 origin + 用户 id 生成稳定账号键 */
export function makeAccountId(serverBaseUrl: string, userId: string): string {
  try {
    return `${new URL(serverBaseUrl).origin}::${userId}`
  } catch {
    return `${serverBaseUrl.replace(/\/+$/, "")}::${userId}`
  }
}

/** 从账号键解析 origin（失败返回 null） */
export function accountOrigin(accountId: string): string | null {
  const idx = accountId.lastIndexOf("::")
  if (idx <= 0) return null
  return accountId.slice(0, idx)
}
