// 敏感值（refresh token 等）的安全存储封装。
//
// Tauri 桌面：Rust keyring（Keychain / Credential Manager / Secret Service）。
// Tauri 移动端（Android/iOS）：应用私有目录 secure_kv.json（Rust command）。
// 浏览器 dev：回退 localStorage（同名键），仅供开发调试。
// service 名 com.newtspeak.desktop。

import { invoke } from "@tauri-apps/api/core"

/** 是否运行在 Tauri 桌面窗口（同 lib/platform.ts 的判定，但可在非 React 上下文调用） */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

export async function secureGet(key: string): Promise<string | null> {
  if (typeof window === "undefined") return null
  if (!isTauriRuntime()) return localStorage.getItem(key)
  try {
    return (await invoke<string | null>("secure_get", { key })) ?? null
  } catch (error) {
    console.error("secure-storage: 读取失败", key, error)
    return null
  }
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (typeof window === "undefined") return
  if (!isTauriRuntime()) {
    localStorage.setItem(key, value)
    return
  }
  try {
    await invoke("secure_set", { key, value })
  } catch (error) {
    console.error("secure-storage: 写入失败", key, error)
  }
}

export async function secureDelete(key: string): Promise<void> {
  if (typeof window === "undefined") return
  if (!isTauriRuntime()) {
    localStorage.removeItem(key)
    return
  }
  try {
    await invoke("secure_delete", { key })
  } catch (error) {
    console.error("secure-storage: 删除失败", key, error)
  }
}
