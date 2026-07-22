import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, test } from "node:test"

const configSource = readFileSync(
  new URL("../../../vite.config.ts", import.meta.url),
  "utf8",
)
const dtlnSource = readFileSync(
  new URL(
    "../../../node_modules/@sapphi-red/dtln-web/dist/index.mjs",
    import.meta.url,
  ),
  "utf8",
)

describe("DTLN 的 Vite 依赖配置", () => {
  test("预构建 DTLN 默认导入的 CommonJS fft.js", () => {
    assert.match(dtlnSource, /import FFT from ["']fft\.js["']/)
    assert.match(configSource, /["']fft\.js["']/)
  })
})
