// 服管 · 表情与贴图：本服 ban 列表（docs 17 G.1–G.4 / MANAGE_EXPRESSIONS）

import { useCallback, useEffect, useState } from "react"
import {
  BanIcon,
  Loader2Icon,
  RefreshCwIcon,
  ShieldOffIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import {
  banGuildStickerPack,
  listGuildStickerPackBans,
  unbanGuildStickerPack,
} from "~/lib/api/stickers"
import { ApiError } from "~/lib/api/http"
import type { GuildStickerPackBan } from "~/lib/api/types"
import { useStickersStore } from "~/stores/stickers"

export function ExpressionsSection({ guildId }: { guildId: string }) {
  const [bans, setBans] = useState<GuildStickerPackBan[] | null>(null)
  const [error, setError] = useState(false)
  const [packId, setPackId] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const invalidate = useStickersStore((s) => s.invalidateAvailable)

  const refresh = useCallback(() => {
    setError(false)
    listGuildStickerPackBans(guildId)
      .then(setBans)
      .catch(() => {
        setError(true)
        setBans(null)
      })
  }, [guildId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onBan = async () => {
    const id = packId.trim()
    if (!id) {
      toast.error("请输入要 ban 的 pack_id")
      return
    }
    setBusy(true)
    try {
      await banGuildStickerPack(guildId, id, reason.trim() || undefined)
      toast.success("已 ban 该表情包（本服不可新发/新装）")
      setPackId("")
      setReason("")
      invalidate()
      refresh()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "操作失败")
    } finally {
      setBusy(false)
    }
  }

  const onUnban = async (id: string) => {
    setBusy(true)
    try {
      await unbanGuildStickerPack(guildId, id)
      toast.success("已解 ban")
      invalidate()
      refresh()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "操作失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div>
        <h2 className="text-lg font-semibold text-balance">表情与贴图</h2>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          对本服 ban 指定贴图包：选择器隐藏、不可新发、不可 Install；历史消息仍显示。
          需要 <span className="font-medium">MANAGE_EXPRESSIONS</span> 权限。
        </p>
      </div>

      <div className="rounded-2xl bg-muted/40 p-4">
        <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          添加 ban
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-xs text-muted-foreground">
            Pack ID（雪花）
            <Input
              value={packId}
              onChange={(e) => setPackId(e.target.value)}
              placeholder="从包预览或 API 复制"
              className="mt-1 border-0 bg-background/80 font-mono text-xs shadow-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </label>
          <label className="min-w-0 flex-1 text-xs text-muted-foreground">
            原因（可选）
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="违规内容等"
              className="mt-1 border-0 bg-background/80 shadow-none focus-visible:ring-2 focus-visible:ring-ring/30"
              maxLength={500}
            />
          </label>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void onBan()}
            className="shrink-0 active:scale-[0.96] transition-transform"
          >
            {busy ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <BanIcon className="size-4" />
            )}
            Ban
          </Button>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            本服 ban 列表
          </p>
          <button
            type="button"
            onClick={refresh}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.96]"
            aria-label="刷新"
          >
            <RefreshCwIcon className="size-3.5" />
          </button>
        </div>
        {error && (
          <p className="text-sm text-destructive">加载失败，请检查权限后重试</p>
        )}
        {bans === null && !error && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            加载中…
          </div>
        )}
        {bans && bans.length === 0 && (
          <p className="rounded-2xl bg-muted/30 py-10 text-center text-sm text-muted-foreground">
            暂无 ban 记录
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {bans?.map((ban) => (
            <li
              key={`${ban.guild_id}-${ban.pack_id}`}
              className="flex items-center gap-3 rounded-2xl bg-muted/35 px-3 py-2.5 transition-colors duration-150 hover:bg-muted/55"
            >
              <ShieldOffIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs tabular-nums">
                  {ban.pack_id}
                </p>
                {ban.reason ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {ban.reason}
                  </p>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void onUnban(ban.pack_id)}
                className="border-0 shadow-none active:scale-[0.96]"
              >
                解 ban
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
