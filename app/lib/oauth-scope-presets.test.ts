import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  applyScopePreset,
  pickMinimumScopes,
  pickRecommendedScopes,
} from "./oauth-scope-presets.ts"

describe("oauth-scope-presets", () => {
  const full = [
    "openid",
    "profile",
    "offline_access",
    "gapi.full",
    "gapi.read",
    "platform.admin",
  ]

  it("minimum picks identity + narrowest gapi, no platform", () => {
    const got = pickMinimumScopes(full)
    assert.deepEqual(got, [
      "openid",
      "profile",
      "offline_access",
      "gapi.read",
    ])
    assert.ok(!got.includes("platform.admin"))
    assert.ok(!got.includes("gapi.full"))
  })

  it("minimum falls back to gapi.full when read absent", () => {
    const got = pickMinimumScopes([
      "openid",
      "offline_access",
      "gapi.full",
      "platform.read",
    ])
    assert.deepEqual(got, ["openid", "offline_access", "gapi.full"])
  })

  it("recommended drops platform", () => {
    const got = pickRecommendedScopes(full)
    assert.ok(!got.some((s) => s.startsWith("platform.")))
    assert.ok(got.includes("gapi.full"))
  })

  it("applyScopePreset all keeps platform", () => {
    const s = applyScopePreset(full.join(" "), "all")
    assert.ok(s.includes("platform.admin"))
  })

  it("minimum never empty when request non-empty", () => {
    assert.equal(pickMinimumScopes(["platform.admin"]).length, 1)
  })
})
