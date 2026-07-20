// 舞台事件 → 本人侧通知与联动（docs 10 FR-18/FR-17/FR-21/FR-24）。
//
// VOICE_STATE_UPDATE（stage 增量形态）在写入 voice store 之前调用
// handleSelfStageTransitions：对比事件前后的 stage_role / capacity_muted，
// 产出「被抱上台 / 被抱下 / 容量禁说解除」提示，并在被抱下时停止屏幕共享。
// 被抱上台不自动开麦（保持当前 self_mute，对标 Discord）。
//
// 主动操作（下麦 / 取消举手）通过 markSelfStageAction 预先打标，
// 避免随之而来的角色回落事件被误判为「被管理员抱下 / 被移出队列」。

import { toast } from "sonner"

import type {
  StageInstanceUpdatePayload,
  VoiceStateUpdatePayload,
} from "~/lib/gateway/events"
import { useAuthStore } from "~/stores/auth"
import { normalizeStageRole, useStageStore } from "~/stores/stage"
import { useVoiceStore } from "~/stores/voice"
import { screenShare } from "./screen-share"

/** 主动操作（self-leave / cancel apply）后的静默窗口 */
const SELF_ACTION_GRACE_MS = 5_000

let lastSelfActionAt = 0

/** 主动下麦 / 取消举手前调用：随后的角色回落事件不再提示「被抱下/被移出」 */
export function markSelfStageAction() {
  lastSelfActionAt = Date.now()
}

function withinSelfActionGrace(): boolean {
  return Date.now() - lastSelfActionAt < SELF_ACTION_GRACE_MS
}

/** 事件应用前从 voice store 找到自己的现存状态（跨频道扫描，与 store 合并逻辑一致） */
function findSelfCurrentState(userId: string) {
  const byChannel = useVoiceStore.getState().byChannel
  for (const states of Object.values(byChannel)) {
    const found = states.find((item) => item.user_id === userId)
    if (found) return found
  }
  return undefined
}

/**
 * VOICE_STATE_UPDATE 前置钩子：仅处理本人的 stage 增量字段迁移。
 * 必须在 applyVoiceStateUpdate 之前调用（依赖 store 中的「旧值」做对比）。
 */
export function handleSelfStageTransitions(payload: VoiceStateUpdatePayload) {
  const selfId = useAuthStore.getState().user?.id
  if (!selfId || payload.user_id !== selfId) return
  const hasRole = Object.prototype.hasOwnProperty.call(payload, "stage_role")
  const hasCapacity = Object.prototype.hasOwnProperty.call(
    payload,
    "capacity_muted"
  )
  if (!hasRole && !hasCapacity) return

  const previous = findSelfCurrentState(selfId)
  const prevRole = normalizeStageRole(previous?.stage_role)
  const nextRole = hasRole ? normalizeStageRole(payload.stage_role) : prevRole

  if (nextRole !== prevRole) {
    if (nextRole === "SPEAKER") {
      // 被抱上台（FR-18）：显著提示，不自动开麦（保持当前 self_mute）
      toast.success("你已被邀请上台，麦克风已可用，请手动开麦发言", {
        duration: 8000,
      })
    } else if (prevRole === "SPEAKER") {
      // 失去 SPEAKER：停止屏幕共享（若在播，docs 11 FR-10），主动下麦不提示
      screenShare.stopSilently()
      if (!withinSelfActionGrace()) {
        toast.info("你已被移至听众席")
      }
    } else if (
      prevRole === "QUEUED" &&
      nextRole === "AUDIENCE" &&
      !withinSelfActionGrace()
    ) {
      // 被移出队列 / 举手过期（FR-14；事件载荷暂无法区分两者）
      toast.info("你的举手申请已被移出队列，可重新申请")
    }
  }

  // 容量禁说解除（FR-24）：解除 ≠ 可直接发言，文案不得暗示可开麦
  const prevCapacity = Boolean(previous?.capacity_muted)
  const nextCapacity = hasCapacity
    ? Boolean(payload.capacity_muted)
    : prevCapacity
  if (prevCapacity && !nextCapacity) {
    toast.info("人数已回落，你的收听限制已解除")
  }
}

/**
 * STAGE_INSTANCE_UPDATE 前置钩子：本人所在频道的模式切换 toast（FR-03/FR-21）。
 * 在 applyInstanceUpdate 之前调用（依赖 store 中的旧模式做对比）。
 */
export function handleStageInstanceNotify(payload: StageInstanceUpdatePayload) {
  const session = useVoiceStore.getState().session
  if (
    !session ||
    !payload.channel_id ||
    session.channelId !== payload.channel_id
  )
    return
  const previous = useStageStore.getState().byChannel[payload.channel_id]
  if (
    !payload.mode ||
    !previous?.instanceKnown ||
    previous.mode === payload.mode
  )
    return
  if (payload.mode === "STAGE") {
    toast.info("频道已切换为舞台模式，仅台上成员可发言")
  } else {
    toast.info("频道已切换为自由讨论模式")
  }
}
