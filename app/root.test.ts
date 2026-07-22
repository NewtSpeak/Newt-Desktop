import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, test } from "node:test"

const source = readFileSync(new URL("./root.tsx", import.meta.url), "utf8")

describe("根路由加载状态", () => {
  test("导出 HydrateFallback 避免客户端模块加载期间出现空白页", () => {
    assert.match(source, /export function HydrateFallback\(\)/)
    assert.match(source, /正在加载 OwlSpeak/)
  })
})
