// Bot 消息卡片渲染：对齐 SDK schema（title/description/color/fields/buttons/footer）。
// buttons 支持外链（<a>，link 样式）与交互回调按钮（设计文档 2026-07-26），
// 按 row 声明分行、无声明每行 5 个自动折行；update_message 换卡时高度过渡（GSAP）。

import { ExternalLinkIcon } from "lucide-react"
import { memo, useMemo, useRef } from "react"

import { buttonVariants } from "~/components/ui/button"
import {
  layoutButtonRows,
  parseBotCard,
  type BotCardButton,
  type BotCardLinkButton,
} from "~/lib/bot-card"
import { gsap, MOTION_OK, useGSAP } from "~/lib/gsap"
import { cn } from "~/lib/utils"
import {
  CardInteractiveButton,
  CARD_SIZE_TO_BUTTON_SIZE,
} from "./message-card-button"

export type MessageCardProps = {
  card: unknown
  /** 交互按钮回调所需的消息定位；只读预览场景可省略 */
  messageId?: string
  channelId?: string
  /** false = 只读渲染（撤回预览 / 编辑历史），交互按钮禁点 */
  interactive?: boolean
  className?: string
}

function CardLinkButton({ button }: { button: BotCardLinkButton }) {
  return (
    <a
      href={button.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        buttonVariants({
          variant: "outline",
          size: CARD_SIZE_TO_BUTTON_SIZE[button.size],
        }),
        button.disabled && "pointer-events-none opacity-50"
      )}
      aria-disabled={button.disabled || undefined}
    >
      {button.label}
      <ExternalLinkIcon className="size-3 opacity-60" data-icon="inline-end" aria-hidden />
    </a>
  )
}

function buttonKey(button: BotCardButton, index: number): string {
  return button.kind === "interactive"
    ? `i-${button.customId}`
    : `l-${index}-${button.url}`
}

export const MessageCard = memo(function MessageCard({
  card,
  messageId,
  channelId,
  interactive = true,
  className,
}: MessageCardProps) {
  const parsed = useMemo(() => parseBotCard(card), [card])
  const containerRef = useRef<HTMLDivElement>(null)
  const previousHeightRef = useRef<number | null>(null)

  // update_message 换卡：高度 old→auto 过渡 + 内容轻微淡入（reduced-motion 直接切换）。
  // 依赖 card 引用变化触发；首次渲染只记录高度不做动画。
  useGSAP(
    () => {
      const element = containerRef.current
      if (!element) return
      const previousHeight = previousHeightRef.current
      const nextHeight = element.offsetHeight
      previousHeightRef.current = nextHeight
      if (previousHeight === null || previousHeight === nextHeight) return
      const media = gsap.matchMedia()
      media.add(MOTION_OK, () => {
        gsap.fromTo(
          element,
          { height: previousHeight },
          {
            height: nextHeight,
            duration: 0.28,
            ease: "power3.out",
            clearProps: "height",
          }
        )
        gsap.fromTo(
          element,
          { opacity: 0.4 },
          { opacity: 1, duration: 0.24, ease: "power2.out" }
        )
      })
      return () => media.revert()
    },
    { dependencies: [card], scope: containerRef }
  )

  if (!parsed) return null

  const inlineFields = parsed.fields?.filter((field) => field.inline) ?? []
  const blockFields = parsed.fields?.filter((field) => !field.inline) ?? []
  const buttonRows = parsed.buttons ? layoutButtonRows(parsed.buttons) : []
  const canInteract = interactive && Boolean(messageId && channelId)

  return (
    <div
      ref={containerRef}
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
                <p className="font-semibold leading-snug text-balance text-foreground">
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
                className="size-16 shrink-0 rounded-md object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : null}
          </div>

          {parsed.image ? (
            <img
              src={parsed.image}
              alt=""
              className="mt-2 max-h-56 w-full rounded-md object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : null}

          {buttonRows.length > 0 ? (
            <div className="mt-2.5 space-y-1.5">
              {buttonRows.map((row, rowIndex) => (
                <div
                  key={`button-row-${rowIndex}`}
                  className="flex flex-wrap gap-1.5"
                >
                  {row.map((button, index) =>
                    button.kind === "link" ? (
                      <CardLinkButton
                        key={buttonKey(button, index)}
                        button={button}
                      />
                    ) : (
                      <CardInteractiveButton
                        key={buttonKey(button, index)}
                        button={button}
                        messageId={messageId ?? ""}
                        channelId={channelId ?? ""}
                        interactive={canInteract}
                      />
                    )
                  )}
                </div>
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
