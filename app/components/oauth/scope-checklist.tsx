// OAuth 授权 scope 勾选 + 一键预设（最小权限 / 推荐 / 全部申请）。

import { useEffect, useMemo, useState } from "react"
import { ShieldAlertIcon } from "lucide-react"

import { describeScopes } from "~/lib/api/oauth"
import {
  defaultSelection,
  selectionFromPreset,
  selectionToScope,
  type ScopePresetId,
} from "~/lib/oauth-scope-presets"
import { cn } from "~/lib/utils"

const RECOMMENDED = new Set(["openid", "profile", "offline_access"])

const PRESETS: {
  id: ScopePresetId
  label: string
  hint: string
}[] = [
  {
    id: "minimum",
    label: "最小权限",
    hint: "身份 + 最窄 gapi，不含平台",
  },
  {
    id: "recommended",
    label: "推荐",
    hint: "全部用户端能力，不含平台",
  },
  {
    id: "all",
    label: "全部申请",
    hint: "含 platform 高风险权限",
  },
]

export type ScopeChecklistProps = {
  requestedScope: string
  onChange: (scope: string) => void
  className?: string
  defaultEnablePlatform?: boolean
}

export function ScopeChecklist({
  requestedScope,
  onChange,
  className,
  defaultEnablePlatform = false,
}: ScopeChecklistProps) {
  const items = useMemo(() => describeScopes(requestedScope), [requestedScope])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [activePreset, setActivePreset] = useState<ScopePresetId | "custom">(
    "recommended",
  )

  useEffect(() => {
    setSelected(defaultSelection(items, defaultEnablePlatform))
    setActivePreset(defaultEnablePlatform ? "all" : "recommended")
  }, [items, defaultEnablePlatform])

  useEffect(() => {
    onChange(selectionToScope(
      items.map((i) => i.id),
      selected,
    ))
  }, [selected, items, onChange])

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">未请求任何权限</p>
  }

  const toggle = (id: string) => {
    setActivePreset("custom")
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const applyPreset = (preset: ScopePresetId) => {
    setActivePreset(preset)
    setSelected(selectionFromPreset(
      items.map((i) => i.id),
      preset,
    ))
  }

  const selectedCount = items.filter((i) => selected[i.id]).length
  const hasPlatformRequest = items.some((i) => i.danger)

  return (
    <div className={cn("space-y-3", className)} data-testid="oauth-scope-checklist">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">将获得的权限</p>
        <p className="text-xs text-muted-foreground">
          已选 {selectedCount}/{items.length}
        </p>
      </div>

      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="权限预设"
        data-testid="oauth-scope-presets"
      >
        {PRESETS.map((p) => {
          if (p.id === "all" && !hasPlatformRequest) return null
          const active = activePreset === p.id
          return (
            <button
              key={p.id}
              type="button"
              title={p.hint}
              data-testid={`oauth-preset-${p.id}`}
              data-active={active ? "true" : "false"}
              onClick={() => applyPreset(p.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                active
                  ? p.id === "minimum"
                    ? "border-emerald-600/40 bg-emerald-600/15 text-emerald-700 dark:text-emerald-400"
                    : p.id === "all"
                      ? "border-destructive/40 bg-destructive/15 text-destructive"
                      : "border-primary/40 bg-primary/15 text-primary"
                  : "border-border/60 bg-background text-muted-foreground hover:bg-muted/50",
              )}
            >
              {p.label}
            </button>
          )
        })}
        {activePreset === "custom" && (
          <span className="rounded-full border border-dashed border-border/60 px-2.5 py-1 text-xs text-muted-foreground">
            自定义
          </span>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {activePreset === "minimum" &&
          "最小权限：仅身份验证与最窄的数据访问，适合只读助手。"}
        {activePreset === "recommended" &&
          "推荐：CLI 完整用户端能力，不含平台管理。"}
        {activePreset === "all" &&
          "全部申请：包含 platform 高风险权限，请确认操作者可信。"}
        {activePreset === "custom" && "已手动调整勾选。"}
      </p>

      <ul className="space-y-2">
        {items.map((s) => {
          const checked = !!selected[s.id]
          const recommended = RECOMMENDED.has(s.id)
          return (
            <li key={s.id}>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  s.danger
                    ? "bg-destructive/10 text-destructive"
                    : checked
                      ? "bg-muted/60 text-foreground"
                      : "bg-muted/30 text-muted-foreground",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-primary"
                  checked={checked}
                  onChange={() => toggle(s.id)}
                  data-testid={`oauth-scope-${s.id}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {s.danger && (
                      <ShieldAlertIcon className="size-3.5 shrink-0" />
                    )}
                    <span className="font-medium">{s.label}</span>
                    {recommended && (
                      <span className="rounded bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        推荐
                      </span>
                    )}
                    {s.danger && (
                      <span className="rounded bg-destructive/20 px-1.5 py-0.5 text-[10px]">
                        高风险
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block font-mono text-[11px] opacity-60">
                    {s.id}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      {selectedCount === 0 && (
        <p className="text-xs text-destructive" data-testid="oauth-scope-empty-error">
          请至少选择一项权限
        </p>
      )}
      {!selected.offline_access &&
        items.some((i) => i.id === "offline_access") && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            未勾选 offline_access 时，CLI 关闭后可能无法自动续期。
          </p>
        )}
    </div>
  )
}
