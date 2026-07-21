// 服务器管理员操作面板（基于客户端可用 REST API）：
//   - 语音席位：服务器静音 / 禁听 / 踢出语音
//   - 成员：踢出 / 封禁、跳转并高亮
//   - 封禁列表：解封
// 入口：任意用户右键「在管理员视图中打开」→ /guilds/:guildId/moderation?user=

import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import {
  ArrowLeftIcon,
  BanIcon,
  HeadphoneOffIcon,
  LogOutIcon,
  MicOffIcon,
  PhoneOffIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldIcon,
  VolumeXIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import {
  banUser,
  kickMember,
  listBans,
  unbanUser,
  type GuildBan,
} from "~/lib/api/guilds"
import { ApiError } from "~/lib/api/http"
import {
  adminDisconnectVoice,
  computeAdminCaps,
  toggleServerDeaf,
  toggleServerMute,
} from "~/lib/moderation"
import {
  memberDisplayName,
  nameInitials,
  resolveProfileAssetUrl,
} from "~/lib/user-display"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import { useGuildsStore } from "~/stores/guilds"
import { useMembersStore } from "~/stores/members"
import { usePresenceStore } from "~/stores/presence"
import { useRolesStore } from "~/stores/roles"
import { useVoiceStore } from "~/stores/voice"
import type { GuildMember, VoiceState } from "~/lib/api/types"

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  return fallback
}

type TabId = "voice" | "members" | "bans"

export default function ModerationPage() {
  const { guildId = "" } = useParams<{ guildId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightUser = searchParams.get("user") ?? ""
  const navigate = useNavigate()

  const user = useAuthStore((s) => s.user)
  const guild = useGuildsStore((s) => s.guilds.find((g) => g.id === guildId))
  const members = useMembersStore((s) => s.byGuild[guildId])
  const roles = useRolesStore((s) => s.byGuild[guildId])
  const channels = useChannelsStore((s) => s.byGuild[guildId])
  const byChannel = useVoiceStore((s) => s.byChannel)
  const statusByUser = usePresenceStore((s) => s.statusByUser)

  const self = members?.find((m) => m.user_id === user?.id)
  const caps = useMemo(
    () => computeAdminCaps(self, roles, user),
    [self, roles, user],
  )

  const [tab, setTab] = useState<TabId>("voice")
  const [query, setQuery] = useState("")
  const [bans, setBans] = useState<GuildBan[] | null>(null)
  const [bansLoading, setBansLoading] = useState(false)
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  useEffect(() => {
    if (!guildId) return
    void useMembersStore.getState().fetchMembers(guildId).catch(() => undefined)
    void useRolesStore.getState().fetchRoles(guildId).catch(() => undefined)
    void useChannelsStore.getState().fetchChannels(guildId).catch(() => undefined)
  }, [guildId])

  // 高亮用户时默认落在成员页
  useEffect(() => {
    if (highlightUser) setTab("members")
  }, [highlightUser])

  // 拉取各语音频道状态快照
  useEffect(() => {
    if (!guildId || !channels) return
    for (const ch of channels.filter((c) => c.type === "VOICE")) {
      void useVoiceStore.getState().fetchChannelStates(guildId, ch.id)
    }
  }, [guildId, channels])

  const loadBans = async () => {
    if (!caps.canBan) return
    setBansLoading(true)
    try {
      setBans(await listBans(guildId))
    } catch (error) {
      toast.error(errorMessage(error, "加载封禁列表失败"))
      setBans([])
    } finally {
      setBansLoading(false)
    }
  }

  useEffect(() => {
    if (tab === "bans") void loadBans()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, guildId, caps.canBan])

  const voiceRows = useMemo(() => {
    const rows: { state: VoiceState; channelName: string }[] = []
    const channelName = (id: string) =>
      channels?.find((c) => c.id === id)?.name ?? id.slice(0, 6)
    for (const [channelId, states] of Object.entries(byChannel)) {
      for (const state of states) {
        if (!state.channel_id) continue
        // 只显示本服
        if (state.guild_id && state.guild_id !== guildId) continue
        rows.push({ state, channelName: channelName(channelId) })
      }
    }
    return rows
  }, [byChannel, channels, guildId])

  const filteredMembers = useMemo(() => {
    const list = members ?? []
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((m) => {
      const name = memberDisplayName(m).toLowerCase()
      return (
        name.includes(q) ||
        m.username?.toLowerCase().includes(q) ||
        m.user_id.toLowerCase().includes(q)
      )
    })
  }, [members, query])

  if (!guildId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        无效的服务器
      </div>
    )
  }

  if (!caps.isModerator) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <ShieldIcon className="size-10 text-muted-foreground/50" />
        <p className="text-sm font-medium">没有管理权限</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          需要服务器所有者、管理员角色，或持有踢出/封禁/静音等权限。
        </p>
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
          返回
        </Button>
      </div>
    )
  }

  const run = async (key: string, action: () => Promise<boolean | void>) => {
    setPendingKey(key)
    try {
      await action()
    } finally {
      setPendingKey(null)
    }
  }

  const memberOf = (userId: string): GuildMember | undefined =>
    members?.find((m) => m.user_id === userId)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* 顶栏 */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate(-1)}
          aria-label="返回"
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">
            管理员视图
            {guild?.name ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {guild.name}
              </span>
            ) : null}
          </h1>
        </div>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">
          {caps.systemAdmin ? "系统管理员" : self?.is_owner ? "所有者" : "管理员"}
        </span>
      </header>

      {/* Tabs */}
      <div className="flex shrink-0 gap-1 border-b px-4 pt-2">
        {(
          [
            { id: "voice" as const, label: "语音席位", count: voiceRows.length },
            {
              id: "members" as const,
              label: "成员",
              count: members?.length ?? 0,
            },
            {
              id: "bans" as const,
              label: "封禁",
              count: bans?.length,
              hide: !caps.canBan,
            },
          ] as const
        )
          .filter((t) => !("hide" in t && t.hide))
          .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "relative px-3 py-2 text-sm transition-colors",
                tab === t.id
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {typeof t.count === "number" && (
                <span className="ml-1 text-xs tabular-nums text-muted-foreground">
                  {t.count}
                </span>
              )}
              {tab === t.id && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "voice" && (
          <section className="mx-auto max-w-3xl space-y-3">
            <p className="text-xs text-muted-foreground">
              当前服务器内各语音频道的在席成员。可服务器静音、禁听（联动禁言）、踢出语音。
            </p>
            {voiceRows.length === 0 ? (
              <EmptyState text="当前没有人在语音频道" />
            ) : (
              voiceRows.map(({ state, channelName }) => {
                const member = memberOf(state.user_id)
                const name = member
                  ? memberDisplayName(member)
                  : state.user_id.slice(0, 8)
                const avatar = resolveProfileAssetUrl(member?.avatar_url)
                const keyBase = `voice-${state.user_id}`
                return (
                  <div
                    key={`${state.channel_id}-${state.user_id}`}
                    className={cn(
                      "flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3",
                      highlightUser === state.user_id && "ring-2 ring-primary",
                    )}
                  >
                    <UserChip
                      name={name}
                      avatarSrc={avatar}
                      online={Boolean(statusByUser[state.user_id])}
                      sub={`# ${channelName}`}
                    />
                    <div className="flex flex-wrap gap-1 text-[10px]">
                      {state.self_mute && <Badge>自静音</Badge>}
                      {state.self_deaf && <Badge>自闭听</Badge>}
                      {state.server_mute && (
                        <Badge tone="danger">服务器静音</Badge>
                      )}
                      {state.server_deaf && (
                        <Badge tone="danger">禁听</Badge>
                      )}
                    </div>
                    <div className="ml-auto flex flex-wrap gap-1.5">
                      {caps.canMute && (
                        <Button
                          size="sm"
                          variant={state.server_mute ? "secondary" : "outline"}
                          disabled={pendingKey === `${keyBase}-mute`}
                          onClick={() =>
                            void run(`${keyBase}-mute`, () =>
                              toggleServerMute(
                                guildId,
                                state.user_id,
                                !state.server_mute,
                              ),
                            )
                          }
                        >
                          <MicOffIcon />
                          {state.server_mute ? "解除静音" : "服务器静音"}
                        </Button>
                      )}
                      {caps.canMute && (
                        <Button
                          size="sm"
                          variant={state.server_mute ? "secondary" : "outline"}
                          disabled={pendingKey === `${keyBase}-speak`}
                          onClick={() =>
                            void run(`${keyBase}-speak`, () =>
                              toggleServerMute(
                                guildId,
                                state.user_id,
                                !state.server_mute,
                              ),
                            )
                          }
                        >
                          <VolumeXIcon />
                          {state.server_mute ? "解除禁言" : "禁言"}
                        </Button>
                      )}
                      {caps.canDeafen && (
                        <Button
                          size="sm"
                          variant={state.server_deaf ? "secondary" : "outline"}
                          disabled={pendingKey === `${keyBase}-deaf`}
                          onClick={() =>
                            void run(`${keyBase}-deaf`, () =>
                              toggleServerDeaf(
                                guildId,
                                state.user_id,
                                !state.server_deaf,
                              ),
                            )
                          }
                        >
                          <HeadphoneOffIcon />
                          {state.server_deaf ? "解除禁听" : "禁听"}
                        </Button>
                      )}
                      {caps.canDisconnect && (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={pendingKey === `${keyBase}-dc`}
                          onClick={() =>
                            void run(`${keyBase}-dc`, () =>
                              adminDisconnectVoice(guildId, state.user_id),
                            )
                          }
                        >
                          <PhoneOffIcon />
                          踢出语音
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </section>
        )}

        {tab === "members" && (
          <section className="mx-auto max-w-3xl space-y-3">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索成员（名称 / 用户名 / ID）"
                className="pl-9"
              />
            </div>
            {filteredMembers.length === 0 ? (
              <EmptyState text="没有匹配的成员" />
            ) : (
              filteredMembers.map((member) => {
                const name = memberDisplayName(member)
                const avatar = resolveProfileAssetUrl(member.avatar_url)
                const voice = voiceRows.find(
                  (r) => r.state.user_id === member.user_id,
                )
                const keyBase = `mem-${member.user_id}`
                const highlighted = highlightUser === member.user_id
                return (
                  <div
                    key={member.user_id}
                    id={`mod-user-${member.user_id}`}
                    className={cn(
                      "flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3",
                      highlighted && "ring-2 ring-primary",
                    )}
                  >
                    <UserChip
                      name={name}
                      avatarSrc={avatar}
                      online={Boolean(statusByUser[member.user_id])}
                      sub={`@${member.username || member.user_id.slice(0, 8)}`}
                    />
                    <div className="flex flex-wrap gap-1 text-[10px]">
                      {member.is_owner && <Badge tone="amber">所有者</Badge>}
                      {voice && (
                        <Badge>语音 · #{voice.channelName}</Badge>
                      )}
                    </div>
                    <div className="ml-auto flex flex-wrap gap-1.5">
                      {voice && caps.canMute && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pendingKey === `${keyBase}-mute`}
                          onClick={() =>
                            void run(`${keyBase}-mute`, () =>
                              toggleServerMute(
                                guildId,
                                member.user_id,
                                !voice.state.server_mute,
                              ),
                            )
                          }
                        >
                          <MicOffIcon />
                          {voice.state.server_mute ? "解除静音" : "服务器静音"}
                        </Button>
                      )}
                      {voice && caps.canDeafen && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pendingKey === `${keyBase}-deaf`}
                          onClick={() =>
                            void run(`${keyBase}-deaf`, () =>
                              toggleServerDeaf(
                                guildId,
                                member.user_id,
                                !voice.state.server_deaf,
                              ),
                            )
                          }
                        >
                          <HeadphoneOffIcon />
                          {voice.state.server_deaf ? "解除禁听" : "禁听"}
                        </Button>
                      )}
                      {voice && caps.canDisconnect && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pendingKey === `${keyBase}-dc`}
                          onClick={() =>
                            void run(`${keyBase}-dc`, () =>
                              adminDisconnectVoice(guildId, member.user_id),
                            )
                          }
                        >
                          <PhoneOffIcon />
                          踢出语音
                        </Button>
                      )}
                      {caps.canKick && !member.is_owner && (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={pendingKey === `${keyBase}-kick`}
                          onClick={() =>
                            void run(`${keyBase}-kick`, async () => {
                              try {
                                await kickMember(guildId, member.id)
                                useMembersStore
                                  .getState()
                                  .removeMember(guildId, member.user_id)
                                toast.success(`已踢出「${name}」`)
                              } catch (error) {
                                toast.error(
                                  errorMessage(error, "踢出失败"),
                                )
                              }
                            })
                          }
                        >
                          <LogOutIcon />
                          踢出
                        </Button>
                      )}
                      {caps.canBan && !member.is_owner && (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={pendingKey === `${keyBase}-ban`}
                          onClick={() =>
                            void run(`${keyBase}-ban`, async () => {
                              try {
                                await banUser(guildId, member.user_id)
                                useMembersStore
                                  .getState()
                                  .removeMember(guildId, member.user_id)
                                toast.success(`已封禁「${name}」`)
                              } catch (error) {
                                toast.error(
                                  errorMessage(error, "封禁失败"),
                                )
                              }
                            })
                          }
                        >
                          <BanIcon />
                          封禁
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </section>
        )}

        {tab === "bans" && caps.canBan && (
          <section className="mx-auto max-w-3xl space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                已封禁用户无法通过邀请重新加入，可在此解封。
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void loadBans()}
                disabled={bansLoading}
              >
                <RefreshCwIcon />
                刷新
              </Button>
            </div>
            {bansLoading && bans === null ? (
              <EmptyState text="加载中…" />
            ) : !bans?.length ? (
              <EmptyState text="暂无封禁记录" />
            ) : (
              bans.map((ban) => (
                <div
                  key={ban.user_id}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3"
                >
                  <UserChip
                    name={ban.user_id.slice(0, 8)}
                    sub={
                      ban.reason?.trim()
                        ? ban.reason.trim()
                        : ban.created_at
                          ? `封禁于 ${new Date(ban.created_at).toLocaleString("zh-CN")}`
                          : "无原因"
                    }
                  />
                  <div className="ml-auto">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingKey === `unban-${ban.user_id}`}
                      onClick={() =>
                        void run(`unban-${ban.user_id}`, async () => {
                          try {
                            await unbanUser(guildId, ban.user_id)
                            setBans((prev) =>
                              (prev ?? []).filter(
                                (b) => b.user_id !== ban.user_id,
                              ),
                            )
                            toast.success("已解封")
                          } catch (error) {
                            toast.error(errorMessage(error, "解封失败"))
                          }
                        })
                      }
                    >
                      解封
                    </Button>
                  </div>
                </div>
              ))
            )}
          </section>
        )}
      </div>

      <footer className="shrink-0 border-t px-4 py-2 text-center text-[11px] text-muted-foreground">
        权限以服务端裁决为准。也可在成员 / 消息 / 语音参与者右键菜单使用快捷管理操作。{" "}
        <Link
          to="/"
          className="underline-offset-2 hover:underline"
          onClick={() => setSearchParams({})}
        >
          回到应用
        </Link>
      </footer>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}

function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode
  tone?: "default" | "danger" | "amber"
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 font-medium",
        tone === "default" && "bg-muted text-muted-foreground",
        tone === "danger" && "bg-destructive/15 text-destructive",
        tone === "amber" && "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      )}
    >
      {children}
    </span>
  )
}

function UserChip({
  name,
  avatarSrc,
  sub,
  online,
}: {
  name: string
  avatarSrc?: string
  sub?: string
  online?: boolean
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="relative shrink-0">
        <Avatar className="size-9 rounded-xl after:rounded-xl after:border-0">
          {avatarSrc ? (
            <AvatarImage
              src={avatarSrc}
              alt={name}
              className="rounded-xl object-cover"
            />
          ) : null}
          <AvatarFallback className="rounded-xl text-xs">
            {nameInitials(name)}
          </AvatarFallback>
        </Avatar>
        {online !== undefined && (
          <span
            className={cn(
              "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card",
              online ? "bg-emerald-500" : "bg-muted-foreground/40",
            )}
          />
        )}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        {sub ? (
          <p className="truncate text-xs text-muted-foreground">{sub}</p>
        ) : null}
      </div>
    </div>
  )
}
