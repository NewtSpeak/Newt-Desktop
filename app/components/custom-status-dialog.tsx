// 自定义状态设置：小表情贴图 + 一句话文案 + 可选过期时间。
// 表情位仅允许小表情贴图（item:id），不支持系统 Unicode emoji。
// 视觉：无描边、无分割线，靠背景层次区分区域。

import { SmileIcon, XIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { CustomEmoteImg } from "~/components/messages/custom-emote"
import { ExpressionPickerPopover } from "~/components/messages/expression-picker"
import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Input } from "~/components/ui/input"
import { customReactionKey } from "~/lib/stickers/format"
import { codePointLength, sliceByCodePoints } from "~/lib/text-length"
import { cn } from "~/lib/utils"
import {
  normalizeStatusEmoteKey,
  setCustomPresence,
  statusEmoteItemId,
} from "~/stores/presence"
import { useSettingsStore } from "~/stores/settings"
import { useStickersStore } from "~/stores/stickers"
import { useUIStore } from "~/stores/ui"

const MAX_STATUS_TEXT = 128

/** 无描边输入：仅用底色区分 */
const FIELD_CLASS =
  "border-0 bg-muted/50 shadow-none focus-visible:border-0 focus-visible:ring-0 focus-visible:bg-muted/70"

type ExpiryOption = {
  id: string
  label: string
  resolve: () => string | null
}

function endOfTodayISO(): string {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

const EXPIRY_OPTIONS: ExpiryOption[] = [
  { id: "never", label: "不清除", resolve: () => null },
  {
    id: "30m",
    label: "30 分钟",
    resolve: () => new Date(Date.now() + 30 * 60_000).toISOString(),
  },
  {
    id: "1h",
    label: "1 小时",
    resolve: () => new Date(Date.now() + 60 * 60_000).toISOString(),
  },
  {
    id: "4h",
    label: "4 小时",
    resolve: () => new Date(Date.now() + 4 * 60 * 60_000).toISOString(),
  },
  { id: "today", label: "今天", resolve: endOfTodayISO },
]

export function CustomStatusDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const storedText = useSettingsStore((s) => s.presence.customText)
  const storedEmoji = useSettingsStore((s) => s.presence.customEmoji)
  const guildId = useUIStore((s) => s.selectedGuildId)
  const cacheItems = useStickersStore((s) => s.cacheItems)
  const ensureAvailable = useStickersStore((s) => s.ensureAvailable)

  const [text, setText] = useState("")
  /** 贴图键 item:{id} */
  const [emoteKey, setEmoteKey] = useState("")
  const [expiryId, setExpiryId] = useState("never")
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    setText(storedText ?? "")
    setEmoteKey(normalizeStatusEmoteKey(storedEmoji) ?? "")
    setExpiryId("never")
    void ensureAvailable(guildId)
  }, [open, storedText, storedEmoji, guildId, ensureAvailable])

  const itemId = statusEmoteItemId({ emoji: emoteKey })
  const hasAnything = Boolean(text.trim() || emoteKey)

  const save = () => {
    const option =
      EXPIRY_OPTIONS.find((o) => o.id === expiryId) ?? EXPIRY_OPTIONS[0]
    const nextText = text.trim()
    const nextEmote = normalizeStatusEmoteKey(emoteKey) ?? ""
    if (!nextText && !nextEmote) {
      setCustomPresence({ text: "", emoji: "", expiresAt: null })
      toast.success("已清除自定义状态")
      onOpenChange(false)
      return
    }
    setCustomPresence({
      text: nextText,
      emoji: nextEmote,
      expiresAt: option.resolve(),
    })
    toast.success("自定义状态已更新")
    onOpenChange(false)
  }

  const clear = () => {
    setText("")
    setEmoteKey("")
    setCustomPresence({ text: "", emoji: "", expiresAt: null })
    toast.success("已清除自定义状态")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 border-0 ring-0 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>自定义状态</DialogTitle>
          <DialogDescription>
            选择一个小表情贴图，并写一句话描述你的当前状态。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2">
            <ExpressionPickerPopover
              mode="emote"
              guildId={guildId ?? undefined}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              side="bottom"
              align="start"
              onPick={(pick) => {
                if (pick.type !== "emote") return
                cacheItems([pick.item])
                setEmoteKey(customReactionKey(pick.item.id))
              }}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 bg-muted/50 hover:bg-muted"
                aria-label="选择小表情"
                title="选择小表情贴图"
              >
                {itemId ? (
                  <CustomEmoteImg itemId={itemId} size={28} alt="" />
                ) : (
                  <SmileIcon className="size-5 text-muted-foreground" />
                )}
              </Button>
            </ExpressionPickerPopover>
            {emoteKey ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="mt-1.5 size-8 shrink-0 text-muted-foreground hover:bg-muted/60"
                aria-label="清除小表情"
                onClick={() => setEmoteKey("")}
              >
                <XIcon className="size-4" />
              </Button>
            ) : null}
            <div className="min-w-0 flex-1">
              <Input
                value={text}
                className={FIELD_CLASS}
                onChange={(event) => {
                  const next = event.target.value
                  setText(
                    codePointLength(next) > MAX_STATUS_TEXT
                      ? sliceByCodePoints(next, MAX_STATUS_TEXT)
                      : next,
                  )
                }}
                placeholder="正在开会 / 游戏中 / 稍后回复…"
                aria-label="状态文案"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    save()
                  }
                }}
              />
              <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
                {codePointLength(text)}/{MAX_STATUS_TEXT}
              </p>
            </div>
          </div>

          {hasAnything ? (
            <div className="flex items-center gap-2 rounded-2xl bg-muted/40 px-3 py-2.5 text-sm">
              <span className="shrink-0 text-muted-foreground">预览</span>
              {itemId ? (
                <CustomEmoteImg itemId={itemId} size={18} alt="" />
              ) : null}
              {text.trim() ? (
                <span className="min-w-0 truncate font-medium">
                  {text.trim()}
                </span>
              ) : (
                <span className="text-muted-foreground">（仅表情）</span>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              选一个小表情，或写一句话，即可设置状态
            </p>
          )}

          <div>
            <p className="mb-2 text-sm font-medium">清除时间</p>
            <div className="flex flex-wrap gap-1.5">
              {EXPIRY_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setExpiryId(option.id)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                    "cursor-pointer border-0 outline-none",
                    expiryId === option.id
                      ? "bg-primary/15 text-primary"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-0 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground hover:bg-muted/60"
            onClick={clear}
          >
            清除状态
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              className="bg-muted/50 hover:bg-muted"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="button" onClick={save}>
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
