// 设置弹窗（docs 16 FR-01）：居中模态，非全屏独立页。
// 动效对齐 transitions-dev modal（scale 0.96、open 250ms / close 150ms），
// 纯 CSS 状态机（.is-open / .is-closing），避免 GSAP 在条件挂载下回滚导致白屏。
// prefers-reduced-motion 降级为瞬时切换。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  BellIcon,
  ChevronDownIcon,
  CircleUserRoundIcon,
  IdCardIcon,
  InfoIcon,
  KeyboardIcon,
  MicIcon,
  PackageOpenIcon,
  PaletteIcon,
  KeyRoundIcon,
  ShieldIcon,
  SparklesIcon,
  StickerIcon,
  XIcon,
} from "lucide-react"

import { cn } from "~/lib/utils"
import { useSettingsStore, type SettingsSection } from "~/stores/settings"
import { AboutSection } from "./about-section"
import { AccountSection } from "./account-section"
import { ApplicationsSection } from "./applications-section"
import { AppearanceSection } from "./appearance-section"
import { CosmeticsInventorySection } from "./cosmetics-inventory-section"
import { CosmeticsShopSection } from "./cosmetics-shop-section"
import { KeybindsSection } from "./keybinds-section"
import { NotificationsSection } from "./notifications-section"
import { PrivacySection } from "./privacy-section"
import { ProfileSection } from "./profile-section"
import {
  SECTION_TOC,
  settingsAnchorDomId,
  type SettingsTocItem,
} from "./settings-toc"
import { StickersSection } from "./stickers-section"
import { VoiceSection } from "./voice-section"

const NAV: {
  group: string
  items: { id: SettingsSection; label: string; icon: typeof MicIcon }[]
}[] = [
  {
    group: "用户设置",
    items: [
      { id: "account", label: "我的账号", icon: CircleUserRoundIcon },
      { id: "profile", label: "个人资料", icon: IdCardIcon },
      { id: "privacy", label: "隐私与安全", icon: ShieldIcon },
      { id: "applications", label: "已授权应用", icon: KeyRoundIcon },
    ],
  },
  {
    group: "应用设置",
    items: [
      { id: "voice", label: "语音与视频", icon: MicIcon },
      { id: "notifications", label: "通知", icon: BellIcon },
      { id: "appearance", label: "外观", icon: PaletteIcon },
      { id: "keybinds", label: "快捷键", icon: KeyboardIcon },
      { id: "stickers", label: "我的贴图库", icon: StickerIcon },
    ],
  },
  {
    group: "装扮",
    items: [
      { id: "cosmetics-shop", label: "装扮商店", icon: SparklesIcon },
      { id: "cosmetics-inventory", label: "我的装扮", icon: PackageOpenIcon },
    ],
  },
  {
    group: "高级",
    items: [{ id: "about", label: "关于", icon: InfoIcon }],
  },
]

/** transitions-dev modal close 时长（ms） */
const CLOSE_MS = 150

function SectionContent({ section }: { section: SettingsSection }) {
  switch (section) {
    case "account":
      return <AccountSection />
    case "profile":
      return <ProfileSection />
    case "privacy":
      return <PrivacySection />
    case "applications":
      return <ApplicationsSection />
    case "voice":
      return <VoiceSection />
    case "notifications":
      return <NotificationsSection />
    case "appearance":
      return <AppearanceSection />
    case "keybinds":
      return <KeybindsSection />
    case "stickers":
      return <StickersSection />
    case "cosmetics-shop":
      return <CosmeticsShopSection />
    case "cosmetics-inventory":
      return <CosmeticsInventorySection />
    case "about":
      return <AboutSection />
    default:
      return null
  }
}

/** closed → preopen（挂载无 is-open）→ open → closing → closed */
type Phase = "closed" | "preopen" | "open" | "closing"

export function SettingsPanel() {
  const storeOpen = useSettingsStore((state) => state.panelOpen)
  const section = useSettingsStore((state) => state.activeSection)
  const setSection = useSettingsStore((state) => state.setSection)
  const closePanel = useSettingsStore((state) => state.closePanel)

  const [phase, setPhase] = useState<Phase>("closed")
  /** 当前高亮的子菜单锚点 */
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null)
  /** 待滚动的锚点（切换主菜单后等内容挂载再滚） */
  const pendingAnchorRef = useRef<string | null>(null)
  const contentScrollRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openRafRef = useRef(0)

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  // store 打开：先 preopen 再 rAF 切 open，保证 CSS 入场过渡
  useEffect(() => {
    if (!storeOpen) return
    clearCloseTimer()
    if (openRafRef.current) cancelAnimationFrame(openRafRef.current)
    setPhase("preopen")
    openRafRef.current = requestAnimationFrame(() => {
      openRafRef.current = requestAnimationFrame(() => {
        openRafRef.current = 0
        setPhase("open")
      })
    })
    return () => {
      if (openRafRef.current) cancelAnimationFrame(openRafRef.current)
    }
  }, [storeOpen, clearCloseTimer])

  const requestClose = useCallback(() => {
    if (phase === "closing" || phase === "closed") {
      if (storeOpen) closePanel()
      return
    }
    setPhase("closing")
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      setPhase("closed")
      closePanel()
    }, CLOSE_MS)
  }, [phase, storeOpen, closePanel, clearCloseTimer])

  // store 被外部关掉（非本组件 requestClose）
  useEffect(() => {
    if (storeOpen) return
    if (phase !== "open" && phase !== "preopen") return
    setPhase("closing")
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      setPhase("closed")
    }, CLOSE_MS)
  }, [storeOpen, phase, clearCloseTimer])

  useEffect(
    () => () => {
      clearCloseTimer()
      if (openRafRef.current) cancelAnimationFrame(openRafRef.current)
    },
    [clearCloseTimer],
  )

  // Esc + 背景滚动锁
  useEffect(() => {
    if (phase === "closed") return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        event.preventDefault()
        requestClose()
      }
    }
    window.addEventListener("keydown", onKeyDown, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      document.body.style.overflow = prev
    }
  }, [phase, requestClose])

  /** 在右侧内容区平滑滚动到锚点 */
  const scrollToAnchor = useCallback((anchorId: string, behavior: ScrollBehavior = "smooth") => {
    const root = contentScrollRef.current
    if (!root) return false
    const el = root.querySelector<HTMLElement>(
      `#${CSS.escape(settingsAnchorDomId(anchorId))}`,
    )
    if (!el) return false
    el.scrollIntoView({ behavior, block: "start" })
    setActiveAnchor(anchorId)
    return true
  }, [])

  /** 进入某主菜单：切换内容并展开子菜单；可选定位到首个/指定锚点 */
  const enterSection = useCallback(
    (id: SettingsSection, anchorId?: string) => {
      const toc = SECTION_TOC[id] ?? []
      const target = anchorId ?? toc[0]?.id ?? null
      setSection(id)
      setActiveAnchor(target)
      pendingAnchorRef.current = target
    },
    [setSection],
  )

  /** 点击子菜单：同栏内滚动；若尚未在该主菜单则先进入再滚 */
  const onSubmenuClick = useCallback(
    (sectionId: SettingsSection, item: SettingsTocItem) => {
      if (section !== sectionId) {
        enterSection(sectionId, item.id)
        return
      }
      scrollToAnchor(item.id)
    },
    [section, enterSection, scrollToAnchor],
  )

  // 主菜单切换后等内容挂载，再执行待滚动锚点
  useLayoutEffect(() => {
    if (phase === "closed") return
    const pending = pendingAnchorRef.current
    if (!pending) return
    // 双 rAF：等 section 内容与 key 切换完成布局
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (scrollToAnchor(pending, "smooth")) {
          pendingAnchorRef.current = null
        }
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [section, phase, scrollToAnchor])

  // 打开弹窗时对齐当前 section 的子菜单高亮
  useEffect(() => {
    if (!storeOpen) return
    const toc = SECTION_TOC[section] ?? []
    setActiveAnchor((prev) => prev ?? toc[0]?.id ?? null)
  }, [storeOpen, section])

  if (phase === "closed") return null

  const open = phase === "open"
  const currentToc = SECTION_TOC[section] ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      {/* 遮罩 */}
      <div
        className={cn(
          "settings-modal-overlay absolute inset-0 bg-black/45",
          "supports-backdrop-filter:backdrop-blur-[2px]",
          open ? "is-open" : "is-closing",
        )}
        aria-hidden
        onClick={requestClose}
      />

      {/* 弹窗卡片 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        className={cn(
          "settings-modal-panel relative z-10 flex w-full max-w-4xl overflow-hidden",
          "h-[min(720px,calc(100dvh-2rem))] sm:h-[min(680px,calc(100dvh-3rem))]",
          "rounded-[1.75rem] bg-background text-foreground",
          "shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_8px_30px_rgba(0,0,0,0.12),0_24px_64px_rgba(0,0,0,0.16)]",
          "dark:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_30px_rgba(0,0,0,0.45),0_24px_64px_rgba(0,0,0,0.55)]",
          open ? "is-open" : "is-closing",
        )}
      >
        <nav
          className={cn(
            "flex w-[14.5rem] shrink-0 flex-col overflow-y-auto",
            "border-r border-border/60 bg-muted/40 py-5 pr-2 pl-3",
            "dark:bg-muted/20",
          )}
          aria-label="设置分类"
        >
          <p className="mb-3 px-3 text-sm font-semibold tracking-tight text-foreground">
            设置
          </p>
          {NAV.map(({ group, items }) => (
            <div key={group} className="mb-3">
              <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {group}
              </p>
              {items.map(({ id, label, icon: Icon }) => {
                const active = section === id
                const subs = SECTION_TOC[id] ?? []
                const expanded = active && subs.length > 0
                return (
                  <div key={id} className="mb-0.5">
                    <button
                      type="button"
                      onClick={() => enterSection(id)}
                      aria-expanded={expanded}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm",
                        "transition-[background-color,color,transform] duration-150",
                        "active:scale-[0.96]",
                        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        active
                          ? "bg-accent font-medium text-accent-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0 opacity-90" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-left">
                        {label}
                      </span>
                      {subs.length > 0 && (
                        <ChevronDownIcon
                          className={cn(
                            "size-3.5 shrink-0 opacity-60 transition-transform duration-200",
                            expanded && "rotate-180",
                          )}
                          aria-hidden
                        />
                      )}
                    </button>

                    {/* 子菜单：进入主菜单后展开，点击跳转右侧锚点 */}
                    <div
                      className={cn(
                        "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                        expanded
                          ? "grid-rows-[1fr] opacity-100"
                          : "grid-rows-[0fr] opacity-0",
                      )}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <ul
                          className="mt-0.5 mb-1 ml-3 space-y-0.5 border-l border-border/70 pl-2"
                          role="list"
                        >
                          {subs.map((sub) => {
                            const subActive = active && activeAnchor === sub.id
                            return (
                              <li key={sub.id}>
                                <button
                                  type="button"
                                  onClick={() => onSubmenuClick(id, sub)}
                                  className={cn(
                                    "flex w-full cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-left text-[13px]",
                                    "transition-[background-color,color,transform] duration-150",
                                    "active:scale-[0.98]",
                                    "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                                    subActive
                                      ? "bg-primary/10 font-medium text-foreground"
                                      : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                                  )}
                                >
                                  <span className="truncate">{sub.label}</span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="relative flex min-w-0 flex-1 flex-col bg-background">
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0 pl-1">
              {currentToc.length > 0 && activeAnchor && (
                <p className="truncate text-xs text-muted-foreground">
                  <span className="text-foreground/80">
                    {NAV.flatMap((g) => g.items).find((i) => i.id === section)
                      ?.label ?? ""}
                  </span>
                  <span className="mx-1.5 opacity-40">/</span>
                  <span>
                    {currentToc.find((t) => t.id === activeAnchor)?.label ?? ""}
                  </span>
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={requestClose}
                aria-label="关闭设置"
                className={cn(
                  "flex size-9 cursor-pointer items-center justify-center rounded-full",
                  "border border-border/80 bg-secondary/60 text-muted-foreground",
                  "transition-[background-color,color,transform] duration-150",
                  "hover:bg-muted hover:text-foreground active:scale-[0.96]",
                  "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                )}
              >
                <XIcon className="size-4" />
              </button>
              <span className="w-7 select-none text-center text-[10px] font-semibold tracking-wide text-muted-foreground tabular-nums">
                ESC
              </span>
            </div>
          </div>

          <div
            ref={contentScrollRef}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <div
              key={section}
              className="settings-section-enter mx-auto max-w-2xl px-6 py-6 sm:px-8 sm:py-8"
            >
              <SectionContent section={section} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
