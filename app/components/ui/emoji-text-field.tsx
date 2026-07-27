// 带 Unicode 表情插入的文本输入（单行 / 多行）。
// 用于显示名、简介、昵称等纯文本资料字段。
// 视觉：无描边、无分割线，靠底色与内嵌按钮区分。

import { SmileIcon } from "lucide-react"
import * as React from "react"

import { EmojiPickerPopover } from "~/components/messages/emoji-picker"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Textarea } from "~/components/ui/textarea"
import {
  codePointLength,
  insertAtSelection,
  sliceByCodePoints,
} from "~/lib/text-length"
import { cn } from "~/lib/utils"

/** 无描边字段底色 */
const FIELD_CLASS =
  "border-0 bg-muted/50 shadow-none focus-visible:border-0 focus-visible:ring-0 focus-visible:bg-muted/70"

type CommonProps = {
  value: string
  onChange: (value: string) => void
  maxChars?: number
  disabled?: boolean
  placeholder?: string
  id?: string
  className?: string
  inputClassName?: string
  /** 显示码点字数（多行默认开，单行默认关） */
  showCount?: boolean
  "aria-describedby"?: string
  onKeyDown?: (
    event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void
  onBlur?: (
    event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void
  autoFocus?: boolean
}

type SingleProps = CommonProps & {
  multiline?: false
  rows?: never
}

type MultiProps = CommonProps & {
  multiline: true
  rows?: number
}

export type EmojiTextFieldProps = SingleProps | MultiProps

export function EmojiTextField({
  value,
  onChange,
  maxChars,
  disabled,
  placeholder,
  id,
  className,
  inputClassName,
  showCount,
  multiline,
  rows = 3,
  onKeyDown,
  onBlur,
  autoFocus,
  "aria-describedby": ariaDescribedBy,
}: EmojiTextFieldProps) {
  const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(
    null,
  )
  const [pickerOpen, setPickerOpen] = React.useState(false)
  // 打开选择器前记住光标，避免焦点丢失后 selection 归零
  const selectionRef = React.useRef({ start: value.length, end: value.length })

  const count = codePointLength(value)
  const showCounter =
    showCount ?? (multiline === true && maxChars !== undefined)

  const rememberSelection = () => {
    const el = inputRef.current
    if (!el) return
    selectionRef.current = {
      start: el.selectionStart ?? value.length,
      end: el.selectionEnd ?? value.length,
    }
  }

  const applyValue = (next: string, selection: number) => {
    onChange(next)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      try {
        el.setSelectionRange(selection, selection)
      } catch {
        /* 部分环境下 setSelectionRange 可能抛错，忽略 */
      }
      selectionRef.current = { start: selection, end: selection }
    })
  }

  const handleChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    let next = event.target.value
    if (maxChars !== undefined && codePointLength(next) > maxChars) {
      next = sliceByCodePoints(next, maxChars)
    }
    onChange(next)
    selectionRef.current = {
      start: event.target.selectionStart ?? next.length,
      end: event.target.selectionEnd ?? next.length,
    }
  }

  const insertEmoji = (emoji: string) => {
    const { start, end } = selectionRef.current
    const { next, selection } = insertAtSelection(
      value,
      emoji,
      start,
      end,
      maxChars,
    )
    applyValue(next, selection)
  }

  const picker = (
    <EmojiPickerPopover
      mode="unicode"
      open={pickerOpen}
      onOpenChange={(open) => {
        if (open) rememberSelection()
        setPickerOpen(open)
      }}
      side="top"
      align="end"
      onPick={insertEmoji}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        className="size-8 shrink-0 border-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
        aria-label="插入表情"
        title="插入表情"
      >
        <SmileIcon className="size-4" />
      </Button>
    </EmojiPickerPopover>
  )

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div
        className={cn(
          "relative flex min-w-0 items-stretch",
          multiline && "items-start",
        )}
      >
        <div className="relative min-w-0 flex-1">
          {multiline ? (
            <Textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              id={id}
              value={value}
              disabled={disabled}
              placeholder={placeholder}
              rows={rows}
              autoFocus={autoFocus}
              aria-describedby={ariaDescribedBy}
              className={cn(FIELD_CLASS, "pr-10", inputClassName)}
              onChange={handleChange}
              onSelect={rememberSelection}
              onKeyUp={rememberSelection}
              onClick={rememberSelection}
              onKeyDown={onKeyDown}
              onBlur={onBlur}
            />
          ) : (
            <Input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              id={id}
              value={value}
              disabled={disabled}
              placeholder={placeholder}
              autoFocus={autoFocus}
              aria-describedby={ariaDescribedBy}
              className={cn(FIELD_CLASS, "pr-10", inputClassName)}
              onChange={handleChange}
              onSelect={rememberSelection}
              onKeyUp={rememberSelection}
              onClick={rememberSelection}
              onKeyDown={onKeyDown}
              onBlur={onBlur}
            />
          )}
          <div
            className={cn(
              "absolute right-1 flex items-center",
              multiline ? "top-1" : "inset-y-0",
            )}
          >
            {picker}
          </div>
        </div>
      </div>
      {showCounter && maxChars !== undefined ? (
        <p
          className={cn(
            "text-xs tabular-nums text-muted-foreground",
            count > maxChars && "text-destructive",
          )}
        >
          {count}/{maxChars}
        </p>
      ) : null}
    </div>
  )
}
