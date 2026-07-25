// 服务器管理设置面板（docs 18 M1–M2/M4）：嵌入主内容圆角卡片 + 左导航 + 右内容 + 底部保存条。
// 与 16 用户设置 / 17 服务器个人设置严格分离（docs 18 §1.2 三面板对照）。
//
// 权限模型（docs 18 §3.4/§4）：
//   - 入口可见与导航项按本地权限投影过滤（memberGuildPermissions）；
//   - 本地投影只负责藏导航与灰置，最终以服务端 403/404 为准；
//   - 面板打开期间权限被剥夺（GUILD_ROLE_* / GUILD_MEMBER_UPDATE）→ 导航实时重算。
//
// 分栏：概览 / 角色 / 成员 / 封禁 / 限制 / 邀请 / 语音节点 / 语音包 / 审计 / 危险区。

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BanIcon,
  BotIcon,
  GavelIcon,
  LinkIcon,
  MusicIcon,
  RadioIcon,
  ScrollTextIcon,
  ShieldAlertIcon,
  ShieldIcon,
  SmileIcon,
  Trash2Icon,
  UsersIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { GuildAvatar } from "~/components/guild-avatar"
import { AuditSection } from "~/components/guild-settings/audit-section"
import { InvitesSection } from "~/components/guild-settings/invites-section"
import { RestrictionsSection } from "~/components/guild-settings/restrictions-section"
import { RolesSection } from "~/components/guild-settings/roles-section"
import { ExpressionsSection } from "~/components/guild-settings/expressions-section"
import { BotsSection } from "~/components/guild-settings/bots-section"
import { VoiceNodesSection } from "~/components/guild-settings/voice-nodes-section"
import { VoicePacksSection } from "~/components/guild-settings/voice-packs-section"
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
  addGuildBanner,
  banUser,
  deleteGuild,
  deleteGuildBanner,
  deleteGuildIcon,
  kickMember,
  listBans,
  listGuildBanners,
  patchGuild,
  removeGuildBanner,
  reorderGuildBanners,
  transferGuildOwnership,
  unbanUser,
  uploadGuildBanner,
  uploadGuildIcon,
  type GuildBan,
} from "~/lib/api/guilds"
import { ApiError, resolveApiUrl } from "~/lib/api/http"
import { hasPermission, Permissions } from "~/lib/permissions"
import { cn, isGuildMediaVideo } from "~/lib/utils"
import type { Channel, GuildBanner, GuildMember } from "~/lib/api/types"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import { useGuildsStore } from "~/stores/guilds"
import { useMembersStore } from "~/stores/members"
import { memberGuildPermissions, useRolesStore } from "~/stores/roles"
import { useUIStore } from "~/stores/ui"

const EMPTY_CHANNELS: Channel[] = []

// Zustand selector 必须返回稳定引用（避免 ?? [] 每次新建导致无限重渲染）
const EMPTY_MEMBERS: GuildMember[] = []
const EMPTY_BANNERS: GuildBanner[] = []

/** 服务器外观资产：图片或短循环 MP4，≤8MB */
const GUILD_MEDIA_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,video/mp4,.mp4"
const GUILD_MEDIA_MAX_BYTES = 8 * 1024 * 1024

function validateGuildMediaFile(file: File): string | null {
  if (file.size > GUILD_MEDIA_MAX_BYTES) return "文件不能超过 8MB"
  const isMp4 = file.type === "video/mp4" || /\.mp4$/i.test(file.name)
  const isImage =
    file.type.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif)$/i.test(file.name)
  if (!isImage && !isMp4) return "仅支持 PNG/JPEG/WebP/GIF 图片或 MP4 视频"
  return null
}

/** 缩略预览：图用 img，MP4 用静音视频；宽度由 className 固定，高度按原始比例 */
function GuildMediaThumb({
  url,
  alt,
  className,
}: {
  url: string
  alt: string
  className?: string
}) {
  const src = resolveApiUrl(url)
  const mediaClass = "block h-auto w-full object-contain"
  if (isGuildMediaVideo(url)) {
    return (
      <div className={cn("overflow-hidden bg-black/5 dark:bg-white/5", className)}>
        <video
          src={src}
          muted
          loop
          autoPlay
          playsInline
          className={mediaClass}
          aria-label={alt}
        />
      </div>
    )
  }
  return (
    <div className={cn("overflow-hidden bg-black/5 dark:bg-white/5", className)}>
      <img src={src} alt={alt} className={mediaClass} draggable={false} />
    </div>
  )
}

function pickGuildMediaFile(onFile: (file: File) => void) {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = GUILD_MEDIA_ACCEPT
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const err = validateGuildMediaFile(file)
    if (err) {
      toast.error(err)
      return
    }
    onFile(file)
  }
  input.click()
}

// ---------------------------------------------------------------------------
// 导航与权限矩阵（docs 18 §4.1）
// ---------------------------------------------------------------------------

type AdminSection =
  | "overview"
  | "roles"
  | "members"
  | "bans"
  | "restrictions"
  | "invites"
  | "bots"
  | "voice-nodes"
  | "voice-packs"
  | "expressions"
  | "audit-log"
  | "danger"

const MEMBERS_ENTRY =
  Permissions.KICK_MEMBERS |
  Permissions.BAN_MEMBERS |
  Permissions.MANAGE_NICKNAMES |
  Permissions.MANAGE_ROLES |
  Permissions.MODERATE_MEMBERS

/** 邀请列表/撤销：CREATE_INSTANT_INVITE 或 MANAGE_GUILD（与 publicinvite 一致） */
const INVITES_ENTRY =
  Permissions.MANAGE_GUILD | Permissions.CREATE_INSTANT_INVITE

/** 任一管理向权限即可打开面板（docs 18 FR-02） */
export const ADMIN_PANEL_ENTRY =
  Permissions.MANAGE_GUILD |
  Permissions.MANAGE_ROLES |
  MEMBERS_ENTRY |
  INVITES_ENTRY |
  Permissions.VIEW_AUDIT_LOG |
  Permissions.MODERATE_MEMBERS |
  Permissions.MANAGE_EXPRESSIONS |
  Permissions.MANAGE_BOTS

const NAV: {
  id: AdminSection
  group: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** 可见条件：权限位任一命中；"owner" = 仅所有者 */
  required: bigint | "owner"
}[] = [
  { id: "overview", group: "服务器设置", label: "概览", icon: WrenchIcon, required: Permissions.MANAGE_GUILD },
  { id: "roles", group: "服务器设置", label: "角色", icon: ShieldIcon, required: Permissions.MANAGE_ROLES },
  { id: "expressions", group: "服务器设置", label: "表情与贴图", icon: SmileIcon, required: Permissions.MANAGE_EXPRESSIONS },
  { id: "members", group: "用户管理", label: "成员", icon: UsersIcon, required: MEMBERS_ENTRY },
  { id: "bans", group: "用户管理", label: "封禁", icon: GavelIcon, required: Permissions.BAN_MEMBERS },
  { id: "restrictions", group: "用户管理", label: "限制", icon: BanIcon, required: Permissions.MODERATE_MEMBERS },
  { id: "invites", group: "用户管理", label: "邀请", icon: LinkIcon, required: INVITES_ENTRY },
  { id: "bots", group: "集成", label: "机器人", icon: BotIcon, required: Permissions.MANAGE_BOTS },
  // 操作日志提到安全组最前，醒目展示可撤销管理流水
  { id: "audit-log", group: "安全", label: "操作日志", icon: ScrollTextIcon, required: Permissions.VIEW_AUDIT_LOG },
  { id: "voice-nodes", group: "语音", label: "语音节点", icon: RadioIcon, required: Permissions.MANAGE_GUILD },
  { id: "voice-packs", group: "语音", label: "入场语音包", icon: MusicIcon, required: Permissions.MANAGE_GUILD },
  { id: "danger", group: "危险", label: "危险操作", icon: ShieldAlertIcon, required: "owner" },
]

export function canOpenGuildAdmin(perms: bigint, isOwner: boolean): boolean {
  return isOwner || hasPermission(perms, ADMIN_PANEL_ENTRY)
}

// ---------------------------------------------------------------------------
// 面板壳
// ---------------------------------------------------------------------------

export function GuildAdminPanel() {
  const guildId = useUIStore((s) => s.guildAdminGuildId)
  const preferredSection = useUIStore((s) => s.guildAdminSection)
  const clearPreferredSection = useUIStore((s) => s.clearGuildAdminSection)
  const close = useUIStore((s) => s.closeGuildAdmin)
  const guild = useGuildsStore((s) => s.guilds.find((g) => g.id === guildId))

  const selfId = useAuthStore((s) => s.user?.id)
  const selfMember = useMembersStore((s) =>
    guildId ? s.byGuild[guildId]?.find((m) => m.user_id === selfId) : undefined,
  )
  const roles = useRolesStore((s) => (guildId ? s.byGuild[guildId] : undefined))
  const isOwner = selfMember?.is_owner === true
  const perms = useMemo(
    () => memberGuildPermissions(selfMember, roles),
    [selfMember, roles],
  )

  const nav = useMemo(
    () =>
      NAV.filter((item) =>
        item.required === "owner"
          ? isOwner
          : isOwner || hasPermission(perms, item.required),
      ),
    [perms, isOwner],
  )

  const [section, setSection] = useState<AdminSection>("overview")
  const [dirty, setDirty] = useState(false)

  // 深链着陆分栏（docs 18 FR-10）
  useEffect(() => {
    if (!guildId || !preferredSection) return
    if (nav.some((item) => item.id === preferredSection)) {
      setSection(preferredSection)
    }
    clearPreferredSection()
  }, [guildId, preferredSection, nav, clearPreferredSection])

  // 打开/权限变化：确保当前分栏仍有权（docs 18 FR-19），否则落到第一个有权项
  useEffect(() => {
    if (!guildId) return
    if (!nav.some((item) => item.id === section)) {
      const first = nav[0]?.id
      if (first) setSection(first)
      else {
        toast.error("没有可管理的项目")
        close()
      }
    }
  }, [guildId, nav, section, close])

  // 被移出服务器 / 服被删：强制关面板（docs 18 §9）
  useEffect(() => {
    if (guildId && !guild) {
      close()
    }
  }, [guildId, guild, close])

  const requestClose = useCallback(() => {
    if (dirty) {
      const ok = window.confirm("有未保存的更改，确定放弃并关闭吗？")
      if (!ok) return
      setDirty(false)
    }
    close()
  }, [dirty, close])

  // Esc 关闭（脏数据拦截，docs 18 FR-07）；点遮罩不关闭（FR-08）
  useEffect(() => {
    if (!guildId) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [guildId, requestClose])

  if (!guildId || !guild) return null

  let groupSeen = ""

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {/* 左导航：与主内容圆角卡片同色，无竖向分割线 */}
      <nav
        className={cn(
          "flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto overscroll-contain",
          "border-0 bg-transparent px-2.5 py-4",
        )}
        aria-label="服务器设置分类"
      >
        <div className="mb-3 flex items-center gap-2.5 px-2 py-1">
          <GuildAvatar guild={guild} className="size-9 rounded-xl" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold tracking-tight text-foreground">
              {guild.name}
            </p>
            <p className="text-[11px] text-foreground/55">服务器设置</p>
          </div>
        </div>
        {nav.map((item) => {
          const header =
            item.group !== groupSeen ? (
              <p className="mt-3 mb-1 px-2.5 text-[10px] font-semibold tracking-wide text-foreground/45 uppercase">
                {item.group}
              </p>
            ) : null
          groupSeen = item.group
          const Icon = item.icon
          const active = section === item.id
          const isDanger = item.id === "danger"
          return (
            <div key={item.id}>
              {header}
              <button
                type="button"
                aria-current={active || undefined}
                onClick={() => {
                  if (dirty && section !== item.id) {
                    const ok = window.confirm("有未保存的更改，切换将放弃，继续吗？")
                    if (!ok) return
                    setDirty(false)
                  }
                  setSection(item.id)
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px]",
                  "transition-[background-color,color,transform] duration-150",
                  "outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  "active:scale-[0.98]",
                  active
                    ? isDanger
                      ? "bg-destructive/10 font-medium text-destructive"
                      : "bg-black/[0.06] font-medium text-foreground dark:bg-white/[0.1]"
                    : isDanger
                      ? "text-destructive/80 hover:bg-destructive/8 hover:text-destructive"
                      : "text-foreground/70 hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]",
                )}
              >
                <Icon className="size-4 shrink-0 opacity-90" />
                {item.label}
              </button>
            </div>
          )
        })}
      </nav>

      {/* 内容区 */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="absolute top-3 right-3 z-10">
          <button
            type="button"
            aria-label="关闭服务器设置"
            onClick={requestClose}
            className={cn(
              "flex size-8 items-center justify-center rounded-full",
              "text-foreground/55 transition-colors",
              "hover:bg-black/[0.06] hover:text-foreground",
              "dark:hover:bg-white/[0.08]",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            )}
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div
            className={cn(
              "mx-auto w-full px-6 py-6 pr-12",
              section === "roles" ? "max-w-5xl" : "max-w-2xl",
            )}
          >
            {section === "overview" && (
              <OverviewSection
                guildId={guildId}
                dirty={dirty}
                setDirty={setDirty}
                canManage={
                  isOwner || hasPermission(perms, Permissions.MANAGE_GUILD)
                }
              />
            )}
            {section === "roles" && (
              <RolesSection
                guildId={guildId}
                perms={perms}
                isOwner={isOwner}
                dirty={dirty}
                setDirty={setDirty}
              />
            )}
            {section === "members" && (
              <MembersSection
                guildId={guildId}
                perms={perms}
                isOwner={isOwner}
              />
            )}
            {section === "bans" && <BansSection guildId={guildId} />}
            {section === "restrictions" && (
              <RestrictionsSection guildId={guildId} />
            )}
            {section === "invites" && <InvitesSection guildId={guildId} />}
            {section === "bots" && <BotsSection guildId={guildId} />}
            {section === "voice-nodes" && (
              <VoiceNodesSection
                guildId={guildId}
                dirty={dirty}
                setDirty={setDirty}
              />
            )}
            {section === "voice-packs" && (
              <VoicePacksSection guildId={guildId} />
            )}
            {section === "expressions" && (
              <ExpressionsSection guildId={guildId} />
            )}
            {section === "audit-log" && <AuditSection guildId={guildId} />}
            {section === "danger" && isOwner && (
              <DangerSection guildId={guildId} onClosePanel={close} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 概览（docs 18 §5.1）
// ---------------------------------------------------------------------------

function OverviewSection({
  guildId,
  dirty,
  setDirty,
  canManage,
}: {
  guildId: string
  dirty: boolean
  setDirty: (next: boolean) => void
  canManage: boolean
}) {
  const guild = useGuildsStore((s) => s.guilds.find((g) => g.id === guildId))
  const channels = useChannelsStore(
    (s) => s.byGuild[guildId] ?? EMPTY_CHANNELS,
  )
  const [name, setName] = useState(guild?.name ?? "")
  const [description, setDescription] = useState(guild?.description ?? "")
  /** 默认着陆频道；空串 = 无（与 API null 对应） */
  const [defaultChannelId, setDefaultChannelId] = useState(
    guild?.default_channel_id ?? "",
  )
  const [saving, setSaving] = useState(false)
  /** 图标 / 单横幅 / 多 banner 上传中的互斥标记 */
  const [busy, setBusy] = useState<"icon" | "banner" | "banners" | null>(null)
  const [bannerLimit, setBannerLimit] = useState(10)

  const banners = useMemo(() => {
    const list = guild?.banners ?? EMPTY_BANNERS
    return [...list].sort((a, b) => a.position - b.position)
  }, [guild?.banners])

  const textChannels = useMemo(
    () =>
      channels
        .filter((c) => c.type === "TEXT")
        .slice()
        .sort(
          (a, b) =>
            (a.position ?? 0) - (b.position ?? 0) ||
            a.name.localeCompare(b.name),
        ),
    [channels],
  )

  /** 触发器展示文案：始终是可读频道名，不露出 UUID */
  const defaultChannelLabel = useMemo(() => {
    if (!defaultChannelId) return "无（回退到第一个文字频道）"
    const hit = textChannels.find((c) => c.id === defaultChannelId)
    if (hit) return `#${hit.name}`
    // 已配置但列表尚未加载 / 频道已删：仍给可读提示，避免显示 raw id
    return "（已选频道暂不可见或已删除）"
  }, [defaultChannelId, textChannels])

  // 打开概览时确保有频道列表（默认频道下拉）
  useEffect(() => {
    if (!useChannelsStore.getState().byGuild[guildId]) {
      void useChannelsStore
        .getState()
        .fetchChannels(guildId)
        .catch(() => undefined)
    }
  }, [guildId])

  // 打开概览时拉一次多 banner（补 limit + 与远端对齐）
  useEffect(() => {
    let cancelled = false
    void listGuildBanners(guildId)
      .then((res) => {
        if (cancelled) return
        setBannerLimit(res.limit)
        const current = useGuildsStore
          .getState()
          .guilds.find((g) => g.id === guildId)
        if (current) {
          useGuildsStore
            .getState()
            .upsertGuild(current, { banners: res.banners })
        }
      })
      .catch(() => {
        /* 列表失败不阻断概览；仍可用 store 缓存 */
      })
    return () => {
      cancelled = true
    }
  }, [guildId])

  // 面板打开/远端 GUILD_UPDATE 且本地未脏：同步草稿
  useEffect(() => {
    if (!dirty && guild) {
      setName(guild.name)
      setDescription(guild.description ?? "")
      setDefaultChannelId(guild.default_channel_id ?? "")
    }
  }, [guild, dirty])

  if (!guild) return null

  const savedDefault = guild.default_channel_id ?? ""

  const markDirty = (
    nextName: string,
    nextDesc: string,
    nextDefault: string = defaultChannelId,
  ) => {
    setDirty(
      nextName !== guild.name ||
        nextDesc !== (guild.description ?? "") ||
        nextDefault !== savedDefault,
    )
  }

  const save = async () => {
    const trimmed = name.trim()
    if (trimmed.length < 2 || trimmed.length > 100) {
      toast.error("名称需 2–100 字符")
      return
    }
    setSaving(true)
    try {
      const updated = await patchGuild(guildId, {
        name: trimmed,
        description: description.trim(),
        default_channel_id: defaultChannelId.trim() || null,
      })
      useGuildsStore.getState().upsertGuild(updated)
      setDirty(false)
      toast.success("已保存")
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const runAsset = async (
    kind: "icon" | "banner" | "banners",
    action: () => Promise<void>,
    successText: string,
  ) => {
    setBusy(kind)
    try {
      await action()
      toast.success(successText)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "操作失败")
    } finally {
      setBusy(null)
    }
  }

  const onUploadIcon = () => {
    pickGuildMediaFile((file) => {
      void runAsset(
        "icon",
        async () => {
          const updated = await uploadGuildIcon(guildId, file)
          if (updated && typeof updated === "object" && "id" in updated) {
            useGuildsStore.getState().upsertGuild(updated)
          }
        },
        "图标已更新",
      )
    })
  }

  const onRemoveIcon = () => {
    void runAsset(
      "icon",
      async () => {
        const updated = await deleteGuildIcon(guildId)
        if (updated && typeof updated === "object" && "id" in updated) {
          useGuildsStore.getState().upsertGuild(updated)
        } else {
          useGuildsStore.getState().upsertGuild({ ...guild, icon_url: "" })
        }
      },
      "已移除图标",
    )
  }

  const onUploadBanner = () => {
    pickGuildMediaFile((file) => {
      void runAsset(
        "banner",
        async () => {
          const updated = await uploadGuildBanner(guildId, file)
          if (updated && typeof updated === "object" && "id" in updated) {
            useGuildsStore.getState().upsertGuild(updated)
          }
        },
        "服务器横幅已更新",
      )
    })
  }

  const onRemoveBanner = () => {
    void runAsset(
      "banner",
      async () => {
        const updated = await deleteGuildBanner(guildId)
        if (updated && typeof updated === "object" && "id" in updated) {
          useGuildsStore.getState().upsertGuild(updated)
        } else {
          useGuildsStore.getState().upsertGuild({ ...guild, banner_url: "" })
        }
      },
      "已移除服务器横幅",
    )
  }

  const onAddCarouselBanner = () => {
    if (banners.length >= bannerLimit) {
      toast.error(`banner 数量已达上限 ${bannerLimit} 张`)
      return
    }
    pickGuildMediaFile((file) => {
      void runAsset(
        "banners",
        async () => {
          const res = await addGuildBanner(guildId, file)
          useGuildsStore
            .getState()
            .upsertGuild(guild, { banners: res.banners })
        },
        "Banner 已上传",
      )
    })
  }

  const onRemoveCarouselBanner = (bannerId: string) => {
    void runAsset(
      "banners",
      async () => {
        const res = await removeGuildBanner(guildId, bannerId)
        useGuildsStore
          .getState()
          .upsertGuild(guild, { banners: res.banners })
      },
      "Banner 已删除",
    )
  }

  const onMoveCarouselBanner = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= banners.length) return
    const ids = banners.map((b) => b.id)
    ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
    void runAsset(
      "banners",
      async () => {
        const res = await reorderGuildBanners(guildId, ids)
        useGuildsStore
          .getState()
          .upsertGuild(guild, { banners: res.banners })
      },
      "Banner 顺序已保存",
    )
  }

  const bannerUrl = guild.banner_url?.trim()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          概览
        </h2>
        <p className="mt-1 text-[13px] text-foreground/55">
          管理服务器的基本资料与展示信息
        </p>
      </div>

      {/* 服务器图标 */}
      <div className="flex items-center gap-4">
        <GuildAvatar guild={guild} className="size-20 rounded-2xl" />
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={!canManage || busy !== null}
              onClick={onUploadIcon}
            >
              {busy === "icon" ? "上传中…" : "上传图标"}
            </Button>
            {guild.icon_url && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!canManage || busy !== null}
                onClick={onRemoveIcon}
              >
                移除
              </Button>
            )}
          </div>
          <p className="text-xs text-foreground/50">
            建议方形图片或短循环 MP4，≤8MB；视频默认静音，悬停播放声音
          </p>
        </div>
      </div>

      {/* 服务器横幅（单张 banner_url，兼容旧字段 / 无多 banner 时展示） */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-foreground/60">
          服务器横幅
        </span>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-black/8 px-3 py-3 dark:border-white/10">
          {bannerUrl ? (
            <GuildMediaThumb
              url={bannerUrl}
              alt="服务器横幅"
              className="w-36 shrink-0 rounded-lg"
            />
          ) : (
            <div className="grid h-14 w-36 shrink-0 place-items-center rounded-lg border border-dashed border-black/12 text-[11px] text-foreground/40 dark:border-white/15">
              未设置
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">单张横幅</p>
            <p className="mt-0.5 text-xs text-foreground/50">
              无 Banner 图库时，频道列表顶部显示此横幅；支持图片 / MP4，≤8MB
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={!canManage || busy !== null}
              onClick={onUploadBanner}
            >
              {busy === "banner" ? "上传中…" : bannerUrl ? "更换" : "上传横幅"}
            </Button>
            {bannerUrl ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={!canManage || busy !== null}
                onClick={onRemoveBanner}
              >
                移除
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* 多 Banner 图库（轮播；优先于单张横幅） */}
      <div className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            <span className="text-xs font-medium text-foreground/60">
              Banner 图库
            </span>
            <p className="mt-0.5 text-xs text-foreground/50">
              频道列表顶部按顺序轮播（第 1 张为封面）；有图库时优先于单张横幅
            </p>
          </div>
          <p className="shrink-0 text-xs tabular-nums text-foreground/45">
            {banners.length} / {bannerLimit}
          </p>
        </div>

        {banners.length === 0 ? (
          <div className="rounded-xl border border-dashed border-black/12 px-4 py-6 text-center text-sm text-foreground/45 dark:border-white/15">
            还没有 Banner，上传后可在频道列表顶部轮播展示
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {banners.map((banner, index) => (
              <div
                key={banner.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-black/8 px-3 py-2.5 dark:border-white/10"
              >
                <GuildMediaThumb
                  url={banner.url}
                  alt={`Banner ${index + 1}`}
                  className="w-28 shrink-0 rounded-md"
                />
                <p className="min-w-0 flex-1 text-sm text-foreground/65">
                  第{" "}
                  <span className="tabular-nums text-foreground">
                    {index + 1}
                  </span>{" "}
                  张
                  {index === 0 ? "（封面）" : ""}
                  {isGuildMediaVideo(banner.url) ? " · 视频" : ""}
                </p>
                <div className="flex items-center gap-0.5">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="上移"
                    disabled={
                      !canManage || busy !== null || index === 0
                    }
                    onClick={() => onMoveCarouselBanner(index, -1)}
                  >
                    <ArrowUpIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="下移"
                    disabled={
                      !canManage ||
                      busy !== null ||
                      index === banners.length - 1
                    }
                    onClick={() => onMoveCarouselBanner(index, 1)}
                  >
                    <ArrowDownIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="删除该 Banner"
                    className="text-destructive hover:text-destructive"
                    disabled={!canManage || busy !== null}
                    onClick={() => onRemoveCarouselBanner(banner.id)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            disabled={
              !canManage ||
              busy !== null ||
              banners.length >= bannerLimit
            }
            onClick={onAddCarouselBanner}
          >
            {busy === "banners" ? "上传中…" : "上传 Banner"}
          </Button>
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground/60">服务器名称</span>
        <Input
          value={name}
          maxLength={100}
          disabled={!canManage}
          onChange={(event) => {
            setName(event.target.value)
            markDirty(event.target.value, description)
          }}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground/60">服务器简介</span>
        <textarea
          value={description}
          maxLength={1024}
          disabled={!canManage}
          rows={4}
          className={cn(
            "rounded-xl border border-black/8 bg-black/[0.02] px-3 py-2 text-sm text-foreground",
            "outline-none placeholder:text-foreground/35",
            "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
            "dark:border-white/10 dark:bg-white/[0.04]",
            "disabled:opacity-50",
          )}
          onChange={(event) => {
            setDescription(event.target.value)
            markDirty(name, event.target.value)
          }}
        />
      </label>

      {/* 默认欢迎频道（docs/design 默认欢迎频道与进服着陆） */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground/60">
          默认欢迎频道
        </span>
        <p className="text-xs text-foreground/50">
          成员进入本服务器且尚未选择频道时，优先打开此文字频道；未设置则打开侧栏第一个可见文字频道。
        </p>
        <Select
          value={defaultChannelId || "__none__"}
          onValueChange={(value) => {
            // Base UI 可能回传 string 或 string[]
            const raw = Array.isArray(value) ? value[0] : value
            const next = !raw || raw === "__none__" ? "" : String(raw)
            setDefaultChannelId(next)
            markDirty(name, description, next)
          }}
          disabled={!canManage}
        >
          <SelectTrigger
            className={cn(
              // 全宽展示完整频道名；覆盖默认 w-fit / line-clamp，避免截断或只显示 UUID
              "h-auto min-h-9 w-full max-w-lg items-start whitespace-normal py-2",
              "*:data-[slot=select-value]:line-clamp-none *:data-[slot=select-value]:whitespace-normal *:data-[slot=select-value]:break-all",
            )}
          >
            <SelectValue placeholder="无（回退到第一个文字频道）">
              {defaultChannelLabel}
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            align="start"
            alignItemWithTrigger={false}
            className="max-w-lg min-w-[var(--anchor-width)]"
          >
            <SelectItem value="__none__">
              无（回退到第一个文字频道）
            </SelectItem>
            {textChannels.map((ch) => (
              <SelectItem key={ch.id} value={ch.id} label={`#${ch.name}`}>
                #{ch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 底部保存条（docs 18 FR-12） */}
      {dirty && (
        <div className="sticky bottom-4 flex items-center justify-between rounded-xl border bg-card px-4 py-3 shadow-lg">
          <span className="text-sm">小心 — 你有未保存的更改！</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setName(guild.name)
                setDescription(guild.description ?? "")
                setDefaultChannelId(guild.default_channel_id ?? "")
                setDirty(false)
              }}
            >
              重置
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              保存修改
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 成员（docs 18 §5.4 精简版：搜索 + 踢出/封禁，两步确认；层级最终由服务端裁决）
// ---------------------------------------------------------------------------

function MembersSection({
  guildId,
  perms,
  isOwner,
}: {
  guildId: string
  perms: bigint
  isOwner: boolean
}) {
  const members = useMembersStore((s) => s.byGuild[guildId] ?? EMPTY_MEMBERS)
  const selfId = useAuthStore((s) => s.user?.id)
  const [query, setQuery] = useState("")
  /** 两步确认：`${action}:${userId}` */
  const [confirming, setConfirming] = useState<string | null>(null)

  const canKick = isOwner || hasPermission(perms, Permissions.KICK_MEMBERS)
  const canBan = isOwner || hasPermission(perms, Permissions.BAN_MEMBERS)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return members
    return members.filter((m) =>
      [m.nickname, m.display_name, m.username]
        .filter(Boolean)
        .some((n) => n!.toLowerCase().includes(q)),
    )
  }, [members, query])

  const run = async (
    action: "kick" | "ban",
    userId: string,
    label: string,
  ) => {
    const key = `${action}:${userId}`
    if (confirming !== key) {
      setConfirming(key)
      return
    }
    setConfirming(null)
    try {
      if (action === "kick") {
        const member = members.find((m) => m.user_id === userId)
        await kickMember(guildId, member?.id ?? userId)
      } else {
        await banUser(guildId, userId)
      }
      useMembersStore.getState().removeMember(guildId, userId)
      toast.success(`${action === "kick" ? "已踢出" : "已封禁"} ${label}`)
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.status === 403
          ? "权限或层级不足"
          : "操作失败",
      )
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          成员 · {members.length}
        </h2>
        <p className="mt-1 text-[13px] text-foreground/55">
          搜索并管理服务器成员
        </p>
      </div>
      <Input
        value={query}
        placeholder="搜索成员（昵称 / 显示名 / 用户名）"
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="flex flex-col divide-y divide-black/6 overflow-hidden rounded-xl border border-black/8 dark:divide-white/8 dark:border-white/10">
        {filtered.map((member) => {
          const label =
            member.nickname?.trim() ||
            member.display_name?.trim() ||
            member.username
          const isSelf = member.user_id === selfId
          const protectedTarget = isSelf || member.is_owner
          return (
            <div
              key={member.user_id}
              className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">
                  {label}
                  {member.is_owner && (
                    <span className="ml-1.5 text-[10px] text-amber-500">所有者</span>
                  )}
                  {isSelf && (
                    <span className="ml-1.5 text-[10px] text-foreground/45">我</span>
                  )}
                </p>
                <p className="truncate text-xs text-foreground/50">
                  @{member.username}
                </p>
              </div>
              {!protectedTarget && (canKick || canBan) && (
                <div className="flex shrink-0 gap-1.5">
                  {canKick && (
                    <Button
                      size="sm"
                      variant={confirming === `kick:${member.user_id}` ? "destructive" : "ghost"}
                      onClick={() => void run("kick", member.user_id, label)}
                      onBlur={() => setConfirming(null)}
                    >
                      {confirming === `kick:${member.user_id}` ? "确认踢出？" : "踢出"}
                    </Button>
                  )}
                  {canBan && (
                    <Button
                      size="sm"
                      variant={confirming === `ban:${member.user_id}` ? "destructive" : "ghost"}
                      onClick={() => void run("ban", member.user_id, label)}
                      onBlur={() => setConfirming(null)}
                    >
                      {confirming === `ban:${member.user_id}` ? "确认封禁？" : "封禁"}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            没有匹配的成员
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        改昵称 / 身份组 / 限制等更多操作在成员列表右键菜单中（docs 08）。
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 封禁（docs 18 §5.5）
// ---------------------------------------------------------------------------

function BansSection({ guildId }: { guildId: string }) {
  const [bans, setBans] = useState<GuildBan[] | null>(null)
  const [error, setError] = useState(false)

  const refresh = useCallback(() => {
    setError(false)
    listBans(guildId)
      .then(setBans)
      .catch(() => setError(true))
  }, [guildId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">封禁</h2>
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          加载失败
          <Button size="sm" variant="outline" onClick={refresh}>
            重试
          </Button>
        </div>
      )}
      {bans && bans.length === 0 && (
        <p className="rounded-xl border px-4 py-8 text-center text-sm text-muted-foreground">
          没有封禁记录
        </p>
      )}
      {bans && bans.length > 0 && (
        <div className="flex flex-col divide-y rounded-xl border">
          {bans.map((ban) => (
            <div
              key={ban.user_id}
              className="flex items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">{ban.user_id}</p>
                {ban.reason && (
                  <p className="truncate text-xs text-muted-foreground">
                    原因：{ban.reason}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void unbanUser(guildId, ban.user_id)
                    .then(() => {
                      toast.success("已解封")
                      refresh()
                    })
                    .catch(() => toast.error("解封失败"))
                }
              >
                解封
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 危险区（docs 18 §5.12，仅所有者）
// ---------------------------------------------------------------------------

function DangerSection({
  guildId,
  onClosePanel,
}: {
  guildId: string
  onClosePanel: () => void
}) {
  const guild = useGuildsStore((s) => s.guilds.find((g) => g.id === guildId))
  const members = useMembersStore((s) => s.byGuild[guildId] ?? EMPTY_MEMBERS)
  const selfId = useAuthStore((s) => s.user?.id)
  const [transferTarget, setTransferTarget] = useState("")
  const [confirmName, setConfirmName] = useState("")
  const [busy, setBusy] = useState(false)

  if (!guild) return null

  const candidates = members.filter(
    (m) => m.user_id !== selfId && !m.is_owner,
  )

  const doTransfer = async () => {
    if (!transferTarget) return
    const target = members.find((m) => m.user_id === transferTarget)
    const ok = window.confirm(
      `确定把「${guild.name}」的所有权转让给 ${target?.nickname || target?.display_name || target?.username}？此操作不可撤销。`,
    )
    if (!ok) return
    setBusy(true)
    try {
      await transferGuildOwnership(guildId, transferTarget)
      toast.success("所有权已转让；你的管理权限可能随之变化")
      setTransferTarget("")
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "转让失败")
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    setBusy(true)
    try {
      await deleteGuild(guildId, confirmName)
      toast.success(`已删除「${guild.name}」`)
      onClosePanel()
      // 本地清理由 GUILD_DELETE 事件路径统一处理（dropGuildLocally）
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.code === "CONFIRM_NAME_MISMATCH"
          ? "名称不一致，请输入完整服务器名称"
          : error instanceof ApiError
            ? error.message
            : "删除失败",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-destructive">危险操作</h2>

      <div className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-4">
        <p className="text-sm font-medium">转让所有权</p>
        <p className="text-xs text-muted-foreground">
          新所有者须为本服成员；转让后你保留成员身份与既有角色。
        </p>
        <div className="flex gap-2">
          <Select
            value={transferTarget}
            onValueChange={(value) => setTransferTarget(value ?? "")}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="选择新所有者" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.nickname?.trim() || m.display_name?.trim() || m.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="destructive"
            disabled={!transferTarget || busy}
            onClick={() => void doTransfer()}
          >
            转让
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-4">
        <p className="text-sm font-medium">删除服务器</p>
        <p className="text-xs text-muted-foreground">
          此操作不可恢复。输入完整服务器名称「{guild.name}」以确认。
        </p>
        <div className="flex gap-2">
          <Input
            value={confirmName}
            placeholder={guild.name}
            onChange={(event) => setConfirmName(event.target.value)}
          />
          <Button
            variant="destructive"
            disabled={confirmName !== guild.name || busy}
            onClick={() => void doDelete()}
          >
            删除服务器
          </Button>
        </div>
      </div>
    </div>
  )
}
