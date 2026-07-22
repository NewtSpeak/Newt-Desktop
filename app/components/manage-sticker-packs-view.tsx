// 管理我的贴图包：自建包 CRUD（条目/封面/软删恢复）+ 已 Install 引用卸装。
// 对齐设置页「我的贴图库」管理能力（docs 17 §15），作为贴图库侧独立页面。

import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import {
  ArrowLeftIcon,
  ImageIcon,
  Loader2Icon,
  PackageIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import {
  deleteStickerItem,
  deleteStickerPackCover,
  getStickerPack,
  patchStickerItem,
  softDeleteStickerPack,
  restoreStickerPack,
  uninstallStickerPack,
  uploadStickerItem,
  uploadStickerPackCover,
} from "~/lib/api/stickers"
import { ApiError, resolveApiUrl } from "~/lib/api/http"
import type { StickerItem, StickerPack } from "~/lib/api/types"
import {
  itemDisplayName,
  isStickerVideoAsset,
  STICKER_UPLOAD_ACCEPT,
  stickerAssetUrl,
} from "~/lib/stickers/format"
import {
  STICKERS_CREATE_PATH,
  STICKERS_PATH,
} from "~/lib/stickers-route"
import { cn } from "~/lib/utils"
import { useGuildsStore } from "~/stores/guilds"
import { useStickersStore } from "~/stores/stickers"
import { useUIStore } from "~/stores/ui"

gsap.registerPlugin(useGSAP)

function restoreCountdown(deadline?: string): string {
  if (!deadline) return ""
  const ms = new Date(deadline).getTime() - Date.now()
  if (ms <= 0) return "已过期，不可恢复"
  const days = Math.ceil(ms / (24 * 3600 * 1000))
  return `还可恢复 ${days} 天`
}

export function ManageStickerPacksView() {
  const navigate = useNavigate()
  const myPacks = useStickersStore((s) => s.myPacks)
  const library = useStickersStore((s) => s.library)
  const refreshMyPacks = useStickersStore((s) => s.refreshMyPacks)
  const refreshLibrary = useStickersStore((s) => s.refreshLibrary)
  const invalidate = useStickersStore((s) => s.invalidateAvailable)
  const guilds = useGuildsStore((s) => s.guilds)

  const [loading, setLoading] = useState(true)
  const [expandedPackId, setExpandedPackId] = useState<string | null>(null)
  const [packItems, setPackItems] = useState<StickerItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ui = useUIStore.getState()
    if (ui.selectedGuildId && ui.selectedGuildId !== "@me") return
    if (ui.selectedChannelId != null || ui.selectedGuildId === "@me") {
      ui.selectGuild(null)
    }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([refreshMyPacks(), refreshLibrary(true)])
    } finally {
      setLoading(false)
    }
  }, [refreshMyPacks, refreshLibrary])

  useEffect(() => {
    void reload()
  }, [reload])

  useGSAP(
    () => {
      if (!listRef.current) return
      const cards = listRef.current.querySelectorAll("[data-pack-card]")
      if (!cards.length) return
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
      gsap.from(cards, {
        opacity: 0,
        y: 10,
        duration: 0.28,
        stagger: 0.04,
        ease: "power2.out",
        clearProps: "transform,opacity",
      })
    },
    { dependencies: [myPacks.length, library.length, loading], scope: listRef },
  )

  const goLibrary = () => {
    useUIStore.getState().selectGuild(null)
    navigate(STICKERS_PATH)
  }

  const openCreate = () => {
    useUIStore.getState().selectGuild(null)
    navigate(STICKERS_CREATE_PATH)
  }

  const onSoftDelete = async (pack: StickerPack) => {
    if (!window.confirm(`软删除「${pack.name}」？180 天内可恢复。`)) return
    try {
      await softDeleteStickerPack(pack.id)
      toast.success("已软删除")
      invalidate()
      await reload()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败")
    }
  }

  const onRestore = async (pack: StickerPack) => {
    try {
      await restoreStickerPack(pack.id)
      toast.success("已恢复")
      invalidate()
      await reload()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "恢复失败")
    }
  }

  const loadPackItems = async (packId: string) => {
    setItemsLoading(true)
    try {
      const res = await getStickerPack(packId)
      setPackItems(res.pack.items ?? [])
    } catch {
      setPackItems([])
      toast.error("加载条目失败")
    } finally {
      setItemsLoading(false)
    }
  }

  const toggleExpandPack = (pack: StickerPack) => {
    if (expandedPackId === pack.id) {
      setExpandedPackId(null)
      setPackItems([])
      return
    }
    setExpandedPackId(pack.id)
    void loadPackItems(pack.id)
  }

  const onUpload = (pack: StickerPack) => {
    const name = window.prompt("表情名称（显示在选择器下方）", "")
    if (name === null) return
    const input = document.createElement("input")
    input.type = "file"
    input.accept = STICKER_UPLOAD_ACCEPT
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      void (async () => {
        try {
          const trimmed = name.trim()
          await uploadStickerItem(pack.id, file, {
            name:
              trimmed ||
              file.name.replace(/\.[^.]+$/, "") ||
              undefined,
            filename: file.name,
          })
          toast.success("已上传")
          invalidate()
          await reload()
          if (expandedPackId === pack.id) await loadPackItems(pack.id)
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : "上传失败")
        }
      })()
    }
    input.click()
  }

  const onRenameItem = async (pack: StickerPack, item: StickerItem) => {
    const next = window.prompt("修改表情名称", itemDisplayName(item))
    if (next === null) return
    const trimmed = next.trim()
    if (!trimmed) {
      toast.error("名称不能为空")
      return
    }
    try {
      await patchStickerItem(pack.id, item.id, { name: trimmed })
      toast.success("已重命名")
      invalidate()
      if (expandedPackId === pack.id) await loadPackItems(pack.id)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "重命名失败")
    }
  }

  const onDeleteItem = async (pack: StickerPack, item: StickerItem) => {
    if (!window.confirm(`删除表情「${itemDisplayName(item)}」？`)) return
    try {
      await deleteStickerItem(pack.id, item.id)
      toast.success("已删除")
      invalidate()
      await reload()
      if (expandedPackId === pack.id) await loadPackItems(pack.id)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败")
    }
  }

  const onUploadCover = (pack: StickerPack) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = STICKER_UPLOAD_ACCEPT
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      void (async () => {
        try {
          await uploadStickerPackCover(pack.id, file, { filename: file.name })
          toast.success("封面已更新")
          invalidate()
          await reload()
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : "封面上传失败")
        }
      })()
    }
    input.click()
  }

  const onClearCover = async (pack: StickerPack) => {
    try {
      await deleteStickerPackCover(pack.id)
      toast.success("已清除自定义封面，将使用包内首条")
      invalidate()
      await reload()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "清除封面失败")
    }
  }

  const onUninstall = async (packId: string, packName?: string) => {
    if (!window.confirm(`从贴图库移除「${packName ?? packId}」？`)) return
    try {
      await uninstallStickerPack(packId)
      toast.success("已卸装")
      invalidate()
      await reload()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "卸装失败")
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          onClick={goLibrary}
          className={cn(
            "flex size-8 items-center justify-center rounded-md text-muted-foreground",
            "transition-[background-color,color,transform] duration-150",
            "hover:bg-muted hover:text-foreground active:scale-[0.96]",
          )}
          aria-label="返回贴图库"
        >
          <ArrowLeftIcon className="size-4" />
        </button>
        <PackageIcon className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          管理我的贴图包
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void reload()}
          className="h-8 gap-1.5 border-0 shadow-none active:scale-[0.97]"
        >
          <RefreshCwIcon className="size-3.5" />
          刷新
        </Button>
        <Button
          size="sm"
          onClick={openCreate}
          className="h-8 gap-1.5 active:scale-[0.97]"
        >
          <PlusIcon className="size-3.5" />
          创建
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <p className="mb-4 text-[13px] text-muted-foreground text-pretty">
          管理自建小表情 / 贴图包，以及 Install 的引用包。发送时仅可用库内集合。
        </p>

        <h3 className="mb-2 flex items-center gap-1.5 px-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          <PackageIcon className="size-3" />
          我创建的包
        </h3>

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            加载中…
          </div>
        ) : null}

        <div ref={listRef} className="flex flex-col gap-1.5">
          {!loading && myPacks.length === 0 ? (
            <div className="rounded-2xl bg-muted/30 px-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">还没有自建包</p>
              <Button
                size="sm"
                onClick={openCreate}
                className="mt-3 gap-1.5 active:scale-[0.97]"
              >
                <PlusIcon className="size-3.5" />
                创建贴图包
              </Button>
            </div>
          ) : null}

          {myPacks.map((pack) => {
            const soft =
              pack.status === "soft_deleted" ||
              pack.status === "soft_deleted_expired"
            const expanded = expandedPackId === pack.id
            return (
              <div
                key={pack.id}
                data-pack-card
                className={cn(
                  "rounded-2xl bg-muted/35 px-3 py-3",
                  "transition-colors duration-150",
                  soft && "opacity-75",
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background/60">
                    {pack.cover_url ? (
                      <img
                        src={resolveApiUrl(pack.cover_url)}
                        alt=""
                        className="size-12 object-contain"
                        draggable={false}
                      />
                    ) : (
                      <PackageIcon className="size-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{pack.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {pack.kind === "emote" ? "小表情" : "贴图"} ·{" "}
                      {pack.scope === "guild" ? "服独属" : "账号级"}
                      {pack.scope === "guild" && pack.guild_id
                        ? `（${guilds.find((g) => g.id === pack.guild_id)?.name ?? "服"}）`
                        : ""}{" "}
                      · {pack.item_count ?? 0} 张
                      {pack.cover_custom ? " · 自定义封面" : ""}
                      {" · "}
                      {pack.status === "active"
                        ? "可用"
                        : pack.status === "soft_deleted"
                          ? restoreCountdown(pack.restore_deadline)
                          : pack.status}
                      {!pack.allow_browse_full ? " · 不可收藏" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {pack.status === "active" ? (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => toggleExpandPack(pack)}
                          className="border-0 active:scale-[0.96] shadow-none"
                        >
                          {expanded ? "收起" : "管理"}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => onUploadCover(pack)}
                          className="border-0 active:scale-[0.96] shadow-none"
                          title="上传自定义封面"
                        >
                          <ImageIcon className="size-3.5" />
                          封面
                        </Button>
                        {pack.cover_custom ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void onClearCover(pack)}
                            className="active:scale-[0.96]"
                            title="清除自定义封面"
                          >
                            清封面
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => onUpload(pack)}
                          className="border-0 active:scale-[0.96] shadow-none"
                        >
                          <UploadIcon className="size-3.5" />
                          上传
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void onSoftDelete(pack)}
                          className="text-destructive hover:text-destructive active:scale-[0.96]"
                          aria-label="软删除"
                        >
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      </>
                    ) : null}
                    {pack.status === "soft_deleted" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void onRestore(pack)}
                        className="border-0 active:scale-[0.96] shadow-none"
                      >
                        <RotateCcwIcon className="size-3.5" />
                        恢复
                      </Button>
                    ) : null}
                  </div>
                </div>

                {expanded && pack.status === "active" ? (
                  <div className="mt-3 rounded-xl bg-background/50 p-2.5">
                    <p className="mb-2 px-1 text-[11px] font-medium text-muted-foreground">
                      表情条目（点击名称可重命名，显示在选择器下方）
                    </p>
                    {itemsLoading ? (
                      <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                        <Loader2Icon className="size-3.5 animate-spin" />
                        加载中…
                      </div>
                    ) : packItems.length === 0 ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">
                        暂无条目，点「上传」添加
                      </p>
                    ) : (
                      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                        {packItems.map((item) => (
                          <li
                            key={item.id}
                            className="flex flex-col items-center gap-1.5 rounded-xl bg-muted/40 p-2"
                          >
                            {isStickerVideoAsset(item.asset_url) ? (
                              <video
                                src={stickerAssetUrl(item.asset_url)}
                                className="size-14 object-contain"
                                autoPlay
                                loop
                                muted
                                playsInline
                                draggable={false}
                              />
                            ) : (
                              <img
                                src={resolveApiUrl(item.asset_url)}
                                alt={itemDisplayName(item)}
                                className="size-14 object-contain"
                                draggable={false}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => void onRenameItem(pack, item)}
                              className="max-w-full truncate text-center text-xs font-medium text-foreground underline-offset-2 hover:underline active:scale-[0.96]"
                              title="点击重命名"
                            >
                              {itemDisplayName(item)}
                            </button>
                            <button
                              type="button"
                              onClick={() => void onDeleteItem(pack, item)}
                              className="text-[10px] text-destructive/80 hover:text-destructive"
                            >
                              删除
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        <h3 className="mt-6 mb-2 px-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          已安装的包（引用）
        </h3>
        <div className="flex flex-col gap-1.5">
          {library.length === 0 && !loading ? (
            <p className="rounded-2xl bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
              点击消息中的表情可预览并 Install 他人包
            </p>
          ) : null}
          {library.map((entry) => (
            <div
              key={entry.pack_id}
              className="flex items-center gap-3 rounded-2xl bg-muted/35 px-3 py-3 transition-colors duration-150 hover:bg-muted/55"
            >
              <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background/60">
                {entry.pack?.cover_url ? (
                  <img
                    src={resolveApiUrl(entry.pack.cover_url)}
                    alt=""
                    className="size-10 object-contain"
                    draggable={false}
                  />
                ) : (
                  <PackageIcon className="size-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {entry.pack?.name ?? entry.pack_id}
                </p>
                <p className="text-xs text-muted-foreground">
                  {entry.status === "hidden" ? "已隐藏（源包软删）" : "引用中"} ·{" "}
                  {entry.pack?.kind === "sticker" ? "贴图" : "小表情"}
                </p>
              </div>
              {entry.status === "active" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void onUninstall(entry.pack_id, entry.pack?.name)
                  }
                  className="active:scale-[0.96]"
                >
                  卸装
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
