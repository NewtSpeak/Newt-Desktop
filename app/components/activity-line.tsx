// 主活动展示：封面缩略图 + 「正在玩 原神」

import { resolveApiUrl } from "~/lib/api/http"
import { cn } from "~/lib/utils"
import {
  formatPrimaryActivity,
  primaryActivityCover,
} from "~/stores/presence"
import type { PresenceActivity } from "~/lib/gateway/events"

function coverSrc(url: string | undefined): string | undefined {
  if (!url) return undefined
  return resolveApiUrl(url)
}

export function ActivityLine({
  activities,
  className,
  title,
  /** 是否显示封面（列表小图 / 资料卡可开） */
  showCover = true,
  coverSize = 16,
}: {
  activities?: PresenceActivity[] | null
  className?: string
  title?: string
  showCover?: boolean
  coverSize?: number
}) {
  const label = formatPrimaryActivity(activities)
  if (!label) return null
  const cover = showCover
    ? coverSrc(primaryActivityCover(activities))
    : undefined
  const a = activities?.[0]
  const sub =
    a?.details || a?.state
      ? [a.details, a.state].filter(Boolean).join(" · ")
      : undefined

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-xs leading-snug text-muted-foreground",
        className,
      )}
      title={title ?? (sub ? `${label}\n${sub}` : label)}
    >
      {cover ? (
        <img
          src={cover}
          alt=""
          width={coverSize}
          height={coverSize}
          className="shrink-0 rounded object-cover ring-1 ring-border/60"
          style={{ width: coverSize, height: coverSize }}
          loading="lazy"
          referrerPolicy="no-referrer"
          draggable={false}
        />
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
    </div>
  )
}

/** 资料卡用：较大封面 + 名称 + 详情 */
export function ActivityCard({
  activities,
  className,
}: {
  activities?: PresenceActivity[] | null
  className?: string
}) {
  const a = activities?.[0]
  if (!a?.name) return null
  const label = formatPrimaryActivity(activities)
  const cover = coverSrc(primaryActivityCover(activities))
  const sub = [a.details, a.state].filter(Boolean).join(" · ")

  return (
    <div
      className={cn(
        "mt-2 flex items-stretch gap-2.5 rounded-xl border border-border/60 bg-muted/30 p-2",
        className,
      )}
    >
      {cover ? (
        <img
          src={cover}
          alt=""
          className="size-14 shrink-0 rounded-lg object-cover ring-1 ring-border/50"
          loading="lazy"
          referrerPolicy="no-referrer"
          draggable={false}
        />
      ) : (
        <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">
          无封面
        </div>
      )}
      <div className="min-w-0 flex-1 self-center">
        <p className="truncate text-[12px] font-medium text-foreground">
          {label}
        </p>
        {sub ? (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {sub}
          </p>
        ) : null}
      </div>
    </div>
  )
}
