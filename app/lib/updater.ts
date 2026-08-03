// 桌面端应用内更新（Tauri command 封装）
// 版本源：GitHub Releases；下载经国内镜像加速；预下载后待用户确认或退出时安装。

import { invoke } from "@tauri-apps/api/core"
import { isTauriRuntime } from "~/lib/secure-storage"
import { isMobileAppRuntime } from "~/lib/platform"

export type UpdatePhase =
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error"

export type UpdateStatus = {
  phase: UpdatePhase
  currentVersion: string
  latestVersion?: string | null
  releaseNotes?: string | null
  assetName?: string | null
  downloadUrl?: string | null
  mirrorId?: string | null
  mirrorLabel?: string | null
  bytesDownloaded: number
  bytesTotal?: number | null
  progress: number
  localPath?: string | null
  error?: string | null
  lastCheckedAt?: string | null
  autoCheck: boolean
}

export type UpdateMirror = {
  id: string
  label: string
}

/** 单镜像测速结果（延迟 + 采样带宽 + 通畅度） */
export type MirrorProbeResult = {
  id: string
  label: string
  ok: boolean
  latencyMs?: number | null
  speedBps?: number | null
  quality: number
  qualityLabel: string
  bytesSampled: number
  error?: string | null
  probing: boolean
}

/** 仅桌面 Tauri 支持（不含移动 App / 浏览器） */
export function isDesktopUpdaterSupported(): boolean {
  return isTauriRuntime() && !isMobileAppRuntime()
}

export async function updaterGetStatus(): Promise<UpdateStatus | null> {
  if (!isDesktopUpdaterSupported()) return null
  return invoke<UpdateStatus>("updater_get_status")
}

export async function updaterCheck(): Promise<UpdateStatus | null> {
  if (!isDesktopUpdaterSupported()) return null
  return invoke<UpdateStatus>("updater_check")
}

export async function updaterDownload(): Promise<UpdateStatus | null> {
  if (!isDesktopUpdaterSupported()) return null
  return invoke<UpdateStatus>("updater_download")
}

export async function updaterCheckAndDownload(): Promise<UpdateStatus | null> {
  if (!isDesktopUpdaterSupported()) return null
  return invoke<UpdateStatus>("updater_check_and_download")
}

export async function updaterInstallNow(): Promise<void> {
  if (!isDesktopUpdaterSupported()) {
    throw new Error("当前环境不支持应用内更新")
  }
  await invoke("updater_install_now")
}

/** 关闭应用；若已下载更新则先启动安装再退出 */
export async function updaterQuit(): Promise<void> {
  if (!isDesktopUpdaterSupported()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window")
    await getCurrentWindow().close()
    return
  }
  await invoke("updater_quit")
}

export async function updaterSetAutoCheck(enabled: boolean): Promise<UpdateStatus | null> {
  if (!isDesktopUpdaterSupported()) return null
  return invoke<UpdateStatus>("updater_set_auto_check", { enabled })
}

export async function updaterSetInstallOnQuit(
  enabled: boolean,
): Promise<UpdateStatus | null> {
  if (!isDesktopUpdaterSupported()) return null
  return invoke<UpdateStatus>("updater_set_install_on_quit", { enabled })
}

export async function updaterListMirrors(): Promise<UpdateMirror[]> {
  if (!isDesktopUpdaterSupported()) return []
  return invoke<UpdateMirror[]>("updater_list_mirrors")
}

/** 探测全部镜像的延迟 / 速度 / 通畅度（会逐条推送事件） */
export async function updaterProbeMirrors(): Promise<MirrorProbeResult[]> {
  if (!isDesktopUpdaterSupported()) return []
  return invoke<MirrorProbeResult[]>("updater_probe_mirrors")
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** 带宽：B/s → 可读字符串 */
export function formatSpeed(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps < 0) return "—"
  if (bps < 1024) return `${bps.toFixed(0)} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—"
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

/** 通畅度颜色 class */
export function qualityTone(quality: number, ok: boolean): string {
  if (!ok || quality <= 0) return "text-destructive"
  if (quality >= 85) return "text-emerald-600 dark:text-emerald-400"
  if (quality >= 65) return "text-sky-600 dark:text-sky-400"
  if (quality >= 40) return "text-amber-600 dark:text-amber-400"
  return "text-orange-600 dark:text-orange-400"
}

export function qualityBarClass(quality: number, ok: boolean): string {
  if (!ok || quality <= 0) return "bg-destructive/70"
  if (quality >= 85) return "bg-emerald-500"
  if (quality >= 65) return "bg-sky-500"
  if (quality >= 40) return "bg-amber-500"
  return "bg-orange-500"
}

export function phaseLabel(phase: UpdatePhase): string {
  switch (phase) {
    case "idle":
      return "尚未检查"
    case "checking":
      return "正在检查…"
    case "up_to_date":
      return "已是最新版本"
    case "available":
      return "发现新版本"
    case "downloading":
      return "正在下载…"
    case "ready":
      return "已下载，待安装"
    case "installing":
      return "正在安装…"
    case "error":
      return "更新出错"
    default:
      return phase
  }
}
