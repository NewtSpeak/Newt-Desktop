// 平台装扮商店用户端 API。

import { api, qs } from "./http"

export type CosmeticAssetView = {
  id: string
  url: string
  mime: string
  width: number
  height: number
  animated: boolean
  size_bytes: number
}

export type CosmeticTag = {
  id: string
  key: string
  name: string
  color: string
}

export type CosmeticCategory = {
  key: string
  name: string
  description: string
  slot: string
  schema: {
    asset_slots?: Array<{
      key: string
      label?: string
      required?: boolean
      mime_groups?: string[]
      max_bytes?: number
    }>
    payload_fields?: Array<{
      key: string
      type: string
      values?: string[]
      default?: unknown
    }>
    render_hint?: string
  }
  sort_order: number
  enabled: boolean
}

export type CosmeticItem = {
  id: string
  category_key: string
  slot?: string
  name: string
  description: string
  preview_url?: string
  assets: Record<string, CosmeticAssetView>
  payload: Record<string, unknown>
  price_points: number
  status?: string
  sort_order: number
  tags?: CosmeticTag[]
  owned?: boolean
  available_from?: string | null
  available_until?: string | null
}

export type CosmeticBundle = {
  id: string
  name: string
  description: string
  preview_url?: string
  price_points: number
  status?: string
  sort_order: number
  tags?: CosmeticTag[]
  item_ids?: string[]
  items?: CosmeticItem[]
  owned_all?: boolean
}

export type EquippedSlot = {
  item_id: string
  category_key: string
  slot: string
  name: string
  assets: Record<string, CosmeticAssetView>
  payload: Record<string, unknown>
  render_hint?: string
}

export type CosmeticInventoryEntry = {
  id: string
  item_id: string
  source: string
  source_ref?: string
  expires_at?: string | null
  acquired_at: string
  item?: CosmeticItem
}

export const listCosmeticCategories = () =>
  api<{ categories: CosmeticCategory[]; version?: string }>(
    "/cosmetics/categories",
  )

export const listCosmeticTags = () =>
  api<{ tags: CosmeticTag[] }>("/cosmetics/tags")

export const listCosmeticShop = (params: {
  category?: string
  tag?: string
  q?: string
} = {}) =>
  api<{ items: CosmeticItem[]; bundles: CosmeticBundle[] }>(
    `/cosmetics/shop${qs(params)}`,
  )

export const getCosmeticItem = (itemId: string) =>
  api<CosmeticItem>(`/cosmetics/items/${itemId}`)

export const getCosmeticBundle = (bundleId: string) =>
  api<CosmeticBundle>(`/cosmetics/bundles/${bundleId}`)

export const listMyCosmeticInventory = () =>
  api<{ inventory: CosmeticInventoryEntry[] }>(
    "/users/@me/cosmetics/inventory",
  )

export const getMyCosmeticLoadout = () =>
  api<{ slots: Record<string, EquippedSlot> }>("/users/@me/cosmetics/loadout")

export const equipCosmetic = (slot: string, itemId: string) =>
  api<{ slots: Record<string, EquippedSlot> }>(
    `/users/@me/cosmetics/loadout/${encodeURIComponent(slot)}`,
    { method: "PUT", body: JSON.stringify({ item_id: itemId }) },
  )

export const unequipCosmetic = (slot: string) =>
  api<{ slots: Record<string, EquippedSlot> }>(
    `/users/@me/cosmetics/loadout/${encodeURIComponent(slot)}`,
    { method: "DELETE" },
  )

export const claimCosmetic = (targetType: "item" | "bundle", targetId: string) =>
  api<{
    ok: boolean
    granted_item_ids: string[]
    price_points: number
    balance: number
  }>("/users/@me/cosmetics/claim", {
    method: "POST",
    body: JSON.stringify({ target_type: targetType, target_id: targetId }),
  })

export const purchaseCosmetic = (
  targetType: "item" | "bundle",
  targetId: string,
) =>
  api<{
    ok: boolean
    granted_item_ids: string[]
    price_points: number
    balance: number
  }>("/users/@me/cosmetics/purchase", {
    method: "POST",
    body: JSON.stringify({ target_type: targetType, target_id: targetId }),
  })

export const getMyCosmeticPoints = () =>
  api<{ balance: number; updated_at?: string }>("/users/@me/cosmetics/points")

/** 预留：服务器货币兑换积分（当前返回 501） */
export const exchangeCurrencyForPoints = (body: Record<string, unknown>) =>
  api<{ enabled: boolean }>("/users/@me/cosmetics/points/exchange", {
    method: "POST",
    body: JSON.stringify(body),
  })

export const getUserEquippedCosmetics = (
  userId: string,
  opts: { full?: boolean } = {},
) =>
  api<{ slots: Record<string, EquippedSlot> }>(
    `/users/${userId}/cosmetics/equipped${opts.full ? "?full=1" : ""}`,
  )
