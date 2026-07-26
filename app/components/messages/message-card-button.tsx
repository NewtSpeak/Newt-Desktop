// bot 卡片交互按钮（设计文档 2026-07-26）：状态机 idle → pending(spinner) →
// acked(√ 停留) / responded(√ 定格后回收) / expired / failed(shake)。
// 状态由 interactions store 按 (messageId, customId) 键控，MESSAGE_UPDATE 换卡后
// 同 custom_id 的新按钮无缝延续 pending 态。

import { CheckIcon, Loader2Icon } from "lucide-react"
import { memo, useCallback } from "react"

import { Button } from "~/components/ui/button"
import type {
  BotCardButtonSize,
  BotCardButtonStyle,
  BotCardInteractiveButton,
} from "~/lib/bot-card"
import { cn } from "~/lib/utils"
import {
  interactionKey,
  useInteractionsStore,
} from "~/stores/interactions"

/** card.style → ui/button variant */
const STYLE_TO_VARIANT: Record<
  BotCardButtonStyle,
  "default" | "secondary" | "success" | "destructive"
> = {
  primary: "default",
  secondary: "secondary",
  success: "success",
  danger: "destructive",
}

/** card.size → ui/button size（卡片密度下默认 sm=h-8） */
export const CARD_SIZE_TO_BUTTON_SIZE: Record<
  BotCardButtonSize,
  "xs" | "sm" | "default" | "lg"
> = {
  xs: "xs",
  sm: "sm",
  md: "default",
  lg: "lg",
}

export type CardInteractiveButtonProps = {
  button: BotCardInteractiveButton
  messageId: string
  channelId: string
  /** 撤回预览 / 编辑历史等只读场景禁用点击 */
  interactive: boolean
}

export const CardInteractiveButton = memo(function CardInteractiveButton({
  button,
  messageId,
  channelId,
  interactive,
}: CardInteractiveButtonProps) {
  const entry = useInteractionsStore(
    (state) => state.byKey[interactionKey(messageId, button.customId)]
  )
  const click = useInteractionsStore((state) => state.click)

  const onClick = useCallback(() => {
    if (!interactive || button.disabled) return
    void click(channelId, messageId, button.customId)
  }, [interactive, button.disabled, button.customId, click, channelId, messageId])

  const status = entry?.status
  const busy = status === "pending" || status === "acked"
  const showSpinner = status === "pending"
  const showCheck = status === "acked" || status === "responded"

  return (
    <Button
      type="button"
      variant={STYLE_TO_VARIANT[button.style]}
      size={CARD_SIZE_TO_BUTTON_SIZE[button.size]}
      disabled={!interactive || button.disabled || busy || status === "responded"}
      aria-busy={busy || undefined}
      className={cn(
        busy && "opacity-80",
        status === "failed" && "t-card-shake"
      )}
      onClick={onClick}
    >
      {showSpinner ? (
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
      ) : null}
      {showCheck ? (
        <CheckIcon className="t-card-check size-3.5" aria-hidden />
      ) : null}
      {button.label}
      {busy ? (
        <span className="sr-only" aria-live="polite">
          {showSpinner ? "正在提交" : "机器人已确认，等待响应"}
        </span>
      ) : null}
      {status === "responded" ? (
        <span className="sr-only" aria-live="polite">
          机器人已响应
        </span>
      ) : null}
    </Button>
  )
})
