// 服务器设置 · 入场语音包库（docs 18 §5.9 / 12）
// 包 CRUD、启停、音频上传；成员「我选哪个包」在 17 个人设置。

import { useCallback, useEffect, useState } from "react"
import {
  MusicIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Switch } from "~/components/ui/switch"
import { ApiError, resolveApiUrl } from "~/lib/api/http"
import {
  createVoicePack,
  deleteVoicePack,
  listVoicePacks,
  patchVoicePack,
  uploadVoicePackAudio,
  type VoicePack,
} from "~/lib/api/voice-admin"
import type { Role } from "~/lib/api/types"
import { cn } from "~/lib/utils"
import { useRolesStore } from "~/stores/roles"

// Zustand selector 必须返回稳定引用（避免 ?? [] 每次新建导致无限重渲染）
const EMPTY_ROLES: Role[] = []

export function VoicePacksSection({ guildId }: { guildId: string }) {
  const roles = useRolesStore((s) => s.byGuild[guildId] ?? EMPTY_ROLES)
  const [packs, setPacks] = useState<VoicePack[] | null>(null)
  const [error, setError] = useState(false)
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)
  /** 展开编辑身份组授权的 pack id */
  const [editingRolesOf, setEditingRolesOf] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setError(false)
    listVoicePacks(guildId)
      .then(setPacks)
      .catch(() => {
        setError(true)
        setPacks(null)
      })
  }, [guildId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onCreate = async () => {
    const name = newName.trim()
    if (!name) {
      toast.error("请输入语音包名称")
      return
    }
    setCreating(true)
    try {
      await createVoicePack(guildId, { name, kind: "STANDARD", enabled: true })
      setNewName("")
      toast.success("已创建语音包，请上传音频")
      refresh()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "创建失败")
    } finally {
      setCreating(false)
    }
  }

  const onToggle = async (pack: VoicePack, enabled: boolean) => {
    try {
      await patchVoicePack(guildId, pack.id, { enabled })
      setPacks((prev) =>
        prev?.map((p) => (p.id === pack.id ? { ...p, enabled } : p)) ?? null,
      )
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "更新失败")
    }
  }

  const onDelete = async (pack: VoicePack) => {
    const ok = window.confirm(`确定删除语音包「${pack.name}」？`)
    if (!ok) return
    try {
      await deleteVoicePack(guildId, pack.id)
      toast.success("已删除")
      refresh()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败")
    }
  }

  const onUpload = (pack: VoicePack) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "audio/ogg,audio/mpeg,.ogg,.mp3"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      if (file.size > 500 * 1024) {
        toast.error("音频不能超过 500KB")
        return
      }
      try {
        const updated = await uploadVoicePackAudio(guildId, pack.id, file)
        setPacks(
          (prev) =>
            prev?.map((p) => (p.id === pack.id ? { ...p, ...updated } : p)) ??
            null,
        )
        toast.success("音频已上传")
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "上传失败")
      }
    }
    input.click()
  }

  const onPreview = (pack: VoicePack) => {
    if (!pack.audio_url) {
      toast.error("尚未上传音频")
      return
    }
    const audio = new Audio(resolveApiUrl(pack.audio_url))
    void audio.play().catch(() => toast.error("播放失败"))
  }

  const onToggleKind = async (pack: VoicePack) => {
    const nextKind = pack.kind === "RARE" ? "STANDARD" : "RARE"
    try {
      const updated = await patchVoicePack(guildId, pack.id, {
        kind: nextKind,
        allowed_role_ids:
          nextKind === "STANDARD" ? [] : pack.allowed_role_ids ?? [],
      })
      setPacks(
        (prev) =>
          prev?.map((p) => (p.id === pack.id ? { ...p, ...updated } : p)) ??
          null,
      )
      if (nextKind === "RARE") setEditingRolesOf(pack.id)
      toast.success(
        nextKind === "RARE" ? "已设为稀有包，请勾选授权身份组" : "已设为标准包",
      )
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "更新失败")
    }
  }

  const onToggleRole = async (pack: VoicePack, roleId: string) => {
    const current = new Set(pack.allowed_role_ids ?? [])
    if (current.has(roleId)) current.delete(roleId)
    else current.add(roleId)
    const next = [...current]
    try {
      const updated = await patchVoicePack(guildId, pack.id, {
        allowed_role_ids: next,
      })
      setPacks(
        (prev) =>
          prev?.map((p) => (p.id === pack.id ? { ...p, ...updated } : p)) ??
          null,
      )
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "更新授权失败")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">入场语音包</h2>
          <p className="text-xs text-muted-foreground">
            管理本服可选用的入场音效库。成员在「服务器个人设置」中选择自己的包。
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh}>
          <RefreshCwIcon className="size-4" />
          刷新
        </Button>
      </div>

      <div className="flex gap-2">
        <Input
          value={newName}
          placeholder="新语音包名称"
          maxLength={100}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onCreate()
          }}
        />
        <Button
          size="sm"
          disabled={creating || !newName.trim()}
          onClick={() => void onCreate()}
        >
          <PlusIcon className="size-4" />
          创建
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive">
          加载失败
          <button type="button" className="ml-2 underline" onClick={refresh}>
            重试
          </button>
        </p>
      )}

      {packs && packs.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border px-4 py-12 text-center">
          <MusicIcon className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">还没有语音包</p>
        </div>
      )}

      {packs && packs.length > 0 && (
        <div className="flex flex-col divide-y rounded-xl border">
          {packs.map((pack) => (
            <div
              key={pack.id}
              className={cn("flex flex-col", !pack.enabled && "opacity-60")}
            >
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {pack.name}
                    <span className="ml-1.5 text-[10px] text-muted-foreground">
                      {pack.kind === "RARE" ? "稀有" : "标准"}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {pack.audio_url
                      ? `${(pack.size_bytes / 1024).toFixed(1)} KB` +
                        (pack.duration_ms
                          ? ` · ${(pack.duration_ms / 1000).toFixed(1)}s`
                          : "")
                      : "未上传音频"}
                    {pack.kind === "RARE" &&
                      ` · 授权 ${(pack.allowed_role_ids ?? []).length} 个身份组`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Switch
                    checked={pack.enabled}
                    onCheckedChange={(c) => void onToggle(pack, c)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void onToggleKind(pack)}
                  >
                    {pack.kind === "RARE" ? "改标准" : "改稀有"}
                  </Button>
                  {pack.kind === "RARE" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEditingRolesOf((id) =>
                          id === pack.id ? null : pack.id,
                        )
                      }
                    >
                      身份组
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    title="上传音频"
                    onClick={() => onUpload(pack)}
                  >
                    <UploadIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="试听"
                    disabled={!pack.audio_url}
                    onClick={() => onPreview(pack)}
                  >
                    试听
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => void onDelete(pack)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </div>
              {editingRolesOf === pack.id && pack.kind === "RARE" && (
                <div className="flex flex-wrap gap-1.5 border-t bg-muted/20 px-3 py-2">
                  {roles
                    .filter((r) => !r.managed)
                    .map((role) => {
                      const on = (pack.allowed_role_ids ?? []).includes(role.id)
                      return (
                        <button
                          key={role.id}
                          type="button"
                          onClick={() => void onToggleRole(pack, role.id)}
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-xs",
                            on
                              ? "border-primary bg-primary/10 text-primary"
                              : "text-muted-foreground hover:bg-accent",
                          )}
                          style={
                            role.color && on
                              ? { borderColor: role.color, color: role.color }
                              : undefined
                          }
                        >
                          {role.is_everyone ? "@everyone" : role.name}
                        </button>
                      )
                    })}
                  {roles.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      暂无角色，请先在「角色」分栏创建
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
