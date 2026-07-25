// 服务器设置 · 机器人管理：服主/MANAGE_BOTS 创建本服独属 bot、签发 token、绑定角色、删除。

import { useCallback, useEffect, useState } from "react"
import {
  BotIcon,
  CopyIcon,
  KeyRoundIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
  createGuildBot,
  createGuildBotToken,
  deleteGuildBot,
  listGuildBotTokens,
  listGuildBots,
  revokeGuildBotToken,
  updateGuildBot,
  type BotTokenMeta,
  type GuildBot,
} from "~/lib/api/bots"
import { assignMemberRole, listRoles, removeMemberRole } from "~/lib/api/guilds"
import { ApiError } from "~/lib/api/http"
import type { Role } from "~/lib/api/types"
import { copyText } from "~/lib/clipboard"
import { cn } from "~/lib/utils"

export function BotsSection({ guildId }: { guildId: string }) {
  const [bots, setBots] = useState<GuildBot[] | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 创建表单
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState("")
  const [username, setUsername] = useState("")
  const [description, setDescription] = useState("")

  // 展开的 bot 详情（token / 角色）
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [tokensByBot, setTokensByBot] = useState<Record<string, BotTokenMeta[]>>(
    {},
  )
  const [plainToken, setPlainToken] = useState<{
    botId: string
    plain: string
  } | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [botList, roleList] = await Promise.all([
        listGuildBots(guildId),
        listRoles(guildId).catch(() => [] as Role[]),
      ])
      setBots(botList)
      setRoles(roleList.filter((r) => !r.is_everyone))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载机器人失败")
      setBots(null)
    }
  }, [guildId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const loadTokens = async (botId: string) => {
    try {
      const tokens = await listGuildBotTokens(guildId, botId)
      setTokensByBot((prev) => ({ ...prev, [botId]: tokens }))
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "读取令牌失败")
    }
  }

  const onCreate = async () => {
    const n = name.trim()
    const u = username.trim()
    if (n.length < 2 || u.length < 2) {
      toast.error("名称与用户名至少 2 个字符")
      return
    }
    setBusy(true)
    try {
      const bot = await createGuildBot(guildId, {
        name: n,
        username: u,
        description: description.trim() || undefined,
      })
      toast.success(`机器人「${bot.name}」已创建并加入本服务器`)
      setShowCreate(false)
      setName("")
      setUsername("")
      setDescription("")
      await refresh()
      setExpandedId(bot.id)
      await loadTokens(bot.id)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "创建失败")
    } finally {
      setBusy(false)
    }
  }

  const onIssueToken = async (botId: string) => {
    setBusy(true)
    try {
      const { plain } = await createGuildBotToken(guildId, botId, {
        name: "default",
      })
      setPlainToken({ botId, plain })
      await loadTokens(botId)
      toast.success("令牌已签发，请立即复制保存（仅显示一次）")
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "签发失败")
    } finally {
      setBusy(false)
    }
  }

  const onRevokeToken = async (botId: string, tokenId: string) => {
    if (!confirm("确定吊销该令牌？使用中的 SDK 将立即失效。")) return
    setBusy(true)
    try {
      await revokeGuildBotToken(guildId, botId, tokenId)
      toast.success("令牌已吊销")
      await loadTokens(botId)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "吊销失败")
    } finally {
      setBusy(false)
    }
  }

  const onDeleteBot = async (bot: GuildBot) => {
    const home = bot.home_guild_id === guildId
    const msg = home
      ? `确定删除机器人「${bot.name}」？将吊销全部令牌并移出本服。`
      : `确定将「${bot.name}」从本服卸载？（平台级机器人不会删除档案）`
    if (!confirm(msg)) return
    setBusy(true)
    try {
      await deleteGuildBot(guildId, bot.id)
      toast.success(home ? "机器人已删除" : "已卸载")
      if (expandedId === bot.id) setExpandedId(null)
      await refresh()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "操作失败")
    } finally {
      setBusy(false)
    }
  }

  const onToggleRole = async (bot: GuildBot, roleId: string, on: boolean) => {
    setBusy(true)
    try {
      if (on) await assignMemberRole(guildId, bot.member_id, roleId)
      else await removeMemberRole(guildId, bot.member_id, roleId)
      await refresh()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "角色更新失败")
    } finally {
      setBusy(false)
    }
  }

  const onRename = async (bot: GuildBot, nextName: string) => {
    const n = nextName.trim()
    if (n.length < 2 || n === bot.name) return
    setBusy(true)
    try {
      await updateGuildBot(guildId, bot.id, { name: n })
      toast.success("已更新名称")
      await refresh()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "更新失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">机器人</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            在本服务器创建独属机器人，自动加入成员列表。用 bot token 连接 SDK
            即可收发消息、流式回复与进语音。需{" "}
            <span className="font-medium text-foreground">管理机器人</span>{" "}
            权限（服主默认具备）。
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={busy}
          >
            <RefreshCwIcon className="size-3.5" />
            刷新
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setShowCreate((v) => !v)}
            disabled={busy}
          >
            <PlusIcon className="size-3.5" />
            创建机器人
          </Button>
        </div>
      </div>

      {showCreate && (
        <div className="space-y-3 rounded-xl border border-border/80 bg-muted/20 p-4">
          <p className="text-sm font-medium">新建本服机器人</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bot-name">显示名称</Label>
              <Input
                id="bot-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：AI 助手"
                maxLength={64}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bot-username">用户名（全局唯一）</Label>
              <Input
                id="bot-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="如：ai-helper"
                maxLength={32}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bot-desc">描述（可选）</Label>
            <Input
              id="bot-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="它能做什么？"
              maxLength={512}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowCreate(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void onCreate()}
            >
              创建并加入本服
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      {bots === null && !error && (
        <p className="text-sm text-muted-foreground">加载中…</p>
      )}
      {bots && bots.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-10 text-center">
          <BotIcon className="size-8 text-muted-foreground/60" />
          <p className="text-sm font-medium">本服还没有机器人</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            创建后将自动出现在成员列表，为其签发 token 即可用官方 SDK 对接。
          </p>
        </div>
      )}

      {bots && bots.length > 0 && (
        <ul className="space-y-3">
          {bots.map((bot) => {
            const expanded = expandedId === bot.id
            const isHome = bot.home_guild_id === guildId || !bot.home_guild_id
            // home_guild_id 为空的平台 bot 也可能装在本服；仅 home===guild 可视为独属
            const guildOwned = bot.home_guild_id === guildId
            return (
              <li
                key={bot.id}
                className="rounded-xl border border-border/80 bg-card/40"
              >
                <div className="flex flex-wrap items-center gap-3 p-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <BotIcon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium">{bot.name}</p>
                      <span className="rounded bg-primary/15 px-1.5 py-px text-[10px] font-semibold uppercase text-primary">
                        BOT
                      </span>
                      {guildOwned ? (
                        <span className="text-[10px] text-muted-foreground">
                          本服独属
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          平台安装
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      @{bot.username}
                      {bot.description ? ` · ${bot.description}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        const next = expanded ? null : bot.id
                        setExpandedId(next)
                        if (next) void loadTokens(bot.id)
                      }}
                    >
                      <KeyRoundIcon className="size-3.5" />
                      {expanded ? "收起" : "管理"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={() => void onDeleteBot(bot)}
                    >
                      <Trash2Icon className="size-3.5" />
                      {guildOwned ? "删除" : "卸载"}
                    </Button>
                  </div>
                </div>

                {expanded && (
                  <div className="space-y-4 border-t border-border/60 px-3 py-3">
                    {guildOwned && (
                      <div className="space-y-1.5">
                        <Label>显示名称</Label>
                        <Input
                          defaultValue={bot.name}
                          maxLength={64}
                          onBlur={(e) => void onRename(bot, e.target.value)}
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">访问令牌</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busy || !isHome}
                          onClick={() => void onIssueToken(bot.id)}
                        >
                          签发新令牌
                        </Button>
                      </div>
                      {plainToken?.botId === bot.id && (
                        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
                          <p className="mb-1 font-medium text-amber-700 dark:text-amber-300">
                            明文令牌仅显示一次，请立即复制：
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="min-w-0 flex-1 break-all font-mono">
                              {plainToken.plain}
                            </code>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void copyText("Bot Token", plainToken.plain)
                              }
                            >
                              <CopyIcon className="size-3.5" />
                              复制
                            </Button>
                          </div>
                        </div>
                      )}
                      <ul className="space-y-1.5">
                        {(tokensByBot[bot.id] ?? []).length === 0 && (
                          <li className="text-xs text-muted-foreground">
                            暂无令牌。签发后用于 SDK 的{" "}
                            <code className="rounded bg-muted px-1">
                              Authorization: Bot …
                            </code>
                          </li>
                        )}
                        {(tokensByBot[bot.id] ?? []).map((t) => (
                          <li
                            key={t.id}
                            className={cn(
                              "flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs",
                              t.revoked_at && "opacity-50",
                            )}
                          >
                            <span className="font-mono">
                              {t.prefix}…{" "}
                              <span className="text-muted-foreground">
                                {t.name || "unnamed"}
                                {t.revoked_at ? " · 已吊销" : ""}
                              </span>
                            </span>
                            {!t.revoked_at && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 text-destructive"
                                disabled={busy}
                                onClick={() =>
                                  void onRevokeToken(bot.id, t.id)
                                }
                              >
                                吊销
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium">角色权限</p>
                      <p className="text-xs text-muted-foreground">
                        勾选角色即可赋予与人类成员相同的 RBAC 权限位。
                      </p>
                      {roles.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          暂无可用角色
                        </p>
                      ) : (
                        <ul className="grid gap-1.5 sm:grid-cols-2">
                          {roles.map((role) => {
                            const on = bot.role_ids?.includes(role.id)
                            return (
                              <li key={role.id}>
                                <label className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs hover:bg-muted/40">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(on)}
                                    disabled={busy}
                                    onChange={(e) =>
                                      void onToggleRole(
                                        bot,
                                        role.id,
                                        e.target.checked,
                                      )
                                    }
                                  />
                                  <span
                                    className="size-2 rounded-full"
                                    style={{
                                      backgroundColor: role.color || "#94a3b8",
                                    }}
                                  />
                                  {role.name}
                                </label>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
