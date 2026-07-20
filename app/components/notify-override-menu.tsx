// 通知覆盖右键菜单项（docs 15 FR-08/09 / UX-06）：
// 服务器栏与频道条目共用——「通知设置」层级子菜单 + 「静音」时长子菜单
// （15 分钟 / 1 小时 / 8 小时 / 24 小时 / 直到重新开启；已静音时显示剩余时间
// 与「取消静音」）。写入 settings store（经 settings-sync 跨端同步）。

import { CheckIcon } from "lucide-react"

import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "~/components/ui/context-menu"
import {
  isOverrideMuted,
  MUTE_DURATION_OPTIONS,
  muteRemainingLabel,
  type NotifyLevel,
} from "~/stores/settings"

const LEVEL_LABELS: { value: NotifyLevel; label: string }[] = [
  { value: "all", label: "全部消息" },
  { value: "mentions", label: "仅 @提及" },
  { value: "none", label: "无" },
]

export function NotifyOverrideMenuItems({
  override,
  inheritLabel,
  onChange,
}: {
  override: { level?: NotifyLevel; muted?: boolean; mutedUntil?: number } | undefined
  /** 层级「继承」项文案：服务器 =「跟随全局」，频道 =「跟随服务器」 */
  inheritLabel: string
  onChange: (patch: {
    level?: NotifyLevel
    muted?: boolean
    mutedUntil?: number
  }) => void
}) {
  const muted = isOverrideMuted(override)
  const remaining = muteRemainingLabel(override)

  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger>通知设置</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem
            onClick={() => onChange({ level: undefined })}
            data-checked={override?.level === undefined || undefined}
          >
            {override?.level === undefined && <CheckIcon className="size-4" />}
            {inheritLabel}
          </ContextMenuItem>
          {LEVEL_LABELS.map((option) => (
            <ContextMenuItem
              key={option.value}
              onClick={() => onChange({ level: option.value })}
            >
              {override?.level === option.value && <CheckIcon className="size-4" />}
              {option.label}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {muted ? (
        <ContextMenuItem
          onClick={() => onChange({ muted: undefined, mutedUntil: undefined })}
        >
          取消静音{remaining ? `（${remaining}）` : ""}
        </ContextMenuItem>
      ) : (
        <ContextMenuSub>
          <ContextMenuSubTrigger>静音</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {MUTE_DURATION_OPTIONS.map((option) => (
              <ContextMenuItem
                key={option.label}
                onClick={() =>
                  onChange(
                    option.ms === null
                      ? { muted: true, mutedUntil: undefined }
                      : { muted: undefined, mutedUntil: Date.now() + option.ms },
                  )
                }
              >
                {option.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
    </>
  )
}
