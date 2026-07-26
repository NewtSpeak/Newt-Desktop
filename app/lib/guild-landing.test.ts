import assert from "node:assert/strict"
import { describe, test } from "node:test"

import type { Channel, Guild } from "./api/types"
import { resolveLandingChannelId } from "./guild-landing"

function text(
  id: string,
  opts: { position?: number; parent_id?: string | null; guild_id?: string } = {},
): Channel {
  return {
    id,
    guild_id: opts.guild_id ?? "g1",
    name: id,
    type: "TEXT",
    position: opts.position ?? 0,
    parent_id: opts.parent_id ?? null,
  }
}

function voice(id: string, position = 0): Channel {
  return {
    id,
    guild_id: "g1",
    name: id,
    type: "VOICE",
    position,
  }
}

function category(id: string, position = 0): Channel {
  return {
    id,
    guild_id: "g1",
    name: id,
    type: "CATEGORY",
    position,
  }
}

const guild = (extra: Partial<Guild> = {}): Guild => ({
  id: "g1",
  name: "Test",
  owner_user_id: "u1",
  ...extra,
})

describe("resolveLandingChannelId", () => {
  test("空列表返回 null", () => {
    assert.equal(resolveLandingChannelId(guild(), []), null)
    assert.equal(resolveLandingChannelId(guild(), null), null)
    assert.equal(resolveLandingChannelId(guild(), undefined), null)
  })

  test("仅有语音/类别时返回 null", () => {
    assert.equal(
      resolveLandingChannelId(guild(), [category("cat"), voice("v1")]),
      null,
    )
  })

  test("优先 default_channel_id 且 type 为 TEXT", () => {
    const channels = [
      text("a", { position: 0 }),
      text("welcome", { position: 10 }),
      voice("v1", 5),
    ]
    assert.equal(
      resolveLandingChannelId(guild({ default_channel_id: "welcome" }), channels),
      "welcome",
    )
  })

  test("default 不可见或非 TEXT 时回退到侧栏第一个 TEXT", () => {
    const channels = [
      category("cat", 0),
      text("first", { position: 1, parent_id: "cat" }),
      text("second", { position: 2, parent_id: "cat" }),
      voice("v1", 3),
    ]
    assert.equal(
      resolveLandingChannelId(guild({ default_channel_id: "missing" }), channels),
      "first",
    )
    assert.equal(
      resolveLandingChannelId(guild({ default_channel_id: "v1" }), channels),
      "first",
    )
  })

  test("未配置默认时按侧栏树序取第一个 TEXT", () => {
    // 根级：无父 text-root(pos=0) 应优先于类别内
    const channels = [
      category("cat", 10),
      text("in-cat", { position: 0, parent_id: "cat" }),
      text("root", { position: 0 }),
      voice("v1", 1),
    ]
    assert.equal(resolveLandingChannelId(guild(), channels), "root")
  })

  test("default_channel_id 为空串视为未配置", () => {
    const channels = [text("only", { position: 0 })]
    assert.equal(
      resolveLandingChannelId(guild({ default_channel_id: "" }), channels),
      "only",
    )
    assert.equal(
      resolveLandingChannelId(guild({ default_channel_id: null }), channels),
      "only",
    )
  })

  test("guild 为 null 时仍可回退到第一个 TEXT", () => {
    const channels = [voice("v1", 0), text("t1", { position: 1 })]
    assert.equal(resolveLandingChannelId(null, channels), "t1")
  })
})
