import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, test } from "node:test"

const source = readFileSync(new URL("./channel.tsx", import.meta.url), "utf8")

describe("ChannelPage 子组件 key", () => {
  test("MessageList 与 Composer 使用不同的频道作用域 key", () => {
    assert.ok(source.includes('key={`message-list:${channelId}`}'))
    assert.ok(source.includes('key={`composer:${channelId}`}'))
    assert.ok(!source.includes("key={channelId}"))
  })
})
