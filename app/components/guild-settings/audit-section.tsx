// 服务器设置 · 操作日志（可撤销管理审计）
// 醒目时间线 + 每卡撤销；对齐 auditapi / auditundo。

import { useCallback, useEffect, useState } from "react"
import {
  ChevronDownIcon,
  ChevronUpIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  Undo2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Input } from "~/components/ui/input"
import { ApiError } from "~/lib/api/http"
import {
  listGuildAuditLogs,
  undoGuildAuditLog,
  type AuditLogEntry,
  type AuditUndoStatus,
} from "~/lib/api/audit"
import type { GuildAdminSectionId } from "~/stores/ui"
import { useUIStore } from "~/stores/ui"

/** 审计 action 前缀 → 服管分栏深链 */
function sectionForAction(action: string): GuildAdminSectionId | null {
  if (action.startsWith("rbac.")) return "roles"
  if (action.startsWith("restriction.")) return "restrictions"
  if (action.startsWith("moderation.ban") || action.startsWith("moderation.unban"))
    return "bans"
  if (action.startsWith("moderation.")) return "members"
  if (action.startsWith("publicinvite.") || action.includes("invite"))
    return "invites"
  if (action.startsWith("sfu_pool.") || action.startsWith("voicepack."))
    return action.startsWith("voicepack.") ? "voice-packs" : "voice-nodes"
  if (action.startsWith("bot.")) return "bots"
  if (action.startsWith("guild.")) return "overview"
  return null
}

const ACTION_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "全部" },
  { value: "rbac.", label: "角色权限" },
  { value: "moderation.", label: "成员治理" },
  { value: "restriction.", label: "限制" },
  { value: "publicinvite.", label: "邀请" },
  { value: "sfu_pool.", label: "语音节点" },
  { value: "bot.", label: "机器人" },
  { value: "guild.", label: "服务器" },
  { value: "audit.undo", label: "撤销记录" },
]

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "全部状态" },
  { value: "available", label: "可撤销" },
  { value: "undone", label: "已撤销" },
  { value: "irreversible", label: "不可逆" },
]

/** 常见 action → 中文摘要（服务端 action_label 优先） */
function actionLabel(entry: AuditLogEntry): string {
  if (entry.action_label && entry.action_label !== entry.action) {
    return entry.action_label
  }
  const map: Record<string, string> = {
    "rbac.role_create": "创建角色",
    "rbac.role_update": "更新角色",
    "rbac.role_delete": "删除角色",
    "rbac.role_reorder": "角色排序",
    "rbac.member_role_assign": "分配角色",
    "rbac.member_role_remove": "移除角色",
    "rbac.channel_create": "创建频道",
    "rbac.channel_update": "修改频道",
    "rbac.channel_delete": "删除频道",
    "rbac.channel_overwrite_update": "更新频道权限覆盖",
    "rbac.channel_overwrite_delete": "删除频道权限覆盖",
    "moderation.kick": "踢出成员",
    "moderation.ban": "封禁成员",
    "moderation.unban": "解封成员",
    "moderation.member_leave": "成员退出",
    "moderation.member_join": "成员加入",
    "moderation.nickname_update": "修改昵称",
    "moderation.invite_create": "创建邀请",
    "restriction.create": "施加限制",
    "restriction.lift": "解除限制",
    "restriction.update": "更新限制",
    "restriction.expire": "限制到期",
    "guild.update": "更新服务器",
    "guild.create": "创建服务器",
    "audit.undo": "撤销操作",
    "publicinvite.invite_revoke": "撤销邀请",
    "sfu_pool.guild_update": "更新节点池",
  }
  return map[entry.action] ?? entry.action
}

function formatTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString()
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const diff = Date.now() - t
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return "刚刚"
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return formatTime(iso)
}

function statusBadge(status?: AuditUndoStatus): {
  label: string
  className: string
} {
  switch (status) {
    case "available":
      return {
        label: "可撤销",
        className:
          "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/30",
      }
    case "undone":
      return {
        label: "已撤销",
        className: "bg-muted text-muted-foreground ring-1 ring-border",
      }
    case "irreversible":
      return {
        label: "不可逆",
        className: "bg-amber-500/10 text-amber-800 dark:text-amber-400 ring-1 ring-amber-500/20",
      }
    case "blocked":
      return {
        label: "暂不可撤",
        className: "bg-orange-500/10 text-orange-800 dark:text-orange-400",
      }
    default:
      return { label: "记录", className: "bg-muted text-muted-foreground" }
  }
}

function mergeEntry(list: AuditLogEntry[], entry: AuditLogEntry): AuditLogEntry[] {
  const idx = list.findIndex((e) => e.id === entry.id)
  if (idx >= 0) {
    const next = list.slice()
    next[idx] = entry
    return next
  }
  return [entry, ...list]
}

export function AuditSection({ guildId }: { guildId: string }) {
  const [items, setItems] = useState<AuditLogEntry[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [actionPrefix, setActionPrefix] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [undoTarget, setUndoTarget] = useState<AuditLogEntry | null>(null)
  const [undoing, setUndoing] = useState(false)

  const load = useCallback(
    async (opts: { reset: boolean; before?: string }) => {
      setLoading(true)
      setError(false)
      try {
        const res = await listGuildAuditLogs(guildId, {
          action: actionPrefix || undefined,
          undo_status: (statusFilter as AuditUndoStatus) || undefined,
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
    [guildId, actionPrefix, statusFilter],
  )

  useEffect(() => {
    void load({ reset: true })
  }, [load])

  const filtered = query.trim()
    ? items.filter((e) => {
        const q = query.trim().toLowerCase()
        return (
          e.action.toLowerCase().includes(q) ||
          actionLabel(e).toLowerCase().includes(q) ||
          (e.actor_username ?? "").toLowerCase().includes(q) ||
          (e.target_summary ?? "").toLowerCase().includes(q) ||
          e.target_id.toLowerCase().includes(q)
        )
      })
    : items

  async function confirmUndo() {
    if (!undoTarget) return
    setUndoing(true)
    try {
      const res = await undoGuildAuditLog(guildId, undoTarget.id)
      setItems((prev) => {
        let next = mergeEntry(prev, res.original)
        next = mergeEntry(next, res.undo)
        return next
      })
      toast.success("已撤销该操作")
      setUndoTarget(null)
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "撤销失败"
      toast.error(msg)
    } finally {
      setUndoing(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">操作日志</h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-primary/20">
              可撤销
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            本服全部管理操作的时间线。可撤销的操作可在卡片上一键撤回。
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

      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value || "all-status"}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
              statusFilter === f.value
                ? "bg-foreground text-background"
                : "bg-black/[0.04] text-foreground/60 hover:bg-black/[0.07] dark:bg-white/[0.06]"
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
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-14 text-center">
          <ScrollTextIcon className="size-9 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">暂无操作记录</p>
          <p className="max-w-xs text-xs text-muted-foreground/80">
            踢人、封禁、改角色、改频道等管理动作会实时出现在这里，并可随时撤销。
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <ol className="relative ml-1.5 flex flex-col border-l border-border/80 pl-5">
          {filtered.map((entry, index) => (
            <AuditCard
              key={entry.id}
              entry={entry}
              index={index}
              onUndo={() => setUndoTarget(entry)}
              onJump={(section) => {
                useUIStore.getState().openGuildAdmin(guildId, section)
              }}
            />
          ))}
        </ol>
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

      <Dialog
        open={!!undoTarget}
        onOpenChange={(open) => {
          if (!open && !undoing) setUndoTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认撤销</DialogTitle>
            <DialogDescription>
              {undoTarget
                ? undoTarget.undo_hint ||
                  `将撤销「${actionLabel(undoTarget)}」。此操作会写入新的操作日志。`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {undoTarget && (
            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              <p className="font-medium">{actionLabel(undoTarget)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {undoTarget.actor_username || "系统"}
                {undoTarget.target_summary
                  ? ` → ${undoTarget.target_summary}`
                  : ""}
                {" · "}
                {formatTime(undoTarget.created_at)}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={undoing}
              onClick={() => setUndoTarget(null)}
            >
              取消
            </Button>
            <Button disabled={undoing} onClick={() => void confirmUndo()}>
              <Undo2Icon className="size-4" />
              {undoing ? "撤销中…" : "确认撤销"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AuditCard({
  entry,
  index,
  onUndo,
  onJump,
}: {
  entry: AuditLogEntry
  index: number
  onUndo: () => void
  onJump: (section: GuildAdminSectionId) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const status = entry.undo_status ?? "none"
  const badge = statusBadge(status)
  const jump = sectionForAction(entry.action)
  const canUndo = entry.reversible === true || status === "available"
  const faded = status === "undone"
  const hasDetail = Boolean(
    entry.detail &&
      typeof entry.detail === "object" &&
      Object.keys(entry.detail as object).length > 0,
  )
  const detailText = hasDetail ? JSON.stringify(entry.detail, null, 2) : ""

  return (
    <li
      className={`relative pb-4 last:pb-0 ${faded ? "opacity-60" : ""}`}
      style={{ animationDelay: `${Math.min(index, 12) * 20}ms` }}
    >
      <span
        className={`absolute top-2 -left-[1.4rem] size-2.5 rounded-full border-2 border-background ${
          canUndo
            ? "bg-emerald-500"
            : status === "undone"
              ? "bg-muted-foreground/40"
              : "bg-primary/60"
        }`}
        aria-hidden
      />
      <div className="flex flex-col gap-1.5 rounded-xl border bg-card/40 px-3.5 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{actionLabel(entry)}</span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
          >
            {badge.label}
          </span>
          <span
            className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums"
            title={formatTime(entry.created_at)}
          >
            {formatRelative(entry.created_at)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="text-foreground/80">
            {entry.actor_username || entry.actor_id || "系统"}
          </span>
          {entry.target_summary || entry.target_id ? (
            <>
              {" → "}
              <span className="text-foreground/80">
                {entry.target_summary || entry.target_id}
              </span>
            </>
          ) : null}
          {entry.target_type ? (
            <span className="text-muted-foreground/70"> · {entry.target_type}</span>
          ) : null}
        </p>
        {entry.action !== actionLabel(entry) && (
          <p className="font-mono text-[10px] text-muted-foreground/60">
            {entry.action}
          </p>
        )}
        {entry.undo_hint && status !== "available" && status !== "none" && (
          <p className="text-[11px] text-muted-foreground/80">{entry.undo_hint}</p>
        )}

        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {canUndo && (
            <Button
              size="sm"
              variant="default"
              className="h-7 gap-1 px-2.5 text-xs"
              onClick={onUndo}
            >
              <Undo2Icon className="size-3.5" />
              撤销
            </Button>
          )}
          {jump && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => onJump(jump)}
            >
              相关设置
            </Button>
          )}
          {hasDetail && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <ChevronUpIcon className="size-3.5" />
              ) : (
                <ChevronDownIcon className="size-3.5" />
              )}
              {expanded ? "收起" : "详情"}
            </Button>
          )}
        </div>

        {expanded && hasDetail ? (
          <pre className="mt-1 max-h-56 overflow-auto rounded-lg bg-muted/50 p-2.5 text-[11px] leading-relaxed">
            {detailText}
          </pre>
        ) : null}
      </div>
    </li>
  )
}
