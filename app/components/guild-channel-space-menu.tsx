// 频道列表区域右键菜单：创建频道 / 创建类别 / 邀请至服务器。
// 任意时刻整块区域可右键（空白/类别标题等）；频道卡片自有菜单优先；有权限才显示对应项。

import { useMemo, useState } from "react"
import {
  FolderPlusIcon,
  HashIcon,
  LinkIcon,
  Volume2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "~/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Switch } from "~/components/ui/switch"
import {
  createChannel,
  createGuildInvite,
} from "~/lib/api/guilds"
import { ApiError } from "~/lib/api/http"
import type { ChannelType } from "~/lib/api/types"
import { copyText } from "~/lib/clipboard"
import { hasPermission, Permissions } from "~/lib/permissions"
import { getServerBaseUrl } from "~/lib/server-connection"
import { GuildSettingsContextMenuItems } from "~/components/guild-settings-menu-items"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import { useMembersStore } from "~/stores/members"
import {
  memberGuildPermissions,
  useRolesStore,
} from "~/stores/roles"

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  return fallback
}

function buildInviteUrl(code: string): string {
  const base = getServerBaseUrl()?.replace(/\/$/, "") ?? window.location.origin
  return `${base}/invite/${code}`
}

type CreateDialog =
  | { kind: "channel"; channelType: "TEXT" | "VOICE" }
  | { kind: "category" }
  | null

export function GuildChannelSpaceMenu({
  guildId,
  children,
  className,
}: {
  guildId: string
  children: React.ReactNode
  className?: string
}) {
  const selfId = useAuthStore((s) => s.user?.id)
  const systemAdmin = useAuthStore((s) => s.user?.system_admin)
  const self = useMembersStore((s) =>
    s.byGuild[guildId]?.find((m) => m.user_id === selfId),
  )
  const roles = useRolesStore((s) => s.byGuild[guildId])

  const caps = useMemo(() => {
    const perms = memberGuildPermissions(self, roles)
    const owner = Boolean(self?.is_owner) || Boolean(systemAdmin)
    return {
      manageChannels:
        owner || hasPermission(perms, Permissions.MANAGE_CHANNELS),
      createInvite:
        owner || hasPermission(perms, Permissions.CREATE_INSTANT_INVITE),
    }
  }, [self, roles, systemAdmin])

  // 个人设置入口任意成员可见（docs 17 FR-05），菜单恒可打开
  const canOpenMenu = true

  const [createDialog, setCreateDialog] = useState<CreateDialog>(null)
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [privateChannel, setPrivateChannel] = useState(false)
  const [lockChannel, setLockChannel] = useState(false)
  const [channelPassword, setChannelPassword] = useState("")
  const [visibleRoleIds, setVisibleRoleIds] = useState<string[]>([])

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteUrl, setInviteUrl] = useState("")
  const [inviteCode, setInviteCode] = useState("")
  const [invitePending, setInvitePending] = useState(false)

  const openCreate = (dialog: Exclude<CreateDialog, null>) => {
    setName("")
    setPrivateChannel(false)
    setLockChannel(false)
    setChannelPassword("")
    setVisibleRoleIds([])
    setCreateDialog(dialog)
  }

  const submitCreate = async () => {
    if (!createDialog) return
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error("请输入名称")
      return
    }
    if (lockChannel && createDialog.kind === "channel" && !channelPassword) {
      toast.error("上锁时请设置访问密码")
      return
    }
    setPending(true)
    try {
      const type: ChannelType =
        createDialog.kind === "category"
          ? "CATEGORY"
          : createDialog.channelType
      // 文字频道名习惯小写连字符
      const channelName =
        type === "TEXT"
          ? trimmed.toLowerCase().replace(/\s+/g, "-")
          : trimmed
      const channel = await createChannel(guildId, {
        name: channelName,
        type,
        ...(type !== "CATEGORY" && lockChannel
          ? { password: channelPassword }
          : {}),
        ...(type !== "CATEGORY" && privateChannel
          ? { private: true, visible_role_ids: visibleRoleIds }
          : {}),
      })
      useChannelsStore.getState().upsertChannel(channel)
      toast.success(
        type === "CATEGORY"
          ? `已创建类别「${channel.name}」`
          : type === "VOICE"
            ? `已创建语音频道「${channel.name}」`
            : `已创建文字频道「${channel.name}」`,
      )
      setCreateDialog(null)
    } catch (error) {
      toast.error(errorMessage(error, "创建失败"))
    } finally {
      setPending(false)
    }
  }

  const createInvite = async () => {
    setInvitePending(true)
    try {
      const invite = await createGuildInvite(guildId, {
        ttl_seconds: 0,
        max_uses: 0,
      })
      const url = invite.share_url || buildInviteUrl(invite.code)
      setInviteCode(invite.code)
      setInviteUrl(url)
      setInviteOpen(true)
      toast.success("邀请已创建")
    } catch (error) {
      toast.error(errorMessage(error, "创建邀请失败"))
    } finally {
      setInvitePending(false)
    }
  }

  if (!canOpenMenu) {
    return <div className={className}>{children}</div>
  }

  const dialogTitle =
    createDialog?.kind === "category"
      ? "创建类别"
      : createDialog?.channelType === "VOICE"
        ? "创建语音频道"
        : "创建文字频道"

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          className={cn("block min-h-full w-full", className)}
        >
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-52">
          <ContextMenuGroup>
          <ContextMenuLabel className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            服务器管理
          </ContextMenuLabel>
          {caps.manageChannels && (
            <>
              <ContextMenuItem onClick={() => openCreate({ kind: "channel", channelType: "TEXT" })}>
                <HashIcon />
                创建文字频道
              </ContextMenuItem>
              <ContextMenuItem onClick={() => openCreate({ kind: "channel", channelType: "VOICE" })}>
                <Volume2Icon />
                创建语音频道
              </ContextMenuItem>
              <ContextMenuItem onClick={() => openCreate({ kind: "category" })}>
                <FolderPlusIcon />
                创建类别
              </ContextMenuItem>
            </>
          )}
          {caps.manageChannels && caps.createInvite && <ContextMenuSeparator />}
          {caps.createInvite && (
            <ContextMenuItem
              disabled={invitePending}
              onClick={() => void createInvite()}
            >
              <LinkIcon />
              邀请至服务器
            </ContextMenuItem>
          )}
          <GuildSettingsContextMenuItems guildId={guildId} />
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog
        open={createDialog !== null}
        onOpenChange={(open) => !open && setCreateDialog(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              {createDialog?.kind === "category"
                ? "类别用于分组频道列表。创建后可把频道移入该类别。"
                : createDialog?.channelType === "VOICE"
                  ? "语音频道用于实时通话与屏幕共享。"
                  : "文字频道用于消息讨论。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="new-channel-name">名称</Label>
              <Input
                id="new-channel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  createDialog?.kind === "category"
                    ? "例如：综合"
                    : createDialog?.channelType === "VOICE"
                      ? "例如：大厅"
                      : "例如：general"
                }
                maxLength={100}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    void submitCreate()
                  }
                }}
              />
            </div>
            {createDialog?.kind === "channel" && (
              <>
                <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <div>
                    <p className="text-sm">仅特定角色可见</p>
                    <p className="text-xs text-muted-foreground">
                      开启后仅勾选的角色能看到此频道
                    </p>
                  </div>
                  <Switch
                    checked={privateChannel}
                    onCheckedChange={setPrivateChannel}
                  />
                </label>
                {privateChannel && (
                  <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border p-2">
                    {(roles ?? [])
                      .filter((r) => !r.is_everyone)
                      .sort((a, b) => b.position - a.position)
                      .map((role) => {
                        const checked = visibleRoleIds.includes(role.id)
                        return (
                          <label
                            key={role.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                          >
                            <input
                              type="checkbox"
                              className="size-3.5 accent-primary"
                              checked={checked}
                              onChange={() => {
                                setVisibleRoleIds((prev) =>
                                  checked
                                    ? prev.filter((id) => id !== role.id)
                                    : [...prev, role.id],
                                )
                              }}
                            />
                            <span
                              className="truncate"
                              style={
                                role.color
                                  ? { color: role.color }
                                  : undefined
                              }
                            >
                              {role.name}
                            </span>
                          </label>
                        )
                      })}
                    {(roles ?? []).filter((r) => !r.is_everyone).length ===
                      0 && (
                      <p className="px-2 py-1 text-xs text-muted-foreground">
                        暂无其它角色，可稍后在「管理频道 → 权限」中配置
                      </p>
                    )}
                  </div>
                )}
                <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <div>
                    <p className="text-sm">频道上锁</p>
                    <p className="text-xs text-muted-foreground">
                      需要密码才能访问（文字与语音均生效）
                    </p>
                  </div>
                  <Switch
                    checked={lockChannel}
                    onCheckedChange={(on) => {
                      setLockChannel(on)
                      if (!on) setChannelPassword("")
                    }}
                  />
                </label>
                {lockChannel && (
                  <div className="space-y-2">
                    <Label htmlFor="new-channel-password">访问密码</Label>
                    <Input
                      id="new-channel-password"
                      type="password"
                      value={channelPassword}
                      maxLength={64}
                      placeholder="1–64 个字符"
                      onChange={(e) => setChannelPassword(e.target.value)}
                    />
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialog(null)}
              disabled={pending}
            >
              取消
            </Button>
            <Button onClick={() => void submitCreate()} disabled={pending}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>邀请至服务器</DialogTitle>
            <DialogDescription>
              将此链接发给好友，对方登录后即可加入。链接默认永久有效、不限次数。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>邀请码</Label>
            <Input readOnly value={inviteCode} className="font-mono" />
            <Label>邀请链接</Label>
            <Input readOnly value={inviteUrl} className="text-xs" />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => void copyText("邀请码", inviteCode)}
            >
              复制邀请码
            </Button>
            <Button onClick={() => void copyText("邀请链接", inviteUrl)}>
              复制链接
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
