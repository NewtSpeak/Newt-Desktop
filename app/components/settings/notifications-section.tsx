// 设置 · 通知（docs 15 FR-08/09/11/16 P0+P1）：
// 全局通知层级（全部消息 / 仅 @提及 / 无，默认仅 @提及）+ 提示音（新消息/@提及
// 开关 + 音量 + 试听）+ 每服务器覆盖（层级 + 静音）+ 每频道覆盖列表管理。
// 偏好经 settings store 持久化，并由 lib/settings-sync 同步到服务端跨端生效。

import { XIcon } from "lucide-react"

import { Button } from "~/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { Slider } from "~/components/ui/slider"
import { Switch } from "~/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group"
import { playNotifySound } from "~/lib/notification-sounds"
import { useChannelsStore } from "~/stores/channels"
import { useGuildsStore } from "~/stores/guilds"
import {
  isOverrideMuted,
  muteRemainingLabel,
  useSettingsStore,
  type NotifyLevel,
} from "~/stores/settings"
import { GroupLabel, SectionTitle, SettingRow } from "./section"

const LEVEL_OPTIONS: { value: NotifyLevel; label: string; description: string }[] = [
  { value: "all", label: "全部消息", description: "每条新消息都发送系统通知" },
  { value: "mentions", label: "仅 @提及", description: "只有 @ 你时才发送系统通知（默认）" },
  { value: "none", label: "无", description: "不发送任何系统通知（未读与 @ 计数照常）" },
]

/** 覆盖层级的 Select 值：跟随上一层用哨兵值表示 */
const INHERIT = "__inherit__"

function GuildOverrideRow({ guildId, name }: { guildId: string; name: string }) {
  const override = useSettingsStore((state) => state.notifications.perGuild[guildId])
  const setGuildNotify = useSettingsStore((state) => state.setGuildNotify)
  const remaining = muteRemainingLabel(override)

  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        {remaining && (
          <p className="text-xs text-muted-foreground">定时静音中 · {remaining}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <Select
          value={override?.level ?? INHERIT}
          onValueChange={(value) =>
            setGuildNotify(guildId, {
              level: value === INHERIT ? undefined : (value as NotifyLevel),
            })
          }
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT}>跟随全局</SelectItem>
            <SelectItem value="all">全部消息</SelectItem>
            <SelectItem value="mentions">仅 @提及</SelectItem>
            <SelectItem value="none">无</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          静音
          <Switch
            size="sm"
            checked={isOverrideMuted(override)}
            onCheckedChange={(checked) =>
              setGuildNotify(guildId, {
                muted: Boolean(checked) || undefined,
                // 手动切换开关时清掉定时静音（开 = 直到重新开启，关 = 全部解除）
                mutedUntil: undefined,
              })
            }
          />
        </label>
      </div>
    </div>
  )
}

/** 已设置频道覆盖的管理列表（入口另见频道条目右键菜单，docs 15 UX-06） */
function ChannelOverrideRow({ channelId }: { channelId: string }) {
  const override = useSettingsStore(
    (state) => state.notifications.perChannel[channelId],
  )
  const setChannelNotify = useSettingsStore((state) => state.setChannelNotify)
  const channel = useChannelsStore((state) => {
    for (const channels of Object.values(state.byGuild)) {
      const found = channels.find((item) => item.id === channelId)
      if (found) return found
    }
    return undefined
  })
  const guildName = useGuildsStore((state) =>
    channel
      ? state.guilds.find((guild) => guild.id === channel.guild_id)?.name
      : undefined,
  )
  const remaining = muteRemainingLabel(override)

  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          #{channel?.name ?? `频道 ${channelId.slice(0, 8)}`}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {guildName ?? "未知服务器"}
          {remaining ? ` · 定时静音中，${remaining}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <Select
          value={override?.level ?? INHERIT}
          onValueChange={(value) =>
            setChannelNotify(channelId, {
              level: value === INHERIT ? undefined : (value as NotifyLevel),
            })
          }
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT}>跟随服务器</SelectItem>
            <SelectItem value="all">全部消息</SelectItem>
            <SelectItem value="mentions">仅 @提及</SelectItem>
            <SelectItem value="none">无</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          静音
          <Switch
            size="sm"
            checked={isOverrideMuted(override)}
            onCheckedChange={(checked) =>
              setChannelNotify(channelId, {
                muted: Boolean(checked) || undefined,
                mutedUntil: undefined,
              })
            }
          />
        </label>
        <Button
          variant="ghost"
          size="icon"
          aria-label="移除该频道覆盖"
          title="移除该频道覆盖"
          onClick={() =>
            setChannelNotify(channelId, {
              level: undefined,
              muted: undefined,
              mutedUntil: undefined,
            })
          }
        >
          <XIcon className="size-4" />
        </Button>
      </div>
    </div>
  )
}

export function NotificationsSection() {
  const notifications = useSettingsStore((state) => state.notifications)
  const setNotifications = useSettingsStore((state) => state.setNotifications)
  const guilds = useGuildsStore((state) => state.guilds)
  const overriddenChannelIds = Object.keys(notifications.perChannel)

  return (
    <div>
      <SectionTitle>通知</SectionTitle>

      <GroupLabel>全局默认</GroupLabel>
      <RadioGroup
        className="gap-2"
        value={notifications.globalLevel}
        onValueChange={(value) => setNotifications({ globalLevel: value as NotifyLevel })}
      >
        {LEVEL_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-start gap-3 rounded-2xl border p-4">
            <RadioGroupItem value={option.value} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{option.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{option.description}</p>
            </div>
          </label>
        ))}
      </RadioGroup>

      <GroupLabel>提示音</GroupLabel>
      <SettingRow label="新消息提示音" description="通过通知判定的普通消息播放短促提示音">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => playNotifySound("message", notifications.soundVolume)}
          >
            试听
          </Button>
          <Switch
            checked={notifications.soundMessageEnabled}
            onCheckedChange={(checked) =>
              setNotifications({ soundMessageEnabled: Boolean(checked) })
            }
          />
        </div>
      </SettingRow>
      <SettingRow label="@提及提示音" description="被 @ 时播放更高音高的提示音">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => playNotifySound("mention", notifications.soundVolume)}
          >
            试听
          </Button>
          <Switch
            checked={notifications.soundMentionEnabled}
            onCheckedChange={(checked) =>
              setNotifications({ soundMentionEnabled: Boolean(checked) })
            }
          />
        </div>
      </SettingRow>
      <SettingRow label="提示音音量" description={`${notifications.soundVolume}%（勿扰与 self_deaf 时抑制）`}>
        <div className="w-56">
          <Slider
            min={0}
            max={100}
            value={notifications.soundVolume}
            onValueChange={(value) =>
              setNotifications({ soundVolume: Array.isArray(value) ? value[0] : value })
            }
          />
        </div>
      </SettingRow>

      <GroupLabel>每服务器覆盖</GroupLabel>
      {guilds.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">尚未加入任何服务器</p>
      ) : (
        <div>
          {guilds.map((guild) => (
            <GuildOverrideRow key={guild.id} guildId={guild.id} name={guild.name} />
          ))}
        </div>
      )}

      <GroupLabel>每频道覆盖</GroupLabel>
      {overriddenChannelIds.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          尚无频道覆盖；在频道列表右键频道 →「通知设置 / 静音」即可添加
        </p>
      ) : (
        <div>
          {overriddenChannelIds.map((channelId) => (
            <ChannelOverrideRow key={channelId} channelId={channelId} />
          ))}
        </div>
      )}

      <SettingRow
        label="关于静音"
        description="静音服务器/频道不弹系统通知、不显示未读白点；@ 你的红色计数仍会保留并聚合；定时静音到期自动恢复"
      />
    </div>
  )
}
