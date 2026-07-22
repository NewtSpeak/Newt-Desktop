import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  STICKERS_CREATE_PATH,
  STICKERS_MANAGE_PATH,
  STICKERS_PATH,
  isStickersCreateLocation,
  isStickersLocation,
  isStickersManageLocation,
} from "./stickers-route"

describe("stickers-route", () => {
  it("paths", () => {
    assert.equal(STICKERS_PATH, "/?tab=stickers")
    assert.equal(STICKERS_CREATE_PATH, "/?tab=stickers&view=create")
    assert.equal(STICKERS_MANAGE_PATH, "/?tab=stickers&view=manage")
  })

  it("isStickersLocation", () => {
    assert.equal(
      isStickersLocation({ pathname: "/", search: "?tab=stickers" }),
      true,
    )
    assert.equal(
      isStickersLocation({
        pathname: "/",
        search: "?tab=stickers&view=create",
      }),
      true,
    )
    assert.equal(
      isStickersLocation({ pathname: "/stickers", search: "" }),
      true,
    )
    assert.equal(isStickersLocation({ pathname: "/", search: "" }), false)
    assert.equal(
      isStickersLocation({ pathname: "/", search: "?tab=friends" }),
      false,
    )
  })

  it("isStickersCreateLocation", () => {
    assert.equal(
      isStickersCreateLocation({
        pathname: "/",
        search: "?tab=stickers&view=create",
      }),
      true,
    )
    assert.equal(
      isStickersCreateLocation({ pathname: "/", search: "?tab=stickers" }),
      false,
    )
    assert.equal(
      isStickersCreateLocation({
        pathname: "/stickers/create",
        search: "",
      }),
      true,
    )
  })

  it("isStickersManageLocation", () => {
    assert.equal(
      isStickersManageLocation({
        pathname: "/",
        search: "?tab=stickers&view=manage",
      }),
      true,
    )
    assert.equal(
      isStickersManageLocation({ pathname: "/", search: "?tab=stickers" }),
      false,
    )
    assert.equal(
      isStickersManageLocation({
        pathname: "/stickers/manage",
        search: "",
      }),
      true,
    )
  })
})
