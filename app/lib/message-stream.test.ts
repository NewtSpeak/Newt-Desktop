import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  applyStreamDelta,
  applyStreamDeltasBatch,
  flushStreamDeltas,
  mergeReconciledStreamMessage,
  shouldReconcileStreamGap,
  streamActivityAt,
  streamGapSpan,
  streamIdleLevel,
  STREAM_GAP_RECONCILE_THRESHOLD,
  STREAM_SLOW_IDLE_MS,
  STREAM_STALE_IDLE_MS,
  type StreamableMessage,
} from "./message-stream"

describe("applyStreamDelta", () => {
  test("顺序 delta 拼接 content", () => {
    let msg: StreamableMessage = {
      content: "思考中：",
      stream_status: "STREAMING",
    }
    msg = applyStreamDelta(msg, 1, "你好")!
    msg = applyStreamDelta(msg, 2, "，世界")!
    assert.equal(msg.content, "思考中：你好，世界")
    assert.equal(msg.streamSeq, 2)
    assert.equal(msg.streamPendingDeltas, undefined)
    assert.ok(msg.streamLastActivityAt)
  })

  test("乱序 delta 先缓冲再冲刷", () => {
    let msg: StreamableMessage = {
      content: "",
      stream_status: "STREAMING",
    }
    msg = applyStreamDelta(msg, 2, "B")!
    assert.equal(msg.content, "")
    assert.deepEqual(msg.streamPendingDeltas, { 2: "B" })
    msg = applyStreamDelta(msg, 1, "A")!
    assert.equal(msg.content, "AB")
    assert.equal(msg.streamSeq, 2)
    assert.equal(msg.streamPendingDeltas, undefined)
  })

  test("重复已应用 / 已缓冲 seq 忽略", () => {
    let msg: StreamableMessage = {
      content: "A",
      stream_status: "STREAMING",
      streamSeq: 1,
    }
    assert.equal(applyStreamDelta(msg, 1, "X"), null)

    msg = {
      content: "",
      stream_status: "STREAMING",
      streamPendingDeltas: { 2: "B" },
    }
    assert.equal(applyStreamDelta(msg, 2, "覆盖?"), null)

    msg = applyStreamDelta(
      {
        content: "A",
        stream_status: "STREAMING",
        streamSeq: 1,
      },
      2,
      "B"
    )!
    assert.equal(msg.content, "AB")
  })

  test("非 STREAMING / 空 delta / 非法 seq 忽略", () => {
    assert.equal(
      applyStreamDelta({ content: "x", stream_status: "" }, 1, "a"),
      null
    )
    assert.equal(
      applyStreamDelta({ content: "", stream_status: "STREAMING" }, 0, "a"),
      null
    )
    assert.equal(
      applyStreamDelta({ content: "", stream_status: "STREAMING" }, 1, ""),
      null
    )
  })
})

describe("applyStreamDeltasBatch", () => {
  test("同帧多条按序合并", () => {
    const msg: StreamableMessage = {
      content: "",
      stream_status: "STREAMING",
    }
    const next = applyStreamDeltasBatch(msg, [
      { seq: 1, delta: "你" },
      { seq: 2, delta: "好" },
      { seq: 1, delta: "重复忽略" },
    ])
    assert.ok(next)
    assert.equal(next!.content, "你好")
    assert.equal(next!.streamSeq, 2)
  })

  test("空批返回 null", () => {
    assert.equal(
      applyStreamDeltasBatch(
        { content: "", stream_status: "STREAMING" },
        []
      ),
      null
    )
  })
})

describe("streamGapSpan / shouldReconcileStreamGap", () => {
  test("空洞跨度达到阈值时建议纠偏", () => {
    const msg: StreamableMessage = {
      content: "",
      stream_status: "STREAMING",
      streamSeq: 1,
      streamPendingDeltas: {
        [1 + STREAM_GAP_RECONCILE_THRESHOLD]: "late",
      },
    }
    assert.equal(streamGapSpan(msg), STREAM_GAP_RECONCILE_THRESHOLD)
    assert.equal(shouldReconcileStreamGap(msg), true)
  })

  test("无空洞不纠偏", () => {
    const msg: StreamableMessage = {
      content: "ok",
      stream_status: "STREAMING",
      streamSeq: 3,
    }
    assert.equal(streamGapSpan(msg), 0)
    assert.equal(shouldReconcileStreamGap(msg), false)
  })
})

describe("streamIdleLevel / streamActivityAt", () => {
  test("按空闲时长分级", () => {
    const base: StreamableMessage = {
      content: "x",
      stream_status: "STREAMING",
      streamLastActivityAt: 1_000_000,
    }
    assert.equal(streamIdleLevel(base, 1_000_000 + 1_000), "active")
    assert.equal(
      streamIdleLevel(base, 1_000_000 + STREAM_SLOW_IDLE_MS),
      "slow"
    )
    assert.equal(
      streamIdleLevel(base, 1_000_000 + STREAM_STALE_IDLE_MS),
      "stale"
    )
  })

  test("无活动戳时回退 created_at", () => {
    const created = Date.parse("2020-01-01T00:00:00.000Z")
    const msg: StreamableMessage = {
      content: "old",
      stream_status: "STREAMING",
      created_at: "2020-01-01T00:00:00.000Z",
    }
    assert.equal(streamActivityAt(msg, created + 10), created)
    assert.equal(
      streamIdleLevel(msg, created + STREAM_STALE_IDLE_MS),
      "stale"
    )
  })
})

describe("mergeReconciledStreamMessage", () => {
  test("终态完全采用服务端并清本地流式字段", () => {
    const previous: StreamableMessage = {
      content: "partial",
      stream_status: "STREAMING",
      streamSeq: 2,
      streamPendingDeltas: { 5: "x" },
      streamLastActivityAt: 1,
    }
    const remote: StreamableMessage = {
      content: "final answer",
      stream_status: "",
    }
    const merged = mergeReconciledStreamMessage(previous, remote, 99)
    assert.equal(merged.content, "final answer")
    assert.equal(merged.streamSeq, undefined)
    assert.equal(merged.streamPendingDeltas, undefined)
    assert.equal(merged.streamLastActivityAt, undefined)
  })

  test("本地因竞态更长时保留本地正文", () => {
    const previous: StreamableMessage = {
      content: "hello world!!!",
      stream_status: "STREAMING",
      streamSeq: 4,
    }
    const remote: StreamableMessage = {
      content: "hello",
      stream_status: "STREAMING",
    }
    const merged = mergeReconciledStreamMessage(previous, remote, 100)
    assert.equal(merged.content, "hello world!!!")
    assert.equal(merged.streamSeq, 4)
    assert.equal(merged.streamPendingDeltas, undefined)
    assert.equal(merged.streamLastActivityAt, 100)
  })

  test("服务端更长时采用服务端并推进 seq 跳过空洞", () => {
    const previous: StreamableMessage = {
      content: "hi",
      stream_status: "STREAMING",
      streamSeq: 1,
      streamPendingDeltas: { 4: "!" },
    }
    const remote: StreamableMessage = {
      content: "hi there!",
      stream_status: "STREAMING",
    }
    const merged = mergeReconciledStreamMessage(previous, remote, 50)
    assert.equal(merged.content, "hi there!")
    assert.equal(merged.streamSeq, 4)
    assert.equal(merged.streamPendingDeltas, undefined)
  })
})

describe("flushStreamDeltas", () => {
  test("非流式消息原样返回", () => {
    const msg: StreamableMessage = { content: "done" }
    assert.equal(flushStreamDeltas(msg), msg)
  })
})
