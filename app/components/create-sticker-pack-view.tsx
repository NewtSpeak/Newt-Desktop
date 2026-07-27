// 创建贴图包分步向导：类型 → 给谁用 → 命名 → 添加表情并命名。
// 对齐 docs 17 与设置页「创建包」字段。

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useNavigate } from "react-router"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ImageIcon,
  Loader2Icon,
  PackageIcon,
  ServerIcon,
  SmileIcon,
  UploadIcon,
  UserIcon,
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
import { useAuthStore } from "~/stores/auth"
import { useGuildsStore } from "~/stores/guilds"
import { useStickersStore } from "~/stores/stickers"
import { useUIStore } from "~/stores/ui"

type Step = 1 | 2 | 3 | 4

const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: "类型" },
  { id: 2, label: "给谁用" },
  { id: 3, label: "命名" },
  { id: 4, label: "添加表情" },
]

export function CreateStickerPackView() {
  const navigate = useNavigate()
  const guilds = useGuildsStore((s) => s.guilds)
  const userId = useAuthStore((s) => s.user?.id)
  const selectedGuildId = useUIStore((s) => s.selectedGuildId)
  const invalidate = useStickersStore((s) => s.invalidateAvailable)
  const refreshMyPacks = useStickersStore((s) => s.refreshMyPacks)
  const cacheItems = useStickersStore((s) => s.cacheItems)

  /** 仅「我是服主」的服务器可创建服独属包 */
  const ownedGuilds = useMemo(
    () =>
      guilds.filter(
        (g) => Boolean(userId) && g.owner_user_id === userId,
      ),
    [guilds, userId],
  )

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
    // 只允许落到「我拥有」的服务器上
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

  const goLibrary = () => {
    useUIStore.getState().selectGuild(null)
    navigate(STICKERS_PATH)
  }

  const canNext =
    step === 1
      ? true
      : step === 2
        ? scope === "account" ||
          (Boolean(guildId) &&
            ownedGuilds.some((g) => g.id === guildId))
        : step === 3
          ? name.trim().length > 0
          : true

  const onCreatePack = async () => {
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
        scope === "guild" ? "好了，这个包归你的服务器用" : "好了，这个包归你自己用",
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
                <h2 className="text-base font-semibold">想做哪种？</h2>
                <p className="mt-1 text-[13px] text-muted-foreground text-pretty">
                  选好了就不能改啦，一个包里也别混装两种。
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <TypeCard
                  active={kind === "emote"}
                  icon={<SmileIcon className="size-6" />}
                  title="小表情"
                  desc="打字时能和文字一起发，也能当反应点一下。"
                  onClick={() => setKind("emote")}
                />
                <TypeCard
                  active={kind === "sticker"}
                  icon={<ImageIcon className="size-6" />}
                  title="贴图"
                  desc="点一下单独发出去，一张消息就一张，不跟文字混。"
                  onClick={() => setKind("sticker")}
                />
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="flex flex-col gap-4">
              <div>
                <h2 className="text-base font-semibold">
                  为自己创建，为服务器创建！
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground text-pretty">
                  给自己用的，走到哪都能带；给服务器用的，只在你当服主的那几个服里用。
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <TypeCard
                  active={scope === "account"}
                  icon={<UserIcon className="size-6" />}
                  title="为自己创建"
                  desc="跟着你的账号走，换服务器也能用；别人能不能收藏看下面开关。"
                  onClick={() => setScope("account")}
                />
                <TypeCard
                  active={scope === "guild"}
                  icon={<ServerIcon className="size-6" />}
                  title="为服务器创建"
                  desc="只在你指定的服务器里用。只有你当服主的服务器可选。"
                  onClick={() => setScope("guild")}
                />
              </div>
              {scope === "guild" ? (
                <div className="rounded-2xl bg-muted/40 p-3">
                  <p className="mb-2 text-[12px] font-medium text-muted-foreground">
                    挂在哪个服务器？（仅你的服）
                  </p>
                  <Select
                    value={guildId}
                    onValueChange={(v) => setGuildId(v ?? "")}
                    disabled={ownedGuilds.length === 0}
                  >
                    <SelectTrigger className="w-full border-0 bg-background/80 shadow-none">
                      <SelectValue
                        placeholder={
                          ownedGuilds.length === 0
                            ? "暂无可选服务器"
                            : "选一个你拥有的服务器"
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
                  {ownedGuilds.length === 0 ? (
                    <p className="mt-2 text-[12px] text-destructive">
                      你还没有自己当服主的服务器，没法给服务器建包。先建个服，或选「为自己创建」。
                    </p>
                  ) : (
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      只列出你拥有的服务器，加入别人的服不在这里。
                    </p>
                  )}
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/40 px-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">允许别人收藏这个包</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground text-pretty">
                    开着：别人能装进自己的贴图库。关着：基本只有你自己好用。
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
                <h2 className="text-base font-semibold">起个好听的名字</h2>
                <p className="mt-1 text-[13px] text-muted-foreground text-pretty">
                  以后还能改。现在是：
                  {kind === "emote" ? "小表情" : "贴图"} ·{" "}
                  {scope === "guild" ? "为服务器创建" : "为自己创建"}
                  {scope === "guild" && guildId
                    ? ` · ${ownedGuilds.find((g) => g.id === guildId)?.name ?? ""}`
                    : ""}
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
                    placeholder="比如：日常小表情、摸鱼贴图"
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
                    placeholder="随便写两句介绍就行"
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
                  往「{createdPack.name}」里塞点
                  {kind === "emote" ? "小表情" : "贴图"}吧
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground text-pretty">
                  一次可以多选。名字点一下就能改，跳过也行，以后再加。
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
