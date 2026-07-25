#!/usr/bin/env node
/**
 * 可选：expect-cli 对抗测试（依赖外部 agent，可能因 agent 空闲超时失败）。
 * 推荐确定性路径：bun run test:oauth-e2e （Playwright）
 *
 * 用法: EXPECT_BASE_URL=http://127.0.0.1:1420 node scripts/oauth-e2e.mjs
 */
import { spawn } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"

const BASE = process.env.EXPECT_BASE_URL || "http://127.0.0.1:1420"
const SKIP_START = process.env.OAUTH_E2E_NO_START === "1"

async function isUp() {
  try {
    const r = await fetch(BASE, { signal: AbortSignal.timeout(2000) })
    return r.ok || r.status === 404 || r.status === 200
  } catch {
    return false
  }
}

let child = null
async function ensureServer() {
  if (await isUp()) {
    console.log(`[oauth-e2e] server already up at ${BASE}`)
    return
  }
  if (SKIP_START) {
    throw new Error(`Server not up at ${BASE} and OAUTH_E2E_NO_START=1`)
  }
  console.log(`[oauth-e2e] starting bun run dev …`)
  child = spawn("bun", ["run", "dev"], {
    cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    stdio: "pipe",
    shell: true,
    env: { ...process.env },
  })
  child.stdout?.on("data", (d) => process.stdout.write(`[dev] ${d}`))
  child.stderr?.on("data", (d) => process.stderr.write(`[dev] ${d}`))
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    if (await isUp()) {
      console.log(`[oauth-e2e] server ready`)
      return
    }
  }
  throw new Error("dev server failed to start within 60s")
}

function runExpect(message) {
  return new Promise((resolve, reject) => {
    const args = ["-m", message, "-y", "--base-url", BASE]
    console.log(`[oauth-e2e] expect-cli ${args.join(" ")}`)
    const p = spawn("expect-cli", args, {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, EXPECT_BASE_URL: BASE },
    })
    p.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`expect-cli exited ${code}`))
    })
    p.on("error", reject)
  })
}

async function main() {
  await ensureServer()

  // 1) 设备码页：表单、空提交、非法码
  await runExpect(
    [
      "Open /oauth/device. Verify the title 授权 CLI / AI and device-code input are visible.",
      "Submit the form empty or with only spaces — should stay on form or show an error, not crash.",
      "Enter nonsense code ZZ99-ZZ99 and click 继续. Expect either network error or invalid code message, not a white screen.",
      "Check there are no unexpected console TypeErrors after these steps.",
    ].join(" "),
  )

  // 2) PKCE 授权页：缺参、带参未登录
  await runExpect(
    [
      "Open /oauth/authorize with no query params. Expect an error about missing redirect_uri or code_challenge, not a blank page.",
      "Then open /oauth/authorize?client_id=owl-cli&redirect_uri=http://127.0.0.1:9/callback&code_challenge=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG&code_challenge_method=S256&scope=openid%20profile%20offline_access%20gapi.full%20platform.admin&state=test.",
      "If not logged in, expect a prompt to 返回应用登录. If logged in, expect scope checklist with presets 最小权限 / 推荐 and checkboxes.",
      "If scope presets are visible, click 最小权限 and verify platform.admin is unchecked if present; click 推荐 and verify gapi.full is checked when requested.",
      "Double-click 允许 rapidly if visible — should not freeze. Check console for errors.",
    ].join(" "),
  )

  console.log("[oauth-e2e] all scenarios finished")
}

main()
  .catch((err) => {
    console.error("[oauth-e2e] FAILED", err)
    process.exitCode = 1
  })
  .finally(() => {
    if (child) {
      child.kill("SIGTERM")
    }
  })
