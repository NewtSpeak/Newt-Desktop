// 本地「记住账号密码」凭据库（无上限）。
// 密码属敏感信息，走 OS 安全存储（与 refresh token 同层）。

import { secureDelete, secureGet, secureSet } from "~/lib/secure-storage"

const STORAGE_KEY = "owl.saved_credentials.v1"

export type SavedCredential = {
  id: string
  /** 规范化后的服务器基址（无尾斜杠） */
  serverBaseUrl: string
  serverName: string | null
  /** 用户名或邮箱 */
  identifier: string
  password: string
  updatedAt: number
}

function normalizeBaseUrl(raw: string): string {
  try {
    const url = new URL(raw)
    return url.origin + url.pathname.replace(/\/+$/, "")
  } catch {
    return raw.replace(/\/+$/, "")
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `cred_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

async function readAll(): Promise<SavedCredential[]> {
  const raw = await secureGet(STORAGE_KEY)
  if (!raw) return []
  try {
    const list = JSON.parse(raw) as SavedCredential[]
    if (!Array.isArray(list)) return []
    return list.filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.serverBaseUrl === "string" &&
        typeof item.identifier === "string" &&
        typeof item.password === "string",
    )
  } catch {
    return []
  }
}

async function writeAll(list: SavedCredential[]): Promise<void> {
  if (list.length === 0) {
    await secureDelete(STORAGE_KEY)
    return
  }
  await secureSet(STORAGE_KEY, JSON.stringify(list))
}

/** 全部已记住凭据（按最近更新排序） */
export async function listSavedCredentials(): Promise<SavedCredential[]> {
  const list = await readAll()
  return list.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 指定服务器上的凭据 */
export async function listSavedCredentialsForServer(
  serverBaseUrl: string,
): Promise<SavedCredential[]> {
  const base = normalizeBaseUrl(serverBaseUrl)
  const list = await readAll()
  return list
    .filter((item) => normalizeBaseUrl(item.serverBaseUrl) === base)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 写入或更新凭据：同一服务器 + 同一 identifier（不区分大小写）合并为一条。
 * 无条数上限。
 */
export async function upsertSavedCredential(input: {
  serverBaseUrl: string
  serverName?: string | null
  identifier: string
  password: string
  /** 指定 id 则强制更新该条（用于编辑） */
  id?: string
}): Promise<SavedCredential> {
  const serverBaseUrl = normalizeBaseUrl(input.serverBaseUrl)
  const identifier = input.identifier.trim()
  const password = input.password
  const list = await readAll()
  const now = Date.now()

  if (input.id) {
    const index = list.findIndex((item) => item.id === input.id)
    if (index >= 0) {
      const next: SavedCredential = {
        ...list[index]!,
        serverBaseUrl,
        serverName: input.serverName ?? list[index]!.serverName,
        identifier,
        password,
        updatedAt: now,
      }
      list[index] = next
      await writeAll(list)
      return next
    }
  }

  const existing = list.findIndex(
    (item) =>
      normalizeBaseUrl(item.serverBaseUrl) === serverBaseUrl &&
      item.identifier.trim().toLowerCase() === identifier.toLowerCase(),
  )
  if (existing >= 0) {
    const next: SavedCredential = {
      ...list[existing]!,
      serverBaseUrl,
      serverName: input.serverName ?? list[existing]!.serverName,
      identifier,
      password,
      updatedAt: now,
    }
    list[existing] = next
    await writeAll(list)
    return next
  }

  const created: SavedCredential = {
    id: newId(),
    serverBaseUrl,
    serverName: input.serverName ?? null,
    identifier,
    password,
    updatedAt: now,
  }
  list.push(created)
  await writeAll(list)
  return created
}

/** 更新已有凭据（identifier / password / 服务器名） */
export async function updateSavedCredential(
  id: string,
  patch: {
    identifier?: string
    password?: string
    serverName?: string | null
  },
): Promise<SavedCredential | null> {
  const list = await readAll()
  const index = list.findIndex((item) => item.id === id)
  if (index < 0) return null
  const prev = list[index]!
  const next: SavedCredential = {
    ...prev,
    identifier:
      patch.identifier !== undefined
        ? patch.identifier.trim()
        : prev.identifier,
    password: patch.password !== undefined ? patch.password : prev.password,
    serverName:
      patch.serverName !== undefined ? patch.serverName : prev.serverName,
    updatedAt: Date.now(),
  }
  list[index] = next
  await writeAll(list)
  return next
}

export async function deleteSavedCredential(id: string): Promise<void> {
  const list = await readAll()
  await writeAll(list.filter((item) => item.id !== id))
}
