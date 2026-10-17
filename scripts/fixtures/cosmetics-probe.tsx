import { StrictMode, act } from "react"
import { createRoot } from "react-dom/client"

import { useEquippedSlots } from "~/hooks/use-equipped-slots"
import type { EquippedSlot } from "~/lib/api/cosmetics"
import { useAuthStore } from "~/stores/auth"
import { useCosmeticsStore } from "~/stores/cosmetics"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let renders = 0
function CosmeticsProbe({ userId }: { userId: string }) {
  const selfId = useAuthStore((state) => state.user?.id)
  const slots = useEquippedSlots(userId, selfId)
  renders++
  return <output>{slots?.avatar_frame?.name ?? "无装扮"}</output>
}

const container = document.createElement("main")
document.body.append(container)
const root = createRoot(container)

function frame(name: string): Record<string, EquippedSlot> {
  return {
    avatar_frame: {
      item_id: name,
      category_key: "avatar_frame",
      slot: "avatar_frame",
      name,
      assets: {},
      payload: {},
    },
  }
}

export async function runScenario(scenario: string) {
  await act(async () => {
    useCosmeticsStore.getState().reset()
    useAuthStore.setState({ user: null })
  })
  renders = 0
  await act(async () => {
    root.render(
      <StrictMode>
        <CosmeticsProbe userId="member" />
      </StrictMode>
    )
  })
  const initial = container.textContent
  const before = renders
  await act(async () => {
    const store = useCosmeticsStore.getState()
    if (scenario === "unrelated") {
      store.setPoints(100)
      store.setEquippedForUser("other", frame("其他人的头像框"))
    } else if (scenario === "equipped") {
      store.setEquippedForUser("member", frame("新头像框"))
    } else if (scenario === "self") {
      useAuthStore.setState({
        user: { id: "member" } as NonNullable<
          ReturnType<typeof useAuthStore.getState>["user"]
        >,
      })
      useCosmeticsStore.setState({ loadout: frame("本人头像框") })
      store.setEquippedForUser("member", frame("旧缓存"))
    } else if (scenario === "reset") {
      store.setEquippedForUser("member", frame("即将清空"))
    } else if (scenario === "switch-user") {
      store.setEquippedForUser("other", frame("另一位成员"))
    }
  })
  const updated = container.textContent
  const after = renders
  if (scenario === "self") {
    await act(async () => {
      useAuthStore.setState({ user: null })
    })
  } else if (scenario === "reset") {
    await act(async () => {
      useCosmeticsStore.getState().reset()
    })
  } else if (scenario === "equipped") {
    await act(async () => {
      useCosmeticsStore.getState().applyLoadoutUpdate("member", {})
    })
  } else if (scenario === "switch-user") {
    await act(async () => {
      root.render(
        <StrictMode>
          <CosmeticsProbe userId="other" />
        </StrictMode>
      )
    })
  }
  return { initial, updated, final: container.textContent, before, after }
}
