// Tauri 活动检测原生命令封装

import { invoke } from "@tauri-apps/api/core"
import { isTauriRuntime } from "~/lib/secure-storage"

export type RunningApp = {
  name: string
  display_name: string
}

export type ForegroundApp = {
  name: string
  display_name: string
  path: string
  window_title: string
}

export type NowPlaying = {
  title: string
  artist: string
  album: string
  app: string
  playing: boolean
}

export type RpcActivity = {
  name: string
  details: string
  state: string
  large_image: string
  large_text: string
  small_image: string
  small_text: string
  application_id: string
  updated_at: number
}

export async function listRunningApps(): Promise<RunningApp[]> {
  if (!isTauriRuntime()) return []
  try {
    return (await invoke<RunningApp[]>("list_running_apps")) ?? []
  } catch {
    return []
  }
}

export async function getNowPlaying(): Promise<NowPlaying | null> {
  if (!isTauriRuntime()) return null
  try {
    return (await invoke<NowPlaying | null>("get_now_playing")) ?? null
  } catch {
    return null
  }
}

export async function getForegroundApp(): Promise<ForegroundApp | null> {
  if (!isTauriRuntime()) return null
  try {
    return (await invoke<ForegroundApp | null>("get_foreground_app")) ?? null
  } catch {
    return null
  }
}

/** 提取应用图标 base64（无 data: 前缀） */
export async function extractAppIcon(path: string): Promise<string | null> {
  if (!isTauriRuntime() || !path.trim()) return null
  try {
    return (await invoke<string | null>("extract_app_icon", { path })) ?? null
  } catch {
    return null
  }
}

export async function getRpcActivity(): Promise<RpcActivity | null> {
  if (!isTauriRuntime()) return null
  try {
    return (await invoke<RpcActivity | null>("get_rpc_activity")) ?? null
  } catch {
    return null
  }
}
