import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { reconcileList } from "./reconcile-list"

type Item = { id: string; value: string }

const keyOf = (item: Item) => item.id
const isEqual = (a: Item, b: Item) => a.value === b.value

describe("reconcileList", () => {
  test("相同快照复用原数组和原对象", () => {
    const previous: Item[] = [
      { id: "1", value: "a" },
      { id: "2", value: "b" },
    ]

    const next = reconcileList(
      previous,
      [
        { id: "1", value: "a" },
        { id: "2", value: "b" },
      ],
      keyOf,
      isEqual
    )

    assert.strictEqual(next, previous)
    assert.strictEqual(next[0], previous[0])
    assert.strictEqual(next[1], previous[1])
  })

  test("仅替换发生变化的对象", () => {
    const previous: Item[] = [
      { id: "1", value: "a" },
      { id: "2", value: "b" },
    ]

    const next = reconcileList(
      previous,
      [
        { id: "1", value: "changed" },
        { id: "2", value: "b" },
      ],
      keyOf,
      isEqual
    )

    assert.notStrictEqual(next, previous)
    assert.notStrictEqual(next[0], previous[0])
    assert.strictEqual(next[1], previous[1])
  })

  test("顺序变化时复用对象但返回新数组", () => {
    const previous: Item[] = [
      { id: "1", value: "a" },
      { id: "2", value: "b" },
    ]

    const next = reconcileList(
      previous,
      [
        { id: "2", value: "b" },
        { id: "1", value: "a" },
      ],
      keyOf,
      isEqual
    )

    assert.notStrictEqual(next, previous)
    assert.strictEqual(next[0], previous[1])
    assert.strictEqual(next[1], previous[0])
  })
})
