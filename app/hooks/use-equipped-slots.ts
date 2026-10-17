import type { EquippedSlot } from "~/lib/api/cosmetics"
import { useCosmeticsStore } from "~/stores/cosmetics"

export function useEquippedSlots(
  userId: string,
  selfId: string | undefined
): Record<string, EquippedSlot> | undefined {
  return useCosmeticsStore((state) =>
    userId === selfId ? state.loadout : state.equippedByUser[userId]
  )
}
