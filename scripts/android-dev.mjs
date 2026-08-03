#!/usr/bin/env node
/**
 * Android 开发启动：自动选择手机可达的本机局域网 IP，并做 adb reverse。
 *
 * 问题背景：
 * - tauri android dev 会把 devUrl 的 127.0.0.1 替换成「本机某个网卡 IP」
 * - 若机器开了 Clash TUN / 虚拟网卡，常会误选 198.18.0.x，手机完全访问不到 → 白屏
 * - 本脚本优先选 192.168.x / 10.x 等真实局域网地址，并执行 adb reverse 兜底
 *
 * 用法：
 *   node scripts/android-dev.mjs
 *   node scripts/android-dev.mjs --host 192.168.1.28
 * 环境变量：
 *   TAURI_DEV_HOST / ANDROID_DEV_HOST  强制指定 IP
 */
import { networkInterfaces } from "node:os"
import { spawn, execSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function parseCliHost(argv) {
  const i = argv.indexOf("--host")
  if (i >= 0 && argv[i + 1]) return argv[i + 1]
  return null
}

/** 排除：环回、链路本地、Clash fake-ip(198.18/15)、常见 Hyper-V/WSL 虚拟段优先降权 */
function scoreAddress(ifaceName, addr) {
  const name = ifaceName.toLowerCase()
  if (addr.startsWith("127.")) return -100
  if (addr.startsWith("169.254.")) return -100
  // Clash / 某些 TUN 的 fake-ip 段 —— 手机访问不到
  if (/^198\.1[89]\./.test(addr)) return -50
  // Docker / WSL 常见
  if (addr.startsWith("172.17.") || addr.startsWith("172.18.") || addr.startsWith("172.19."))
    return -20
  if (addr.startsWith("172.22.") || addr.startsWith("172.23.")) return -15
  if (/vethernet|hyper-v|docker|wsl|vmware|virtualbox|tun|tap|clash|meta/i.test(name))
    return -10
  // 家庭/公司局域网
  if (addr.startsWith("192.168.")) return 100
  if (addr.startsWith("10.")) return 90
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(addr)) return 70
  return 10
}

function detectLanIp() {
  const nets = networkInterfaces()
  const candidates = []
  for (const [name, list] of Object.entries(nets)) {
    if (!list) continue
    for (const item of list) {
      if (item.family !== "IPv4" && item.family !== 4) continue
      if (item.internal) continue
      const score = scoreAddress(name, item.address)
      candidates.push({ name, address: item.address, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  if (candidates.length === 0) return null
  console.log("[android-dev] 网卡候选（分数越高越优先）:")
  for (const c of candidates.slice(0, 8)) {
    console.log(`  ${c.score.toString().padStart(4)}  ${c.address.padEnd(15)}  ${c.name}`)
  }
  return candidates[0]
}

function adbReverse() {
  try {
    execSync("adb reverse tcp:1420 tcp:1420", { stdio: "inherit" })
    // Server API / Gateway 常用端口，可选
    try {
      execSync("adb reverse tcp:8080 tcp:8080", { stdio: "pipe" })
    } catch {
      // ignore
    }
    console.log("[android-dev] adb reverse: 1420 (and 8080 if available) OK")
  } catch (e) {
    console.warn(
      "[android-dev] adb reverse 失败（未连设备或无 adb）。真机请 USB 调试后重试。",
    )
  }
}

const cliHost = parseCliHost(process.argv.slice(2))
const envHost = process.env.TAURI_DEV_HOST || process.env.ANDROID_DEV_HOST || null
const detected = detectLanIp()
const host = cliHost || envHost || detected?.address || "127.0.0.1"

console.log(`[android-dev] 使用 dev host = ${host}`)
if (host.startsWith("198.18.") || host.startsWith("198.19.")) {
  console.warn(
    "[android-dev] 警告：当前 host 像 Clash TUN fake-ip，手机通常访问不到！",
  )
  console.warn(
    "  请关闭 TUN 或手动指定: bun run dev:android -- --host 192.168.x.x",
  )
}

adbReverse()

process.env.TAURI_DEV_HOST = host
// Vite HMR / 公网可达地址
process.env.VITE_DEV_HOST = host

const tauriArgs = ["tauri", "android", "dev", "--host", host]
// 透传除 --host x 以外的参数
const rest = process.argv.slice(2).filter((a, i, arr) => {
  if (a === "--host") return false
  if (arr[i - 1] === "--host") return false
  return true
})
tauriArgs.push(...rest)

const bin = process.platform === "windows" ? "npx.cmd" : "npx"
const child = spawn(bin, tauriArgs, {
  cwd: root,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "windows",
})

child.on("exit", (code) => process.exit(code ?? 1))
