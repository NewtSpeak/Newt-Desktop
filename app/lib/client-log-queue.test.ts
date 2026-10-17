import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import {
  createClientLogQueue,
  MAX_LOCATION_CHARS,
  MAX_MESSAGE_CHARS,
  MAX_QUEUE,
  type ClientLogEntry,
} from "./client-log-queue.ts"

function harness(
  send?: (entries: ClientLogEntry[], flush: boolean) => Promise<unknown>
) {
  const batches: { entries: ClientLogEntry[]; flush: boolean }[] = []
  const timers = new Set<() => void>()
  const queue = createClientLogQueue({
    send: async (entries, flush) => {
      batches.push({ entries: structuredClone(entries), flush })
      await send?.(entries, flush)
    },
    schedule: (callback) => {
      timers.add(callback)
      return () => {
        timers.delete(callback)
      }
    },
  })
  function push(count: number, prefix = "message") {
    for (let i = 0; i < count; i++)
      queue.push({ level: "info", message: `${prefix} ${i}` })
  }
  return { queue, batches, timers, push }
}

test("normal flush sends one IPC per batch and preserves order", async () => {
  const { queue, batches, push } = harness()
  push(200)
  await queue.flush()
  await queue.flush()
  await queue.flush()
  assert.deepEqual(
    batches.map(({ entries }) => entries.length),
    [80, 80, 40]
  )
  assert.deepEqual(
    batches.flatMap(({ entries }) => entries.map(({ message }) => message)),
    Array.from({ length: 200 }, (_, i) => `message ${i}`)
  )
})

test("lifecycle flush submits all 200 pending entries in one request", async () => {
  const { queue, batches, timers, push } = harness()
  push(200)
  await queue.flush(true)
  assert.equal(batches.length, 1)
  assert.equal(batches[0].entries.length, 200)
  assert.equal(batches[0].flush, true)
  assert.equal(timers.size, 0)
})

test("scheduled work coalesces and does not emit empty batches", async () => {
  const { queue, batches, timers, push } = harness()
  push(20)
  assert.equal(timers.size, 1)
  const callback = [...timers][0]
  timers.delete(callback)
  callback()
  await Promise.resolve()
  await Promise.resolve()
  await queue.flush()
  assert.equal(batches.length, 1)
  assert.equal(batches[0].entries.length, 20)
})

test("queue capacity includes in-flight entries and lifecycle flush bypasses the batch wait", async () => {
  let resolve!: () => void
  const blocked = new Promise<void>((done) => {
    resolve = done
  })
  const { queue, batches, push } = harness(() => blocked)
  push(80)
  const first = queue.flush()
  push(321, "later")
  await queue.flush()
  assert.equal(batches.length, 1)
  const last = queue.flush(true)
  assert.equal(batches.length, 2)
  assert.equal(batches[1].entries.length, 321)
  assert.match(batches[1].entries.at(-1)!.message, /已丢弃 1 条/)
  resolve()
  await Promise.all([first, last])
})

test("failed IPC retains entries and overflow counts without a retry loop", async () => {
  let fail = true
  const { queue, batches, timers, push } = harness(async () => {
    if (fail) throw new Error("IPC unavailable")
  })
  push(405)
  assert.equal(await queue.flush(true), false)
  assert.equal(timers.size, 0)
  fail = false
  assert.equal(await queue.flush(true), true)
  assert.deepEqual(batches[1], batches[0])
  assert.equal(batches[1].entries.length, 401)
  assert.match(batches[1].entries.at(-1)!.message, /已丢弃 5 条/)
  await queue.flush(true)
  assert.equal(batches.length, 2)
})

test("duplicate counts remain attached to their original entry and location", async () => {
  const { queue, batches } = harness()
  const entry = {
    level: "error" as const,
    message: "failed",
    location: "app/a.ts:1:1",
  }
  queue.push(entry)
  queue.push(entry)
  queue.push(entry)
  queue.push({ ...entry, location: "app/b.ts:1:1" })
  queue.push({ level: "info", message: "next" })
  await queue.flush(true)
  assert.equal(batches[0].entries.length, 3)
  assert.equal(batches[0].entries[0].repeats, 2)
  assert.equal(batches[0].entries[1].repeats, undefined)
  assert.equal(batches[0].entries[2].repeats, undefined)
})

test("concurrent failed lifecycle requests retain chronological order on retry", async () => {
  const rejectors: ((reason: Error) => void)[] = []
  let fail = true
  const { queue, batches, push } = harness(() =>
    fail
      ? new Promise<void>((_resolve, reject) => {
          rejectors.push(reject)
        })
      : Promise.resolve()
  )
  push(80, "first")
  const first = queue.flush()
  push(80, "second")
  const second = queue.flush(true)
  rejectors[0](new Error("first failed"))
  assert.equal(await first, false)
  rejectors[1](new Error("second failed"))
  assert.equal(await second, false)
  fail = false
  await queue.flush(true)
  assert.deepEqual(
    batches[2].entries.map(({ message }) => message),
    [
      ...Array.from({ length: 80 }, (_, i) => `first ${i}`),
      ...Array.from({ length: 80 }, (_, i) => `second ${i}`),
    ]
  )
})

test("truncation and lone surrogates always produce well-formed text", async () => {
  const { queue, batches } = harness()
  queue.push({
    level: "info",
    message: `${"a".repeat(MAX_MESSAGE_CHARS - 1)}😀tail`,
  })
  queue.push({ level: "info", message: "lone \uD83D end \uDE00" })
  await queue.flush(true)
  const [cut, lone] = batches[0].entries
  assert.equal(
    cut.message,
    `${"a".repeat(MAX_MESSAGE_CHARS - 1)}\uFFFD…[truncated]`
  )
  assert.equal(lone.message, "lone \uFFFD end \uFFFD")
  // serde_json 拒收 JSON 里的孤立代理转义
  assert.doesNotMatch(JSON.stringify(batches[0].entries), /\\ud[89a-f]/i)
})

test("a batch the backend keeps rejecting is dropped instead of blocking the queue", async () => {
  let fail = true
  const { queue, batches, push } = harness(async () => {
    if (fail) throw new Error("invalid args")
  })
  push(3, "poisoned")
  for (let i = 0; i < 3; i++) assert.equal(await queue.flush(true), false)
  fail = false
  push(1, "fresh")
  assert.equal(await queue.flush(true), true)
  assert.equal(batches.length, 4)
  assert.deepEqual(
    batches[3].entries.map(({ message }) => message),
    ["fresh 0", "[client-log] 已丢弃 3 条日志（队列溢出或多次发送失败）"]
  )
})

test("a full lifecycle batch fits the Rust validator limits", async () => {
  const rust = readFileSync(
    new URL("../../src-tauri/src/client_log.rs", import.meta.url),
    "utf8"
  )
  const limit = (name: string) =>
    Number(rust.match(new RegExp(`const ${name}: usize = (\\d+);`))?.[1])
  const { queue, batches } = harness()
  for (let i = 0; i < MAX_QUEUE + 10; i++)
    queue.push({
      level: "info",
      message: `${i} `.padEnd(10_000, "x"),
      location: "y".repeat(10_000),
    })
  await queue.flush(true)
  const { entries } = batches[0]
  assert.equal(entries.length, MAX_QUEUE + 1)
  assert.ok(entries.length <= limit("MAX_BATCH_ENTRIES"))
  assert.ok(
    entries.every(
      ({ message, location = "" }) =>
        [...message].length <= limit("MAX_MESSAGE_CHARS") &&
        [...location].length <= limit("MAX_LOCATION_CHARS")
    )
  )
  assert.equal(entries[0].location?.length, MAX_LOCATION_CHARS)
})
