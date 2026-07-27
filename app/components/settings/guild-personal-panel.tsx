// 服务器个人设置面板（docs 17 FR-06）：中型模态，仅影响本人在该服的体验。
// 分组：概览（昵称）· 通知 · 入场语音包选包 · 频道列表个性化 · 隐私（预留）。
// 与 18 号服管全屏面板严格区分：此处不出现任何管理项。
// 打开时绑定 guildId（ui store 会话态）；切换浏览服务器不自动切换目标（FR-08）。

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { EmojiTextField } from "~/components/ui/emoji-text-field"
import { sliceByCodePoints } from "~/lib/text-length"
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group"
import { Switch } from "~/components/ui/switch"
import {
  RoleStyleDot,
  StyledDisplayName,
} from "~/components/styled-name"
import {
  updateMemberNickname,
  updateMyNameStylePreference,
} from "~/lib/api/guilds"
import { ApiError, resolveApiUrl } from "~/lib/api/http"
import type { Role } from "~/lib/api/types"
import {
  clearMyVoicePackSelection,
  listVoicePacks,
  selectVoicePack,
  type VoicePack,
} from "~/lib/api/voice-admin"
import { hasPermission, Permissions } from "~/lib/permissions"
import {
  resolveMemberNameStyle,
  resolveRoleIconResolved,
} from "~/lib/name-style"
import { memberDisplayName } from "~/lib/user-display"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useGuildsStore } from "~/stores/guilds"
import { useMembersStore } from "~/stores/members"
import { memberGuildPermissions, useRolesStore } from "~/stores/roles"
import {
  isOverrideMuted,
  MUTE_DURATION_OPTIONS,
  muteRemainingLabel,
  useSettingsStore,
  type NotifyLevel,
} from "~/stores/settings"
import { useUIStore } from "~/stores/ui"

const LEVELS: { value: NotifyLevel | "inherit"; label: string }[] = [
  { value: "inherit", label: "跟随全局" },
  { value: "all", label: "全部消息" },
  { value: "mentions", label: "仅 @提及" },
  { value: "none", label: "无" },
]

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm break-words">{label}</p>
        {description && (
          <p className="mt-0.5 text-xs break-words text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="flex max-w-[48%] shrink-0 flex-wrap justify-end gap-1">
        {children}
      </div>
    </div>
  )
}

export function GuildPersonalPanel() {
  const guildId = useUIStore((s) => s.guildPersonalGuildId)
  const closePanel = useUIStore((s) => s.closeGuildPersonal)
  const guild = useGuildsStore((s) =>
    s.guilds.find((item) => item.id === guildId),
  )

  const selfId = useAuthStore((s) => s.user?.id)
  const selfMember = useMembersStore((s) =>
    guildId ? s.byGuild[guildId]?.find((m) => m.user_id === selfId) : undefined,
  )
  const roles = useRolesStore((s) => (guildId ? s.byGuild[guildId] : undefined))
  const canChangeNickname = useMemo(
    () =>
      hasPermission(
        memberGuildPermissions(selfMember, roles),
        Permissions.CHANGE_NICKNAME,
      ),
    [selfMember, roles],
  )

  const override = useSettingsStore((s) =>
    guildId ? s.notifications.perGuild[guildId] : undefined,
  )
  const prefs = useSettingsStore((s) =>
    guildId ? s.guildPreferences[guildId] : undefined,
  )
  const muted = isOverrideMuted(override)
  const remaining = muteRemainingLabel(override)

  // 昵称草稿：面板打开或成员数据更新时重置
  const [nickname, setNickname] = useState("")
  const [savingNickname, setSavingNickname] = useState(false)
  useEffect(() => {
    setNickname(selfMember?.nickname ?? "")
  }, [guildId, selfMember?.nickname])

  // 用户名样式来源角色（仅切换展示，不增删角色）
  const [styleRoleId, setStyleRoleId] = useState<string | "auto">("auto")
  const [savingStyle, setSavingStyle] = useState(false)
  useEffect(() => {
    const pref = selfMember?.name_style_role_id?.trim()
    setStyleRoleId(pref || "auto")
  }, [guildId, selfMember?.name_style_role_id])

  // 本人持有的角色（含 @everyone），用于选择样式来源
  const heldRoles = useMemo(() => {
    if (!roles?.length || !selfMember) return [] as Role[]
    const held = new Set(selfMember.role_ids)
    return roles
      .filter((r) => r.is_everyone || held.has(r.id))
      .slice()
      .sort((a, b) => b.position - a.position || a.id.localeCompare(b.id))
  }, [roles, selfMember])

  /** 本人持有角色选项；标注是否配置了样式 */
  const styleOptions = useMemo(() => {
    return heldRoles.map((role) => {
      const style =
        typeof role.style === "string"
          ? role.style
          : role.style
            ? JSON.stringify(role.style)
            : ""
      const hasStyle =
        (style && style !== "{}" && style !== "") ||
        Boolean(role.color?.trim())
      return { role, hasStyle }
    })
  }, [heldRoles])

  const previewName = useMemo(() => {
    if (!selfMember) return "预览"
    return memberDisplayName(selfMember)
  }, [selfMember])

  const previewStyle = useMemo(() => {
    if (!selfMember || !roles) return null
    return resolveMemberNameStyle(
      {
        ...selfMember,
        name_style_role_id: styleRoleId === "auto" ? null : styleRoleId,
      },
      roles,
    )
  }, [selfMember, roles, styleRoleId])

  const saveNameStylePreference = async (next: string | "auto") => {
    if (!guildId || !selfMember) return
    const prev = selfMember.name_style_role_id ?? null
    const roleId = next === "auto" ? null : next
    setStyleRoleId(next)
    setSavingStyle(true)
    useMembersStore.getState().upsertMember(guildId, {
      user_id: selfMember.user_id,
      name_style_role_id: roleId,
    })
    try {
      await updateMyNameStylePreference(guildId, roleId)
      toast.success(
        roleId ? "已切换用户名样式来源" : "已恢复自动（最高样式角色）",
      )
    } catch (error) {
      useMembersStore.getState().upsertMember(guildId, {
        user_id: selfMember.user_id,
        name_style_role_id: prev,
      })
      setStyleRoleId(prev?.trim() || "auto")
      toast.error(
        error instanceof ApiError ? error.message : "保存用户名样式偏好失败",
      )
    } finally {
      setSavingStyle(false)
    }
  }

  // 打开面板时确保角色列表就绪
  useEffect(() => {
    if (!guildId) return
    if (roles === undefined) {
      void useRolesStore.getState().fetchRoles(guildId).catch(() => undefined)
    }
  }, [guildId, roles])

  // 入场语音包选包（docs 12 / 17）
  const [packs, setPacks] = useState<VoicePack[] | null>(null)
  const [packsLoading, setPacksLoading] = useState(false)
  const [packBusy, setPackBusy] = useState(false)

  const loadPacks = useCallback(() => {
    if (!guildId) return
    setPacksLoading(true)
    listVoicePacks(guildId)
      .then(setPacks)
      .catch(() => setPacks([]))
      .finally(() => setPacksLoading(false))
  }, [guildId])

  useEffect(() => {
    loadPacks()
  }, [loadPacks])

  const selectedPackId = packs?.find((p) => p.selected)?.id ?? null

  const choosePack = async (packId: string | null) => {
    if (!guildId) return
    setPackBusy(true)
    try {
      if (packId === null) {
        await clearMyVoicePackSelection(guildId)
        toast.success("已取消入场音效")
      } else {
        await selectVoicePack(guildId, packId)
        toast.success("已选用入场音效")
      }
      loadPacks()
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.code === "PACK_NOT_AUTHORIZED"
            ? "缺少使用该语音包所需的身份组"
            : error.message
          : "选包失败",
      )
    } finally {
      setPackBusy(false)
    }
  }

  const previewPack = (pack: VoicePack) => {
    if (!pack.audio_url) {
      toast.error("该包尚未上传音频")
      return
    }
    const audio = new Audio(resolveApiUrl(pack.audio_url))
    void audio.play().catch(() => toast.error("播放失败"))
  }

  if (!guildId || !guild) return null

  const setGuildNotify = (patch: Parameters<
    ReturnType<typeof useSettingsStore.getState>["setGuildNotify"]
  >[1]) => useSettingsStore.getState().setGuildNotify(guildId, patch)

  const saveNickname = async () => {
    if (!selfMember) return
    const next = sliceByCodePoints(nickname.trim(), 32)
    if (next === (selfMember.nickname ?? "")) return
    setSavingNickname(true)
    // 乐观更新：失败回滚（docs 17 §7.2）
    const prev = selfMember.nickname
    useMembersStore.getState().upsertMember(guildId, {
      user_id: selfMember.user_id,
      nickname: next,
    })
    try {
      // 本人改昵称走 @me（docs 17）；路径接受成员记录 ID / user_id，但 @me 最稳妥
      await updateMemberNickname(guildId, "@me", next)
      toast.success(next ? "昵称已更新" : "已清除服内昵称")
    } catch (error) {
      useMembersStore.getState().upsertMember(guildId, {
        user_id: selfMember.user_id,
        nickname: prev,
      })
      setNickname(prev ?? "")
      toast.error(
        error instanceof ApiError && error.status === 403
          ? "缺少修改昵称权限"
          : "昵称保存失败",
      )
    } finally {
      setSavingNickname(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && closePanel()}>
      <DialogContent className="flex max-h-[80vh] min-w-0 flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader className="min-w-0 shrink-0 pr-8">
          <DialogTitle className="truncate">
            {guild.name} · 个人设置
          </DialogTitle>
          <DialogDescription>
            仅影响你自己在这个服务器的体验，不改变服务器配置
          </DialogDescription>
        </DialogHeader>

        {/*
          滚动条贴卡片右缘：外层 -mr-6 抵消 DialogContent 的 p-6，
          内层 pr-5 让正文与滚动条拉开距离。
        */}
        <div className="-mr-6 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
          <div className="flex min-w-0 flex-col gap-6 pr-5">
          <Group title="概览 · 服内昵称">
            <div className="flex min-w-0 items-center gap-2">
              <EmojiTextField
                value={nickname}
                maxChars={32}
                className="min-w-0 flex-1"
                placeholder={selfMember?.display_name || selfMember?.username || ""}
                disabled={!canChangeNickname || savingNickname}
                onChange={setNickname}
                onBlur={() => void saveNickname()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveNickname()
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                disabled={!canChangeNickname || savingNickname}
                onClick={() => void saveNickname()}
              >
                保存
              </Button>
            </div>
            <p className="text-xs break-words text-muted-foreground">
              {canChangeNickname
                ? `他人将看到：${nickname.trim() || selfMember?.display_name || selfMember?.username || "—"}（昵称 > 显示名 > 用户名）`
                : "缺少修改昵称权限"}
            </p>
          </Group>

          <Group title="用户名样式">
            <p className="text-xs text-muted-foreground">
              从你已持有的身份组中选择用户名样式来源（颜色 / 渐变 /
              徽章效果）。不会增删角色，仅改变展示。
            </p>
            <div className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2.5">
              <span className="text-[11px] text-muted-foreground shrink-0">
                预览
              </span>
              <StyledDisplayName
                name={previewName}
                style={previewStyle}
                className="text-base font-semibold"
              />
            </div>
            <RadioGroup
              className="min-w-0 gap-1.5"
              value={styleRoleId}
              disabled={savingStyle || !selfMember}
              onValueChange={(value) =>
                void saveNameStylePreference(value as string | "auto")
              }
            >
              <label className="flex min-w-0 items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <RadioGroupItem value="auto" className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">自动</p>
                  <p className="text-[11px] text-muted-foreground">
                    使用你持有的、层级最高且配置了样式的身份组
                  </p>
                </div>
              </label>
              {styleOptions.map(({ role, hasStyle }) => {
                const displayStyle = resolveMemberNameStyle(
                  {
                    role_ids: selfMember?.role_ids ?? [role.id],
                    name_style_role_id: role.id,
                  },
                  roles,
                )
                const iconStyle = resolveRoleIconResolved(role)
                return (
                  <label
                    key={role.id}
                    className={cn(
                      "flex min-w-0 items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2 text-sm",
                      !hasStyle && "opacity-70",
                    )}
                  >
                    <RadioGroupItem value={role.id} className="shrink-0" />
                    <RoleStyleDot
                      style={
                        iconStyle.kind !== "none" ? iconStyle : null
                      }
                      fallbackColor={role.color}
                      className="size-3 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <StyledDisplayName
                        name={
                          role.is_everyone ? "@everyone" : role.name
                        }
                        style={displayStyle}
                        className="truncate text-sm"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        {hasStyle
                          ? "已配置样式"
                          : "未配置样式（选中后显示默认）"}
                        {" · "}P{role.position}
                      </p>
                    </div>
                  </label>
                )
              })}
            </RadioGroup>
            {styleOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                暂无可用身份组
              </p>
            ) : null}
          </Group>

          <Group title="通知">
            <RadioGroup
              className="min-w-0 gap-1.5"
              value={override?.level ?? "inherit"}
              onValueChange={(value) =>
                setGuildNotify({
                  level: value === "inherit" ? undefined : (value as NotifyLevel),
                })
              }
            >
              {LEVELS.map((option) => (
                <label
                  key={option.value}
                  className="flex min-w-0 items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2 text-sm"
                >
                  <RadioGroupItem value={option.value} className="shrink-0" />
                  <span className="min-w-0 truncate">{option.label}</span>
                </label>
              ))}
            </RadioGroup>
            <Row
              label="抑制 @everyone 和 @here"
              description="不再因群体提及弹通知与响声；@ 红点计数保留"
            >
              <Switch
                checked={override?.suppressEveryone === true}
                onCheckedChange={(checked) =>
                  setGuildNotify({ suppressEveryone: Boolean(checked) || undefined })
                }
              />
            </Row>
            {muted ? (
              <Row
                label="静音中"
                description={remaining ?? "直到重新开启"}
              >
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setGuildNotify({ muted: undefined, mutedUntil: undefined })
                  }
                >
                  取消静音
                </Button>
              </Row>
            ) : (
              <Row label="静音服务器" description="不弹通知、不显示未读白点；@ 计数保留">
                {MUTE_DURATION_OPTIONS.map((option) => (
                  <Button
                    key={option.label}
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setGuildNotify(
                        option.ms === null
                          ? { muted: true, mutedUntil: undefined }
                          : {
                              muted: undefined,
                              mutedUntil: Date.now() + option.ms,
                            },
                      )
                    }
                  >
                    {option.label}
                  </Button>
                ))}
              </Row>
            )}
          </Group>

          <Group title="入场语音包">
            <p className="text-xs text-muted-foreground">
              进入语音频道时播放的个人音效。服管在「服务器设置 → 入场语音包」维护库。
            </p>
            {packsLoading && (
              <p className="text-xs text-muted-foreground">加载中…</p>
            )}
            {!packsLoading && packs && packs.length === 0 && (
              <p className="text-xs text-muted-foreground">
                本服暂无可选语音包
              </p>
            )}
            {!packsLoading && packs && packs.length > 0 && (
              <div className="flex min-w-0 flex-col gap-1.5">
                <button
                  type="button"
                  disabled={packBusy}
                  onClick={() => void choosePack(null)}
                  className={cn(
                    "min-w-0 rounded-lg bg-muted/50 px-3 py-2 text-left text-sm",
                    selectedPackId === null
                      ? "bg-muted font-medium"
                      : "hover:bg-muted/80",
                  )}
                >
                  不使用
                </button>
                {packs.map((pack) => {
                  const disabled = pack.available === false
                  const selected = pack.selected === true
                  return (
                    <div
                      key={pack.id}
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-lg bg-muted/50 px-3 py-2",
                        selected && "bg-muted font-medium",
                        disabled && "opacity-50",
                      )}
                    >
                      <button
                        type="button"
                        disabled={packBusy || disabled}
                        className="min-w-0 flex-1 truncate text-left text-sm"
                        onClick={() => void choosePack(pack.id)}
                      >
                        <span className="font-medium">{pack.name}</span>
                        {pack.kind === "RARE" && (
                          <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                            稀有
                          </span>
                        )}
                        {disabled && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground">
                            无权限
                          </span>
                        )}
                      </button>
                      {pack.audio_url && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0"
                          disabled={packBusy}
                          onClick={() => previewPack(pack)}
                        >
                          试听
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Group>

          <Group title="频道列表">
            <Row
              label="隐藏已静音的频道"
              description="当前选中与有 @ 提及的频道仍会显示"
            >
              <Switch
                checked={prefs?.hideMutedChannels === true}
                onCheckedChange={(checked) =>
                  useSettingsStore
                    .getState()
                    .setGuildPreference(guildId, {
                      hideMutedChannels: Boolean(checked),
                    })
                }
              />
            </Row>
            <Row
              label="重置分类折叠"
              description={`已折叠 ${prefs?.collapsedCategoryIds?.length ?? 0} 个分类`}
            >
              <Button
                size="sm"
                variant="ghost"
                disabled={!prefs?.collapsedCategoryIds?.length}
                onClick={() =>
                  useSettingsStore
                    .getState()
                    .setGuildPreference(guildId, { collapsedCategoryIds: [] })
                }
              >
                全部展开
              </Button>
            </Row>
          </Group>

          <Group title="隐私">
            <Row
              label="允许本服务器成员向我发送私信"
              description="关闭后，仅因共同在本服获得的新私信资格失效；好友私信不受影响（docs 17 FR-18）"
            >
              <Switch
                checked={prefs?.allowDmsFromMembers !== false}
                onCheckedChange={(checked) => {
                  useSettingsStore.getState().setGuildPreference(guildId, {
                    allowDmsFromMembers: Boolean(checked),
                  })
                  void import("~/lib/api/social").then(({ putGuildPrivacy }) =>
                    putGuildPrivacy(guildId, Boolean(checked)).catch(() =>
                      toast.error("同步服级私信设置失败"),
                    ),
                  )
                }}
              />
            </Row>
            <p className="text-[11px] text-muted-foreground">
              偏好已跨端同步；服务端隐私裁决 API 就绪后将以此为权威输入。
            </p>
          </Group>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
