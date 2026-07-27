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
import { Input } from "~/components/ui/input"
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
  /** 行内重命名：当前编辑的条目 id */
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [renameSaving, setRenameSaving] = useState(false)
  /** 行内二次确认删除：待确认的条目 id（避免 window.confirm 在 WebView 失效） */
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(
    null,
  )
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null)
  /** 批量上传中：包 id + 进度文案 */
  const [uploadingPackId, setUploadingPackId] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState("")
  const listRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadPackRef = useRef<StickerPack | null>(null)
  /** Escape 取消时跳过随后的 blur 提交 */
  const skipRenameBlurRef = useRef(false)

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

  // 必须在用户点击的同一同步调用栈里打开文件选择器。
  // 之前先 window.prompt 会消耗 user activation，导致 input.click() 被浏览器静默拦截。
  const onUpload = (pack: StickerPack) => {
    if (uploadingPackId) {
      toast.message("正在上传，请稍候…")
      return
    }
    uploadPackRef.current = pack
    const input = fileInputRef.current
    if (!input) return
    input.value = ""
    input.click()
  }

  const onFileChosen = (fileList: FileList | null) => {
    const pack = uploadPackRef.current
    uploadPackRef.current = null
    if (!pack || !fileList?.length) return
    const files = Array.from(fileList)
    void (async () => {
      setUploadingPackId(pack.id)
      setUploadProgress(`0/${files.length}`)
      let ok = 0
      let fail = 0
      const errors: string[] = []
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i]!
          setUploadProgress(`${i + 1}/${files.length}`)
          try {
            const defaultName = file.name.replace(/\.[^.]+$/, "").trim()
            await uploadStickerItem(pack.id, file, {
              name: defaultName || undefined,
              filename: file.name,
            })
            ok++
          } catch (err) {
            fail++
            const msg =
              err instanceof ApiError ? err.message : "上传失败"
            errors.push(`${file.name}: ${msg}`)
          }
        }
        invalidate()
        await reload()
        if (expandedPackId === pack.id) await loadPackItems(pack.id)
        if (fail === 0) {
          toast.success(
            ok === 1
              ? "已上传 1 张（点击名称可改展示名）"
              : `已批量上传 ${ok} 张`,
          )
        } else if (ok === 0) {
          toast.error(
            errors[0] ?? `全部失败（${fail} 张）`,
          )
        } else {
          toast.warning(
            `成功 ${ok} 张，失败 ${fail} 张${errors[0] ? `：${errors[0]}` : ""}`,
          )
        }
      } finally {
        setUploadingPackId(null)
        setUploadProgress("")
      }
    })()
  }

  const startRenameItem = (item: StickerItem) => {
    skipRenameBlurRef.current = false
    setEditingItemId(item.id)
    setEditName(itemDisplayName(item))
  }

  const cancelRenameItem = () => {
    if (renameSaving) return
    skipRenameBlurRef.current = true
    setEditingItemId(null)
    setEditName("")
  }

  const commitRenameItem = async (pack: StickerPack, item: StickerItem) => {
    if (renameSaving) return
    if (skipRenameBlurRef.current) {
      skipRenameBlurRef.current = false
      return
    }
    const trimmed = editName.trim()
    if (!trimmed) {
      toast.error("名称不能为空")
      return
    }
    if (trimmed === itemDisplayName(item)) {
      setEditingItemId(null)
      setEditName("")
      return
    }
    setRenameSaving(true)
    try {
      await patchStickerItem(pack.id, item.id, { name: trimmed })
      toast.success("已重命名")
      invalidate()
      setEditingItemId(null)
      setEditName("")
      if (expandedPackId === pack.id) await loadPackItems(pack.id)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "重命名失败")
    } finally {
      setRenameSaving(false)
    }
  }

  const onDeleteItem = async (pack: StickerPack, item: StickerItem) => {
    // 第一次点：进入确认态；第二次点同一条目才真正删除
    if (confirmDeleteItemId !== item.id) {
      setConfirmDeleteItemId(item.id)
      return
    }
    if (deletingItemId) return
    setDeletingItemId(item.id)
    try {
      await deleteStickerItem(pack.id, item.id)
      toast.success("已删除")
      setConfirmDeleteItemId(null)
      // 本地先摘掉，避免等刷新时还挂着
      setPackItems((prev) => prev.filter((i) => i.id !== item.id))
      invalidate()
      await reload()
      if (expandedPackId === pack.id) await loadPackItems(pack.id)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败")
    } finally {
      setDeletingItemId(null)
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
      <input
        ref={fileInputRef}
        type="file"
        accept={STICKER_UPLOAD_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => onFileChosen(e.target.files)}
      />
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
                          disabled={uploadingPackId === pack.id}
                          className="border-0 active:scale-[0.96] shadow-none"
                          title="可一次选择多张图片/视频批量上传"
                        >
                          {uploadingPackId === pack.id ? (
                            <Loader2Icon className="size-3.5 animate-spin" />
                          ) : (
                            <UploadIcon className="size-3.5" />
                          )}
                          {uploadingPackId === pack.id
                            ? `上传中 ${uploadProgress}`
                            : "上传"}
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
                            {editingItemId === item.id ? (
                              <Input
                                value={editName}
                                disabled={renameSaving}
                                autoFocus
                                maxLength={100}
                                className="h-7 w-full rounded-lg px-2 text-center text-xs"
                                aria-label="表情名称"
                                onChange={(e) => setEditName(e.target.value)}
                                onBlur={() =>
                                  void commitRenameItem(pack, item)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault()
                                    void commitRenameItem(pack, item)
                                  } else if (e.key === "Escape") {
                                    e.preventDefault()
                                    cancelRenameItem()
                                  }
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => startRenameItem(item)}
                                className="max-w-full truncate text-center text-xs font-medium text-foreground underline-offset-2 hover:underline active:scale-[0.96]"
                                title="点击重命名"
                              >
                                {itemDisplayName(item)}
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={deletingItemId === item.id}
                              onClick={(e) => {
                                e.stopPropagation()
                                void onDeleteItem(pack, item)
                              }}
                              className={cn(
                                "text-[10px] transition-colors",
                                confirmDeleteItemId === item.id
                                  ? "font-semibold text-destructive"
                                  : "text-destructive/80 hover:text-destructive",
                                deletingItemId === item.id && "opacity-60",
                              )}
                              title={
                                confirmDeleteItemId === item.id
                                  ? "再点一次确认删除"
                                  : "删除此表情"
                              }
                            >
                              {deletingItemId === item.id
                                ? "删除中…"
                                : confirmDeleteItemId === item.id
                                  ? "再点确认删除"
                                  : "删除"}
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
