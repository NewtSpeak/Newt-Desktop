// 用户设置 · 我的贴图库（docs 17 §15）：自建包管理、Install 管理、软删恢复倒计时。

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import {
  ImageIcon,
  ImagePlusIcon,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import {
  createStickerPack,
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
import type {
  StickerItem,
  StickerKind,
  StickerPack,
  StickerPackScope,
} from "~/lib/api/types"
import {
  itemDisplayName,
  isStickerVideoAsset,
  STICKER_UPLOAD_ACCEPT,
  stickerAssetUrl,
} from "~/lib/stickers/format"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useGuildsStore } from "~/stores/guilds"
import { useStickersStore } from "~/stores/stickers"
import { useUIStore } from "~/stores/ui"
import { GroupLabel, SectionTitle, SettingRow } from "./section"

gsap.registerPlugin(useGSAP)

function restoreCountdown(deadline?: string): string {
  if (!deadline) return ""
  const ms = new Date(deadline).getTime() - Date.now()
  if (ms <= 0) return "已过期，不可恢复"
  const days = Math.ceil(ms / (24 * 3600 * 1000))
  return `还可恢复 ${days} 天`
}

export function StickersSection() {
  const myPacks = useStickersStore((s) => s.myPacks)
  const library = useStickersStore((s) => s.library)
  const refreshMyPacks = useStickersStore((s) => s.refreshMyPacks)
  const refreshLibrary = useStickersStore((s) => s.refreshLibrary)
  const invalidate = useStickersStore((s) => s.invalidateAvailable)
  const guilds = useGuildsStore((s) => s.guilds)
  const userId = useAuthStore((s) => s.user?.id)
  const selectedGuildId = useUIStore((s) => s.selectedGuildId)

  /** 仅「我是服主」的服务器可创建服独属包 */
  const ownedGuilds = useMemo(
    () =>
      guilds.filter(
        (g) => Boolean(userId) && g.owner_user_id === userId,
      ),
    [guilds, userId],
  )

  const [loading, setLoading] = useState(true)
  const [name, setName] = useState("")
  const [kind, setKind] = useState<StickerKind>("emote")
  const [scope, setScope] = useState<StickerPackScope>("account")
  const [guildId, setGuildId] = useState("")
  const [allowBrowse, setAllowBrowse] = useState(true)
  const [creating, setCreating] = useState(false)
  /** 展开管理条目的包 id */
  const [expandedPackId, setExpandedPackId] = useState<string | null>(null)
  const [packItems, setPackItems] = useState<StickerItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [renameSaving, setRenameSaving] = useState(false)
  const [uploadingPackId, setUploadingPackId] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState("")
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(
    null,
  )
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadPackRef = useRef<StickerPack | null>(null)
  const skipRenameBlurRef = useRef(false)

  // 默认选中：当前服（若你是服主）或你拥有的第一服
  useEffect(() => {
    if (
      selectedGuildId &&
      selectedGuildId !== "@me" &&
      ownedGuilds.some((g) => g.id === selectedGuildId)
    ) {
      setGuildId(selectedGuildId)
      return
    }
    if (guildId && ownedGuilds.some((g) => g.id === guildId)) return
    setGuildId(ownedGuilds[0]?.id ?? "")
  }, [selectedGuildId, ownedGuilds, guildId])

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

  const onCreate = async () => {
    const n = name.trim()
    if (!n) {
      toast.error("请输入包名称")
      return
    }
    if (scope === "guild") {
      if (!guildId || !ownedGuilds.some((g) => g.id === guildId)) {
        toast.error("请选择你拥有的服务器")
        return
      }
    }
    if (scope === "guild" && !allowBrowse) {
      const ok = window.confirm(
        "关掉「允许别人收藏」后，别人基本用不了这个包，确定继续？",
      )
      if (!ok) return
    }
    setCreating(true)
    try {
      await createStickerPack({
        name: n,
        kind,
        scope,
        guild_id: scope === "guild" ? guildId : undefined,
        allow_browse_full: allowBrowse,
      })
      setName("")
      toast.success(
        scope === "guild" ? "好了，这个包归你的服务器用" : "好了，这个包归你自己用",
      )
      invalidate()
      await reload()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "创建失败")
    } finally {
      setCreating(false)
    }
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

  // 同步栈内打开文件选择器；禁止先 prompt 再 click（会丢 user activation）
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
          toast.error(errors[0] ?? `全部失败（${fail} 张）`)
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
    <div>
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
      <SectionTitle>我的贴图库</SectionTitle>
      <p className="mb-4 text-sm text-muted-foreground text-pretty">
        管理自建小表情 / 贴图包，以及 Install 的引用包。发送时仅可用库内集合。
      </p>

      <GroupLabel id="stickers-create">创建        <span className="inline-flex items-center gap-1.5">
          <PlusIcon className="size-3" />
          创建包
        </span>
      </GroupLabel>
      <div className="flex flex-col gap-3 rounded-2xl bg-muted/40 p-4">
        <SettingRow
          label="名称"
          description="展示名，创建后可改"
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：日常小表情"
            className="w-48 border-0 bg-background/80 shadow-none focus-visible:ring-2 focus-visible:ring-ring/30"
            maxLength={100}
          />
        </SettingRow>
        <SettingRow label="类型" description="创建后不可更改">
          <Select
            value={kind}
            onValueChange={(v) => setKind(v as StickerKind)}
          >
            <SelectTrigger className="w-40 border-0 bg-background/80 shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="emote">小表情（可混排）</SelectItem>
              <SelectItem value="sticker">贴图（单独发送）</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          label="给谁用"
          description="为自己创建可跨服；为服务器创建仅本服，且须你是服主"
        >
          <Select
            value={scope}
            onValueChange={(v) => setScope(v as StickerPackScope)}
          >
            <SelectTrigger className="w-48 border-0 bg-background/80 shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="account">为自己创建（跨服）</SelectItem>
              <SelectItem value="guild">为服务器创建（仅本服）</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        {scope === "guild" && (
          <SettingRow
            label="挂在哪个服务器"
            description={
              ownedGuilds.length === 0
                ? "你还没有自己当服主的服务器"
                : "只列出你拥有的服务器"
            }
          >
            <Select
              value={guildId}
              onValueChange={(v) => setGuildId(v ?? "")}
              disabled={ownedGuilds.length === 0}
            >
              <SelectTrigger className="w-52 border-0 bg-background/80 shadow-none">
                <SelectValue
                  placeholder={
                    ownedGuilds.length === 0
                      ? "暂无可选服务器"
                      : "选你拥有的服务器"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {ownedGuilds.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        )}
        <SettingRow
          label="允许别人收藏"
          description="关掉后别人基本装不进贴图库"
        >
          <button
            type="button"
            role="switch"
            aria-checked={allowBrowse}
            onClick={() => setAllowBrowse((v) => !v)}
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              "active:scale-[0.96] cursor-pointer",
              allowBrowse ? "bg-primary" : "bg-muted-foreground/20",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow-sm",
                "transition-transform duration-150",
                allowBrowse && "translate-x-5",
              )}
            />
          </button>
        </SettingRow>
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={creating}
            onClick={() => void onCreate()}
            className="active:scale-[0.96] transition-transform"
          >
            {creating ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <ImagePlusIcon className="size-4" />
            )}
            创建
          </Button>
        </div>
      </div>

      <GroupLabel id="stickers-owned">
        <span className="inline-flex items-center gap-1.5">
          <PackageIcon className="size-3" />
          我创建的包
          <button
            type="button"
            onClick={() => void reload()}
            className="ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.96]"
            aria-label="刷新"
          >
            <RefreshCwIcon className="size-3" />
          </button>
        </span>
      </GroupLabel>

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          加载中…
        </div>
      )}

      <div ref={listRef} className="flex flex-col gap-1.5">
        {!loading && myPacks.length === 0 && (
          <p className="rounded-2xl bg-muted/30 py-10 text-center text-sm text-muted-foreground">
            还没有自建包，上方创建一个吧
          </p>
        )}
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
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  {pack.status === "active" && (
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
                      {pack.cover_custom && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void onClearCover(pack)}
                          className="active:scale-[0.96]"
                          title="清除自定义封面"
                        >
                          清封面
                        </Button>
                      )}
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
                  )}
                  {pack.status === "soft_deleted" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void onRestore(pack)}
                      className="border-0 active:scale-[0.96] shadow-none"
                    >
                      <RotateCcwIcon className="size-3.5" />
                      恢复
                    </Button>
                  )}
                </div>
              </div>

              {/* 条目列表：命名 / 删除 */}
              {expanded && pack.status === "active" && (
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
                              onBlur={() => void commitRenameItem(pack, item)}
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
              )}
            </div>
          )
        })}
      </div>

      <GroupLabel id="stickers-library">已安装的包（引用）</GroupLabel>
      <div className="flex flex-col gap-1.5">
        {library.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">
            点击消息中的表情可预览并 Install 他人包
          </p>
        )}
        {library.map((entry) => (
          <div
            key={entry.pack_id}
            className="flex items-center gap-3 rounded-2xl bg-muted/35 px-3 py-3 transition-colors duration-150 hover:bg-muted/55"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {entry.pack?.name ?? entry.pack_id}
              </p>
              <p className="text-xs text-muted-foreground">
                {entry.status === "hidden" ? "已隐藏（源包软删）" : "引用中"} ·{" "}
                {entry.pack?.kind === "sticker" ? "贴图" : "小表情"}
              </p>
            </div>
            {entry.status === "active" && (
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
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
