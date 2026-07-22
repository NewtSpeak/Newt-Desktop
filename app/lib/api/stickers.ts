// 贴图与表情包用户端 API（docs 17 / Owl-Server sticker 模块）。

import { api, qs } from "./http"
import type {
  GuildStickerPackBan,
  StickerItem,
  StickerKind,
  StickerLibraryEntry,
  StickerPack,
  StickerPackScope,
} from "./types"

export type CreateStickerPackInput = {
  name: string
  description?: string
  kind: StickerKind
  scope: StickerPackScope
  guild_id?: string
  allow_browse_full?: boolean
}

export type PatchStickerPackInput = {
  name?: string
  description?: string
  allow_browse_full?: boolean
  /** 指定包内条目为封面（会清除自定义上传封面） */
  cover_item_id?: string
  /** 清除自定义封面 + 条目封面，回退为首条 */
  clear_cover?: boolean
  /** 仅清除自定义上传封面 */
  clear_custom_cover?: boolean
}

/** 我创建的包 */
export const listMyStickerPacks = () =>
  api<{ packs: StickerPack[] }>("/users/@me/sticker-packs").then(
    (r) => r.packs ?? [],
  )

export const createStickerPack = (input: CreateStickerPackInput) =>
  api<StickerPack>("/users/@me/sticker-packs", {
    method: "POST",
    body: JSON.stringify(input),
  })

export const patchStickerPack = (packId: string, input: PatchStickerPackInput) =>
  api<StickerPack>(`/users/@me/sticker-packs/${packId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })

/** 作者软删 */
export const softDeleteStickerPack = (packId: string) =>
  api<StickerPack>(`/users/@me/sticker-packs/${packId}`, { method: "DELETE" })

/** 180 天内恢复 */
export const restoreStickerPack = (packId: string) =>
  api<StickerPack>(`/users/@me/sticker-packs/${packId}/restore`, {
    method: "POST",
  })

/** 包预览（受 allow_browse_full 约束） */
export const getStickerPack = (
  packId: string,
  params: { guild_id?: string; item_id?: string } = {},
) =>
  api<{
    pack: StickerPack
    can_install: boolean
    can_copy: boolean
  }>(`/sticker-packs/${packId}${qs(params)}`)

export const getStickerItem = (itemId: string) =>
  api<StickerItem>(`/sticker-items/${itemId}`)

/**
 * 上传条目：multipart 字段 file + 可选 name。
 * Content-Type 由浏览器自动带 boundary，勿手动设 application/json。
 */
export async function uploadStickerItem(
  packId: string,
  file: Blob,
  opts: { name?: string; filename?: string } = {},
): Promise<StickerItem> {
  const form = new FormData()
  form.append("file", file, opts.filename ?? "sticker.png")
  if (opts.name) form.append("name", opts.name)
  return api<StickerItem>(`/users/@me/sticker-packs/${packId}/items`, {
    method: "POST",
    body: form,
  })
}

/** 上传贴图包自定义封面（独立于包内条目） */
export async function uploadStickerPackCover(
  packId: string,
  file: Blob,
  opts: { filename?: string } = {},
): Promise<StickerPack> {
  const form = new FormData()
  form.append("file", file, opts.filename ?? "cover.png")
  return api<StickerPack>(`/users/@me/sticker-packs/${packId}/cover`, {
    method: "PUT",
    body: form,
  })
}

/** 清除自定义封面，回退到 cover_item 或首条 */
export const deleteStickerPackCover = (packId: string) =>
  api<StickerPack>(`/users/@me/sticker-packs/${packId}/cover`, {
    method: "DELETE",
  })

export const patchStickerItem = (
  packId: string,
  itemId: string,
  input: { name?: string; sort_order?: number },
) =>
  api<StickerItem>(`/users/@me/sticker-packs/${packId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })

export const deleteStickerItem = (packId: string, itemId: string) =>
  api<void>(`/users/@me/sticker-packs/${packId}/items/${itemId}`, {
    method: "DELETE",
  })

/** 贴图库（Install 引用列表） */
export const listStickerLibrary = (includeHidden = false) =>
  api<{ library: StickerLibraryEntry[] }>(
    `/users/@me/sticker-library${qs({ include_hidden: includeHidden ? "true" : undefined })}`,
  ).then((r) => r.library ?? [])

export const installStickerPack = (packId: string, guildId?: string) =>
  api<StickerLibraryEntry>(
    `/users/@me/sticker-library/${packId}${qs({ guild_id: guildId })}`,
    { method: "PUT" },
  )

export const uninstallStickerPack = (packId: string) =>
  api<void>(`/users/@me/sticker-library/${packId}`, { method: "DELETE" })

/** 单条 Copy 到自己的包 */
export const copyStickerItem = (
  targetPackId: string,
  sourceItemId: string,
  name?: string,
) =>
  api<StickerItem>(`/users/@me/sticker-packs/${targetPackId}/items/copy`, {
    method: "POST",
    body: JSON.stringify({ source_item_id: sourceItemId, name }),
  })

/** 当前上下文可用集合（选择器） */
export const listAvailableStickers = (params: {
  guild_id?: string
  kind?: StickerKind
} = {}) =>
  api<{ packs: StickerPack[]; items: StickerItem[] }>(
    `/users/@me/sticker-available${qs(params)}`,
  )

export const listGuildStickerPackBans = (guildId: string) =>
  api<{ bans: GuildStickerPackBan[] }>(
    `/guilds/${guildId}/sticker-pack-bans`,
  ).then((r) => r.bans ?? [])

export const banGuildStickerPack = (
  guildId: string,
  packId: string,
  reason?: string,
) =>
  api<GuildStickerPackBan>(
    `/guilds/${guildId}/sticker-pack-bans/${packId}`,
    {
      method: "PUT",
      body: JSON.stringify({ reason: reason ?? "" }),
    },
  )

export const unbanGuildStickerPack = (guildId: string, packId: string) =>
  api<void>(`/guilds/${guildId}/sticker-pack-bans/${packId}`, {
    method: "DELETE",
  })
