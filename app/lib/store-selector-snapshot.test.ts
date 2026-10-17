// 守卫：zustand store 选择器不得返回「新建对象/数组」。
//
// zustand v5 的 useStore 直接基于 useSyncExternalStore：每次渲染都会调用选择器，
// 并用 Object.is 比较快照。选择器里写 `?? {}` / `?? []` / `|| []` 这类字面量时，
// 每次返回的都是新引用 → React 认为快照一直在变 → 无限重渲染
// （"The result of getSnapshot should be cached to avoid an infinite loop"，
//  最终 "Maximum update depth exceeded"），整页被路由错误边界接管 = 白屏。
//
// 取不到缓存时请直接返回 undefined，并在组件里用可选链读取，
// 或只订阅单个字段（`s.byUser[id]?.field`，返回原始值）。
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, test } from "node:test"

const APP_DIR = new URL("../", import.meta.url).pathname

/** 选择器体内返回新引用的写法 */
const UNSAFE_SNAPSHOT = /(\?\?|\|\|)\s*(\{\s*\}|\[\s*\])/

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
      out.push(full)
  }
  return out
}

/** 取出 useXStore(...) 里选择器箭头函数体（按括号配平，避免把外层 ?? [] 算进来） */
function selectorBodies(source: string): { line: number; body: string }[] {
  const found: { line: number; body: string }[] = []
  const re = /use[A-Za-z0-9_]*Store\s*\(\s*(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) {
    const start = match.index + match[0].length
    let depth = 0
    let index = start
    for (; index < source.length; index++) {
      const char = source[index]
      if (char === "(") depth++
      else if (char === ")") {
        if (depth === 0) break
        depth--
      }
    }
    found.push({
      line: source.slice(0, match.index).split("\n").length,
      body: source.slice(start, index),
    })
  }
  return found
}

describe("store 选择器快照稳定性", () => {
  test("选择器不返回新建对象/数组字面量", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(APP_DIR)) {
      const source = readFileSync(file, "utf8")
      for (const { line, body } of selectorBodies(source)) {
        if (UNSAFE_SNAPSHOT.test(body)) {
          offenders.push(
            `${relative(APP_DIR, file)}:${line} → ${body.replace(/\s+/g, " ").trim().slice(0, 120)}`,
          )
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `以下选择器每次渲染都会返回新引用，会导致无限重渲染（白屏）：\n${offenders.join("\n")}`,
    )
  })
})
