// 服务器设置 · 语音节点池（docs 18 §5.8）
// 从平台授权候选中勾选本服生效节点；空池可回落平台默认池。

import { useCallback, useEffect, useState } from "react"
import { RadioIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import { Switch } from "~/components/ui/switch"
import { ApiError } from "~/lib/api/http"
import {
  getGuildNodePool,
  putGuildNodePool,
  type GuildNodePool,
  type PoolNode,
} from "~/lib/api/voice-admin"
import { cn } from "~/lib/utils"

export function VoiceNodesSection({
  guildId,
  dirty,
  setDirty,
}: {
  guildId: string
  dirty: boolean
  setDirty: (next: boolean) => void
}) {
  const [pool, setPool] = useState<GuildNodePool | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [fallback, setFallback] = useState(true)
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState(false)

  const applyPool = useCallback(
    (cfg: GuildNodePool) => {
      setPool(cfg)
      setSelected(new Set(cfg.selected.map((n) => n.id)))
      setFallback(cfg.fallback_to_default)
      setDirty(false)
    },
    [setDirty],
  )

  const refresh = useCallback(() => {
    setError(false)
    getGuildNodePool(guildId)
      .then(applyPool)
      .catch(() => {
        setError(true)
        setPool(null)
      })
  }, [guildId, applyPool])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      // dirty 对比
      const original = new Set(pool?.selected.map((n) => n.id) ?? [])
      const sameSize = next.size === original.size
      const same =
        sameSize && [...next].every((x) => original.has(x))
      setDirty(!same || fallback !== (pool?.fallback_to_default ?? true))
      return next
    })
  }

  const onFallback = (checked: boolean) => {
    setFallback(checked)
    const original = new Set(pool?.selected.map((n) => n.id) ?? [])
    const sameSize = selected.size === original.size
    const same = sameSize && [...selected].every((x) => original.has(x))
    setDirty(!same || checked !== (pool?.fallback_to_default ?? true))
  }

  const save = async () => {
    setSaving(true)
    try {
      const updated = await putGuildNodePool(guildId, {
        node_ids: [...selected],
        fallback_to_default: fallback,
      })
      applyPool(updated)
      toast.success("节点池已保存")
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    if (!pool) return
    setSelected(new Set(pool.selected.map((n) => n.id)))
    setFallback(pool.fallback_to_default)
    setDirty(false)
  }

  const candidates: PoolNode[] = pool?.candidates ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">语音节点</h2>
          <p className="text-xs text-muted-foreground">
            只能勾选平台已授权的候选节点；调度不会超出本池。
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh}>
          <RefreshCwIcon className="size-4" />
          刷新
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive">
          加载失败（可能暂无候选节点授权）
          <button type="button" className="ml-2 underline" onClick={refresh}>
            重试
          </button>
        </p>
      )}

      {pool && (
        <>
          <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
            <div>
              <p className="text-sm">空池时回落平台默认节点</p>
              <p className="text-xs text-muted-foreground">
                未勾选任何节点时，允许使用平台默认池
              </p>
            </div>
            <Switch checked={fallback} onCheckedChange={onFallback} />
          </label>

          {candidates.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border px-4 py-12 text-center">
              <RadioIcon className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                平台尚未为本服授权候选节点
              </p>
              <p className="text-xs text-muted-foreground">
                请联系系统管理员在后台配置节点候选集
              </p>
            </div>
          ) : (
            <div className="flex flex-col divide-y rounded-xl border">
              {candidates.map((node) => {
                const on = selected.has(node.id)
                return (
                  <label
                    key={node.id}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5",
                      on && "bg-accent/30",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {node.display_name || node.id.slice(0, 8)}
                        {node.online ? (
                          <span className="ml-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                            在线
                          </span>
                        ) : (
                          <span className="ml-1.5 text-[10px] text-muted-foreground">
                            离线
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {node.status}
                        {node.labels && Object.keys(node.labels).length > 0
                          ? ` · ${Object.entries(node.labels)
                              .map(([k, v]) => `${k}=${v}`)
                              .join(", ")}`
                          : ""}
                      </p>
                    </div>
                    <Switch
                      checked={on}
                      onCheckedChange={() => toggle(node.id)}
                    />
                  </label>
                )
              })}
            </div>
          )}

          {dirty && (
            <div className="sticky bottom-0 flex items-center justify-between rounded-xl border bg-card px-4 py-3 shadow-lg">
              <span className="text-sm">小心 — 你有未保存的更改！</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" disabled={saving} onClick={reset}>
                  重置
                </Button>
                <Button size="sm" disabled={saving} onClick={() => void save()}>
                  保存修改
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
