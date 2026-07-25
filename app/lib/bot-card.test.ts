import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  isSafeHttpUrl,
  normalizeCardColor,
  parseBotCard,
} from "./bot-card"

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
    assert.equal(card!.buttons?.[0]?.url, "https://example.com/logs")
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
