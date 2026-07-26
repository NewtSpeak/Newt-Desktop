// 装扮"实景试穿"预览：按品类槽位分派到真实渲染组件（商城与我的装扮共用）。
// 头像框套当前用户头像、铭牌真实渲染渐变/视频+底色、资料卡边框/特效包迷你占位卡；
// 未知品类（运行时扩展）回退 preview_url 图，保证不炸。

import { SparklesIcon } from "lucide-react"

import {
  AvatarFrameOverlay,
  AvatarWithFrame,
} from "~/components/cosmetics/avatar-frame"
import { NameplateBackground } from "~/components/cosmetics/nameplate"
import { ProfileCardChrome } from "~/components/cosmetics/profile-decorations"
import { StyledDisplayName } from "~/components/styled-name"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { resolveMemberNameStyle } from "~/lib/name-style"
import {
  memberDisplayName,
  nameInitials,
  resolveProfileAssetUrl,
} from "~/lib/user-display"
import { useAuthStore } from "~/stores/auth"
import { useCosmeticsStore } from "~/stores/cosmetics"
import { useMembersStore } from "~/stores/members"
import { useRolesStore } from "~/stores/roles"
import { useUIStore } from "~/stores/ui"
import type { CosmeticItem, EquippedSlot } from "~/lib/api/cosmetics"

/** CosmeticItem → EquippedSlot 适配（字段同构，供渲染组件试穿） */
export function asSlot(item: CosmeticItem): EquippedSlot {
  return {
    item_id: item.id,
    category_key: item.category_key,
    slot: item.slot ?? item.category_key,
    name: item.name,
    assets: item.assets,
    payload: item.payload,
  }
}

/** 静态回退预览：preview_url 图 → Sparkles 占位 */
function FallbackPreview({ url }: { url?: string }) {
  const resolved = resolveProfileAssetUrl(url)
  if (resolved) {
    return (
      <img
        src={resolved}
        alt=""
        className="size-full object-cover outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
        draggable={false}
      />
    )
  }
  return (
    <div className="flex size-full items-center justify-center text-muted-foreground">
      <SparklesIcon className="size-8 opacity-40" />
    </div>
  )
}

/**
 * 铭牌实景试穿：1:1 复刻成员列表行 —— 行宽跟随右侧成员栏宽度（减去列表 px-2 内边距）、
 * 套用当前已装备头像框、显示名按本人当前名称样式配置（所选服务器的角色色/渐变）渲染。
 */
function NameplateTryOnRow({ slot }: { slot: EquippedSlot }) {
  const self = useAuthStore((s) => s.user)
  const panelWidth = useUIStore((s) => s.memberPanelWidth)
  const guildId = useUIStore((s) => s.selectedGuildId)
  const avatarFrame = useCosmeticsStore((s) => s.loadout.avatar_frame)
  const inGuild = Boolean(guildId && guildId !== "@me")
  const member = useMembersStore((s) =>
    inGuild && self
      ? s.byGuild[guildId!]?.find((m) => m.user_id === self.id)
      : undefined,
  )
  const roles = useRolesStore((s) => (inGuild ? s.byGuild[guildId!] : undefined))

  const name = member
    ? memberDisplayName(member)
    : self?.display_name?.trim() || self?.username?.trim() || "你的昵称"
  const nameStyle = resolveMemberNameStyle(member, roles)
  const avatarUrl = resolveProfileAssetUrl(self?.avatar_url)
  // 与 member-panel 实际行同宽：成员栏宽度 - 列表容器 px-2 左右各 8px
  const rowWidth = Math.max(140, panelWidth - 16)

  return (
    <div className="flex size-full items-center justify-center p-4">
      <div
        className="relative flex items-center gap-2 overflow-hidden rounded-md px-2 py-0.5 text-left text-sm"
        style={{ width: rowWidth, maxWidth: "100%" }}
      >
        <NameplateBackground nameplate={slot} />
        {/* flex：消除 inline 基线偏移，与 member-panel 实际行保持一致 */}
        <span className="relative z-[1] flex shrink-0 items-center justify-center">
          <AvatarWithFrame frame={avatarFrame} sizeClass="size-8">
            <Avatar className="size-8 rounded-full after:rounded-full after:border-0">
              {avatarUrl ? (
                <AvatarImage
                  src={avatarUrl}
                  alt=""
                  className="rounded-full object-cover"
                />
              ) : null}
              <AvatarFallback className="rounded-full text-[10px]">
                {name ? nameInitials(name) : "我"}
              </AvatarFallback>
            </Avatar>
          </AvatarWithFrame>
        </span>
        <StyledDisplayName
          name={name}
          style={nameStyle}
          className="relative z-[1] min-w-0 flex-1 truncate text-[13px]"
        />
      </div>
    </div>
  )
}

export function ItemPreview({ item }: { item: CosmeticItem }) {
  const self = useAuthStore((s) => s.user)
  const slotKey = item.slot ?? item.category_key
  const slot = asSlot(item)

  if (slotKey === "avatar_frame") {
    const avatarUrl = resolveProfileAssetUrl(self?.avatar_url)
    const name = self?.display_name || self?.username || ""
    return (
      <div className="flex size-full items-center justify-center">
        <span className="relative inline-flex">
          <Avatar className="size-16">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-sm">
              {name ? nameInitials(name) : "我"}
            </AvatarFallback>
          </Avatar>
          <AvatarFrameOverlay frame={slot} className="z-[2]" />
        </span>
      </div>
    )
  }

  if (slotKey === "nameplate") {
    return <NameplateTryOnRow slot={slot} />
  }

  if (slotKey === "profile_border" || slotKey === "profile_effect") {
    const border = slotKey === "profile_border" ? slot : null
    const effect = slotKey === "profile_effect" ? slot : null
    return (
      <div className="flex size-full items-center justify-center p-3">
        <ProfileCardChrome
          border={border}
          effect={effect}
          size="compact"
          playAudio={false}
          // 卡片占预览区高度 70%：给外挂边框（上 1/3、下 1/2 悬出）留显示空间
          className="h-[70%] w-auto"
        >
          {/* 迷你占位资料卡：9:16 竖版，按预览区高度撑满，最大程度展示完整卡片样式 */}
          <div className="flex aspect-[9/16] h-full flex-col gap-2 rounded-lg bg-muted/60 p-3">
            <div className="h-8 rounded-md bg-foreground/10" />
            <div className="flex items-center gap-2">
              <span className="size-7 rounded-full bg-foreground/20" />
              <div className="flex flex-1 flex-col gap-1">
                <span className="h-2 w-16 rounded bg-foreground/20" />
                <span className="h-2 w-10 rounded bg-foreground/10" />
              </div>
            </div>
          </div>
        </ProfileCardChrome>
      </div>
    )
  }

  return <FallbackPreview url={item.preview_url} />
}
