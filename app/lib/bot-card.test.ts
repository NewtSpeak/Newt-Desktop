import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  isSafeHttpUrl,
  layoutButtonRows,
  normalizeCardColor,
  parseBotCard,
  type BotCardButton,
  type BotCardInteractiveButton,
  type BotCardLinkButton,
} from "./bot-card.ts"

describe("parseBotCard", () => {
  test("解析 SDK 推荐完整结构", () => {
    const card = parseBotCard({
      title: "部署完成",
      description: "v1.4.2 已发布",
      color: "#22c55e",
      fields: [
        { name: "耗时", value: "42s", inline: true },
        { name: "环境", value: "prod" },
      ],
      buttons: [{ label: "查看日志", url: "https://example.com/logs" }],
      footer: "CI Bot",
    })
    assert.ok(card)
    assert.equal(card!.title, "部署完成")
    assert.equal(card!.color, "#22c55e")
    assert.equal(card!.fields?.length, 2)
    const button = card!.buttons?.[0] as BotCardLinkButton
    assert.equal(button.kind, "link")
    assert.equal(button.url, "https://example.com/logs")
    assert.equal(card!.footer, "CI Bot")
  })

  test("支持 JSON 字符串", () => {
    const card = parseBotCard(
      JSON.stringify({ title: "回答完毕", footer: "AI Bot" })
    )
    assert.ok(card)
    assert.equal(card!.title, "回答完毕")
    assert.equal(card!.footer, "AI Bot")
  })

  test("空对象 / 非法输入返回 null", () => {
    assert.equal(parseBotCard(null), null)
    assert.equal(parseBotCard({}), null)
    assert.equal(parseBotCard("not-json"), null)
    assert.equal(parseBotCard([]), null)
  })

  test("过滤危险按钮 URL 与非法颜色", () => {
    const card = parseBotCard({
      title: "x",
      color: "red",
      buttons: [
        { label: "bad", url: "javascript:alert(1)" },
        { label: "ok", url: "https://safe.example/" },
      ],
    })
    assert.ok(card)
    assert.equal(card!.color, undefined)
    assert.equal(card!.buttons?.length, 1)
    assert.equal(card!.buttons?.[0]?.label, "ok")
  })

  test("旧格式 {label,url} 回退默认 style/size", () => {
    const card = parseBotCard({
      buttons: [{ label: "查看", url: "https://a.com" }],
    })
    const button = card!.buttons![0]
    assert.equal(button.kind, "link")
    assert.equal(button.style, "secondary")
    assert.equal(button.size, "sm")
    assert.equal(button.disabled, false)
  })

  test("交互按钮：custom_id / style / size / disabled / row", () => {
    const card = parseBotCard({
      buttons: [
        {
          label: "批准",
          custom_id: "deploy:approve:42",
          style: "success",
          size: "md",
          row: 1,
        },
        { label: "已处理", custom_id: "noop", disabled: true },
      ],
    })
    const [approve, noop] = card!.buttons! as BotCardInteractiveButton[]
    assert.equal(approve.kind, "interactive")
    assert.equal(approve.customId, "deploy:approve:42")
    assert.equal(approve.style, "success")
    assert.equal(approve.size, "md")
    assert.equal(approve.row, 1)
    assert.equal(noop.disabled, true)
  })

  test("url 与 custom_id 双有 / 双无的按钮被丢弃", () => {
    const card = parseBotCard({
      title: "t",
      buttons: [
        { label: "both", url: "https://a.com", custom_id: "a" },
        { label: "neither" },
        { label: "ok", custom_id: "ok" },
      ],
    })
    assert.equal(card!.buttons?.length, 1)
    assert.equal((card!.buttons![0] as BotCardInteractiveButton).customId, "ok")
  })

  test("style/size 未知值回退 secondary/sm", () => {
    const card = parseBotCard({
      buttons: [{ label: "x", custom_id: "a", style: "link", size: "xl" }],
    })
    const button = card!.buttons![0]
    assert.equal(button.style, "secondary")
    assert.equal(button.size, "sm")
  })

  test("label 按码位截断到 40（emoji 不拦腰）", () => {
    const label = "🦉".repeat(45)
    const card = parseBotCard({
      buttons: [{ label, custom_id: "a" }],
    })
    assert.equal(Array.from(card!.buttons![0].label).length, 40)
  })

  test("row 非法值丢弃字段（进入自动折行）", () => {
    const card = parseBotCard({
      buttons: [
        { label: "a", custom_id: "a", row: 5 },
        { label: "b", custom_id: "b", row: -1 },
        { label: "c", custom_id: "c", row: 1.5 },
      ],
    })
    for (const button of card!.buttons!) {
      assert.equal(button.row, undefined)
    }
  })

  test("custom_id 非法字符 / 重复被丢弃", () => {
    const card = parseBotCard({
      buttons: [
        { label: "bad", custom_id: "a b" },
        { label: "one", custom_id: "dup" },
        { label: "two", custom_id: "dup" },
      ],
    })
    assert.equal(card!.buttons?.length, 1)
    assert.equal(card!.buttons![0].label, "one")
  })

  test("超过 25 个按钮截断", () => {
    const buttons = Array.from({ length: 30 }, (_, index) => ({
      label: `b${index}`,
      custom_id: `id-${index}`,
    }))
    const card = parseBotCard({ buttons })
    assert.equal(card!.buttons?.length, 25)
  })
})

describe("layoutButtonRows", () => {
  const interactive = (
    customId: string,
    row?: number
  ): BotCardButton => ({
    kind: "interactive",
    customId,
    label: customId,
    style: "secondary",
    size: "sm",
    disabled: false,
    row,
  })

  test("无 row：每 5 个自动折行", () => {
    const rows = layoutButtonRows(
      Array.from({ length: 7 }, (_, index) => interactive(`b${index}`))
    )
    assert.equal(rows.length, 2)
    assert.equal(rows[0].length, 5)
    assert.equal(rows[1].length, 2)
  })

  test("显式 row 分桶且排在自动行之前，空桶不产生空行", () => {
    const rows = layoutButtonRows([
      interactive("auto1"),
      interactive("r3", 3),
      interactive("r0", 0),
      interactive("r0b", 0),
    ])
    assert.equal(rows.length, 3)
    assert.deepEqual(
      rows[0].map((b) => (b as BotCardInteractiveButton).customId),
      ["r0", "r0b"]
    )
    assert.deepEqual(
      rows[1].map((b) => (b as BotCardInteractiveButton).customId),
      ["r3"]
    )
    assert.deepEqual(
      rows[2].map((b) => (b as BotCardInteractiveButton).customId),
      ["auto1"]
    )
  })

  test("空数组返回空行集", () => {
    assert.deepEqual(layoutButtonRows([]), [])
  })
})

describe("isSafeHttpUrl / normalizeCardColor", () => {
  test("仅允许 http(s)", () => {
    assert.equal(isSafeHttpUrl("https://a.com"), true)
    assert.equal(isSafeHttpUrl("http://a.com"), true)
    assert.equal(isSafeHttpUrl("javascript:alert(1)"), false)
    assert.equal(isSafeHttpUrl("not a url"), false)
  })

  test("颜色仅接受 hex", () => {
    assert.equal(normalizeCardColor("#22c55e"), "#22c55e")
    assert.equal(normalizeCardColor("#fff"), "#fff")
    assert.equal(normalizeCardColor("blue"), undefined)
  })
})
