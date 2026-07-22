// 服务器设置 · 邀请管理（docs 18 §5.7 / 02 FR-17）
// 列表活跃邀请：码、创建者、已用/上限、过期、复制链接、撤销。
// 「邀请其他人」快捷生成仍走频道/服务器菜单弹窗，不在本页。

import { useCallback, useEffect, useMemo, useState } from "react"
import { CopyIcon, LinkIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import {
  listGuildInvites,
  revokeGuildInvite,
} from "~/lib/api/guilds"
import { ApiError } from "~/lib/api/http"
import type { GuildInvite, GuildMember } from "~/lib/api/types"
import { copyText } from "~/lib/clipboard"
import { useMembersStore } from "~/stores/members"

// Zustand selector 必须返回稳定引用（避免 ?? [] 每次新建导致无限重渲染）
const EMPTY_MEMBERS: GuildMember[] = []

function formatExpiry(iso: string | null | undefined): string {
  if (!iso) return "永不过期"
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString()
}

function formatUses(invite: GuildInvite): string {
  const max = invite.max_uses ?? 0
  const uses = invite.uses ?? 0
  if (!max) return `${uses} / ∞`
  return `${uses} / ${max}`
}

function creatorLabel(
  userId: string,
  members: { user_id: string; username: string; display_name?: string; nickname?: string }[],
): string {
  const m = members.find((x) => x.user_id === userId)
  if (!m) return userId.slice(0, 8) + "…"
  return m.nickname?.trim() || m.display_name?.trim() || m.username
}

export function InvitesSection({ guildId }: { guildId: string }) {
  const members = useMembersStore((s) => s.byGuild[guildId] ?? EMPTY_MEMBERS)
  const [invites, setInvites] = useState<GuildInvite[] | null>(null)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState("")
  const [revoking, setRevoking] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setError(false)
    listGuildInvites(guildId)
      .then(setInvites)
      .catch(() => {
        setError(true)
        setInvites(null)
      })
  }, [guildId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const filtered = useMemo(() => {
    if (!invites) return []
    const q = query.trim().toLowerCase()
    if (!q) return invites
    return invites.filter(
      (inv) =>
        inv.code.toLowerCase().includes(q) ||
        inv.created_by.toLowerCase().includes(q) ||
        creatorLabel(inv.created_by, members).toLowerCase().includes(q),
    )
  }, [invites, query, members])

  const onRevoke = async (code: string) => {
    if (revoking === code) {
      setRevoking(null)
      try {
        await revokeGuildInvite(guildId, code)
        setInvites((prev) => prev?.filter((i) => i.code !== code) ?? null)
        toast.success("邀请已撤销")
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "撤销失败")
      }
      return
    }
    setRevoking(code)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">邀请</h2>
          <p className="text-xs text-muted-foreground">
            管理本服活跃邀请链接。创建新邀请请使用服务器/频道菜单中的「邀请」。
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh}>
          <RefreshCwIcon className="size-4" />
          刷新
        </Button>
      </div>

      <Input
        value={query}
        placeholder="搜索邀请码或创建者"
        onChange={(e) => setQuery(e.target.value)}
      />

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          加载失败
          <Button size="sm" variant="outline" onClick={refresh}>
            重试
          </Button>
        </div>
      )}

      {invites && invites.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border px-4 py-12 text-center">
          <LinkIcon className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">暂无活跃邀请</p>
          <p className="text-xs text-muted-foreground">
            从服务器菜单或频道菜单创建邀请后，会显示在这里。
          </p>
        </div>
      )}

      {invites && invites.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">邀请码</th>
                <th className="px-3 py-2 font-medium">创建者</th>
                <th className="px-3 py-2 font-medium">使用</th>
                <th className="px-3 py-2 font-medium">过期</th>
                <th className="px-3 py-2 font-medium">创建时间</th>
                <th className="px-3 py-2 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((inv) => (
                <tr key={inv.code} className="hover:bg-muted/20">
                  <td className="px-3 py-2.5">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {inv.code}
                    </code>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {creatorLabel(inv.created_by, members)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{formatUses(inv)}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {formatExpiry(inv.expires_at)}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {inv.created_at
                      ? new Date(inv.created_at).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="复制链接"
                        onClick={() =>
                          void copyText(
                            "邀请链接",
                            inv.share_url || inv.code,
                          )
                        }
                      >
                        <CopyIcon className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant={
                          revoking === inv.code ? "destructive" : "ghost"
                        }
                        className={
                          revoking === inv.code
                            ? undefined
                            : "text-destructive"
                        }
                        onClick={() => void onRevoke(inv.code)}
                        onBlur={() =>
                          setRevoking((c) => (c === inv.code ? null : c))
                        }
                      >
                        <Trash2Icon className="size-3.5" />
                        {revoking === inv.code ? "确认撤销？" : "撤销"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-muted-foreground"
                  >
                    没有匹配的邀请
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
