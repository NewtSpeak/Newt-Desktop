// 底部语音状态面板（docs 09 FR-16 / docs 13 §4，对标 Discord 左下角）：
// 连接状态文案 + 频道名 + 静音/闭听/断开按钮 + 连接质量占位（绿点）。
// 迁移/重连仅微弱提示（UX-01 模糊措辞：「线路优化中…」「网络重连中…」，禁 Toast/模态）；
// 重连持续 >30s 升级文案并提供重试入口（UX-05，仍不引导离开频道）。
// 放在频道列表栏底部、用户区上方（channel-list.tsx 挂载）。

import { useEffect, useState } from "react"
import {
  HeadphoneOffIcon,
  HeadphonesIcon,
  MicIcon,
  MicOffIcon,
  MonitorUpIcon,
  PhoneOffIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group"
import type { ScreenQuality } from "~/lib/api/types"
import { voiceConnection } from "~/lib/voice/connection"
import { screenShare, SCREEN_QUALITIES } from "~/lib/voice/screen-share"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import {
  inferChannelMode,
  normalizeStageRole,
  useStageStore,
} from "~/stores/stage"
import { useVoiceStore, type VoicePhase } from "~/stores/voice"

/** 重连超过该时长后升级文案并给出重试按钮（UX-05） */
const RECOVERING_ESCALATE_MS = 30_000

function phaseLabel(phase: VoicePhase): string {
  switch (phase) {
    case "joining":
      return "正在加入语音…"
    case "signaling":
      return "信令连接中…"
    case "negotiating":
      return "协商中…"
    case "connected":
      return "语音已连接"
    case "recovering":
      return "网络重连中…"
    case "suspended":
      return "等待网络…"
    default:
      return ""
  }
}

/** recoveringSince 超过 30s 时置 true（每秒重估） */
function useRecoveryEscalated(recoveringSince: number | null): boolean {
  const [escalated, setEscalated] = useState(false)
  useEffect(() => {
    if (!recoveringSince) {
      setEscalated(false)
      return
    }
    const evaluate = () =>
      setEscalated(Date.now() - recoveringSince >= RECOVERING_ESCALATE_MS)
    evaluate()
    const timer = setInterval(evaluate, 1_000)
    return () => clearInterval(timer)
  }, [recoveringSince])
  return escalated
}

/** 屏幕共享质量档选择弹窗（480p/720p/1080p，docs 11 FR-03 简版） */
function ScreenQualityDialog({
  open,
  onOpenChange,
  onStart,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStart: (quality: ScreenQuality) => void
}) {
  const [quality, setQuality] = useState<ScreenQuality>("720p")
  const labels: Record<ScreenQuality, string> = {
    "480p": "480p · 流畅（15fps）",
    "720p": "720p · 标准（30fps，推荐）",
    "1080p": "1080p · 高清（30fps）",
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>共享屏幕</DialogTitle>
          <DialogDescription>
            选择画面质量后开始共享，接下来在系统弹窗中选择要共享的屏幕或窗口。
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={quality}
          onValueChange={(value) => setQuality(value as ScreenQuality)}
          className="gap-2"
        >
          {SCREEN_QUALITIES.map((item) => (
            <label
              key={item}
              className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm hover:bg-accent/50"
            >
              <RadioGroupItem value={item} />
              {labels[item]}
            </label>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false)
              onStart(quality)
            }}
          >
            开始共享
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function VoicePanel() {
  const session = useVoiceStore((state) => state.session)
  const channelName = useChannelsStore((state) => {
    if (!session) return null
    const channels = state.byGuild[session.guildId]
    return (
      channels?.find((channel) => channel.id === session.channelId)?.name ??
      null
    )
  })
  const escalated = useRecoveryEscalated(session?.recoveringSince ?? null)

  // 舞台与屏幕共享状态（docs 10 FR-25 / docs 11 FR-01/FR-13）
  const selfId = useAuthStore((state) => state.user?.id)
  const stage = useStageStore((state) =>
    session ? state.byChannel[session.channelId] : undefined
  )
  const channelStates = useVoiceStore((state) =>
    session ? state.byChannel[session.channelId] : undefined
  )
  const quota = useStageStore((state) =>
    session ? state.quotaByGuild[session.guildId] : undefined
  )
  const selfScreen = useStageStore((state) => state.selfScreen)
  const [qualityOpen, setQualityOpen] = useState(false)

  if (!session) return null

  const isStage = stage?.instanceKnown
    ? stage.mode === "STAGE"
    : inferChannelMode(channelStates) === "STAGE"
  const selfRole = normalizeStageRole(
    channelStates?.find((item) => item.user_id === selfId)?.stage_role
  )

  const connected = session.phase === "connected"
  const inRecovery =
    session.phase === "recovering" || session.phase === "suspended"
  const micBlocked =
    session.serverMute ||
    !session.caps.includes("publish_audio") ||
    session.listenOnly
  const muted = session.selfMute || micBlocked
  const micTitle = session.listenOnly
    ? "未获得麦克风权限"
    : session.serverMute
      ? "你已被服务器静音"
      : isStage && selfRole !== "SPEAKER" && micBlocked
        ? "舞台模式下需上台后才能发言"
        : !session.caps.includes("publish_audio") && session.caps.length > 0
          ? "你已被禁言"
          : session.selfMute
            ? "取消静音"
            : "静音"

  // 屏幕共享按钮三态：共享中（高亮停止）/ 舞台非台上（置灰）/ 可发起
  const sharing = selfScreen !== null && selfScreen.phase !== "idle"
  const stageBlocked = isStage && selfRole !== "SPEAKER"
  const screenDisabled = !connected || (stageBlocked && !sharing)
  const quotaText = quota
    ? `（本服 ${quota.used}/${quota.effective_limit}）`
    : ""
  const screenTitle = sharing
    ? "停止屏幕共享"
    : !connected
      ? "语音连接后才能共享屏幕"
      : stageBlocked
        ? "舞台模式下仅台上成员可共享屏幕"
        : quota &&
            quota.dynamic_enabled &&
            quota.effective_limit < quota.base_limit
          ? `共享屏幕${quotaText}·服务器负载较高，名额暂时下调`
          : `共享屏幕${quotaText}`

  const handleScreenClick = () => {
    if (sharing) {
      void screenShare.stop()
      return
    }
    if (!screenShare.isSupported()) {
      toast.error("当前环境不支持屏幕采集")
      return
    }
    // 配额缓存超 60s 未更新：进入发起流程前兜底刷新（docs 11 §6.9）
    if (!quota || Date.now() - quota.fetchedAt > 60_000) {
      void useStageStore.getState().fetchQuota(session.guildId)
    }
    setQualityOpen(true)
  }

  // >30s 未恢复：升级文案（UX-05）；耗尽自动重试后 error 文案优先
  const statusLabel =
    session.error ??
    (inRecovery && escalated
      ? "网络状况不佳，仍在重连…"
      : phaseLabel(session.phase))
  const showRetry = Boolean(session.error) || (inRecovery && escalated)

  return (
    <div className="shrink-0 border-t bg-sidebar">
      {/* 迁移微提示细条（docs 13 UX-01 模糊措辞，不打断、不清空成员列表） */}
      {session.migrating && (
        <div className="bg-amber-500/15 px-3 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
          线路优化中…
        </div>
      )}
      <div className="flex flex-col gap-1 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium",
                connected
                  ? "text-emerald-600 dark:text-emerald-400"
                  : session.error
                    ? "text-destructive"
                    : "text-amber-600 dark:text-amber-400"
              )}
            >
              {/* 连接质量占位：绿点；重连/迁移中黄点闪烁（信号图标变黄，UX-01） */}
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  connected ? "bg-emerald-500" : "animate-pulse bg-amber-500"
                )}
              />
              {statusLabel}
            </span>
            <span className="truncate text-xs text-sidebar-foreground/60">
              {channelName ?? "语音频道"}
            </span>
          </div>
          {showRetry && (
            <button
              type="button"
              onClick={() => voiceConnection.retry()}
              className="shrink-0 rounded-md bg-sidebar-accent px-2 py-1 text-xs text-sidebar-accent-foreground hover:opacity-80"
            >
              重试
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title={micTitle}
            aria-label={micTitle}
            disabled={micBlocked}
            onClick={() => voiceConnection.toggleMute()}
            className={cn(
              "flex flex-1 items-center justify-center rounded-md py-1.5 hover:bg-sidebar-accent",
              muted && "text-destructive",
              micBlocked && "cursor-not-allowed opacity-70 hover:bg-transparent"
            )}
          >
            {muted ? (
              <MicOffIcon className="size-4" />
            ) : (
              <MicIcon className="size-4" />
            )}
          </button>
          <button
            type="button"
            title={session.selfDeaf ? "取消闭听" : "闭听"}
            aria-label={session.selfDeaf ? "取消闭听" : "闭听"}
            onClick={() => voiceConnection.toggleDeaf()}
            className={cn(
              "flex flex-1 items-center justify-center rounded-md py-1.5 hover:bg-sidebar-accent",
              session.selfDeaf && "text-destructive"
            )}
          >
            {session.selfDeaf ? (
              <HeadphoneOffIcon className="size-4" />
            ) : (
              <HeadphonesIcon className="size-4" />
            )}
          </button>
          <button
            type="button"
            title={screenTitle}
            aria-label={screenTitle}
            disabled={screenDisabled}
            onClick={handleScreenClick}
            className={cn(
              "flex flex-1 items-center justify-center rounded-md py-1.5 hover:bg-sidebar-accent",
              sharing &&
                "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
              screenDisabled &&
                "cursor-not-allowed opacity-70 hover:bg-transparent"
            )}
          >
            <MonitorUpIcon className="size-4" />
          </button>
          <button
            type="button"
            title="断开语音"
            aria-label="断开语音"
            onClick={() => void voiceConnection.leave()}
            className="flex flex-1 items-center justify-center rounded-md py-1.5 text-destructive hover:bg-sidebar-accent"
          >
            <PhoneOffIcon className="size-4" />
          </button>
        </div>
      </div>
      <ScreenQualityDialog
        open={qualityOpen}
        onOpenChange={setQualityOpen}
        onStart={(quality) =>
          void screenShare.start(session.channelId, quality)
        }
      />
    </div>
  )
}
