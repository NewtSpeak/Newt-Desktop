// 平台装扮商店状态：品类/商店/库存/装备/积分。

import { create } from "zustand"

import {
  claimCosmetic,
  equipCosmetic,
  getMyCosmeticLoadout,
  getMyCosmeticPoints,
  listCosmeticCategories,
  listCosmeticShop,
  listCosmeticTags,
  listMyCosmeticInventory,
  purchaseCosmetic,
  unequipCosmetic,
  type CosmeticBundle,
  type CosmeticCategory,
  type CosmeticInventoryEntry,
  type CosmeticItem,
  type CosmeticTag,
  type EquippedSlot,
} from "~/lib/api/cosmetics"
import { useAuthStore } from "./auth"

type CosmeticsState = {
  categories: CosmeticCategory[]
  tags: CosmeticTag[]
  shopItems: CosmeticItem[]
  shopBundles: CosmeticBundle[]
  inventory: CosmeticInventoryEntry[]
  /** 本人全量装备 */
  loadout: Record<string, EquippedSlot>
  /** 他人精简/全量装备缓存 userId -> slots */
  equippedByUser: Record<string, Record<string, EquippedSlot>>
  points: number
  loadingShop: boolean
  loadingInventory: boolean
  shopFilter: { category?: string; tag?: string; q?: string }

  reset: () => void
  ensureMeta: () => Promise<void>
  loadShop: (filter?: { category?: string; tag?: string; q?: string }) => Promise<void>
  loadInventory: () => Promise<void>
  loadLoadout: () => Promise<void>
  loadPoints: () => Promise<void>
  equip: (slot: string, itemId: string) => Promise<void>
  unequip: (slot: string) => Promise<void>
  claim: (type: "item" | "bundle", id: string) => Promise<void>
  purchase: (type: "item" | "bundle", id: string) => Promise<void>
  applyLoadoutUpdate: (
    userId: string,
    slots: Record<string, EquippedSlot>,
  ) => void
  setEquippedForUser: (
    userId: string,
    slots: Record<string, EquippedSlot>,
  ) => void
  setPoints: (balance: number) => void
}

const empty = {
  categories: [] as CosmeticCategory[],
  tags: [] as CosmeticTag[],
  shopItems: [] as CosmeticItem[],
  shopBundles: [] as CosmeticBundle[],
  inventory: [] as CosmeticInventoryEntry[],
  loadout: {} as Record<string, EquippedSlot>,
  equippedByUser: {} as Record<string, Record<string, EquippedSlot>>,
  points: 0,
  loadingShop: false,
  loadingInventory: false,
  shopFilter: {} as { category?: string; tag?: string; q?: string },
}

export const useCosmeticsStore = create<CosmeticsState>((set, get) => ({
  ...empty,

  reset: () => set({ ...empty }),

  ensureMeta: async () => {
    const [cats, tags] = await Promise.all([
      listCosmeticCategories(),
      listCosmeticTags(),
    ])
    set({
      categories: cats.categories ?? [],
      tags: tags.tags ?? [],
    })
  },

  loadShop: async (filter) => {
    const next = filter ?? get().shopFilter
    set({ loadingShop: true, shopFilter: next })
    try {
      const data = await listCosmeticShop(next)
      set({
        shopItems: data.items ?? [],
        shopBundles: data.bundles ?? [],
      })
    } finally {
      set({ loadingShop: false })
    }
  },

  loadInventory: async () => {
    set({ loadingInventory: true })
    try {
      const data = await listMyCosmeticInventory()
      set({ inventory: data.inventory ?? [] })
    } finally {
      set({ loadingInventory: false })
    }
  },

  loadLoadout: async () => {
    const data = await getMyCosmeticLoadout()
    set({ loadout: data.slots ?? {} })
  },

  loadPoints: async () => {
    const data = await getMyCosmeticPoints()
    set({ points: data.balance ?? 0 })
  },

  equip: async (slot, itemId) => {
    const data = await equipCosmetic(slot, itemId)
    set({ loadout: data.slots ?? {} })
  },

  unequip: async (slot) => {
    const data = await unequipCosmetic(slot)
    set({ loadout: data.slots ?? {} })
  },

  claim: async (type, id) => {
    await claimCosmetic(type, id)
    await Promise.all([get().loadInventory(), get().loadShop(), get().loadPoints()])
  },

  purchase: async (type, id) => {
    const res = await purchaseCosmetic(type, id)
    if (typeof res.balance === "number" && res.balance >= 0) {
      set({ points: res.balance })
    }
    await Promise.all([get().loadInventory(), get().loadShop()])
  },

  applyLoadoutUpdate: (userId, slots) => {
    const selfId = useAuthStore.getState().user?.id
    set((s) => ({
      loadout: userId === selfId ? slots : s.loadout,
      equippedByUser: { ...s.equippedByUser, [userId]: slots },
    }))
  },

  setEquippedForUser: (userId, slots) =>
    set((s) => ({
      equippedByUser: { ...s.equippedByUser, [userId]: slots },
    })),

  setPoints: (balance) => set({ points: balance }),
}))
