// 舞台 / 屏幕共享服务端错误码 → 中文文案（docs 10 §3 / docs 11 FR-09）。
// 错误码来源：Newt-Server internal/stage/api.go；映射模式对齐 connection.ts joinErrorMessage。

import { ApiError } from "~/lib/api/http"

/** 舞台域（举手 / 抱上 / 抱下 / 模式切换）错误码映射 */
export function stageErrorMessage(
  error: unknown,
  fallback = "操作失败，请稍后再试"
): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "STAGE_FULL":
        return "台上名额已满，请先移下他人"
      case "STAGE_QUEUE_FULL":
        return "申请队列已满，请稍后再试"
      case "STAGE_NOT_ACTIVE":
        return "该频道当前不是舞台模式"
      case "STAGE_REQUEST_DISABLED":
        return "本频道由管理员邀请上麦，暂不接受举手申请"
      case "STAGE_ALREADY_SPEAKER":
        return "该成员已在台上"
      case "STAGE_NOT_SPEAKER":
        return "该成员不在台上"
      case "STAGE_REQUIRED_BY_CAPACITY":
        return "频道人数超过 50，无法切回自由讨论"
      case "NOT_IN_VOICE":
        return "请先加入该语音频道"
      case "NOT_VOICE_CHANNEL":
        return "该频道不是语音频道"
      case "RESTRICTED":
        return "你已被限制该操作"
      case "FORBIDDEN":
        return "权限不足"
      case "NETWORK_ERROR":
        return "网络请求失败，请检查网络连接"
    }
    if (error.status === 403) return "权限不足"
    if (error.status === 404) return "频道不存在或不可见"
  }
  return fallback
}

/** 屏幕共享（start/stop/stop-user）错误码映射；QUOTA 附当前占用/上限 */
export function screenErrorMessage(
  error: unknown,
  quota?: { used: number; effective_limit: number } | null
): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "STREAM_PERMISSION":
        return "你没有屏幕共享权限"
      case "STAGE_SPEAKER_REQUIRED":
        return "舞台模式下仅台上成员可共享屏幕"
      case "NOT_IN_VOICE":
        return "请先加入该语音频道"
      case "SCREEN_QUOTA_EXCEEDED":
        return quota
          ? `共享名额已满（${quota.used}/${quota.effective_limit}），请稍后再试`
          : "共享名额已满，请稍后再试"
      case "SCREEN_ALREADY_ACTIVE":
        return "你已有一路共享正在进行"
      case "SCREEN_QUALITY_NOT_ALLOWED":
        return "当前身份不允许该清晰度档位"
      case "SCREEN_NOT_FOUND":
        return "该共享已结束"
      case "RESTRICTED":
        return "你已被限制该操作"
      case "FORBIDDEN":
        return "权限不足"
      case "NETWORK_ERROR":
        return "网络请求失败，请检查网络连接"
    }
    if (error.status === 403) return "权限不足"
    if (error.status === 404) return "频道不存在或不可见"
  }
  return "屏幕共享操作失败，请稍后再试"
}

/** SCREEN_SHARE_STOP reason → 发布端中文 toast（reason=self 无提示返回 null） */
export function screenStopReasonMessage(
  reason: string | undefined
): string | null {
  switch (reason) {
    case "self":
      return null
    case "admin":
      return "你的屏幕共享已被管理员结束"
    case "demote":
      return "你已离开台上，屏幕共享已停止"
    case "quota":
      return "因服务器负载，你的屏幕共享已被系统结束"
    case "disconnect":
      return "连接中断，屏幕共享已结束"
    case "timeout":
      return "屏幕共享发布超时，已释放名额"
    default:
      return "你的屏幕共享已结束"
  }
}
