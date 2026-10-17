import assert from "node:assert/strict"
import { withBrowserFixture } from "./lib/browser-fixture.mjs"

await withBrowserFixture(
  new URL("./fixtures/cosmetics-probe.tsx", import.meta.url),
  async (browser, baseUrl) => {
    for (const scenario of [
      "unrelated",
      "equipped",
      "self",
      "reset",
      "switch-user",
    ]) {
      const page = await browser.newPage()
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text())
      })
      await page.goto(baseUrl)
      await page.waitForFunction(
        () => typeof window.fixture?.runScenario === "function"
      )
      const state = await page.evaluate(
        (name) => window.fixture.runScenario(name),
        scenario
      )
      assert.equal(state.initial, "无装扮", `${scenario}: 空缓存应正常渲染`)
      assert(state.before > 0, "测试组件必须实际渲染")
      if (scenario === "unrelated") {
        assert.equal(
          state.after,
          state.before,
          "积分与其他用户缓存更新不应触发重渲染"
        )
      } else if (scenario === "equipped") {
        assert.equal(state.updated, "新头像框")
        assert.equal(state.final, "无装扮", "卸下装扮应刷新组件")
      } else if (scenario === "self") {
        assert.equal(state.updated, "本人头像框")
        assert.equal(state.final, "旧缓存", "账号切换应重新选择数据源")
      } else if (scenario === "reset") {
        assert.equal(state.updated, "即将清空")
        assert.equal(state.final, "无装扮", "清空 store 后应恢复默认显示")
      } else {
        assert.equal(state.updated, "无装扮")
        assert.equal(state.final, "另一位成员", "切换成员应重新订阅对应缓存")
      }
      assert.deepEqual(errors, [], `${scenario}: 不应出现 React 错误`)
      console.log(`PASS cosmetics component: ${scenario}`)
      await page.close()
    }
  }
)
