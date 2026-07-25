#!/usr/bin/env node
/**
 * 确定性 OAuth 页面 e2e（Playwright），不依赖 expect-cli agent。
 * 用法:
 *   EXPECT_BASE_URL=http://127.0.0.1:1420 node scripts/oauth-playwright.mjs
 */
import { createRequire } from "node:module"
import { setTimeout as sleep } from "node:timers/promises"

const BASE = (process.env.EXPECT_BASE_URL || "http://127.0.0.1:1420").replace(
  /\/$/,
  "",
)

async function waitForServer(maxSec = 30) {
  for (let i = 0; i < maxSec; i++) {
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(1500) })
      if (r.status > 0) return
    } catch {
      // retry
    }
    await sleep(1000)
  }
  throw new Error(`Server not reachable: ${BASE}`)
}

async function main() {
  await waitForServer()

  let playwright
  try {
    const require = createRequire(import.meta.url)
    playwright = require("playwright")
  } catch {
    console.error(
      "[oauth-playwright] 请先安装: cd Owl-Desktop && bun add -d playwright && npx playwright install chromium",
    )
    process.exit(1)
  }

  const { chromium } = playwright
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const consoleErrors = []
  page.on("pageerror", (e) => consoleErrors.push(String(e)))
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })

  const fail = async (msg) => {
    await browser.close()
    throw new Error(msg)
  }

  // --- /oauth/device ---
  console.log("[1] /oauth/device form")
  await page.goto(`${BASE}/oauth/device`, { waitUntil: "networkidle" })
  const title = page.getByTestId("oauth-device-title")
  if ((await title.count()) === 0) {
    // fallback text
    const h1 = page.locator("h1")
    const text = await h1.first().textContent()
    if (!text?.includes("授权")) await fail("device page missing title")
  }
  const input = page.getByTestId("oauth-device-code-input")
  if ((await input.count()) === 0) await fail("missing device code input")

  // empty continue
  await page.getByTestId("oauth-device-continue").click()
  await sleep(500)
  if ((await page.locator("body").count()) === 0) await fail("white screen after empty")

  // invalid code
  await input.fill("ZZ99-ZZ99")
  await page.getByTestId("oauth-device-continue").click()
  await sleep(1500)
  // either error phase or still form — must not crash
  const bodyText = await page.locator("body").innerText()
  if (!bodyText || bodyText.length < 5) await fail("blank body after invalid code")

  // --- /oauth/authorize missing params ---
  console.log("[2] /oauth/authorize missing params")
  await page.goto(`${BASE}/oauth/authorize`, { waitUntil: "networkidle" })
  const authTitle = page.getByTestId("oauth-authorize-title")
  if ((await authTitle.count()) === 0) {
    const t = await page.locator("h1").first().textContent()
    if (!t?.includes("授权")) await fail("authorize title missing")
  }
  // should show missing param or login wall or server warning
  const authBody = await page.locator("body").innerText()
  if (!/缺少|登录|服务器|redirect/i.test(authBody)) {
    console.warn("[warn] authorize empty-params body:", authBody.slice(0, 200))
  }

  // --- authorize with full query (likely login wall without session) ---
  console.log("[3] /oauth/authorize with PKCE params")
  const q = new URLSearchParams({
    client_id: "owl-cli",
    redirect_uri: "http://127.0.0.1:9/callback",
    code_challenge: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    code_challenge_method: "S256",
    scope: "openid profile offline_access gapi.full gapi.read platform.admin",
    state: "e2e",
  })
  await page.goto(`${BASE}/oauth/authorize?${q}`, { waitUntil: "networkidle" })
  await sleep(800)
  const body3 = await page.locator("body").innerText()
  const hasLogin = /返回应用登录|请先登录/.test(body3)
  const hasPresets = (await page.getByTestId("oauth-scope-presets").count()) > 0
  if (!hasLogin && !hasPresets && !/缺少|服务器/.test(body3)) {
    await fail(`unexpected authorize state: ${body3.slice(0, 300)}`)
  }

  if (hasPresets) {
    console.log("[4a] scope presets on authorize (logged-in)")
    await page.getByTestId("oauth-preset-minimum").click()
    await sleep(200)
    if (
      (await page.getByTestId("oauth-preset-minimum").getAttribute("data-active")) !==
      "true"
    ) {
      await fail("minimum preset not active")
    }
  } else {
    console.log("[4a] authorize login wall — OK")
  }

  // --- scope demo: always test presets without login ---
  console.log("[4b] /oauth/scope-demo presets")
  await page.goto(`${BASE}/oauth/scope-demo`, { waitUntil: "networkidle" })
  if ((await page.getByTestId("oauth-scope-demo").count()) === 0) {
    await fail("scope demo missing")
  }
  await page.getByTestId("oauth-preset-minimum").click()
  await sleep(200)
  if (
    (await page.getByTestId("oauth-preset-minimum").getAttribute("data-active")) !==
    "true"
  ) {
    await fail("demo minimum not active")
  }
  const plat = page.getByTestId("oauth-scope-platform.admin")
  if ((await plat.count()) > 0 && (await plat.isChecked())) {
    await fail("demo: platform.admin should be off on minimum")
  }
  const valMin = await page.getByTestId("oauth-scope-demo-value").innerText()
  if (!valMin.includes("gapi.read") && !valMin.includes("gapi.full")) {
    await fail(`demo minimum scope unexpected: ${valMin}`)
  }
  if (valMin.includes("platform.")) {
    await fail(`demo minimum must not include platform: ${valMin}`)
  }

  await page.getByTestId("oauth-preset-recommended").click()
  await sleep(200)
  const valRec = await page.getByTestId("oauth-scope-demo-value").innerText()
  if (!valRec.includes("gapi.full")) {
    await fail(`demo recommended missing gapi.full: ${valRec}`)
  }
  if (valRec.includes("platform.")) {
    await fail(`demo recommended must not include platform: ${valRec}`)
  }

  await page.getByTestId("oauth-preset-all").click()
  await sleep(200)
  const valAll = await page.getByTestId("oauth-scope-demo-value").innerText()
  if (!valAll.includes("platform.admin")) {
    await fail(`demo all missing platform.admin: ${valAll}`)
  }

  // empty selection
  for (const id of [
    "openid",
    "profile",
    "offline_access",
    "gapi.full",
    "gapi.read",
    "gapi.guilds.manage",
    "platform.read",
    "platform.admin",
  ]) {
    const box = page.getByTestId(`oauth-scope-${id}`)
    if ((await box.count()) > 0 && (await box.isChecked())) await box.click()
  }
  await sleep(200)
  if ((await page.getByTestId("oauth-scope-empty-error").count()) === 0) {
    await fail("demo: empty selection should show error")
  }

  // filter noisy console (network 401 etc.)
  const hard = consoleErrors.filter(
    (e) =>
      !/Failed to load|401|403|net::|favicon|Download the React DevTools/i.test(e),
  )
  if (hard.length) {
    console.warn("[console errors]", hard.slice(0, 10))
  }

  await browser.close()
  console.log("[oauth-playwright] PASS")
}

main().catch((e) => {
  console.error("[oauth-playwright] FAIL", e)
  process.exit(1)
})
