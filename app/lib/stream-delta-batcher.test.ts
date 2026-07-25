import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  StreamDeltaBatcher,
  forEachStreamBatch,
  toSeqDeltas,
} from "./stream-delta-batcher"

describe("StreamDeltaBatcher", () => {
  test("enqueue 后在短时内合并 flush", async () => {
    const flushed: Array<Map<string, unknown>> = []
    const batcher = new StreamDeltaBatcher((batches) => {
      flushed.push(batches)
    })

    batcher.enqueue({
      channelId: "c1",
      messageId: "m1",
      seq: 1,
      delta: "A",
    })
    batcher.enqueue({
      channelId: "c1",
      messageId: "m1",
      seq: 2,
      delta: "B",
    })
    batcher.enqueue({
      channelId: "c1",
      messageId: "m2",
      seq: 1,
      delta: "X",
    })

    assert.equal(flushed.length, 0)
    assert.ok(batcher.pendingCount >= 3)

    // 等待 rAF / 32ms 兜底
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(flushed.length, 1)

    const items: Array<{ messageId: string; seqs: number[] }> = []
    forEachStreamBatch(flushed[0] as never, (channelId, messageId, list) => {
      assert.equal(channelId, "c1")
      items.push({
        messageId,
        seqs: toSeqDeltas(list).map((d) => d.seq),
      })
    })
    items.sort((a, b) => a.messageId.localeCompare(b.messageId))
    assert.deepEqual(items, [
      { messageId: "m1", seqs: [1, 2] },
      { messageId: "m2", seqs: [1] },
    ])
  })

  test("flushNow 立即写出并清空", () => {
    let count = 0
    const batcher = new StreamDeltaBatcher(() => {
      count += 1
    })
    batcher.enqueue({
      channelId: "c",
      messageId: "m",
      seq: 1,
      delta: "z",
    })
    batcher.flushNow()
    assert.equal(count, 1)
    assert.equal(batcher.pendingCount, 0)
    batcher.flushNow()
    assert.equal(count, 1)
  })

  test("clear 丢弃未写出队列", async () => {
    let count = 0
    const batcher = new StreamDeltaBatcher(() => {
      count += 1
    })
    batcher.enqueue({
      channelId: "c",
      messageId: "m",
      seq: 1,
      delta: "z",
    })
    batcher.clear()
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(count, 0)
  })
})
