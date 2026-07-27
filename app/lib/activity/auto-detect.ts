// 活动自动检测聚合器（Server-18）：
//   - 游戏：优先「用户焦点窗口」实时捕获（无需手选）→ 目录封面 / 图标上传
//   - Discord RPC：游戏经 IPC 上报的详情优先
//   - 音乐：Now Playing + iTunes 封面
//   - 手动覆盖时不写检测结果

import { uploadActivityCover } from "~/lib/api/activity"
import {
  isIgnoredExecutable,
  matchGameByExecutable,
  matchGameInCatalog,
  type GameCatalogEntry,
} from "~/lib/activity/game-catalog"
import {
  invalidateGameCatalogCache,
  loadGameCatalog,
  resolveMusicCover,
} from "~/lib/activity/covers"
import {
  extractAppIcon,
  getForegroundApp,
  getNowPlaying,
  getRpcActivity,
  type ForegroundApp,
  type NowPlaying,
  type RpcActivity,
} from "~/lib/activity/native"
import type { PresenceActivity } from "~/lib/gateway/events"
import { isTauriRuntime } from "~/lib/secure-storage"
import {
  applyDetectedActivities,
  reportSelfPresence,
} from "~/stores/presence"
import { useSettingsStore } from "~/stores/settings"

/** 焦点游戏轮询：实时感（约 1.5s） */
const FOCUS_INTERVAL_MS = 1_500
/** 仅音乐时的间隔 */
const MEDIA_ONLY_INTERVAL_MS = 5_000
const CLEAR_DEBOUNCE_MS = 3_000
/** RPC 活动过期（游戏退出未 CLEAR） */
const RPC_STALE_MS = 120_000

let started = false
let timer: ReturnType<typeof setInterval> | null = null
let lastSignature = ""
let stickyGame: PresenceActivity | null = null
let stickyExec = ""
let gameMissingSince: number | null = null
let catalogCache: GameCatalogEntry[] = []
let mediaCoverCache = new Map<string, string>()
/** executable → 已上传封面相对 URL */
const iconCoverCache = new Map<string, string>()
/** 正在上传的 exec，防并发 */
const iconUploading = new Set<string>()

function signatureOf(acts: PresenceActivity[]): string {
  return acts
    .map(
      (a) =>
        `${a.type}|${a.name}|${a.details ?? ""}|${a.state ?? ""}|${a.assets?.large_image ?? ""}|${a.source}`,
    )
    .join(";;")
}

function prettyProcessName(raw: string): string {
  let s = raw.trim()
  s = s.replace(/\.exe$/i, "").replace(/\.app$/i, "")
  // Unreal shipping 后缀
  s = s.replace(/-win64-shipping$/i, "").replace(/_dx11$/i, "")
  if (!s) return "Game"
  // 简单标题化
  return s
    .replace(/[_\-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

async function ensureCatalog() {
  if (!catalogCache.length) {
    catalogCache = await loadGameCatalog()
  }
}

async function resolveIconCover(
  execKey: string,
  path: string,
): Promise<string | undefined> {
  if (!path) return undefined
  const cached = iconCoverCache.get(execKey)
  if (cached) return cached
  if (iconUploading.has(execKey)) return undefined
  iconUploading.add(execKey)
  try {
    const b64 = await extractAppIcon(path)
    if (!b64) return undefined
    const url = await uploadActivityCover(b64, `${execKey}.png`)
    if (url) {
      iconCoverCache.set(execKey, url)
      return url
    }
  } finally {
    iconUploading.delete(execKey)
  }
  return undefined
}

/** Discord RPC 优先 */
function activityFromRpc(rpc: RpcActivity): PresenceActivity | null {
  if (!rpc.name?.trim() && !rpc.details?.trim()) return null
  if (rpc.updated_at && Date.now() - rpc.updated_at > RPC_STALE_MS) return null
  const name = rpc.name?.trim() || "Game"
  // Discord large_image 多为 asset key，非 URL；有 http 才用
  const large = rpc.large_image?.trim() ?? ""
  const cover =
    large.startsWith("http://") ||
    large.startsWith("https://") ||
    large.startsWith("/public-assets/")
      ? large
      : undefined
  return {
    type: "playing",
    name,
    details: rpc.details?.trim() || undefined,
    state: rpc.state?.trim() || undefined,
    source: "rpc",
    application_id: rpc.application_id || undefined,
    assets: cover
      ? {
          large_image: cover,
          large_text: rpc.large_text || name,
          small_image: rpc.small_image || undefined,
          small_text: rpc.small_text || undefined,
        }
      : rpc.large_text
        ? { large_text: rpc.large_text }
        : undefined,
    timestamps: { start: rpc.updated_at || Date.now() },
  }
}

/**
 * 焦点游戏：用户当前前台窗口所属进程。
 * - 黑名单（浏览器/IDE 等）→ 忽略
 * - 目录命中 → 标准名 + 目录封面
 * - 未命中 → 仍显示为「正在玩 {展示名}」，并异步提取图标上传
 */
async function detectFocusedGame(): Promise<{
  activity: PresenceActivity
  execKey: string
} | null> {
  const fg: ForegroundApp | null = await getForegroundApp()
  if (!fg?.name) return null
  if (isIgnoredExecutable(fg.name)) return null

  await ensureCatalog()
  const hit =
    matchGameByExecutable(fg.name, catalogCache) ||
    matchGameInCatalog(fg.display_name, catalogCache) ||
    (fg.window_title
      ? matchGameInCatalog(fg.window_title, catalogCache)
      : null)

  const execKey = fg.name.toLowerCase()
  const start =
    stickyExec === execKey && stickyGame?.timestamps?.start
      ? stickyGame.timestamps.start
      : Date.now()

  if (hit) {
    if (!hit.cover_url && fg.path) {
      void resolveIconCover(execKey, fg.path).then((url) => {
        if (url && stickyExec === execKey) refreshActivityDetection()
      })
    }
    const iconCover = iconCoverCache.get(execKey)
    return {
      execKey,
      activity: {
        type: "playing",
        name: hit.name,
        source: "detected",
        assets:
          hit.cover_url || iconCover
            ? {
                large_image: hit.cover_url || iconCover,
                large_text: hit.name,
              }
            : undefined,
        timestamps: { start },
      },
    }
  }

  // 未知应用：仍自动显示「正在玩」，无需用户登记
  const display = prettyProcessName(fg.display_name || fg.name)
  if (fg.path) {
    void resolveIconCover(execKey, fg.path).then((url) => {
      if (url && stickyExec === execKey) refreshActivityDetection()
    })
  }
  const iconCover = iconCoverCache.get(execKey)
  return {
    execKey,
    activity: {
      type: "playing",
      name: display,
      details: fg.window_title?.trim() || undefined,
      source: "detected",
      assets: iconCover
        ? { large_image: iconCover, large_text: display }
        : undefined,
      timestamps: { start },
    },
  }
}

async function detectMusic(): Promise<PresenceActivity | null> {
  const np: NowPlaying | null = await getNowPlaying()
  if (!np || !np.playing) return null
  const title = np.title.trim()
  if (!title) return null
  const artist = np.artist.trim()
  const cacheKey = `${title}\0${artist}`
  let cover = mediaCoverCache.get(cacheKey)
  if (cover === undefined) {
    const resolved = await resolveMusicCover(title, artist || undefined)
    cover = resolved.cover_url ?? ""
    mediaCoverCache.set(cacheKey, cover)
    if (mediaCoverCache.size > 40) {
      const keys = [...mediaCoverCache.keys()].slice(0, 20)
      for (const k of keys) mediaCoverCache.delete(k)
    }
  }
  return {
    type: "listening",
    name: title,
    details: artist || undefined,
    state: np.album?.trim() || undefined,
    source: "media",
    assets: cover
      ? { large_image: cover, large_text: title }
      : undefined,
    timestamps: { start: Date.now() },
  }
}

async function tick() {
  const settings = useSettingsStore.getState().presence
  if (settings.activityManualOverride) return

  if (!settings.detectGames && !settings.detectMedia) {
    if (lastSignature) {
      lastSignature = ""
      stickyGame = null
      stickyExec = ""
      gameMissingSince = null
      applyDetectedActivities([])
      reportSelfPresence({ includeActivities: true })
    }
    return
  }

  const acts: PresenceActivity[] = []

  // 1) Discord RPC 优先（有详情时）
  if (settings.detectGames) {
    try {
      const rpc = await getRpcActivity()
      if (rpc) {
        const fromRpc = activityFromRpc(rpc)
        if (fromRpc) {
          stickyGame = fromRpc
          stickyExec = `rpc:${rpc.application_id || rpc.name}`
          gameMissingSince = null
          acts.push(fromRpc)
        }
      }
    } catch {
      // ignore
    }
  }

  // 2) 焦点游戏（无 RPC 时）
  if (settings.detectGames && !acts.some((a) => a.source === "rpc")) {
    let detected: { activity: PresenceActivity; execKey: string } | null = null
    try {
      detected = await detectFocusedGame()
    } catch {
      detected = null
    }
    if (detected) {
      stickyGame = detected.activity
      stickyExec = detected.execKey
      gameMissingSince = null
      acts.push(detected.activity)
    } else if (stickyGame) {
      if (gameMissingSince == null) gameMissingSince = Date.now()
      if (Date.now() - gameMissingSince < CLEAR_DEBOUNCE_MS) {
        acts.push(stickyGame)
      } else {
        stickyGame = null
        stickyExec = ""
        gameMissingSince = null
      }
    }
  } else if (!settings.detectGames) {
    stickyGame = null
    stickyExec = ""
    gameMissingSince = null
  }

  if (settings.detectMedia) {
    try {
      const music = await detectMusic()
      if (music) acts.push(music)
    } catch {
      // ignore
    }
  }

  acts.sort((a, b) => {
    const rank = (t: string, s: string) => {
      if (s === "rpc") return 6
      if (t === "playing") return 5
      if (t === "listening") return 3
      return 0
    }
    return rank(b.type, b.source) - rank(a.type, a.source)
  })

  const sig = signatureOf(acts)
  if (sig === lastSignature) return
  lastSignature = sig
  applyDetectedActivities(acts)
  reportSelfPresence({ includeActivities: true })
}

function intervalMs(): number {
  const p = useSettingsStore.getState().presence
  if (p.detectGames) return FOCUS_INTERVAL_MS
  if (p.detectMedia) return MEDIA_ONLY_INTERVAL_MS
  const sec = p.detectIntervalSec
  if (typeof sec === "number" && sec >= 5 && sec <= 30) return sec * 1000
  return MEDIA_ONLY_INTERVAL_MS
}

export function initActivityAutoDetect() {
  if (started || typeof window === "undefined") return
  if (!isTauriRuntime()) return
  started = true

  const schedule = () => {
    if (timer) clearInterval(timer)
    timer = setInterval(() => {
      void tick()
    }, intervalMs())
    void tick()
  }

  schedule()
  useSettingsStore.subscribe((state, prev) => {
    const a = state.presence
    const b = prev.presence
    if (
      a.detectGames !== b.detectGames ||
      a.detectMedia !== b.detectMedia ||
      a.detectIntervalSec !== b.detectIntervalSec ||
      a.activityManualOverride !== b.activityManualOverride
    ) {
      lastSignature = ""
      schedule()
    }
  })
}

export function refreshActivityDetection() {
  lastSignature = ""
  void tick()
}

export function afterCustomGamesChanged() {
  catalogCache = []
  invalidateGameCatalogCache()
  refreshActivityDetection()
}
