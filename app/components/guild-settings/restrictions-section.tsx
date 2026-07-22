// 服务器设置 · 限制（docs 18 §5.6 / 08）
// 生效中限制列表 + 解除；创建入口也可从成员菜单，本页提供表单快捷创建。

import { useCallback, useEffect, useMemo, useState } from "react"
import { BanIcon, PencilIcon, PlusIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { Switch } from "~/components/ui/switch"
import { ApiError } from "~/lib/api/http"
import {
  createRestriction,
  liftRestriction,
  listRestrictions,
  patchRestriction,
  type DenyFlags,
  type Restriction,
  type RestrictionScope,
} from "~/lib/api/restrictions"
import type { Channel, GuildMember } from "~/lib/api/types"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import { useMembersStore } from "~/stores/members"

// Zustand selector 必须返回稳定引用（避免 ?? [] 每次新建导致无限重渲染）
const EMPTY_MEMBERS: GuildMember[] = []
const EMPTY_CHANNELS: Channel[] = []

const SCOPE_LABEL: Record<string, string> = {
  TEXT_CHANNEL: "文字频道",
  VOICE_CHANNEL: "语音频道",
  GUILD_ALL_TEXT: "全服文字",
  GUILD_ALL_VOICE: "全服语音",
}

const DURATION_OPTIONS: { label: string; ms: number | null }[] = [
  { label: "60 分钟", ms: 60 * 60 * 1000 },
  { label: "24 小时", ms: 24 * 60 * 60 * 1000 },
  { label: "7 天", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "永久", ms: null },
]

function denySummary(deny: DenyFlags): string {
  const parts: string[] = []
  if (deny.view_text) parts.push("禁看")
  if (deny.send_text) parts.push("禁发")
  if (deny.listen_voice) parts.push("禁听")
  if (deny.speak_voice) parts.push("禁说")
  return parts.join(" / ") || "—"
}

function memberLabel(
  userId: string,
  members: { user_id: string; username: string; display_name?: string; nickname?: string }[],
): string {
  const m = members.find((x) => x.user_id === userId)
  if (!m) return userId.slice(0, 8) + "…"
  return m.nickname?.trim() || m.display_name?.trim() || m.username
}

function formatExpiry(iso: string | null | undefined): string {
  if (!iso) return "永久"
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString()
}

export function RestrictionsSection({ guildId }: { guildId: string }) {
  const members = useMembersStore((s) => s.byGuild[guildId] ?? EMPTY_MEMBERS)
  const channels = useChannelsStore((s) => s.byGuild[guildId] ?? EMPTY_CHANNELS)
  const selfId = useAuthStore((s) => s.user?.id)

  const [items, setItems] = useState<Restriction[] | null>(null)
  const [error, setError] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  /** 正在编辑的限制 id */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editReason, setEditReason] = useState("")
  const [editDurationMs, setEditDurationMs] = useState<number | null>(
    60 * 60 * 1000,
  )
  const [editBusy, setEditBusy] = useState(false)

  // 创建表单
  const [targetUserId, setTargetUserId] = useState("")
  const [scope, setScope] = useState<RestrictionScope>("GUILD_ALL_TEXT")
  const [channelId, setChannelId] = useState("")
  const [deny, setDeny] = useState<DenyFlags>({ send_text: true })
  const [reason, setReason] = useState("")
  const [durationMs, setDurationMs] = useState<number | null>(60 * 60 * 1000)
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(() => {
    setError(false)
    listRestrictions(guildId, { active: true })
      .then(setItems)
      .catch(() => {
        setError(true)
        setItems(null)
      })
  }, [guildId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // scope 变化时重置 deny 合法维度
  useEffect(() => {
    if (scope === "TEXT_CHANNEL" || scope === "GUILD_ALL_TEXT") {
      setDeny({ send_text: true })
      if (scope === "GUILD_ALL_TEXT") setChannelId("")
    } else {
      setDeny({ speak_voice: true })
      if (scope === "GUILD_ALL_VOICE") setChannelId("")
    }
  }, [scope])

  const channelOptions = useMemo(() => {
    if (scope === "TEXT_CHANNEL") {
      return channels.filter((c) => c.type === "TEXT")
    }
    if (scope === "VOICE_CHANNEL") {
      return channels.filter((c) => c.type === "VOICE")
    }
    return []
  }, [channels, scope])

  const candidates = members.filter(
    (m) => m.user_id !== selfId && !m.is_owner,
  )

  const onLift = async (id: string) => {
    try {
      await liftRestriction(guildId, id)
      toast.success("已解除限制")
      refresh()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "解除失败")
    }
  }

  const openEdit = (r: Restriction) => {
    setEditingId(r.id)
    setEditReason(r.reason ?? "")
    if (!r.expires_at) {
      setEditDurationMs(null)
    } else {
      const remain = Date.parse(r.expires_at) - Date.now()
      // 就近匹配预设，否则默认 60 分钟从现在起算
      const nearest =
        DURATION_OPTIONS.find(
          (o) => o.ms !== null && Math.abs((o.ms ?? 0) - remain) < 60_000,
        )?.ms ?? 60 * 60 * 1000
      setEditDurationMs(nearest)
    }
  }

  const onSaveEdit = async () => {
    if (!editingId) return
    setEditBusy(true)
    try {
      const expires_at =
        editDurationMs == null
          ? null
          : new Date(Date.now() + editDurationMs).toISOString()
      await patchRestriction(guildId, editingId, {
        reason: editReason.trim() || undefined,
        expires_at,
      })
      toast.success("限制已更新")
      setEditingId(null)
      refresh()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "更新失败")
    } finally {
      setEditBusy(false)
    }
  }

  const onCreate = async () => {
    if (!targetUserId) {
      toast.error("请选择目标成员")
      return
    }
    const needsChannel =
      scope === "TEXT_CHANNEL" || scope === "VOICE_CHANNEL"
    if (needsChannel && !channelId) {
      toast.error("请选择频道")
      return
    }
    const hasDeny =
      deny.view_text ||
      deny.send_text ||
      deny.listen_voice ||
      deny.speak_voice
    if (!hasDeny) {
      toast.error("至少勾选一个限制维度")
      return
    }
    setCreating(true)
    try {
      const expires_at =
        durationMs == null
          ? null
          : new Date(Date.now() + durationMs).toISOString()
      await createRestriction(guildId, {
        target_user_id: targetUserId,
        scope,
        channel_id: needsChannel ? channelId : null,
        deny,
        kind: "SANCTION",
        reason: reason.trim() || undefined,
        expires_at,
      })
      toast.success("已施加限制")
      setShowCreate(false)
      setReason("")
      setTargetUserId("")
      refresh()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "创建失败")
    } finally {
      setCreating(false)
    }
  }

  const isTextScope =
    scope === "TEXT_CHANNEL" || scope === "GUILD_ALL_TEXT"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">限制</h2>
          <p className="text-xs text-muted-foreground">
            生效中的禁言 / 禁看 / 禁听等限制（MODERATE_MEMBERS）
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={refresh}>
            <RefreshCwIcon className="size-4" />
            刷新
          </Button>
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <PlusIcon className="size-4" />
            {showCreate ? "收起" : "新建限制"}
          </Button>
        </div>
      </div>

      {showCreate && (
        <div className="flex flex-col gap-3 rounded-xl border p-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">目标成员</span>
            <Select
              value={targetUserId}
              onValueChange={(v) => setTargetUserId(v ?? "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择成员" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.nickname?.trim() ||
                      m.display_name?.trim() ||
                      m.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">作用域</span>
            <Select
              value={scope}
              onValueChange={(v) =>
                setScope((v as RestrictionScope) || "GUILD_ALL_TEXT")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  [
                    "GUILD_ALL_TEXT",
                    "GUILD_ALL_VOICE",
                    "TEXT_CHANNEL",
                    "VOICE_CHANNEL",
                  ] as const
                ).map((s) => (
                  <SelectItem key={s} value={s}>
                    {SCOPE_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {(scope === "TEXT_CHANNEL" || scope === "VOICE_CHANNEL") && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">频道</span>
              <Select
                value={channelId}
                onValueChange={(v) => setChannelId(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择频道" />
                </SelectTrigger>
                <SelectContent>
                  {channelOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">限制维度</span>
            {isTextScope ? (
              <>
                <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  禁止查看频道
                  <Switch
                    checked={!!deny.view_text}
                    onCheckedChange={(c) =>
                      setDeny((d) => ({ ...d, view_text: c }))
                    }
                  />
                </label>
                <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  禁止发送消息
                  <Switch
                    checked={!!deny.send_text}
                    onCheckedChange={(c) =>
                      setDeny((d) => ({ ...d, send_text: c }))
                    }
                  />
                </label>
              </>
            ) : (
              <>
                <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  禁止连接 / 收听
                  <Switch
                    checked={!!deny.listen_voice}
                    onCheckedChange={(c) =>
                      setDeny((d) => ({ ...d, listen_voice: c }))
                    }
                  />
                </label>
                <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  禁止说话
                  <Switch
                    checked={!!deny.speak_voice}
                    onCheckedChange={(c) =>
                      setDeny((d) => ({ ...d, speak_voice: c }))
                    }
                  />
                </label>
              </>
            )}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">时长</span>
            <Select
              value={durationMs === null ? "perm" : String(durationMs)}
              onValueChange={(v) => {
                if (v === "perm") setDurationMs(null)
                else setDurationMs(Number(v))
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((o) => (
                  <SelectItem
                    key={o.label}
                    value={o.ms === null ? "perm" : String(o.ms)}
                  >
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">原因</span>
            <Input
              value={reason}
              maxLength={512}
              placeholder="可选；部分服务器强制填写"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>

          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={creating}
              onClick={() => void onCreate()}
            >
              {creating ? "提交中…" : "施加限制"}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">
          加载失败
          <button type="button" className="ml-2 underline" onClick={refresh}>
            重试
          </button>
        </p>
      )}

      {items && items.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border px-4 py-12 text-center">
          <BanIcon className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">当前没有生效中的限制</p>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="flex flex-col divide-y rounded-xl border">
          {items.map((r) => (
            <div key={r.id} className="flex flex-col">
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {memberLabel(r.target_user_id, members)}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {SCOPE_LABEL[r.scope] ?? r.scope}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {denySummary(r.deny)}
                    {" · 到期 "}
                    {formatExpiry(r.expires_at)}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      editingId === r.id
                        ? setEditingId(null)
                        : openEdit(r)
                    }
                  >
                    <PencilIcon className="size-3.5" />
                    {editingId === r.id ? "收起" : "改期"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void onLift(r.id)}
                  >
                    解除
                  </Button>
                </div>
              </div>
              {editingId === r.id && (
                <div className="flex flex-col gap-2 border-t bg-muted/20 px-3 py-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">
                      剩余时长（从现在起算）
                    </span>
                    <Select
                      value={
                        editDurationMs === null
                          ? "perm"
                          : String(editDurationMs)
                      }
                      onValueChange={(v) => {
                        if (v === "perm") setEditDurationMs(null)
                        else setEditDurationMs(Number(v))
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DURATION_OPTIONS.map((o) => (
                          <SelectItem
                            key={o.label}
                            value={o.ms === null ? "perm" : String(o.ms)}
                          >
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">原因</span>
                    <Input
                      value={editReason}
                      maxLength={512}
                      onChange={(e) => setEditReason(e.target.value)}
                    />
                  </label>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={editBusy}
                      onClick={() => void onSaveEdit()}
                    >
                      {editBusy ? "保存中…" : "保存"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
