// 设置 · 隐私与安全（docs 16 FR-05 / 19 §4）
// 账号级隐私偏好本地存储 + settings-sync；裁决以服务端为准（API 待落地）。
// 屏蔽列表 / 好友请求真实数据依赖 Server-16，此处提供完整 UI 与空态。

import { useEffect } from "react"
import { ShieldIcon } from "lucide-react"

import { Button } from "~/components/ui/button"
import {
  blockedOf,
  useRelationshipsStore,
} from "~/stores/relationships"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { Switch } from "~/components/ui/switch"
import { toast } from "sonner"

import { ApiError } from "~/lib/api/http"
import { patchPrivacy as patchPrivacyApi } from "~/lib/api/social"
import {
  useSettingsStore,
  type DmFrom,
  type FriendRequestFrom,
} from "~/stores/settings"
import { GroupLabel, SectionTitle, SettingRow } from "./section"

function syncPrivacy(
  patch: Parameters<ReturnType<typeof useSettingsStore.getState>["setPrivacy"]>[0],
) {
  useSettingsStore.getState().setPrivacy(patch)
  // 映射到服务端字段
  const body: Record<string, unknown> = {}
  if (patch.friendRequestFrom !== undefined)
    body.friend_request_from = patch.friendRequestFrom
  if (patch.dmFrom !== undefined) body.dm_from = patch.dmFrom
  if (patch.messageRequestFilter !== undefined)
    body.message_request_filter = patch.messageRequestFilter
  if (patch.showMutualGuilds !== undefined)
    body.show_mutual_guilds = patch.showMutualGuilds
  if (patch.publicProfileToNonFriends !== undefined)
    body.public_profile_to_non_friends = patch.publicProfileToNonFriends
  void patchPrivacyApi(body as never).catch((error) => {
    toast.error(
      error instanceof ApiError ? error.message : "同步隐私设置失败",
    )
  })
}

const FRIEND_FROM: { value: FriendRequestFrom; label: string; desc: string }[] =
  [
    {
      value: "everyone",
      label: "所有人",
      desc: "任何人都可向你发送好友请求",
    },
    {
      value: "mutual_friends",
      label: "仅共同好友",
      desc: "只有你们有共同好友时才能请求",
    },
    {
      value: "mutual_guilds",
      label: "仅同服务器成员",
      desc: "默认；只有共同服务器的成员可请求（推荐）",
    },
    {
      value: "nobody",
      label: "无人",
      desc: "关闭所有好友请求",
    },
  ]

const DM_FROM: { value: DmFrom; label: string; desc: string }[] = [
  {
    value: "everyone",
    label: "所有人",
    desc: "任何人可直接私信你（仍受消息请求过滤）",
  },
  {
    value: "friends",
    label: "仅好友",
    desc: "默认；仅好友可私信",
  },
  {
    value: "mutual_guilds",
    label: "好友 + 同服成员",
    desc: "好友与共同服务器成员可发起私信",
  },
  {
    value: "nobody",
    label: "无人",
    desc: "关闭所有新私信（既有会话不受影响）",
  },
]

function BlockedList() {
  const items = useRelationshipsStore((s) => s.items)
  const blocked = blockedOf(items)
  useEffect(() => {
    void useRelationshipsStore.getState().refresh().catch(() => undefined)
  }, [])
  if (blocked.length === 0) {
    return (
      <>
        <GroupLabel id="privacy-block">屏蔽列表</GroupLabel>
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-10 text-center">
          <ShieldIcon className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">暂无屏蔽用户</p>
        </div>
      </>
    )
  }
  return (
    <>
      <GroupLabel id="privacy-block">屏蔽列表 · {blocked.length}</GroupLabel>
      <div className="mb-4 flex flex-col gap-0.5 rounded-xl bg-muted/30 p-1 dark:bg-white/[0.04]">
        {blocked.map((rel) => (
          <div
            key={rel.id}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm">
                {rel.user.display_name || rel.user.username}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                @{rel.user.username}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void useRelationshipsStore
                  .getState()
                  .unblock(rel.user.id)
                  .then(() => toast.success("已解除屏蔽"))
                  .catch((e) =>
                    toast.error(e instanceof ApiError ? e.message : "失败"),
                  )
              }
            >
              解除屏蔽
            </Button>
          </div>
        ))}
      </div>
    </>
  )
}

export function PrivacySection() {
  const privacy = useSettingsStore((s) => s.privacy)

  return (
    <div>
      <SectionTitle>隐私与安全</SectionTitle>
      <p className="mb-4 text-xs text-muted-foreground">
        偏好同步到服务端（Server-16）并裁决好友请求与私信；同时缓存到本机。
      </p>

      <GroupLabel id="privacy-friend">谁可以加你为好友</GroupLabel>
      <div className="mb-4 flex flex-col gap-2">
        {FRIEND_FROM.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5"
          >
            <input
              type="radio"
              name="friendRequestFrom"
              className="mt-1"
              checked={privacy.friendRequestFrom === opt.value}
              onChange={() => syncPrivacy({ friendRequestFrom: opt.value })}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.desc}</p>
            </div>
          </label>
        ))}
      </div>

      <GroupLabel id="privacy-dm">谁可以私信你</GroupLabel>
      <div className="mb-4 flex flex-col gap-2">
        {DM_FROM.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5"
          >
            <input
              type="radio"
              name="dmFrom"
              className="mt-1"
              checked={privacy.dmFrom === opt.value}
              onChange={() => syncPrivacy({ dmFrom: opt.value })}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.desc}</p>
            </div>
          </label>
        ))}
      </div>

      <GroupLabel id="privacy-filter">消息请求与资料</GroupLabel>
      <SettingRow
        label="启用消息请求箱"
        description="非好友的私信先进请求箱，确认后再进入正常私信列表"
      >
        <Switch
          checked={privacy.messageRequestFilter}
          onCheckedChange={(c) =>
            syncPrivacy({ messageRequestFilter: Boolean(c) })
          }
        />
      </SettingRow>
      <SettingRow
        label="对非好友展示共同服务器"
        description="资料卡上是否显示你们共同所在的服务器"
      >
        <Switch
          checked={privacy.showMutualGuilds}
          onCheckedChange={(c) =>
            syncPrivacy({ showMutualGuilds: Boolean(c) })
          }
        />
      </SettingRow>
      <SettingRow
        label="非好友可见完整资料"
        description="关闭后，非好友仅能看到基础用户名（邮箱永不暴露）"
      >
        <Switch
          checked={privacy.publicProfileToNonFriends}
          onCheckedChange={(c) =>
            syncPrivacy({ publicProfileToNonFriends: Boolean(c) })
          }
        />
      </SettingRow>

      <BlockedList />

      <GroupLabel id="privacy-server">每服务器覆盖</GroupLabel>
      <SettingRow
        label="服级「允许成员私信」"
        description="在服务器个人设置 → 隐私中按服开关（docs 17 FR-18）"
      >
        <Select disabled value="hint">
          <SelectTrigger className="w-40">
            <SelectValue placeholder="见服务器个人设置" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hint">在服务器菜单中设置</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
    </div>
  )
}
