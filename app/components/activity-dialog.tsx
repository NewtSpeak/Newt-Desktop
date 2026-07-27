// 手动活动设置（Server-18）：正在玩 / 听 / 看 + 自动解析封面 + 自动检测开关

import { useEffect, useRef, useState } from "react"
import { Loader2Icon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { Switch } from "~/components/ui/switch"
import {
  afterCustomGamesChanged,
  refreshActivityDetection,
} from "~/lib/activity/auto-detect"
import { resolveActivityCover, resolveGameCover } from "~/lib/activity/covers"
import {
  listCustomGames,
  removeCustomGame,
  upsertCustomGame,
} from "~/lib/activity/custom-games"
import { getForegroundApp } from "~/lib/activity/native"
import type { ActivityType } from "~/lib/gateway/events"
import { isTauriRuntime } from "~/lib/secure-storage"
import {
  clearManualActivity,
  formatPrimaryActivity,
  resumeActivityAutoDetect,
  setManualActivity,
  usePresenceStore,
} from "~/stores/presence"
import { useSettingsStore } from "~/stores/settings"

const TYPE_OPTIONS: { value: ActivityType; label: string }[] = [
  { value: "playing", label: "正在玩" },
  { value: "listening", label: "正在听" },
  { value: "watching", label: "正在看" },
  { value: "streaming", label: "正在直播" },
  { value: "competing", label: "竞技中" },
]

export function ActivityDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const storedType = useSettingsStore((s) => s.presence.activityType)
  const storedName = useSettingsStore((s) => s.presence.activityName)
  const storedDetails = useSettingsStore((s) => s.presence.activityDetails)
  const storedCover = useSettingsStore((s) => s.presence.activityCoverUrl)
  const storedEnabled = useSettingsStore((s) => s.presence.activityEnabled)
  const detectGames = useSettingsStore((s) => s.presence.detectGames)
  const detectMedia = useSettingsStore((s) => s.presence.detectMedia)
  const manualOverride = useSettingsStore((s) => s.presence.activityManualOverride)
  const detected = usePresenceStore((s) => s.detectedActivities)
  const isDesktop = isTauriRuntime()

  const [type, setType] = useState<ActivityType>("playing")
  const [name, setName] = useState("")
  const [details, setDetails] = useState("")
  const [coverUrl, setCoverUrl] = useState("")
  const [resolving, setResolving] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [customList, setCustomList] = useState(() => listCustomGames())
  const resolveSeq = useRef(0)

  useEffect(() => {
    if (!open) return
    setType((storedType as ActivityType) || "playing")
    setName(storedName ?? "")
    setDetails(storedDetails ?? "")
    setCoverUrl(storedCover ?? "")
    setCustomList(listCustomGames())
  }, [open, storedType, storedName, storedDetails, storedCover])

  // 名称/类型变化时自动尝试解析封面（防抖）
  useEffect(() => {
    if (!open) return
    const trimmed = name.trim()
    if (!trimmed) {
      setCoverUrl("")
      return
    }
    const seq = ++resolveSeq.current
    const timer = window.setTimeout(() => {
      setResolving(true)
      void resolveActivityCover({
        type,
        name: trimmed,
        details: details.trim() || undefined,
      })
        .then((r) => {
          if (seq !== resolveSeq.current) return
          if (r.cover_url) setCoverUrl(r.cover_url)
        })
        .finally(() => {
          if (seq === resolveSeq.current) setResolving(false)
        })
    }, 450)
    return () => window.clearTimeout(timer)
  }, [open, type, name, details])

  const fetchCoverNow = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.message("请先填写名称")
      return
    }
    const seq = ++resolveSeq.current
    setResolving(true)
    void resolveActivityCover({
      type,
      name: trimmed,
      details: details.trim() || undefined,
    })
      .then((r) => {
        if (seq !== resolveSeq.current) return
        if (r.cover_url) {
          setCoverUrl(r.cover_url)
          toast.success(
            r.source === "itunes"
              ? "已从 iTunes 获取专辑封面"
              : r.source === "catalog"
                ? "已匹配游戏封面"
                : "已获取封面",
          )
        } else {
          toast.message("未找到封面，可手动粘贴图片链接")
        }
      })
      .catch(() => toast.error("封面解析失败"))
      .finally(() => {
        if (seq === resolveSeq.current) setResolving(false)
      })
  }

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      clearManualActivity()
      toast.success("已清除活动状态")
      onOpenChange(false)
      return
    }
    setManualActivity({
      enabled: true,
      type,
      name: trimmed,
      details: details.trim(),
      coverUrl: coverUrl.trim() || "",
      coverText: trimmed,
    })
    toast.success("活动状态已更新")
    onOpenChange(false)
  }

  const clear = () => {
    setName("")
    setDetails("")
    setCoverUrl("")
    clearManualActivity()
    toast.success("已清除活动状态")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>设置活动状态</DialogTitle>
          <DialogDescription>
            可手填活动并自动匹配封面；桌面端还可开启进程/音乐自动检测。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {isDesktop ? (
            <div className="grid gap-2 rounded-xl border bg-muted/20 p-3">
              <p className="text-xs font-medium text-foreground">自动检测</p>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm">自动捕捉焦点游戏</p>
                  <p className="text-[11px] text-muted-foreground">
                    实时跟随当前前台窗口，无需手选；约 1.5 秒刷新并带封面
                  </p>
                </div>
                <Switch
                  checked={detectGames}
                  onCheckedChange={(c) => {
                    useSettingsStore.getState().setPresence({
                      detectGames: Boolean(c),
                    })
                    refreshActivityDetection()
                  }}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm">检测正在播放的音乐</p>
                  <p className="text-[11px] text-muted-foreground">
                    macOS Music/Spotify · Windows 系统媒体会话 · Linux playerctl
                  </p>
                </div>
                <Switch
                  checked={detectMedia}
                  onCheckedChange={(c) => {
                    useSettingsStore.getState().setPresence({
                      detectMedia: Boolean(c),
                    })
                    refreshActivityDetection()
                  }}
                />
              </div>
              {!manualOverride && detected.length > 0 ? (
                <p className="truncate text-[11px] text-muted-foreground">
                  当前检测：{formatPrimaryActivity(detected)}
                </p>
              ) : null}
              {manualOverride ? (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    正在使用手动活动，已暂停自动检测覆盖
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      resumeActivityAutoDetect()
                      refreshActivityDetection()
                      toast.success("已恢复自动检测")
                    }}
                  >
                    恢复自动
                  </Button>
                </div>
              ) : null}
              <div className="border-t border-border/50 pt-2">
                <p className="mb-1.5 text-[11px] text-muted-foreground">
                  开启上方开关后，切到游戏窗口即自动显示「正在玩」。可选：登记本机别名/封面。
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-full text-xs"
                  disabled={registering}
                  onClick={() => {
                    setRegistering(true)
                    void (async () => {
                      try {
                        const fg = await getForegroundApp()
                        if (!fg?.name) {
                          toast.message("未获取到前台应用")
                          return
                        }
                        const display =
                          window.prompt(
                            `将「${fg.display_name || fg.name}」登记为游戏，请输入展示名：`,
                            fg.display_name || fg.name,
                          )?.trim() ?? ""
                        if (!display) return
                        // 尝试匹配已知封面
                        const cover = await resolveGameCover(display)
                        upsertCustomGame({
                          name: display,
                          executable: fg.name,
                          cover_url: cover.cover_url,
                        })
                        setCustomList(listCustomGames())
                        afterCustomGamesChanged()
                        toast.success(
                          cover.cover_url
                            ? `已登记「${display}」并匹配封面`
                            : `已登记「${display}」`,
                        )
                        // 若开启了游戏检测，立刻手填预览方便确认
                        if (!name.trim()) {
                          setType("playing")
                          setName(display)
                          if (cover.cover_url) setCoverUrl(cover.cover_url)
                        }
                      } catch (e) {
                        toast.error(
                          e instanceof Error ? e.message : "登记失败",
                        )
                      } finally {
                        setRegistering(false)
                      }
                    })()
                  }}
                >
                  {registering ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : null}
                  将前台应用登记为游戏
                </Button>
                {customList.length > 0 ? (
                  <ul className="mt-2 max-h-24 space-y-1 overflow-y-auto">
                    {customList.slice(0, 8).map((g) => (
                      <li
                        key={g.id}
                        className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                      >
                        <span className="min-w-0 truncate">
                          {g.name}
                          <span className="opacity-60">
                            {" "}
                            · {g.executables[0]}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-destructive/80 hover:text-destructive"
                          onClick={() => {
                            removeCustomGame(g.id)
                            setCustomList(listCustomGames())
                            afterCustomGamesChanged()
                            toast.success("已移除本地登记")
                          }}
                        >
                          移除
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
              自动检测仅在 Owl Desktop 客户端可用；网页端请手填活动。
            </p>
          )}
          {/* 封面预览 */}
          <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt=""
                className="size-16 shrink-0 rounded-lg object-cover ring-1 ring-border"
                referrerPolicy="no-referrer"
                onError={() => setCoverUrl("")}
              />
            ) : (
              <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-muted text-[11px] text-muted-foreground">
                {resolving ? (
                  <Loader2Icon className="size-5 animate-spin opacity-60" />
                ) : (
                  "封面"
                )}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {name.trim()
                  ? `${TYPE_OPTIONS.find((o) => o.value === type)?.label ?? ""} ${name.trim()}`
                  : "预览"}
              </p>
              {details.trim() ? (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {details.trim()}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {type === "listening"
                    ? "详情填艺人可提高专辑匹配准确度"
                    : "游戏名可匹配内置目录封面"}
                </p>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1 h-7 px-2 text-xs"
                disabled={resolving || !name.trim()}
                onClick={fetchCoverNow}
              >
                {resolving ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCwIcon className="size-3.5" />
                )}
                重新获取封面
              </Button>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="activity-type">类型</Label>
            <Select
              value={type}
              onValueChange={(v) => setType((v as ActivityType) || "playing")}
            >
              <SelectTrigger id="activity-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="activity-name">
              {type === "listening" ? "曲名 / 歌单名" : "名称"}
            </Label>
            <Input
              id="activity-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                type === "listening"
                  ? "例如：夜曲、Blinding Lights"
                  : "例如：原神、ELDEN RING"
              }
              maxLength={128}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="activity-details">
              {type === "listening" ? "艺人（可选）" : "详情（可选）"}
            </Label>
            <Input
              id="activity-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={
                type === "listening"
                  ? "例如：周杰伦"
                  : "例如：探索璃月、单人模式"
              }
              maxLength={128}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="activity-cover">封面链接（可选）</Label>
            <Input
              id="activity-cover"
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://… 自动填充后可手动覆盖"
              maxLength={1024}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {storedEnabled ? (
            <Button type="button" variant="ghost" onClick={clear}>
              清除
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" onClick={save}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
