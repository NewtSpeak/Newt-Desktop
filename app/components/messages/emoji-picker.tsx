// 简易 emoji 选择器：内置常用 emoji 分组网格（不引第三方库）。
// 用于消息反应（+ 按钮）与 composer 的 emoji 输入。

import { useState } from "react"

import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover"

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "表情",
    emojis: [
      "😀", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂",
      "😉", "😍", "🥰", "😘", "😋", "😜", "🤪", "🤔", "🤨", "😐",
      "😏", "🙄", "😬", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵",
      "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "😱", "😨", "😰",
      "🤗", "🤭", "🤫", "🤥", "😶", "😑", "🫠", "🥹", "😎", "🤓",
    ],
  },
  {
    label: "手势",
    emojis: [
      "👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "👏", "🙌", "🙏",
      "💪", "🫡", "🤝", "✋", "👋", "🖐️", "☝️", "👉", "👈", "🫶",
    ],
  },
  {
    label: "心情与符号",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "💕",
      "💯", "✨", "🔥", "⭐", "🌟", "💫", "🎉", "🎊", "✅", "❌",
      "❓", "❗", "⚠️", "💤", "👀", "💡", "📌", "🚀", "🌈", "☀️",
    ],
  },
  {
    label: "其他",
    emojis: [
      "🐱", "🐶", "🐼", "🦊", "🐧", "🦉", "🍎", "🍕", "🍜", "🍰",
      "☕", "🍺", "⚽", "🎮", "🎵", "🎁", "📖", "💻", "⌛", "🧠",
    ],
  },
]

export function EmojiGrid({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
      {EMOJI_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-1 pb-1 text-xs text-muted-foreground select-none">{group.label}</p>
          <div className="grid grid-cols-8 gap-0.5">
            {group.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onPick(emoji)}
                aria-label={`选择 ${emoji}`}
                className="rounded-md p-1 text-xl leading-none hover:bg-muted"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Popover 封装：children 作为触发器；未受控时内部管理开合（选中后自动关闭） */
export function EmojiPickerPopover({
  onPick,
  children,
  open,
  onOpenChange,
}: {
  onPick: (emoji: string) => void
  children: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [innerOpen, setInnerOpen] = useState(false)
  const controlled = open !== undefined
  const actualOpen = controlled ? open : innerOpen
  const setOpen = (next: boolean) => {
    if (!controlled) setInnerOpen(next)
    onOpenChange?.(next)
  }
  return (
    <Popover open={actualOpen} onOpenChange={setOpen}>
      <PopoverTrigger render={children} />
      <PopoverContent className="w-80 p-2" side="top" align="end">
        <EmojiGrid
          onPick={(emoji) => {
            onPick(emoji)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
