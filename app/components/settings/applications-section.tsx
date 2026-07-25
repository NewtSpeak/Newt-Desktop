// 设置 · 已授权应用：列出 / 吊销 OAuth agent 会话（CLI / AI）。
// scope 以彩色标签细粒度展示，危险权限（platform.*）高亮。

import { useCallback, useEffect, useState } from "react"
import { ShieldAlertIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { ApiError } from "~/lib/api/http"
import {
  listOAuthGrants,
  revokeAllOAuthGrants,
  revokeOAuthGrant,
  SCOPE_LABELS,
  type OAuthGrant,
} from "~/lib/api/oauth"
import { cn } from "~/lib/utils"
import { GroupLabel, SectionTitle, SettingRow } from "./section"

function formatTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString()
}

function scopeParts(scope: string): { id: string; label: string; danger: boolean }[] {
  return scope
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => ({
      id,
      label: SCOPE_LABELS[id] ?? id,
      danger: id.startsWith("platform."),
    }))
}

function ScopeBadges({ scope }: { scope: string }) {
  const parts = scopeParts(scope)
  if (parts.length === 0) {
    return <span className="text-xs text-muted-foreground">无 scope</span>
  }
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {parts.map((p) => (
        <Badge
          key={p.id}
          variant={p.danger ? "destructive" : "secondary"}
          className={cn(
            "max-w-full text-left text-[11px] font-normal whitespace-normal",
            p.danger && "gap-1",
          )}
          title={p.id}
        >
          {p.danger && <ShieldAlertIcon className="size-3 shrink-0" />}
          <span>{p.label}</span>
          <span className="opacity-60 font-mono text-[10px]">{p.id}</span>
        </Badge>
      ))}
    </div>
  )
}

export function ApplicationsSection() {
  const [grants, setGrants] = useState<OAuthGrant[] | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setError(false)
    try {
      setGrants(await listOAuthGrants())
    } catch {
      setError(true)
      setGrants([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onRevoke = async (sessionId: string) => {
    setBusy(true)
    try {
      await revokeOAuthGrant(sessionId)
      toast.success("已吊销该授权")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "吊销失败")
    } finally {
      setBusy(false)
    }
  }

  const onRevokeAll = async () => {
    if (!confirm("确定吊销全部 CLI / AI 授权？相关工具需重新登录。")) return
    setBusy(true)
    try {
      const n = await revokeAllOAuthGrants()
      toast.success(`已吊销 ${n} 个会话`)
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "吊销失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <SectionTitle>已授权应用</SectionTitle>
      <p className="mb-4 text-sm text-muted-foreground">
        Owl CLI、MCP 与 AI 助手通过 OAuth 获得的访问。吊销后需重新{" "}
        <code className="text-xs">owl login</code>。带{" "}
        <span className="text-destructive">platform.*</span> 的授权可管理平台级资源，请谨慎保留。
      </p>

      <GroupLabel id="apps-list">活跃授权</GroupLabel>
      {grants === null && (
        <p className="text-sm text-muted-foreground">加载中…</p>
      )}
      {error && (
        <p className="text-sm text-destructive">
          无法加载授权列表（服务端可能未升级 OAuth grants API）。
        </p>
      )}
      {grants && grants.length === 0 && !error && (
        <p className="py-3 text-sm text-muted-foreground">暂无 CLI / AI 授权。</p>
      )}
      {grants?.map((g) => {
        const danger = scopeParts(g.scope).some((p) => p.danger)
        const open = expanded[g.session_id]
        return (
          <div
            key={g.session_id}
            className={cn(
              "rounded-xl border border-border/60 px-3 py-3",
              danger && "border-destructive/30 bg-destructive/5",
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {g.client_name || g.client_id}
                  {danger && (
                    <Badge variant="destructive" className="ml-2 align-middle text-[10px]">
                      高权限
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[g.device_name, g.platform, g.ip_address].filter(Boolean).join(" · ") ||
                    "未知设备"}
                  {" · "}
                  授权于 {formatTime(g.session_created_at || g.created_at)}
                  {" · 到期 "}
                  {formatTime(g.expires_at)}
                </p>
                <button
                  type="button"
                  className="mt-1 text-xs text-primary hover:underline"
                  onClick={() =>
                    setExpanded((s) => ({
                      ...s,
                      [g.session_id]: !s[g.session_id],
                    }))
                  }
                >
                  {open ? "收起权限" : "查看权限明细"}
                </button>
                {open && <ScopeBadges scope={g.scope} />}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void onRevoke(g.session_id)}
              >
                <Trash2Icon className="size-3.5" />
                吊销
              </Button>
            </div>
          </div>
        )
      })}

      {grants && grants.length > 0 && (
        <>
          <GroupLabel id="apps-revoke-all">全部吊销</GroupLabel>
          <SettingRow
            label="吊销全部 CLI / AI 授权"
            description="所有 owl login 会话将立即失效"
          >
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void onRevokeAll()}
            >
              全部吊销
            </Button>
          </SettingRow>
        </>
      )}
    </div>
  )
}
