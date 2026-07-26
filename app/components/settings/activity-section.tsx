// 活跃度页：等级卡（等级/总分/下一级进度/积分加成）+ 今日活跃卡（四维计数）+
// 最近 14 天历史（迷你柱状图 + 列表）。数据来自 activity store；
// ACTIVITY_UPDATE 实时事件经 gateway-bindings 写入 store 后本组件自动响应。
// 动效遵循全局 MOTION 节奏：入场分块 stagger、数字 number pop-in、
// 进度条可中断 CSS 过渡、升级徽章脉冲；全部尊重 prefers-reduced-motion。

import { useEffect, useRef } from "react"
import {
  CoinsIcon,
  FlameIcon,
  LogInIcon,
  MessageSquareIcon,
  MicIcon,
  RotateCcwIcon,
  SmilePlusIcon,
} from "lucide-react"
import { Bar, BarChart, Cell, XAxis } from "recharts"

import { SectionTitle, GroupLabel } from "~/components/settings/section"
import { settingsAnchorDomId } from "~/components/settings/settings-toc"
import { Skeleton } from "~/components/ui/skeleton"
import { ChartContainer, ChartTooltip, type ChartConfig } from "~/components/ui/chart"
import { gsap, MOTION, MOTION_OK, useGSAP } from "~/lib/gsap"
import { cn } from "~/lib/utils"
import { useActivityStore } from "~/stores/activity"
import type { ActivityHistoryEntry, MyActivity } from "~/lib/api/activity"

/** 细进度条（0-100）：可中断的 CSS 宽度过渡，实时事件到达平滑续走 */
function ProgressBar({
  percent,
  className,
  barClassName,
}: {
  percent: number
  className?: string
  barClassName?: string
}) {
  const clamped = Math.min(100, Math.max(0, percent))
  return (
    <div
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-muted/70",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full bg-primary transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
          barClassName,
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

/** 今日单维度行：图标 + label + 计数/上限（计数变化 number pop）+ 细进度条 */
function TodayMetricRow({
  icon: Icon,
  label,
  count,
  cap,
  unit,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  count: number
  cap: number
  unit?: string
}) {
  const capped = Math.min(count, cap)
  const percent = cap > 0 ? (capped / cap) * 100 : 0
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-2 text-foreground/90">
          <Icon className="size-4 text-muted-foreground" />
          {label}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          <span key={count} className="t-number-pop">
            {count}
          </span>{" "}
          / {cap}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <ProgressBar percent={percent} className="mt-1.5 h-1" />
    </div>
  )
}

/** 今日预计积分 = floor(预估分 × 换算率 × (1 + 等级加成%)) */
function estimatePoints(summary: MyActivity): number {
  return Math.floor(
    summary.today.score_estimate *
      summary.points_rate *
      (1 + summary.level_bonus_pct / 100),
  )
}

/** 历史日期展示：截取 MM-DD */
function formatDay(day: string): string {
  return day.length >= 10 ? day.slice(5) : day
}

const historyChartConfig = {
  score: { label: "得分", color: "var(--chart-1)" },
} satisfies ChartConfig

/** 历史柱状图 tooltip：日期 / 得分 / 积分或待结算（不单靠颜色传义） */
function HistoryTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload?: ActivityHistoryEntry }>
}) {
  const entry = payload?.[0]?.payload
  if (!active || !entry) return null
  return (
    <div className="rounded-lg border border-border/60 bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-medium tabular-nums">{entry.day}</p>
      <p className="mt-0.5 text-muted-foreground">
        得分 <span className="text-foreground tabular-nums">{entry.score}</span>
      </p>
      {entry.granted ? (
        <p className="text-amber-500 tabular-nums">+{entry.granted_points} 积分</p>
      ) : (
        <p className="text-muted-foreground">待结算</p>
      )}
    </div>
  )
}

/** 加载骨架：镜像三块卡片的高度轮廓，避免内容到达时布局跳动 */
function ActivitySkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-[120px] rounded-xl" />
      <div>
        <Skeleton className="mb-2 h-4 w-16" />
        <Skeleton className="h-[248px] rounded-xl" />
      </div>
      <div>
        <Skeleton className="mb-2 h-4 w-16" />
        <Skeleton className="h-[200px] rounded-xl" />
      </div>
    </div>
  )
}

export function ActivitySection() {
  const summary = useActivityStore((s) => s.summary)
  const status = useActivityStore((s) => s.status)
  const containerRef = useRef<HTMLDivElement>(null)
  // 记录上一次渲染的等级：仅"变高"时触发徽章脉冲（首次加载不脉冲）
  const prevLevelRef = useRef<number | null>(null)

  useEffect(() => {
    void useActivityStore.getState().load().catch(() => undefined)
  }, [])

  // 入场编排：summary 首次到达后对三块卡做 stagger 入场；
  // delay 避开外层 .settings-section-enter（180ms）的节奏叠加。
  useGSAP(
    () => {
      if (!summary) return
      const media = gsap.matchMedia()
      media.add(MOTION_OK, () => {
        gsap.from("[data-activity-card]", {
          autoAlpha: 0,
          y: 12,
          duration: MOTION.enter,
          ease: MOTION.ease,
          stagger: 0.06,
          delay: 0.1,
          clearProps: "all",
        })
      })
    },
    { dependencies: [Boolean(summary)], scope: containerRef },
  )

  const levelPopped =
    summary != null &&
    prevLevelRef.current != null &&
    summary.level > prevLevelRef.current
  useEffect(() => {
    if (summary) prevLevelRef.current = summary.level
  }, [summary])

  const chartData = summary ? [...summary.history].reverse() : []

  return (
    <div ref={containerRef} className="space-y-6">
      <div>
        <SectionTitle>活跃度</SectionTitle>
        <p className="-mt-3 text-sm text-muted-foreground">
          发消息、语音在线、回应与每日登录都会累积活跃度分；每日结算自动发放积分，
          等级越高积分加成越多。
        </p>
      </div>

      {status === "loading" && !summary ? <ActivitySkeleton /> : null}
      {status === "error" && !summary ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-border/60 bg-card/40 p-4">
          <p className="text-sm text-muted-foreground">
            活跃度数据加载失败，请稍后重试。
          </p>
          <button
            type="button"
            onClick={() => {
              void useActivityStore.getState().load().catch(() => undefined)
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-sm transition-[background-color,transform] hover:bg-muted/60 active:scale-[0.96]"
          >
            <RotateCcwIcon className="size-3.5" />
            重试
          </button>
        </div>
      ) : null}

      {summary ? (
        <>
          {/* 等级卡 */}
          <div
            id={settingsAnchorDomId("activity-level")}
            data-activity-card
            className="scroll-mt-6 rounded-xl border border-border/60 bg-linear-to-t from-orange-500/8 to-card/40 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  key={summary.level}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full bg-orange-500/15 px-3 py-1.5 text-lg font-bold text-orange-500",
                    levelPopped && "level-pop",
                  )}
                >
                  <FlameIcon className="size-5" />
                  Lv.{summary.level}
                </span>
                <div>
                  <p className="text-xs text-muted-foreground">总活跃度分</p>
                  <p className="text-base font-semibold tabular-nums">
                    <span key={summary.total_score} className="t-number-pop">
                      {summary.total_score}
                    </span>
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-500">
                <CoinsIcon className="size-3.5" />
                <span key={summary.level_bonus_pct} className="t-number-pop tabular-nums">
                  +{summary.level_bonus_pct}%
                </span>
                每日积分加成
              </span>
            </div>

            <div className="mt-4">
              {summary.next_level ? (
                <>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      距离 Lv.{summary.next_level.level}（
                      <span className="tabular-nums">
                        {summary.next_level.threshold}
                      </span>{" "}
                      分）
                    </span>
                    <span className="tabular-nums">
                      {summary.next_level.progress_pct.toFixed(1)}%
                    </span>
                  </div>
                  <ProgressBar
                    percent={summary.next_level.progress_pct}
                    className="mt-1.5"
                    barClassName="bg-orange-500"
                  />
                </>
              ) : (
                <p className="text-xs font-medium text-orange-500">已满级</p>
              )}
            </div>
          </div>

          {/* 今日活跃卡 */}
          <div data-activity-card>
            <GroupLabel id="activity-today">今日活跃</GroupLabel>
            <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-2">
              <TodayMetricRow
                icon={MessageSquareIcon}
                label="消息"
                count={summary.today.msg_count}
                cap={summary.caps.message}
              />
              <TodayMetricRow
                icon={MicIcon}
                label="语音"
                count={summary.today.voice_minutes}
                cap={summary.caps.voice_minutes}
                unit="分钟"
              />
              <TodayMetricRow
                icon={SmilePlusIcon}
                label="回应"
                count={summary.today.reaction_count}
                cap={summary.caps.reactions}
              />
              <TodayMetricRow
                icon={LogInIcon}
                label="登录"
                count={summary.today.login_count}
                cap={summary.caps.login}
              />

              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 py-3 text-sm">
                <span className="text-muted-foreground">
                  今日预估分{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    <span key={summary.today.score_estimate} className="t-number-pop">
                      {summary.today.score_estimate}
                    </span>
                  </span>
                </span>
                <span className="inline-flex items-center gap-1 text-amber-500">
                  <CoinsIcon className="size-3.5" />
                  预计积分{" "}
                  <span className="font-semibold tabular-nums">
                    <span key={estimatePoints(summary)} className="t-number-pop">
                      {estimatePoints(summary)}
                    </span>
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* 历史卡 */}
          <div data-activity-card>
            <GroupLabel id="activity-history">历史记录</GroupLabel>
            {summary.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无历史记录</p>
            ) : (
              <div className="rounded-xl border border-border/60 bg-card/40 px-4">
                {chartData.length > 1 ? (
                  <div className="border-b border-border/50 pt-3 pb-1">
                    <ChartContainer
                      config={historyChartConfig}
                      className="h-[112px] w-full"
                    >
                      <BarChart data={chartData} margin={{ top: 4, left: 0, right: 0 }}>
                        <XAxis
                          dataKey="day"
                          tickFormatter={formatDay}
                          tickLine={false}
                          axisLine={false}
                          fontSize={10}
                          interval="preserveStartEnd"
                        />
                        <ChartTooltip cursor={false} content={<HistoryTooltip />} />
                        <Bar dataKey="score" radius={[3, 3, 0, 0]} maxBarSize={18}>
                          {chartData.map((entry) => (
                            <Cell
                              key={entry.day}
                              fill="var(--color-score)"
                              fillOpacity={entry.granted ? 0.9 : 0.35}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  </div>
                ) : null}
                <div className="divide-y divide-border/50">
                  {summary.history.map((entry, index) => (
                    <div
                      key={entry.day}
                      className="anim-item flex items-center justify-between gap-3 py-2.5 text-sm"
                      style={{ "--stagger-index": index } as React.CSSProperties}
                    >
                      <span className="w-14 shrink-0 text-muted-foreground tabular-nums">
                        {formatDay(entry.day)}
                      </span>
                      <span className="flex-1 text-right text-foreground/90 tabular-nums">
                        {entry.score} 分
                      </span>
                      <span
                        key={String(entry.granted)}
                        className={cn(
                          "t-text-swap w-20 shrink-0 text-right text-xs",
                          entry.granted
                            ? "font-medium text-amber-500 tabular-nums"
                            : "text-muted-foreground",
                        )}
                      >
                        {entry.granted ? `+${entry.granted_points} 积分` : "待结算"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
