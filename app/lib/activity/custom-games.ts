// 用户本地自定义游戏目录（localStorage）：登记前台进程可执行名 → 展示名 / 封面

import type { GameCatalogEntry } from "./game-catalog"

const STORAGE_KEY = "owl.activity.custom_games"

export type CustomGameEntry = {
  id: string
  name: string
  executables: string[]
  cover_url?: string
  aliases?: string[]
  created_at: number
}

function readAll(): CustomGameEntry[] {
  if (typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as CustomGameEntry[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e) => e?.id && e?.name && Array.isArray(e.executables))
  } catch {
    return []
  }
}

function writeAll(entries: CustomGameEntry[]) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 200)))
  } catch {
    // quota
  }
}

export function listCustomGames(): CustomGameEntry[] {
  return readAll()
}

export function customGamesAsCatalog(): GameCatalogEntry[] {
  return readAll().map((e) => ({
    id: e.id,
    name: e.name,
    executables: e.executables.map((x) => x.toLowerCase()),
    cover_url: e.cover_url,
    aliases: e.aliases,
  }))
}

/** 登记/更新：按 executable 主键合并 */
export function upsertCustomGame(input: {
  name: string
  executable: string
  cover_url?: string
}): CustomGameEntry {
  const name = input.name.trim().slice(0, 128)
  const executable = input.executable.trim().toLowerCase()
  if (!name || !executable) {
    throw new Error("名称与可执行文件名不能为空")
  }
  const list = readAll()
  const existing = list.find((e) =>
    e.executables.some((x) => x.toLowerCase() === executable),
  )
  if (existing) {
    existing.name = name
    if (input.cover_url !== undefined) {
      existing.cover_url = input.cover_url?.trim() || undefined
    }
    if (!existing.executables.map((x) => x.toLowerCase()).includes(executable)) {
      existing.executables.push(executable)
    }
    writeAll(list)
    return existing
  }
  const entry: CustomGameEntry = {
    id: `custom_${Date.now().toString(36)}`,
    name,
    executables: [executable],
    cover_url: input.cover_url?.trim() || undefined,
    created_at: Date.now(),
  }
  list.unshift(entry)
  writeAll(list)
  return entry
}

export function removeCustomGame(id: string) {
  writeAll(readAll().filter((e) => e.id !== id))
}

export function clearCustomGames() {
  writeAll([])
}
