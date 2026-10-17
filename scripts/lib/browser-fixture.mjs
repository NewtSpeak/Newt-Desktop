import assert from "node:assert/strict"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { build } from "vite"

export async function withBrowserFixture(entry, run) {
  const result = await build({
    configFile: false,
    root: fileURLToPath(new URL("../../", import.meta.url)),
    logLevel: "error",
    resolve: {
      alias: { "~": fileURLToPath(new URL("../../app", import.meta.url)) },
    },
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    build: {
      write: false,
      minify: false,
      rolldownOptions: { output: { codeSplitting: false } },
      lib: {
        entry: fileURLToPath(entry),
        formats: ["es"],
        fileName: "probe",
      },
    },
  })
  const output = Array.isArray(result) ? result[0] : result
  assert("output" in output)
  const bundle = output.output.find(
    (entry) => entry.type === "chunk" && entry.isEntry
  )
  assert(bundle)
  const server = createServer((req, res) => {
    if (req.url === "/probe.js") {
      res.setHeader("Content-Type", "text/javascript")
      res.end(bundle.code)
    } else {
      res.setHeader("Content-Type", "text/html")
      res.end(
        '<!doctype html><html><body><script type="module">window.fixture = await import("/probe.js");</script></body></html>'
      )
    }
  })

  let browser
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHANNEL
        ? { channel: process.env.PLAYWRIGHT_CHANNEL }
        : {}),
    })
    await run(browser, `http://127.0.0.1:${server.address().port}`)
  } finally {
    await browser?.close()
    await new Promise((resolve) => server.close(resolve))
  }
}
