import assert from "node:assert/strict"
import { withBrowserFixture } from "./lib/browser-fixture.mjs"

// client_log_level 的模拟返回值：logging-off = NEWT_LOG=off，info-level = 正式版默认
const LEVELS = { "logging-off": null, "info-level": "info" }

await withBrowserFixture(
  new URL("../app/lib/client-log.ts", import.meta.url),
  async (browser, baseUrl) => {
    for (const scenario of [
      "browser",
      "disabled",
      "logging-off",
      "info-level",
      "batch",
      "pagehide",
      "errors",
      "failed-ipc",
    ]) {
      const page = await browser.newPage()
      await page.goto(baseUrl)
      await page.waitForFunction(
        () => typeof window.fixture?.initClientLog === "function"
      )
      const level = scenario in LEVELS ? LEVELS[scenario] : "debug"
      const result = await page.evaluate(
        async ({ scenario, level }) => {
          const batches = []
          const original = console.info
          if (scenario !== "browser") {
            window.__TAURI_INTERNALS__ = {
              invoke: async (command, args) => {
                if (command === "client_log_level") return level
                batches.push({ command, ...structuredClone(args) })
                if (scenario === "failed-ipc") throw new Error("unavailable")
              },
            }
          }
          if (scenario === "disabled")
            localStorage.setItem("owl.log.disabled", "1")
          window.fixture.initClientLog()
          window.fixture.initClientLog()
          const circular = { name: "circular" }
          circular.self = circular
          if (scenario === "info-level") {
            // 级别查询返回前后各打一条 debug：前者在发送时过滤，后者在 push 时过滤
            console.debug("hidden before ready")
            await new Promise((resolve) => setTimeout(resolve, 0))
            console.debug("hidden after ready")
            console.info("visible")
          } else if (scenario === "errors") {
            window.dispatchEvent(
              new ErrorEvent("error", {
                message: "uncaught",
                error: new Error("boom"),
                filename: "app/example.ts",
                lineno: 1,
                colno: 2,
              })
            )
            window.dispatchEvent(
              new PromiseRejectionEvent("unhandledrejection", {
                promise: Promise.resolve(),
                reason: new Error("rejected"),
              })
            )
          } else {
            for (let i = 0; i < 200; i++) console.info("message", i)
            console.info(circular)
            console.info("x".repeat(10000))
          }
          if (scenario !== "batch") window.dispatchEvent(new Event("pagehide"))
          await new Promise((resolve) => setTimeout(resolve, 1100))
          return { batches, patched: console.info !== original }
        },
        { scenario, level }
      )
      if (["browser", "disabled", "logging-off"].includes(scenario)) {
        assert.equal(result.patched, false)
        assert.equal(result.batches.length, 0)
      } else {
        assert(
          result.batches.every(({ command }) => command === "client_log_batch")
        )
        const entries = result.batches.flatMap(({ entries }) => entries)
        assert.equal(
          entries.filter(({ message }) =>
            message.startsWith("[client-log] 已启用")
          ).length,
          1,
          "重复初始化不能重复安装"
        )
        if (scenario === "info-level") {
          assert.deepEqual(
            entries.map(({ level }) => level),
            ["info", "info"],
            "info 级别下 debug 不应转发"
          )
          assert(entries.some(({ message }) => message === "visible"))
        } else if (scenario === "errors") {
          assert(
            entries.some(
              ({ level, message }) =>
                level === "error" && message.includes("boom")
            )
          )
          assert(
            entries.some(
              ({ level, message }) =>
                level === "error" && message.includes("rejected")
            )
          )
          assert(result.batches.every(({ flush }) => flush))
        } else {
          assert.equal(entries.length, 203)
          assert(entries.some(({ message }) => message.includes("[Circular]")))
          assert(
            entries.some(({ message }) => message.endsWith("…[truncated]"))
          )
          assert(entries.every(({ message }) => message.length <= 4096))
          assert.equal(result.batches.length, scenario === "batch" ? 3 : 1)
          if (scenario === "pagehide")
            assert.equal(result.batches[0].flush, true)
        }
      }
      await page.close()
      console.log(`PASS client log: ${scenario}`)
    }
  }
)
