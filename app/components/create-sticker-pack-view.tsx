// 创建贴图包分步向导：类型 → 作用域 → 命名 → 添加表情并命名。
// 对齐 docs 17 与设置页「创建包」字段。

import { useEffect, useRef, useState, type ReactNode } from "react"
import { useNavigate } from "react-router"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ImageIcon,
  ImagePlusIcon,
  Loader2Icon,
  PackageIcon,
  SmileIcon,
  UploadIcon,
  XIcon,
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
  patchStickerItem,
  uploadStickerItem,
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
import { STICKERS_PATH } from "~/lib/stickers-route"
import { cn } from "~/lib/utils"
import { useGuildsStore } from "~/stores/guilds"
import { useStickersStore } from "~/stores/stickers"
import { useUIStore } from "~/stores/ui"

type Step = 1 | 2 | 3 | 4

const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: "类型" },
  { id: 2, label: "作用域" },
  { id: 3, label: "命名" },
  { id: 4, label: "添加表情" },
]

export function CreateStickerPackView() {
  const navigate = useNavigate()
  const guilds = useGuildsStore((s) => s.guilds)
  const selectedGuildId = useUIStore((s) => s.selectedGuildId)
  const invalidate = useStickersStore((s) => s.invalidateAvailable)
  const refreshMyPacks = useStickersStore((s) => s.refreshMyPacks)
  const cacheItems = useStickersStore((s) => s.cacheItems)

  const [step, setStep] = useState<Step>(1)
  const [kind, setKind] = useState<StickerKind>("emote")
  const [scope, setScope] = useState<StickerPackScope>("account")
  const [guildId, setGuildId] = useState("")
  const [allowBrowse, setAllowBrowse] = useState(true)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [creating, setCreating] = useState(false)
  const [createdPack, setCreatedPack] = useState<StickerPack | null>(null)
  const [items, setItems] = useState<StickerItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [namingId, setNamingId] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const ui = useUIStore.getState()
    if (ui.selectedGuildId && ui.selectedGuildId !== "@me") return
    if (ui.selectedChannelId != null || ui.selectedGuildId === "@me") {
      ui.selectGuild(null)
    }
  }, [])

  useEffect(() => {
    if (
      selectedGuildId &&
      selectedGuildId !== "@me" &&
      guilds.some((g) => g.id === selectedGuildId)
    ) {
      setGuildId(selectedGuildId)
    } else if (!guildId && guilds[0]) {
      setGuildId(guilds[0].id)
    }
  }, [selectedGuildId, guilds, guildId])

  const goLibrary = () => {
    useUIStore.getState().selectGuild(null)
    navigate(STICKERS_PATH)
  }

  const canNext =
    step === 1
      ? true
      : step === 2
        ? scope === "account" || Boolean(guildId)
        : step === 3
          ? name.trim().length > 0
          : true

  const onCreatePack = async () => {
    const n = name.trim()
    if (!n) {
      toast.error("请输入包名称")
      return
    }
    if (scope === "guild" && !guildId) {
      toast.error("服独属包必须选择服务器")
      return
    }
    if (scope === "guild" && !allowBrowse) {
      const ok = window.confirm(
        "关闭完整浏览后，他人无法 Install 或 Copy，基本仅你自己可在本服使用。确定创建？",
      )
      if (!ok) return
    }
    setCreating(true)
    try {
      const pack = await createStickerPack({
        name: n,
        description: description.trim() || undefined,
        kind,
        scope,
        guild_id: scope === "guild" ? guildId : undefined,
        allow_browse_full: allowBrowse,
      })
      setCreatedPack(pack)
      invalidate()
      void refreshMyPacks()
      toast.success(
        scope === "guild" ? "已创建服独属贴图包" : "已创建账号级贴图包",
      )
      setStep(4)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "创建失败")
    } finally {
      setCreating(false)
    }
  }

  const onNext = () => {
    if (step === 3) {
      void onCreatePack()
      return
    }
    if (step < 4) setStep((s) => (s + 1) as Step)
  }

  const onBack = () => {
    if (step === 1) {
      goLibrary()
      return
    }
    // 包已创建后不允许回退改 kind/scope
    if (createdPack && step === 4) {
      goLibrary()
      return
    }
    setStep((s) => (s - 1) as Step)
  }

  const onPickFiles = () => fileRef.current?.click()

  const onFilesSelected = async (fileList: FileList | null) => {
    if (!createdPack || !fileList?.length) return
    setUploading(true)
    try {
      const uploaded: StickerItem[] = []
      for (const file of Array.from(fileList)) {
        const okType =
          file.type.startsWith("image/") ||
          file.type.startsWith("video/") ||
          isStickerVideoAsset(file.name)
        if (!okType) {
          toast.error(`跳过不支持的格式：${file.name}`)
          continue
        }
        const base = file.name.replace(/\.[^.]+$/, "").slice(0, 64)
        const item = await uploadStickerItem(createdPack.id, file, {
          name: base || undefined,
          filename: file.name,
        })
        uploaded.push(item)
      }
      if (uploaded.length) {
        setItems((prev) => [...prev, ...uploaded])
        cacheItems(uploaded)
        invalidate()
        toast.success(`已添加 ${uploaded.length} 张`)
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "上传失败")
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const startRename = (item: StickerItem) => {
    setNamingId(item.id)
    setNameDraft(item.name?.trim() || "")
  }

  const commitRename = async (item: StickerItem) => {
    if (!createdPack || namingId !== item.id) return
    const trimmed = nameDraft.trim()
    setNamingId(null)
    if (trimmed === (item.name?.trim() || "")) return
    try {
      const updated = await patchStickerItem(createdPack.id, item.id, {
        name: trimmed || undefined,
      })
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
      cacheItems([updated])
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "重命名失败")
    }
  }

  const onDeleteItem = async (item: StickerItem) => {
    if (!createdPack) return
    if (!window.confirm(`删除「${itemDisplayName(item)}」？`)) return
    try {
      await deleteStickerItem(createdPack.id, item.id)
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      invalidate()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败")
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          onClick={onBack}
          className={cn(
            "flex size-8 items-center justify-center rounded-md text-muted-foreground",
            "transition-[background-color,color,transform] duration-150",
            "hover:bg-muted hover:text-foreground active:scale-[0.96]",
          )}
          aria-label={step === 1 || (step === 4 && createdPack) ? "返回贴图库" : "上一步"}
        >
          <ArrowLeftIcon className="size-4" />
        </button>
        <PackageIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">创建贴图包</span>
        <div className="ml-3 hidden items-center gap-1 sm:flex">
          {STEPS.map((s, idx) => {
            const active = step === s.id
            const done = step > s.id || (s.id === 3 && Boolean(createdPack))
            return (
              <div key={s.id} className="flex items-center gap-1">
                {idx > 0 ? (
                  <span className="mx-0.5 text-muted-foreground/40">·</span>
                ) : null}
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px] font-medium tabular-nums",
                    active
                      ? "bg-primary/15 text-primary"
                      : done
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {s.id}. {s.label}
                </span>
              </div>
            )
          })}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto w-full max-w-lg">
          {step === 1 ? (
            <section className="flex flex-col gap-4">
              <div>
                <h2 className="text-base font-semibold">选择贴图包类型</h2>
                <p className="mt-1 text-[13px] text-muted-foreground text-pretty">
                  创建后类型不可更改，且包内禁止混装小表情与贴图。
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <TypeCard
                  active={kind === "emote"}
                  icon={<SmileIcon className="size-6" />}
                  title="小表情"
                  desc="可在输入框连发、与文字混排，也可作反应。"
                  onClick={() => setKind("emote")}
                />
                <TypeCard
                  active={kind === "sticker"}
                  icon={<ImageIcon className="size-6" />}
                  title="贴图"
                  desc="点选单独发送，禁止与正文混排；一条消息一张。"
                  onClick={() => setKind("sticker")}
                />
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="flex flex-col gap-4">
              <div>
                <h2 className="text-base font-semibold">选择作用域与浏览策略</h2>
                <p className="mt-1 text-[13px] text-muted-foreground text-pretty">
                  账号级可跨服使用；服独属仅本服可用，且他人不可单条复制。
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <TypeCard
                  active={scope === "account"}
                  icon={<PackageIcon className="size-6" />}
                  title="账号级"
                  desc="跨服可用；他人可 Install 或单条 Copy（视浏览开关）。"
                  onClick={() => setScope("account")}
                />
                <TypeCard
                  active={scope === "guild"}
                  icon={<ImagePlusIcon className="size-6" />}
                  title="服独属"
                  desc="仅本服上下文可用；禁止他人 Copy，仅能本服 Install。"
                  onClick={() => setScope("guild")}
                />
              </div>
              {scope === "guild" ? (
                <div className="rounded-2xl bg-muted/40 p-3">
                  <p className="mb-2 text-[12px] font-medium text-muted-foreground">
                    所属服务器
                  </p>
                  <Select
                    value={guildId}
                    onValueChange={(v) => setGuildId(v ?? "")}
                  >
                    <SelectTrigger className="w-full border-0 bg-background/80 shadow-none">
                      <SelectValue placeholder="选择服务器" />
                    </SelectTrigger>
                    <SelectContent>
                      {guilds.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {guilds.length === 0 ? (
                    <p className="mt-2 text-[12px] text-destructive">
                      你还没有加入任何服务器，无法创建服独属包。
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/40 px-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">允许完整浏览（可收藏）</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground text-pretty">
                    关闭后禁止他人 Install；账号级仍可单条 Copy，服独属关闭则基本仅作者可用。
                  </p>
                </div>
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
              </div>
            </section>
          ) : null}

          {step === 3 ? (
            <section className="flex flex-col gap-4">
              <div>
                <h2 className="text-base font-semibold">为贴图包命名</h2>
                <p className="mt-1 text-[13px] text-muted-foreground text-pretty">
                  名称可在创建后修改。类型：
                  {kind === "emote" ? "小表情" : "贴图"} · 作用域：
                  {scope === "guild" ? "服独属" : "账号级"}
                </p>
              </div>
              <div className="flex flex-col gap-3 rounded-2xl bg-muted/40 p-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-muted-foreground">
                    包名称
                  </span>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：日常小表情"
                    maxLength={100}
                    className="h-10 border-0 bg-background/80 shadow-none focus-visible:ring-2 focus-visible:ring-ring/30"
                    autoFocus
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-muted-foreground">
                    描述（可选）
                  </span>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="简单介绍这个包"
                    maxLength={200}
                    className="h-10 border-0 bg-background/80 shadow-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  />
                </label>
              </div>
            </section>
          ) : null}

          {step === 4 && createdPack ? (
            <section className="flex flex-col gap-4">
              <div>
                <h2 className="text-base font-semibold">
                  添加{kind === "emote" ? "小表情" : "贴图"}
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground text-pretty">
                  上传图片并为每张命名（展示名，非 shortcode）。可跳过稍后再加。
                  当前包：
                  <span className="font-medium text-foreground">
                    {" "}
                    {createdPack.name}
                  </span>
                </p>
              </div>

              <input
                ref={fileRef}
                type="file"
                accept={STICKER_UPLOAD_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => void onFilesSelected(e.target.files)}
              />

              <button
                type="button"
                onClick={onPickFiles}
                disabled={uploading}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-muted-foreground/25 bg-muted/30 px-4 py-10",
                  "text-muted-foreground transition-[background-color,border-color,transform] duration-150",
                  "hover:border-primary/40 hover:bg-muted/50 hover:text-foreground",
                  "active:scale-[0.99] disabled:opacity-60",
                )}
              >
                {uploading ? (
                  <Loader2Icon className="size-6 animate-spin" />
                ) : (
                  <UploadIcon className="size-6" />
                )}
                <span className="text-sm font-medium">
                  {uploading ? "上传中…" : "点击选择图片（可多选）"}
                </span>
                <span className="text-[11px]">
                  支持 PNG / GIF / WebP / MP4 / WebM 等（大小由服务器配置，默认 50MB）
                </span>
              </button>

              {items.length > 0 ? (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="relative flex flex-col items-center gap-1.5 rounded-2xl bg-muted/40 p-3"
                    >
                      <button
                        type="button"
                        onClick={() => void onDeleteItem(item)}
                        className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-destructive active:scale-[0.96]"
                        aria-label="删除"
                      >
                        <XIcon className="size-3.5" />
                      </button>
                      {isStickerVideoAsset(item.asset_url) ? (
                        <video
                          src={stickerAssetUrl(item.asset_url)}
                          className="size-16 object-contain"
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
                          className="size-16 object-contain"
                          draggable={false}
                        />
                      )}
                      {namingId === item.id ? (
                        <Input
                          value={nameDraft}
                          onChange={(e) => setNameDraft(e.target.value)}
                          onBlur={() => void commitRename(item)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.currentTarget.blur()
                            }
                            if (e.key === "Escape") {
                              setNamingId(null)
                            }
                          }}
                          className="h-7 border-0 bg-background/80 px-2 text-center text-xs shadow-none"
                          maxLength={64}
                          autoFocus
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => startRename(item)}
                          className="max-w-full truncate text-center text-xs font-medium underline-offset-2 hover:underline"
                          title="点击命名"
                        >
                          {itemDisplayName(item)}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-center text-[13px] text-muted-foreground">
                  还没有添加表情
                </p>
              )}
            </section>
          ) : null}
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border/40 px-3 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="active:scale-[0.97]"
        >
          <ArrowLeftIcon className="size-3.5" />
          {step === 1 || (step === 4 && createdPack) ? "返回贴图库" : "上一步"}
        </Button>
        {step < 4 ? (
          <Button
            size="sm"
            disabled={!canNext || creating}
            onClick={onNext}
            className="gap-1.5 active:scale-[0.97]"
          >
            {creating ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : step === 3 ? (
              <CheckIcon className="size-3.5" />
            ) : (
              <ArrowRightIcon className="size-3.5" />
            )}
            {step === 3 ? (creating ? "创建中…" : "创建并继续") : "下一步"}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={goLibrary}
            className="gap-1.5 active:scale-[0.97]"
          >
            <CheckIcon className="size-3.5" />
            完成
          </Button>
        )}
      </footer>
    </div>
  )
}

function TypeCard({
  active,
  icon,
  title,
  desc,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-2 rounded-2xl p-4 text-left",
        "transition-[background-color,box-shadow,transform] duration-150",
        "active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        active
          ? "bg-primary/10 shadow-[inset_0_0_0_1.5px] shadow-primary/40"
          : "bg-muted/40 hover:bg-muted/65",
      )}
    >
      <span
        className={cn(
          "flex size-11 items-center justify-center rounded-xl",
          active
            ? "bg-primary/15 text-primary"
            : "bg-background/70 text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-[12px] leading-relaxed text-muted-foreground text-pretty">
        {desc}
      </span>
    </button>
  )
}
