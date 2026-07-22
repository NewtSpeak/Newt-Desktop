// 服务器设置 · 审计日志（docs 18 §5.11 / 08 FR-35）
// 只读时间线 + action 前缀筛选 + 游标分页。

import { useCallback, useEffect, useState } from "react"
import { RefreshCwIcon, ScrollTextIcon } from "lucide-react"

import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import {
  listGuildAuditLogs,
  type AuditLogEntry,
} from "~/lib/api/audit"
import type { GuildAdminSectionId } from "~/stores/ui"
import { useUIStore } from "~/stores/ui"

/** 审计 action 前缀 → 服管分栏深链 */
function sectionForAction(action: string): GuildAdminSectionId | null {
  if (action.startsWith("rbac.")) return "roles"
  if (action.startsWith("restriction.")) return "restrictions"
  if (action.startsWith("moderation.member_ban") || action.startsWith("moderation.member_unban"))
    return "bans"
  if (action.startsWith("moderation.")) return "members"
  if (action.startsWith("publicinvite.") || action.includes("invite"))
    return "invites"
  if (action.startsWith("sfu_pool.") || action.startsWith("voicepack."))
    return action.startsWith("voicepack.") ? "voice-packs" : "voice-nodes"
  return null
}

const ACTION_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "全部" },
  { value: "rbac.", label: "角色权限" },
  { value: "moderation.", label: "成员治理" },
  { value: "restriction.", label: "限制" },
  { value: "publicinvite.", label: "邀请" },
  { value: "sfu_pool.", label: "语音节点" },
]

/** 常见 action → 中文摘要 */
function actionLabel(action: string): string {
  const map: Record<string, string> = {
    "rbac.role_create": "创建角色",
    "rbac.role_update": "更新角色",
    "rbac.role_delete": "删除角色",
    "rbac.role_reorder": "角色排序",
    "rbac.member_role_assign": "分配角色",
    "rbac.member_role_remove": "移除角色",
    "moderation.member_kick": "踢出成员",
    "moderation.member_ban": "封禁成员",
    "moderation.member_unban": "解封成员",
    "moderation.member_leave": "成员退出",
    "moderation.nickname_update": "修改昵称",
    "moderation.invite_create": "创建邀请",
    "restriction.create": "施加限制",
    "restriction.lift": "解除限制",
    "restriction.update": "更新限制",
    "publicinvite.invite_revoke": "撤销邀请",
    "sfu_pool.guild_update": "更新节点池",
  }
  return map[action] ?? action
}

function formatTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString()
}

export function AuditSection({ guildId }: { guildId: string }) {
  const [items, setItems] = useState<AuditLogEntry[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [actionPrefix, setActionPrefix] = useState("")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const load = useCallback(
    async (opts: { reset: boolean; before?: string }) => {
      setLoading(true)
      setError(false)
      try {
        const res = await listGuildAuditLogs(guildId, {
          action: actionPrefix || undefined,
          before: opts.before,
          limit: 40,
        })
        setItems((prev) =>
          opts.reset ? res.items : [...prev, ...res.items],
        )
        setCursor(res.next_cursor)
        setHasMore(res.has_more)
      } catch {
        setError(true)
        if (opts.reset) setItems([])
      } finally {
        setLoading(false)
      }
    },
    [guildId, actionPrefix],
  )

  useEffect(() => {
    void load({ reset: true })
  }, [load])

  const filtered = query.trim()
    ? items.filter((e) => {
        const q = query.trim().toLowerCase()
        return (
          e.action.toLowerCase().includes(q) ||
          (e.actor_username ?? "").toLowerCase().includes(q) ||
          (e.target_summary ?? "").toLowerCase().includes(q) ||
          e.target_id.toLowerCase().includes(q)
        )
      })
    : items

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">审计日志</h2>
          <p className="text-xs text-muted-foreground">
            本服管理操作流水，只读。按时间倒序。
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => void load({ reset: true })}
        >
          <RefreshCwIcon className="size-4" />
          刷新
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ACTION_FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            type="button"
            onClick={() => setActionPrefix(f.value)}
            className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
              actionPrefix === f.value
                ? "bg-primary text-primary-foreground"
                : "bg-black/[0.05] text-foreground/70 hover:bg-black/[0.08] hover:text-foreground dark:bg-white/[0.08] dark:hover:bg-white/[0.12]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Input
        value={query}
        placeholder="在已加载记录中搜索操作者 / 目标 / 动作"
        onChange={(e) => setQuery(e.target.value)}
      />

      {error && (
        <p className="text-sm text-destructive">
          加载失败
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => void load({ reset: true })}
          >
            重试
          </button>
        </p>
      )}

      {!error && items.length === 0 && !loading && (
        <div className="flex flex-col items-center gap-2 rounded-xl border px-4 py-12 text-center">
          <ScrollTextIcon className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">暂无审计记录</p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="flex flex-col divide-y rounded-xl border">
          {filtered.map((entry) => {
            const jump = sectionForAction(entry.action)
            return (
              <button
                key={entry.id}
                type="button"
                disabled={!jump}
                title={jump ? "跳转到相关管理分栏" : undefined}
                onClick={() => {
                  if (!jump) return
                  useUIStore.getState().openGuildAdmin(guildId, jump)
                }}
                className="flex flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-black/[0.03] disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-white/[0.05]"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">
                    {actionLabel(entry.action)}
                    {jump && (
                      <span className="ml-1.5 text-[10px] font-normal text-primary">
                        查看
                      </span>
                    )}
                  </p>
                  <time className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {formatTime(entry.created_at)}
                  </time>
                </div>
                <p className="text-xs text-muted-foreground">
                  {entry.actor_username || entry.actor_id || "系统"}
                  {entry.target_summary || entry.target_id
                    ? ` → ${entry.target_summary || entry.target_id}`
                    : ""}
                  {entry.target_type ? ` · ${entry.target_type}` : ""}
                </p>
                {entry.action !== actionLabel(entry.action) && (
                  <p className="font-mono text-[10px] text-muted-foreground/70">
                    {entry.action}
                  </p>
                )}
              </button>
            )
          })}
        </div>
      )}

      {hasMore && (
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => void load({ reset: false, before: cursor })}
        >
          {loading ? "加载中…" : "加载更多"}
        </Button>
      )}
    </div>
  )
}
