// 用户相关菜单底部「管理员」段（docs 05 语音管理 + 限制快捷 + 管理面板入口）。
// 仅当本人是系统管 / 服主 / 管理员角色 / 持有相关权限时渲染。
// 支持 context-menu 与 dropdown-menu 两种外壳。

import {
  BanIcon,
  ClockIcon,
  EyeIcon,
  HeadphoneOffIcon,
  MicOffIcon,
  PhoneOffIcon,
  ShieldIcon,
  VolumeXIcon,
} from "lucide-react"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import {
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "~/components/ui/context-menu"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "~/components/ui/dropdown-menu"
import {
  adminDisconnectVoice,
  computeAdminCaps,
  toggleServerDeaf,
  toggleServerMute,
  type AdminCaps,
} from "~/lib/moderation"
import { ApiError } from "~/lib/api/http"
import { createRestriction } from "~/lib/api/restrictions"
import type { GuildMember, Role, VoiceState } from "~/lib/api/types"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import { useMembersStore } from "~/stores/members"
import { useRolesStore } from "~/stores/roles"
import { useUIStore } from "~/stores/ui"
import { useViewAsStore, viewAsFromMember } from "~/stores/view-as"
import { useVoiceStore } from "~/stores/voice"

export function useAdminCaps(guildId: string | null | undefined): AdminCaps {
  const user = useAuthStore((s) => s.user)
  const selfId = user?.id
  const self = useMembersStore((s) =>
    guildId && selfId
      ? s.byGuild[guildId]?.find((m) => m.user_id === selfId)
      : undefined,
  )
  const roles = useRolesStore((s) =>
    guildId ? s.byGuild[guildId] : undefined,
  )
  return computeAdminCaps(self, roles, user)
}

/** 在 byChannel 中查找用户当前语音状态 */
export function findUserVoiceState(
  userId: string,
): VoiceState | undefined {
  const byChannel = useVoiceStore.getState().byChannel
  for (const states of Object.values(byChannel)) {
    const hit = states.find((s) => s.user_id === userId)
    if (hit?.channel_id) return hit
  }
  return undefined
}

const QUICK_TIMEOUTS: { label: string; ms: number | null }[] = [
  { label: "60 分钟", ms: 60 * 60 * 1000 },
  { label: "24 小时", ms: 24 * 60 * 60 * 1000 },
  { label: "7 天", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "永久", ms: null },
]

async function quickRestrict(
  guildId: string,
  targetUserId: string,
  kind: "text" | "voice",
  durationMs: number | null,
) {
  const expires_at =
    durationMs == null
      ? null
      : new Date(Date.now() + durationMs).toISOString()
  try {
    await createRestriction(guildId, {
      target_user_id: targetUserId,
      scope: kind === "text" ? "GUILD_ALL_TEXT" : "GUILD_ALL_VOICE",
      deny:
        kind === "text"
          ? { send_text: true }
          : { speak_voice: true },
      kind: "SANCTION",
      reason: "快捷限制",
      expires_at,
    })
    toast.success(
      kind === "text"
        ? "已禁止其在全服发送消息"
        : "已禁止其在全服语音发言",
    )
  } catch (error) {
    toast.error(
      error instanceof ApiError ? error.message : "施加限制失败",
    )
  }
}

type AdminMenuVariant = "context" | "dropdown"

/**
 * 管理员菜单段：分割线 + 打开管理视图 + 服务器静音/禁听/踢语音 + 快捷限制。
 * variant=context 用于右键菜单；variant=dropdown 用于资料卡「更多」子菜单。
 */
export function AdminMemberMenuSection({
  guildId,
  targetUserId,
  /** 若已知当前语音状态可传入，避免重复查找 */
  voiceState,
  /** 是否显示踢出语音（目标在语音中时） */
  showDisconnect = true,
  variant = "context",
}: {
  guildId: string
  targetUserId: string
  voiceState?: VoiceState | null
  showDisconnect?: boolean
  variant?: AdminMenuVariant
}) {
  const navigate = useNavigate()
  const caps = useAdminCaps(guildId)
  const selfId = useAuthStore((s) => s.user?.id)
  const targetMember = useMembersStore((s) =>
    s.byGuild[guildId]?.find((m) => m.user_id === targetUserId),
  )
  const liveState =
    voiceState ??
    useVoiceStore((s) => {
      for (const list of Object.values(s.byChannel)) {
        const hit = list.find((v) => v.user_id === targetUserId)
        if (hit?.channel_id) return hit
      }
      return undefined
    })

  if (!caps.isModerator) return null
  if (targetUserId === selfId) return null

  const inVoice = Boolean(liveState?.channel_id)
  const serverMuted = Boolean(liveState?.server_mute)
  const serverDeaf = Boolean(liveState?.server_deaf)

  const startViewAs = () => {
    if (!targetMember) {
      toast.error("成员信息未加载")
      return
    }
    if (!caps.canManageRoles) {
      toast.error("需要「管理角色」权限以拉取频道覆盖")
      return
    }
    const channelIds = (
      useChannelsStore.getState().byGuild[guildId] ?? []
    ).map((c) => c.id)
    void useViewAsStore
      .getState()
      .start(guildId, viewAsFromMember(targetMember), channelIds)
      .then(() =>
        toast.success(`正在以「${viewAsFromMember(targetMember).label}」视角查看`),
      )
  }

  const label = `管理员${caps.systemAdmin ? " · 系统" : ""}`
  const openModeration = () =>
    void navigate(
      `/guilds/${guildId}/moderation?user=${encodeURIComponent(targetUserId)}`,
    )
  const openRestrictions = () =>
    useUIStore.getState().openGuildAdmin(guildId, "restrictions")

  if (variant === "dropdown") {
    return (
      <>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            {label}
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={openModeration}>
            <ShieldIcon />
            在管理员视图中打开
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openRestrictions}>
            <BanIcon />
            服务器设置 · 限制
          </DropdownMenuItem>
          {caps.canManageRoles && targetMember ? (
            <DropdownMenuItem onClick={startViewAs}>
              <EyeIcon />
              以该成员身份查看
            </DropdownMenuItem>
          ) : null}

          {inVoice && caps.canMute ? (
            <DropdownMenuItem
              onClick={() =>
                void toggleServerMute(guildId, targetUserId, !serverMuted)
              }
            >
              <MicOffIcon />
              {serverMuted ? "解除服务器静音" : "服务器静音"}
            </DropdownMenuItem>
          ) : null}
          {inVoice && caps.canDeafen ? (
            <DropdownMenuItem
              onClick={() =>
                void toggleServerDeaf(guildId, targetUserId, !serverDeaf)
              }
            >
              <HeadphoneOffIcon />
              {serverDeaf ? "解除禁听" : "服务器闭听"}
            </DropdownMenuItem>
          ) : null}
          {inVoice && showDisconnect && caps.canDisconnect ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void adminDisconnectVoice(guildId, targetUserId)}
            >
              <PhoneOffIcon />
              踢出语音频道
            </DropdownMenuItem>
          ) : null}
          {!inVoice && (caps.canMute || caps.canDeafen) ? (
            <DropdownMenuItem disabled>
              <VolumeXIcon />
              目标不在语音中（语音管理不可用）
            </DropdownMenuItem>
          ) : null}

          {caps.canModerateMembers ? (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ClockIcon />
                  超时禁言（全服文字）
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-36">
                  {QUICK_TIMEOUTS.map((opt) => (
                    <DropdownMenuItem
                      key={`text-${opt.label}`}
                      onClick={() =>
                        void quickRestrict(
                          guildId,
                          targetUserId,
                          "text",
                          opt.ms,
                        )
                      }
                    >
                      {opt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <MicOffIcon />
                  超时禁说（全服语音）
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-36">
                  {QUICK_TIMEOUTS.map((opt) => (
                    <DropdownMenuItem
                      key={`voice-${opt.label}`}
                      onClick={() =>
                        void quickRestrict(
                          guildId,
                          targetUserId,
                          "voice",
                          opt.ms,
                        )
                      }
                    >
                      {opt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          ) : null}
        </DropdownMenuGroup>
      </>
    )
  }

  return (
    <>
      <ContextMenuSeparator className="my-0" />
      <ContextMenuGroup className="p-1.5">
        <ContextMenuLabel className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </ContextMenuLabel>
        <ContextMenuItem onClick={openModeration}>
          <ShieldIcon />
          在管理员视图中打开
        </ContextMenuItem>
        <ContextMenuItem onClick={openRestrictions}>
          <BanIcon />
          服务器设置 · 限制
        </ContextMenuItem>
        {caps.canManageRoles && targetMember && (
          <ContextMenuItem onClick={startViewAs}>
            <EyeIcon />
            以该成员身份查看
          </ContextMenuItem>
        )}

        {inVoice && caps.canMute && (
          <ContextMenuItem
            onClick={() =>
              void toggleServerMute(guildId, targetUserId, !serverMuted)
            }
          >
            <MicOffIcon />
            {serverMuted ? "解除服务器静音" : "服务器静音"}
          </ContextMenuItem>
        )}
        {inVoice && caps.canDeafen && (
          <ContextMenuItem
            onClick={() =>
              void toggleServerDeaf(guildId, targetUserId, !serverDeaf)
            }
          >
            <HeadphoneOffIcon />
            {serverDeaf ? "解除禁听" : "服务器闭听"}
          </ContextMenuItem>
        )}
        {inVoice && showDisconnect && caps.canDisconnect && (
          <ContextMenuItem
            variant="destructive"
            onClick={() => void adminDisconnectVoice(guildId, targetUserId)}
          >
            <PhoneOffIcon />
            踢出语音频道
          </ContextMenuItem>
        )}
        {!inVoice && (caps.canMute || caps.canDeafen) && (
          <ContextMenuItem disabled>
            <VolumeXIcon />
            目标不在语音中（语音管理不可用）
          </ContextMenuItem>
        )}

        {caps.canModerateMembers && (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <ClockIcon />
                超时禁言（全服文字）
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-36">
                {QUICK_TIMEOUTS.map((opt) => (
                  <ContextMenuItem
                    key={`text-${opt.label}`}
                    onClick={() =>
                      void quickRestrict(
                        guildId,
                        targetUserId,
                        "text",
                        opt.ms,
                      )
                    }
                  >
                    {opt.label}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <MicOffIcon />
                超时禁说（全服语音）
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-36">
                {QUICK_TIMEOUTS.map((opt) => (
                  <ContextMenuItem
                    key={`voice-${opt.label}`}
                    onClick={() =>
                      void quickRestrict(
                        guildId,
                        targetUserId,
                        "voice",
                        opt.ms,
                      )
                    }
                  >
                    {opt.label}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        )}
      </ContextMenuGroup>
    </>
  )
}

/** 非 hooks 场景：传入已算好的 caps / self 过滤 */
export function shouldShowAdminMenu(
  caps: AdminCaps,
  selfId: string | undefined,
  targetUserId: string,
): boolean {
  return caps.isModerator && selfId !== targetUserId
}

export type { Role, GuildMember }
