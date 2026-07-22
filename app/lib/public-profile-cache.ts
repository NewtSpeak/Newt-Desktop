// 公开资料内存缓存：好友卡片签名等场景复用，避免重复打 GET /users/:id。

import type { PublicUserProfile } from "~/lib/api/types"
import { getPublicProfile } from "~/lib/api/users"

const cache = new Map<string, PublicUserProfile | null>()
const inflight = new Map<string, Promise<PublicUserProfile | null>>()

export function peekPublicProfile(
  userId: string,
): PublicUserProfile | null | undefined {
  if (!cache.has(userId)) return undefined
  return cache.get(userId) ?? null
}

export function loadPublicProfile(
  userId: string,
): Promise<PublicUserProfile | null> {
  if (cache.has(userId)) {
    return Promise.resolve(cache.get(userId) ?? null)
  }
  const pending = inflight.get(userId)
  if (pending) return pending

  const task = getPublicProfile(userId)
    .then((profile) => {
      cache.set(userId, profile)
      return profile
    })
    .catch(() => {
      cache.set(userId, null)
      return null
    })
    .finally(() => {
      inflight.delete(userId)
    })

  inflight.set(userId, task)
  return task
}

/** 测试 / 登出时清空 */
export function clearPublicProfileCache() {
  cache.clear()
  inflight.clear()
}
