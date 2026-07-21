// 设置 · 个人资料（docs 01 §3.3 / 16 FR-04）：
// 显示名、个性签名、头像、个人横幅；即时预览 + 保存文本字段 / 选图即上传。

import { useEffect, useRef, useState } from "react"
import { ImageIcon, Loader2Icon, Trash2Icon, UploadIcon } from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { ApiError } from "~/lib/api/http"
import {
  deleteAvatar,
  deleteBanner,
  patchMe,
  uploadAvatar,
  uploadBanner,
} from "~/lib/api/users"
import {
  nameInitials,
  resolveProfileAssetUrl,
  userDisplayName,
} from "~/lib/user-display"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { GroupLabel, SectionTitle, SettingRow } from "./section"

const MAX_AVATAR_BYTES = 8 << 20
const MAX_BANNER_BYTES = 12 << 20
const ACCEPT_IMAGE = "image/png,image/jpeg,image/webp,image/gif"

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  return fallback
}

function validateImageFile(file: File, maxBytes: number, label: string): string | null {
  if (!file.type.startsWith("image/")) return `${label}须为图片文件`
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
    return `${label}仅支持 PNG / JPEG / WebP / GIF`
  }
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024))
    return `${label}不能超过 ${mb}MB`
  }
  return null
}

export function ProfileSection() {
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)

  const [displayName, setDisplayName] = useState(user?.display_name ?? "")
  const [bio, setBio] = useState(user?.bio ?? "")
  const [savingText, setSavingText] = useState(false)
  const [textError, setTextError] = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadingBanner, setUploadingBanner] = useState(false)

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  // 外部 USER_UPDATE / 重登 同步到表单（避免覆盖用户正在编辑的内容）
  useEffect(() => {
    if (!user) return
    setDisplayName(user.display_name ?? "")
    setBio(user.bio ?? "")
  }, [user?.id, user?.display_name, user?.bio, user?.updated_at])

  if (!user) return null

  const previewName = displayName.trim() || user.username
  const avatarSrc = resolveProfileAssetUrl(user.avatar_url)
  const bannerSrc = resolveProfileAssetUrl(user.banner_url)
  const dirtyText =
    displayName.trim() !== (user.display_name ?? "").trim() ||
    bio.trim() !== (user.bio ?? "").trim()

  const saveText = async () => {
    const name = displayName.trim()
    if (name && (name.length < 1 || [...name].length > 32)) {
      setTextError("显示名长度为 1–32 个字符")
      return
    }
    if ([...bio.trim()].length > 190) {
      setTextError("个性签名不能超过 190 个字符")
      return
    }
    setTextError(null)
    setSavingText(true)
    try {
      const updated = await patchMe({
        display_name: name,
        bio: bio.trim(),
      })
      setUser(updated)
      toast.success("资料已保存")
    } catch (error) {
      setTextError(errorMessage(error, "保存失败，请重试"))
    } finally {
      setSavingText(false)
    }
  }

  const onPickAvatar = async (file: File | undefined) => {
    if (!file) return
    const invalid = validateImageFile(file, MAX_AVATAR_BYTES, "头像")
    if (invalid) {
      toast.error(invalid)
      return
    }
    setUploadingAvatar(true)
    try {
      const result = await uploadAvatar(file)
      setUser(result.user)
      toast.success("头像已更新")
    } catch (error) {
      toast.error(errorMessage(error, "头像上传失败"))
    } finally {
      setUploadingAvatar(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ""
    }
  }

  const onRemoveAvatar = async () => {
    setUploadingAvatar(true)
    try {
      const updated = await deleteAvatar()
      setUser(updated)
      toast.success("已移除头像")
    } catch (error) {
      toast.error(errorMessage(error, "移除头像失败"))
    } finally {
      setUploadingAvatar(false)
    }
  }

  const onPickBanner = async (file: File | undefined) => {
    if (!file) return
    const invalid = validateImageFile(file, MAX_BANNER_BYTES, "横幅")
    if (invalid) {
      toast.error(invalid)
      return
    }
    setUploadingBanner(true)
    try {
      const result = await uploadBanner(file)
      setUser(result.user)
      toast.success("横幅已更新")
    } catch (error) {
      toast.error(errorMessage(error, "横幅上传失败"))
    } finally {
      setUploadingBanner(false)
      if (bannerInputRef.current) bannerInputRef.current.value = ""
    }
  }

  const onRemoveBanner = async () => {
    setUploadingBanner(true)
    try {
      const updated = await deleteBanner()
      setUser(updated)
      toast.success("已移除横幅")
    } catch (error) {
      toast.error(errorMessage(error, "移除横幅失败"))
    } finally {
      setUploadingBanner(false)
    }
  }

  return (
    <div>
      <SectionTitle>个人资料</SectionTitle>
      <p className="mb-5 text-sm text-muted-foreground">
        配置系统内展示名、签名、头像与横幅。显示名优先于用户名；服务器内昵称仍优先于显示名。
      </p>

      {/* 预览卡（对标 Discord 资料预览） */}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div
          className={cn(
            "relative h-28 w-full bg-gradient-to-br from-primary/40 via-muted to-muted",
            !bannerSrc && "bg-muted",
          )}
        >
          {bannerSrc && (
            <img
              src={bannerSrc}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
          )}
        </div>
        <div className="relative px-4 pb-4">
          <div className="-mt-10 mb-3">
            <Avatar className="size-20 rounded-full ring-4 ring-card">
              {avatarSrc && <AvatarImage src={avatarSrc} alt={previewName} />}
              <AvatarFallback className="rounded-full text-xl">
                {nameInitials(previewName)}
              </AvatarFallback>
            </Avatar>
          </div>
          <p className="truncate text-lg font-semibold leading-tight">{previewName}</p>
          <p className="truncate text-sm text-muted-foreground">@{user.username}</p>
          {bio.trim() ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{bio.trim()}</p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">暂无个性签名</p>
          )}
        </div>
      </div>

      <GroupLabel>文字资料</GroupLabel>
      <div className="space-y-4">
        <div>
          <label htmlFor="profile-display-name" className="mb-1.5 block text-sm font-medium">
            显示名
          </label>
          <Input
            id="profile-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={user.username}
            maxLength={32}
            aria-describedby="profile-display-name-hint"
          />
          <p id="profile-display-name-hint" className="mt-1 text-xs text-muted-foreground">
            1–32 个字符；留空则展示用户名「{user.username}」
          </p>
        </div>
        <div>
          <label htmlFor="profile-bio" className="mb-1.5 block text-sm font-medium">
            个性签名
          </label>
          <textarea
            id="profile-bio"
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            placeholder="介绍一下自己…"
            maxLength={190}
            rows={3}
            className="w-full resize-none rounded-2xl border border-transparent bg-input/50 px-3 py-2 text-sm outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {[...bio].length}/190
          </p>
        </div>
        {textError && <p className="text-sm text-destructive">{textError}</p>}
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={!dirtyText || savingText}
            onClick={() => void saveText()}
          >
            {savingText && <Loader2Icon className="size-4 animate-spin" />}
            保存资料
          </Button>
        </div>
      </div>

      <GroupLabel>头像</GroupLabel>
      <SettingRow
        label="个人头像"
        description="PNG / JPEG / WebP / GIF，最大 8MB"
      >
        <div className="flex items-center gap-2">
          <input
            ref={avatarInputRef}
            type="file"
            accept={ACCEPT_IMAGE}
            className="hidden"
            onChange={(event) => void onPickAvatar(event.target.files?.[0])}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploadingAvatar}
            onClick={() => avatarInputRef.current?.click()}
          >
            {uploadingAvatar ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <UploadIcon className="size-4" />
            )}
            上传
          </Button>
          {user.avatar_url && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={uploadingAvatar}
              onClick={() => void onRemoveAvatar()}
            >
              <Trash2Icon className="size-4" />
              移除
            </Button>
          )}
        </div>
      </SettingRow>

      <GroupLabel>横幅</GroupLabel>
      <SettingRow
        label="个人横幅"
        description="展示在资料卡顶部；PNG / JPEG / WebP / GIF，最大 12MB"
      >
        <div className="flex items-center gap-2">
          <input
            ref={bannerInputRef}
            type="file"
            accept={ACCEPT_IMAGE}
            className="hidden"
            onChange={(event) => void onPickBanner(event.target.files?.[0])}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploadingBanner}
            onClick={() => bannerInputRef.current?.click()}
          >
            {uploadingBanner ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <ImageIcon className="size-4" />
            )}
            上传
          </Button>
          {user.banner_url && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={uploadingBanner}
              onClick={() => void onRemoveBanner()}
            >
              <Trash2Icon className="size-4" />
              移除
            </Button>
          )}
        </div>
      </SettingRow>

      <p className="mt-6 text-xs text-muted-foreground">
        当前登录账号：{userDisplayName(user)}（@{user.username}）
      </p>
    </div>
  )
}
