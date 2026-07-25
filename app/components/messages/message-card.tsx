// Bot 消息卡片渲染：对齐 SDK 推荐 schema（title/description/color/fields/buttons/footer）。

import { ExternalLinkIcon } from "lucide-react"
import { memo, useMemo } from "react"

import { parseBotCard } from "~/lib/bot-card"
import { cn } from "~/lib/utils"

export type MessageCardProps = {
  card: unknown
  className?: string
}

export const MessageCard = memo(function MessageCard({
  card,
  className,
}: MessageCardProps) {
  const parsed = useMemo(() => parseBotCard(card), [card])
  if (!parsed) return null

  const inlineFields = parsed.fields?.filter((field) => field.inline) ?? []
  const blockFields = parsed.fields?.filter((field) => !field.inline) ?? []

  return (
    <div
      className={cn(
        "mt-1.5 max-w-md overflow-hidden rounded-lg border border-border/70 bg-muted/30 text-sm shadow-sm",
        className
      )}
      data-slot="bot-message-card"
    >
      <div className="flex min-w-0">
        <div
          className={cn(
            "w-1 shrink-0 self-stretch",
            !parsed.color && "bg-primary"
          )}
          style={parsed.color ? { backgroundColor: parsed.color } : undefined}
          aria-hidden
        />
        <div className="min-w-0 flex-1 p-3">
          <div className="flex gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              {parsed.title ? (
                <p className="font-semibold leading-snug text-foreground">
                  {parsed.title}
                </p>
              ) : null}
              {parsed.description ? (
                <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted-foreground">
                  {parsed.description}
                </p>
              ) : null}

              {inlineFields.length > 0 ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-1 sm:grid-cols-3">
                  {inlineFields.map((field, index) => (
                    <div key={`inline-${index}-${field.name}`} className="min-w-0">
                      <p className="truncate text-[11px] font-semibold text-muted-foreground">
                        {field.name}
                      </p>
                      <p className="break-words text-[13px] text-foreground">
                        {field.value}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

              {blockFields.length > 0 ? (
                <div className="space-y-2 pt-1">
                  {blockFields.map((field, index) => (
                    <div key={`block-${index}-${field.name}`} className="min-w-0">
                      <p className="text-[11px] font-semibold text-muted-foreground">
                        {field.name}
                      </p>
                      <p className="whitespace-pre-wrap break-words text-[13px] text-foreground">
                        {field.value}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {parsed.thumbnail ? (
              <img
                src={parsed.thumbnail}
                alt=""
                className="size-16 shrink-0 rounded-md object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : null}
          </div>

          {parsed.image ? (
            <img
              src={parsed.image}
              alt=""
              className="mt-2 max-h-56 w-full rounded-md object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : null}

          {parsed.buttons && parsed.buttons.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {parsed.buttons.map((button) => (
                <a
                  key={`${button.label}-${button.url}`}
                  href={button.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border border-border/80",
                    "bg-background/80 px-2.5 py-1 text-xs font-medium text-foreground",
                    "transition-colors hover:bg-muted"
                  )}
                >
                  {button.label}
                  <ExternalLinkIcon className="size-3 opacity-60" aria-hidden />
                </a>
              ))}
            </div>
          ) : null}

          {parsed.footer ? (
            <p className="mt-2 text-[11px] text-muted-foreground">{parsed.footer}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
})
