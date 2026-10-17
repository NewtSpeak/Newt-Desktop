import { invoke } from "@tauri-apps/api/core"

import {
  createClientLogQueue,
  type ClientLogEntry,
} from "~/lib/client-log-queue"
import { isTauriRuntime } from "~/lib/platform"

type Level = ClientLogEntry["level"]

const DISABLED_KEY = "owl.log.disabled"
const LEVELS: Level[] = ["debug", "info", "warn", "error"]
let installed = false

function enabled(level: Level, min: Level) {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(min)
}

function formatArg(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return String(value)
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`
  }
  try {
    const seen = new WeakSet<object>()
    const text = JSON.stringify(value, (_key, item) => {
      if (typeof item === "object" && item !== null) {
        if (seen.has(item as object)) return "[Circular]"
        seen.add(item as object)
      }
      return item
    })
    return text ?? Object.prototype.toString.call(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

function formatArgs(args: unknown[]): string {
  return args.map((arg) => formatArg(arg)).join(" ")
}

/** 仅开发模式记录调用位置：正式版模块已合并压缩，跳不过本文件的帧，行列号也没有参考价值 */
function callerLocation(): string | undefined {
  if (!import.meta.env.DEV) return undefined
  const stack = new Error().stack
  if (!stack) return undefined
  for (const line of stack.split("\n").slice(1)) {
    if (line.includes("client-log")) continue
    const local = line.match(/((?:app|src)\/[^\s)]+:\d+:\d+)/)
    if (local) return local[1]
    const remote = line.match(/((?:https?|tauri|asset):\/\/[^\s)]+:\d+:\d+)/)
    if (remote) return remote[1]
  }
  return undefined
}

export function initClientLog() {
  if (installed || typeof window === "undefined") return
  if (!isTauriRuntime()) return
  try {
    if (localStorage.getItem(DISABLED_KEY) === "1") return
  } catch {}

  installed = true
  // 生效级别以 Rust 端为准（NEWT_LOG，正式版默认 info）；null = 未启用日志。
  // 先接管 console 再异步查询，首屏渲染期间的报错也不会漏掉。
  let minLevel: Level | null | undefined
  const ready = invoke<Level | null>("client_log_level").catch(() => null)
  const queue = createClientLogQueue({
    send: async (entries, flush) => {
      const level = await ready
      if (!level) return
      const accepted = entries.filter((entry) => enabled(entry.level, level))
      if (accepted.length > 0)
        await invoke("client_log_batch", { entries: accepted, flush })
    },
  })
  const push = (level: Level, args: unknown[]) => {
    if (minLevel === null || (minLevel && !enabled(level, minLevel))) return
    try {
      queue.push({
        level,
        message: formatArgs(args),
        location: callerLocation(),
      })
    } catch {}
  }

  const original = {
    debug: console.debug,
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  }
  const patch = (level: Level, key: keyof typeof original) => {
    const wrapper = (...args: unknown[]) => {
      push(level, args)
      original[key].apply(console, args)
    }
    console[key] = wrapper
    // 只还原仍是自己的包装，避免覆盖之后其他库的接管
    return () => {
      if (console[key] === wrapper) console[key] = original[key]
    }
  }
  const restore = [
    patch("debug", "debug"),
    patch("info", "log"),
    patch("info", "info"),
    patch("warn", "warn"),
    patch("error", "error"),
  ]
  void ready.then((level) => {
    minLevel = level
    if (!level) restore.forEach((undo) => undo())
  })

  window.addEventListener("error", (event) => {
    push("error", [
      `未捕获错误: ${event.message}`,
      `${event.filename}:${event.lineno}:${event.colno}`,
      event.error instanceof Error ? event.error : "",
    ])
    void queue.flush(true)
  })
  window.addEventListener("unhandledrejection", (event) => {
    push("error", ["未处理的 Promise 拒绝", event.reason])
    void queue.flush(true)
  })
  window.addEventListener("pagehide", () => {
    void queue.flush(true)
  })
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void queue.flush(true)
  })

  push("info", [`[client-log] 已启用本地日志（${navigator.userAgent}）`])
}
