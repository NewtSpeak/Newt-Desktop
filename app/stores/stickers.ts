// 贴图库 / 可用集合缓存（docs 17）：按 guild 维度缓存 available，避免选择器重复请求。

import { create } from "zustand"

import {
  getStickerItem,
  listAvailableStickers,
  listMyStickerPacks,
  listStickerLibrary,
} from "~/lib/api/stickers"
import type { StickerItem, StickerLibraryEntry, StickerPack } from "~/lib/api/types"
import { asSnowflakeId } from "~/lib/snowflake"

/** 历史消息小表情按需拉取：同 itemId 合并为一次请求 */
const itemInflight = new Map<string, Promise<StickerItem | undefined>>()

/** 保证条目/包上的雪花 ID 全是字符串，避免 Number 精度丢失 */
function normalizeStickerItem(item: StickerItem): StickerItem {
  return {
    ...item,
    id: asSnowflakeId(item.id),
    pack_id: asSnowflakeId(item.pack_id),
    asset_id: asSnowflakeId(item.asset_id),
    source_item_id: item.source_item_id
      ? asSnowflakeId(item.source_item_id)
      : item.source_item_id,
    source_pack_id: item.source_pack_id
      ? asSnowflakeId(item.source_pack_id)
      : item.source_pack_id,
  }
}

function normalizeStickerPack(pack: StickerPack): StickerPack {
  return {
    ...pack,
    id: asSnowflakeId(pack.id),
    cover_item_id: pack.cover_item_id
      ? asSnowflakeId(pack.cover_item_id)
      : pack.cover_item_id,
    cover_asset_id: pack.cover_asset_id
      ? asSnowflakeId(pack.cover_asset_id)
      : pack.cover_asset_id,
    items: pack.items?.map(normalizeStickerItem),
  }
}

type AvailableCache = {
  packs: StickerPack[]
  items: StickerItem[]
  loadedAt: number
}

type StickersState = {
  /** guildId 或 "__dm__" → 可用集合 */
  availableByContext: Record<string, AvailableCache>
  loadingAvailable: Record<string, boolean>
  myPacks: StickerPack[]
  library: StickerLibraryEntry[]
  /** item_id → 条目（渲染历史消息时可按需填充） */
  itemCache: Record<string, StickerItem>
  /** 包预览弹层 */
  previewPackId: string | null
  previewItemId: string | null
  previewGuildId: string | null

  ensureAvailable: (guildId?: string | null) => Promise<void>
  refreshMyPacks: () => Promise<void>
  refreshLibrary: (includeHidden?: boolean) => Promise<void>
  cacheItems: (items: StickerItem[]) => void
  getItem: (itemId: string) => StickerItem | undefined
  /** 缓存未命中时拉取条目（渲染历史消息 `<e:id:mark>` 用）；失败返回 undefined */
  ensureItem: (itemId: string) => Promise<StickerItem | undefined>
  openPackPreview: (packId: string, opts?: { itemId?: string; guildId?: string }) => void
  closePackPreview: () => void
  invalidateAvailable: () => void
  reset: () => void
}

const TTL_MS = 60_000
const DM_KEY = "__dm__"

function contextKey(guildId?: string | null): string {
  return guildId && guildId !== "00000000-0000-0000-0000-000000000000"
    ? guildId
    : DM_KEY
}

export const useStickersStore = create<StickersState>((set, get) => ({
  availableByContext: {},
  loadingAvailable: {},
  myPacks: [],
  library: [],
  itemCache: {},
  previewPackId: null,
  previewItemId: null,
  previewGuildId: null,

  ensureAvailable: async (guildId) => {
    const key = contextKey(guildId)
    const cached = get().availableByContext[key]
    if (cached && Date.now() - cached.loadedAt < TTL_MS) return
    if (get().loadingAvailable[key]) return
    set((s) => ({
      loadingAvailable: { ...s.loadingAvailable, [key]: true },
    }))
    try {
      const data = await listAvailableStickers({
        guild_id: key === DM_KEY ? undefined : key,
      })
      const items = (data.items ?? []).map(normalizeStickerItem)
      const packs = (data.packs ?? []).map(normalizeStickerPack)
      get().cacheItems(items)
      set((s) => ({
        availableByContext: {
          ...s.availableByContext,
          [key]: {
            packs,
            items,
            loadedAt: Date.now(),
          },
        },
        loadingAvailable: { ...s.loadingAvailable, [key]: false },
      }))
    } catch {
      set((s) => ({
        loadingAvailable: { ...s.loadingAvailable, [key]: false },
      }))
    }
  },

  refreshMyPacks: async () => {
    try {
      const packs = await listMyStickerPacks()
      set({ myPacks: packs.map(normalizeStickerPack) })
    } catch {
      // 设置页会 toast
    }
  },

  refreshLibrary: async (includeHidden = false) => {
    try {
      const library = await listStickerLibrary(includeHidden)
      set({
        library: library.map((entry) => ({
          ...entry,
          pack_id: asSnowflakeId(entry.pack_id),
          pack: entry.pack ? normalizeStickerPack(entry.pack) : entry.pack,
        })),
      })
    } catch {
      // ignore
    }
  },

  cacheItems: (items) => {
    if (!items.length) return
    set((s) => {
      const next = { ...s.itemCache }
      for (const raw of items) {
        const item = normalizeStickerItem(raw)
        next[item.id] = item
      }
      return { itemCache: next }
    })
  },

  getItem: (itemId) => get().itemCache[asSnowflakeId(itemId)],

  ensureItem: async (itemId) => {
    const id = asSnowflakeId(itemId)
    if (!id) return undefined
    const hit = get().itemCache[id]
    if (hit) return hit
    const pending = itemInflight.get(id)
    if (pending) return pending
    const promise = getStickerItem(id)
      .then((item) => {
        get().cacheItems([item])
        return get().itemCache[id] ?? normalizeStickerItem(item)
      })
      .catch(() => undefined)
      .finally(() => {
        itemInflight.delete(id)
      })
    itemInflight.set(id, promise)
    return promise
  },

  openPackPreview: (packId, opts) => {
    set({
      previewPackId: packId,
      previewItemId: opts?.itemId ?? null,
      previewGuildId: opts?.guildId ?? null,
    })
  },

  closePackPreview: () => {
    set({
      previewPackId: null,
      previewItemId: null,
      previewGuildId: null,
    })
  },

  invalidateAvailable: () => set({ availableByContext: {} }),

  reset: () =>
    set({
      availableByContext: {},
      loadingAvailable: {},
      myPacks: [],
      library: [],
      itemCache: {},
      previewPackId: null,
      previewItemId: null,
      previewGuildId: null,
    }),
}))

export function availableItems(
  guildId?: string | null,
  kind?: "emote" | "sticker",
): StickerItem[] {
  const key = contextKey(guildId)
  const items =
    useStickersStore.getState().availableByContext[key]?.items ?? []
  if (!kind) return items
  return items.filter((i) => i.kind === kind)
}
