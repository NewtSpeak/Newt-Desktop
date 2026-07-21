// 用户相关右键菜单底部「管理员」段（docs 05 语音管理 + 管理面板入口）。
// 仅当本人是系统管 / 服主 / 管理员角色 / 持有相关权限时渲染。

import {
  HeadphoneOffIcon,
  MicOffIcon,
  PhoneOffIcon,
  ShieldIcon,
  VolumeXIcon,
} from "lucide-react"
import { useNavigate } from "react-router"

import {
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "~/components/ui/context-menu"
import {
  adminDisconnectVoice,
  computeAdminCaps,
  toggleServerDeaf,
  toggleServerMute,
  type AdminCaps,
} from "~/lib/moderation"
import type { GuildMember, Role, VoiceState } from "~/lib/api/types"
import { useAuthStore } from "~/stores/auth"
import { useMembersStore } from "~/stores/members"
import { useRolesStore } from "~/stores/roles"
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

/**
 * 管理员菜单段：分割线 + 打开管理视图 + 服务器静音 / 禁言 / 禁听 / 踢出语音。
 * 禁言 = server_mute；禁听 = server_deaf（开启时联动 mute 双向禁止）。
 */
export function AdminMemberMenuSection({
  guildId,
  targetUserId,
  /** 若已知当前语音状态可传入，避免重复查找 */
  voiceState,
  /** 是否显示踢出语音（目标在语音中时） */
  showDisconnect = true,
}: {
  guildId: string
  targetUserId: string
  voiceState?: VoiceState | null
  showDisconnect?: boolean
}) {
  const navigate = useNavigate()
  const caps = useAdminCaps(guildId)
  const selfId = useAuthStore((s) => s.user?.id)
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

  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuGroup>
      <ContextMenuLabel className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        管理员
        {caps.systemAdmin ? " · 系统" : ""}
      </ContextMenuLabel>
      <ContextMenuItem
        onClick={() =>
          void navigate(
            `/guilds/${guildId}/moderation?user=${encodeURIComponent(targetUserId)}`,
          )
        }
      >
        <ShieldIcon />
        在管理员视图中打开
      </ContextMenuItem>
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
      {inVoice && caps.canMute && (
        <ContextMenuItem
          onClick={() =>
            void toggleServerMute(guildId, targetUserId, !serverMuted)
          }
        >
          <VolumeXIcon />
          {serverMuted ? "解除禁言" : "禁言"}
        </ContextMenuItem>
      )}
      {inVoice && caps.canDeafen && (
        <ContextMenuItem
          onClick={() =>
            void toggleServerDeaf(guildId, targetUserId, !serverDeaf)
          }
        >
          <HeadphoneOffIcon />
          {serverDeaf ? "解除禁听" : "禁听（双向禁止）"}
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
          <MicOffIcon />
          目标不在语音中
        </ContextMenuItem>
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
