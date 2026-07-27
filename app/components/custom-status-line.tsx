// 自定义状态一行展示：小表情贴图 + 文案（已过期则不渲染）。

import { CustomEmoteImg } from "~/components/messages/custom-emote"
import { cn } from "~/lib/utils"
import {
  customStatusTitle,
  hasCustomStatus,
  statusEmoteItemId,
  type CustomPresence,
} from "~/stores/presence"

export function CustomStatusLine({
  custom,
  className,
  title,
  emoteSize = 14,
}: {
  custom?: CustomPresence | null
  className?: string
  title?: string
  emoteSize?: number
}) {
  if (!hasCustomStatus(custom)) return null
  const text = custom?.text?.trim() ?? ""
  const itemId = statusEmoteItemId(custom)
  const label = title ?? customStatusTitle(custom)

  return (
    <p
      className={cn(
        "flex min-w-0 items-center gap-1 text-xs leading-snug text-muted-foreground",
        className,
      )}
      title={label}
    >
      {itemId ? (
        <CustomEmoteImg
          itemId={itemId}
          size={emoteSize}
          className="shrink-0"
          alt=""
        />
      ) : null}
      {text ? (
        <span className="min-w-0 truncate">{text}</span>
      ) : null}
    </p>
  )
}
