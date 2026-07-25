/**
 * 验收模拟：对齐服务端三段协议的客户端纯逻辑路径
 * START 占位 → DELTA 批拼 → 乱序/缺口 → REST 纠偏竞态 → END 终态+卡片
 */
import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { parseBotCard } from "./bot-card"
import {
  applyStreamDelta,
  applyStreamDeltasBatch,
  mergeReconciledStreamMessage,
  shouldReconcileStreamGap,
  streamIdleLevel,
  type StreamableMessage,
} from "./message-stream"
import { StreamDeltaBatcher, toSeqDeltas, forEachStreamBatch } from "./stream-delta-batcher"

function simulateClientMessage(
  initial: StreamableMessage
): {
  get: () => StreamableMessage
  onStart: (content: string) => void
  onDelta: (seq: number, delta: string) => void
  flushDeltas: () => void
  onEnd: (content: string, card?: unknown) => void
  reconcile: (remote: StreamableMessage) => void
} {
  let msg: StreamableMessage = { ...initial }
  const batcher = new StreamDeltaBatcher((batches) => {
    forEachStreamBatch(batches, (_c, _m, items) => {
      const next = applyStreamDeltasBatch(msg, toSeqDeltas(items))
      if (next) msg = next
    })
  })

  return {
    get: () => msg,
    onStart: (content) => {
      msg = {
        ...msg,
        content,
        stream_status: "STREAMING",
        streamSeq: undefined,
        streamPendingDeltas: undefined,
        streamLastActivityAt: Date.now(),
      }
    },
    onDelta: (seq, delta) => {
      batcher.enqueue({
        channelId: "ch",
        messageId: "m1",
        seq,
        delta,
      })
    },
    flushDeltas: () => batcher.flushNow(),
    onEnd: (content, card) => {
      batcher.flushNow()
      msg = {
        ...msg,
        content,
        stream_status: "",
        streamSeq: undefined,
        streamPendingDeltas: undefined,
        streamLastActivityAt: undefined,
        // card 仅验收解析
        ...(card !== undefined ? { content } : {}),
      }
      if (card !== undefined) {
        assert.ok(parseBotCard(card))
      }
    },
    reconcile: (remote) => {
      batcher.flushNow()
      msg = mergeReconciledStreamMessage(msg, remote)
    },
  }
}

describe("流式验收：协议路径", () => {
  test("happy path：START → 顺序 DELTA → END 卡片", async () => {
    const client = simulateClientMessage({
      content: "",
      created_at: new Date().toISOString(),
    })
    client.onStart("思考中：")
    client.onDelta(1, "你好")
    client.onDelta(2, "世界")
    client.flushDeltas()
    assert.equal(client.get().content, "思考中：你好世界")
    assert.equal(client.get().stream_status, "STREAMING")

    client.onEnd("思考中：你好世界", {
      title: "回答完毕",
      footer: "AI Bot",
      color: "#6366f1",
    })
    assert.equal(client.get().stream_status, "")
    assert.equal(client.get().content, "思考中：你好世界")
    assert.equal(client.get().streamSeq, undefined)
  })

  test("乱序 DELTA 最终可拼回", () => {
    let msg: StreamableMessage = {
      content: "",
      stream_status: "STREAMING",
    }
    msg = applyStreamDelta(msg, 3, "C")!
    msg = applyStreamDelta(msg, 1, "A")!
    msg = applyStreamDelta(msg, 2, "B")!
    assert.equal(msg.content, "ABC")
    assert.equal(msg.streamSeq, 3)
  })

  test("仅 UPDATE/纠偏无 START：可插入终态", () => {
    const remote: StreamableMessage = {
      content: "完整回答",
      stream_status: "",
    }
    const merged = mergeReconciledStreamMessage(undefined, remote)
    assert.equal(merged.content, "完整回答")
    assert.notEqual(merged.stream_status, "STREAMING")
  })

  test("大空洞触发纠偏建议，纠偏后跳过空洞 seq", () => {
    let msg: StreamableMessage = {
      content: "A",
      stream_status: "STREAMING",
      streamSeq: 1,
      streamPendingDeltas: { 5: "E" },
    }
    assert.equal(shouldReconcileStreamGap(msg), true)
    // 服务端已累计 A..E
    msg = mergeReconciledStreamMessage(msg, {
      content: "ABCDE",
      stream_status: "STREAMING",
    })
    assert.equal(msg.content, "ABCDE")
    assert.equal(msg.streamSeq, 5)
    // 迟到的 seq=5 不再重复
    assert.equal(applyStreamDelta(msg, 5, "E"), null)
    msg = applyStreamDelta(msg, 6, "!")!
    assert.equal(msg.content, "ABCDE!")
  })

  test("纠偏竞态：本地更长则不被旧快照盖掉", () => {
    const local: StreamableMessage = {
      content: "hello world",
      stream_status: "STREAMING",
      streamSeq: 3,
    }
    const staleRemote: StreamableMessage = {
      content: "hello",
      stream_status: "STREAMING",
    }
    const merged = mergeReconciledStreamMessage(local, staleRemote)
    assert.equal(merged.content, "hello world")
  })

  test("卡片 XSS：javascript: 按钮被丢弃", () => {
    const card = parseBotCard({
      title: "x",
      buttons: [
        { label: "坏", url: "javascript:alert(1)" },
        { label: "好", url: "https://ok.example" },
      ],
    })
    assert.ok(card)
    assert.equal(card!.buttons?.length, 1)
    assert.equal(card!.buttons?.[0]?.label, "好")
  })

  test("idle：长时间无活动为 stale", () => {
    const msg: StreamableMessage = {
      content: "x",
      stream_status: "STREAMING",
      streamLastActivityAt: 0,
    }
    assert.equal(streamIdleLevel(msg, 10 * 60_000), "stale")
  })

  test("批处理合并同帧多 delta", async () => {
    let msg: StreamableMessage = {
      content: "",
      stream_status: "STREAMING",
    }
    const batcher = new StreamDeltaBatcher((batches) => {
      forEachStreamBatch(batches, (_c, _m, items) => {
        const next = applyStreamDeltasBatch(msg, toSeqDeltas(items))
        if (next) msg = next
      })
    })
    batcher.enqueue({ channelId: "c", messageId: "m", seq: 1, delta: "1" })
    batcher.enqueue({ channelId: "c", messageId: "m", seq: 2, delta: "2" })
    batcher.enqueue({ channelId: "c", messageId: "m", seq: 3, delta: "3" })
    batcher.flushNow()
    assert.equal(msg.content, "123")
    assert.equal(msg.streamSeq, 3)
  })
})
