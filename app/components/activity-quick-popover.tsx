// 标题栏"活跃度速览"：主题按钮右侧的常驻入口，点击弹出悬浮窗展示
// 等级/总活跃分/下一级进度/积分余额/今日四维速览，底部可跳转设置页完整视图。
// Popover 范式与 notifications-inbox 一致（base-ui 受控 open）；
// 动效复用全局资产：.t-number-pop / .anim-item / .level-pop，全部受 reduced-motion 约束。

import { useEffect, useRef, useState } from "react"
import {
  ChevronRightIcon,
  CoinsIcon,
  FlameIcon,
  LogInIcon,
  MessageSquareIcon,
  MicIcon,
  RotateCcwIcon,
  SmilePlusIcon,
} from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover"
import { Skeleton } from "~/components/ui/skeleton"
import { cn } from "~/lib/utils"
import { useActivityStore } from "~/stores/activity"
import { useAuthStore } from "~/stores/auth"
import { useCosmeticsStore } from "~/stores/cosmetics"
import { useSettingsStore } from "~/stores/settings"
import type { MyActivity } from "~/lib/api/activity"

// 与 titlebar-controls 的图标按钮同款热区/反馈（32px + hover/active/focus ring）
const triggerClass =
  "relative flex size-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring/50"

/** 今日预计积分 = floor(预估分 × 换算率 × (1 + 等级加成%)) */
function estimatePoints(summary: MyActivity): number {
  return Math.floor(
    summary.today.score_estimate *
      summary.points_rate *
      (1 + summary.level_bonus_pct / 100),
  )
}

/** 今日四维迷你格 */
function MiniMetric({
  icon: Icon,
  label,
  count,
  cap,
  index,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  count: number
  cap: number
  index: number
}) {
  return (
    <div
      className="anim-item flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-2"
      style={{ "--stagger-index": index } as React.CSSProperties}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        <span key={count} className="t-number-pop">
          {count}
        </span>
        /{cap}
      </span>
    </div>
  )
}

/** 悬浮窗主体内容（summary 已就绪） */
function QuickContent({
  summary,
  points,
  onOpenFull,
}: {
  summary: MyActivity
  points: number
  onOpenFull: () => void
}) {
  return (
    <>
      {/* 头部：Lv 胶囊 + 总活跃分 */}
      <div
        className="anim-item flex items-center justify-between gap-3 px-4 pt-4"
        style={{ "--stagger-index": 0 } as React.CSSProperties}
      >
        <span
          key={summary.level}
          className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/15 px-2.5 py-1 text-sm font-bold text-orange-500"
        >
          <FlameIcon className="size-4" />
          Lv.{summary.level}
        </span>
        <div className="text-right">
          <p className="text-[11px] text-muted-foreground">总活跃分</p>
          <p className="text-sm font-semibold tabular-nums">
            <span key={summary.total_score} className="t-number-pop">
              {summary.total_score}
            </span>
          </p>
        </div>
      </div>

      {/* 等级进度 */}
      <div
        className="anim-item px-4 pt-3"
        style={{ "--stagger-index": 1 } as React.CSSProperties}
      >
        {summary.next_level ? (
          <>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>距离 Lv.{summary.next_level.level}</span>
              <span className="tabular-nums">
                {summary.next_level.progress_pct.toFixed(1)}%
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/70">
              <div
                className="h-full rounded-full bg-orange-500 transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{
                  width: `${Math.min(100, Math.max(0, summary.next_level.progress_pct))}%`,
                }}
              />
            </div>
          </>
        ) : (
          <p className="text-[11px] font-medium text-orange-500">已满级</p>
        )}
      </div>

      {/* 积分余额行 */}
      <div
        className="anim-item mt-3 flex items-center justify-between gap-2 border-t border-border/50 px-4 py-2.5"
        style={{ "--stagger-index": 2 } as React.CSSProperties}
      >
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <CoinsIcon className="size-4 text-amber-500" />
          我的积分
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="text-sm font-semibold tabular-nums">
            <span key={points} className="t-number-pop">
              {points}
            </span>
          </span>
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-500 tabular-nums">
            +{summary.level_bonus_pct}% 加成
          </span>
        </span>
      </div>

      {/* 今日速览 2×2 */}
      <div className="border-t border-border/50 px-4 py-3">
        <p
          className="anim-item mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
          style={{ "--stagger-index": 3 } as React.CSSProperties}
        >
          今日活跃
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <MiniMetric
            icon={MessageSquareIcon}
            label="消息"
            count={summary.today.msg_count}
            cap={summary.caps.message}
            index={4}
          />
          <MiniMetric
            icon={MicIcon}
            label="语音"
            count={summary.today.voice_minutes}
            cap={summary.caps.voice_minutes}
            index={5}
          />
          <MiniMetric
            icon={SmilePlusIcon}
            label="回应"
            count={summary.today.reaction_count}
            cap={summary.caps.reactions}
            index={6}
          />
          <MiniMetric
            icon={LogInIcon}
            label="登录"
            count={summary.today.login_count}
            cap={summary.caps.login}
            index={7}
          />
        </div>
        <div
          className="anim-item mt-2 flex items-center justify-between text-xs"
          style={{ "--stagger-index": 8 } as React.CSSProperties}
        >
          <span className="text-muted-foreground">
            今日预估分{" "}
            <span className="font-semibold text-foreground tabular-nums">
              <span key={summary.today.score_estimate} className="t-number-pop">
                {summary.today.score_estimate}
              </span>
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-amber-500">
            <CoinsIcon className="size-3" />
            预计{" "}
            <span className="font-semibold tabular-nums">
              <span key={estimatePoints(summary)} className="t-number-pop">
                +{estimatePoints(summary)}
              </span>
            </span>
          </span>
        </div>
      </div>

      {/* 底部操作 */}
      <button
        type="button"
        onClick={onOpenFull}
        className="flex w-full items-center justify-center gap-1 border-t border-border/50 py-2.5 text-xs text-muted-foreground transition-[background-color,color,transform] hover:bg-muted/50 hover:text-foreground active:scale-[0.98]"
      >
        查看完整活跃度
        <ChevronRightIcon className="size-3.5" />
      </button>
    </>
  )
}

/** 骨架：镜像内容高度轮廓，防止数据到达时悬浮窗尺寸跳动 */
function QuickSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-16 rounded-full" />
        <Skeleton className="h-8 w-14" />
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
      <Skeleton className="h-9 w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-1.5">
        <Skeleton className="h-8 rounded-lg" />
        <Skeleton className="h-8 rounded-lg" />
        <Skeleton className="h-8 rounded-lg" />
        <Skeleton className="h-8 rounded-lg" />
      </div>
    </div>
  )
}

export function ActivityQuickButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const authed = useAuthStore((s) => s.status === "authenticated")
  const summary = useActivityStore((s) => s.summary)
  const status = useActivityStore((s) => s.status)
  const points = useCosmeticsStore((s) => s.points)
  // 记录上一次等级：popover 打开期间升级时给 Lv 胶囊补脉冲
  const prevLevelRef = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    const activity = useActivityStore.getState()
    if (!activity.summary || activity.status === "idle" || activity.status === "error") {
      void activity.load().catch(() => undefined)
    }
    void useCosmeticsStore.getState().loadPoints().catch(() => undefined)
  }, [open])

  useEffect(() => {
    if (summary) prevLevelRef.current = summary.level
  }, [summary])

  if (!authed) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="活跃度与积分"
        className={cn(triggerClass, className)}
      >
        <FlameIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="w-[min(100vw-1rem,20rem)] gap-0 overflow-hidden p-0 pb-0 shadow-lg"
      >
        {summary ? (
          <QuickContent
            summary={summary}
            points={points}
            onOpenFull={() => {
              setOpen(false)
              useSettingsStore.getState().openPanel("activity")
            }}
          />
        ) : status === "error" ? (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <p className="text-sm text-muted-foreground">活跃度数据加载失败</p>
            <button
              type="button"
              onClick={() => {
                void useActivityStore.getState().load().catch(() => undefined)
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs transition-[background-color,transform] hover:bg-muted/60 active:scale-[0.96]"
            >
              <RotateCcwIcon className="size-3" />
              重试
            </button>
          </div>
        ) : (
          <QuickSkeleton />
        )}
      </PopoverContent>
    </Popover>
  )
}
