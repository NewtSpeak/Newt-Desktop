import assert from "node:assert/strict"
import { test } from "node:test"

import {
  SHOP_INVENTORY_PATH,
  SHOP_PATH,
  isShopInventoryLocation,
  isShopLocation,
} from "./shop-route.ts"

test("SHOP_PATH 指向 index 路由的 shop tab", () => {
  assert.equal(SHOP_PATH, "/?tab=shop")
})

test("isShopLocation 识别 index+query 形式", () => {
  assert.equal(isShopLocation({ pathname: "/", search: "?tab=shop" }), true)
  assert.equal(isShopLocation({ pathname: "", search: "?tab=shop" }), true)
  assert.equal(isShopLocation({ pathname: "/", search: "?tab=stickers" }), false)
  assert.equal(isShopLocation({ pathname: "/", search: "" }), false)
})

test("isShopLocation 识别 /shop 别名", () => {
  assert.equal(isShopLocation({ pathname: "/shop", search: "" }), true)
  assert.equal(isShopLocation({ pathname: "/shop/anything", search: "" }), true)
  assert.equal(isShopLocation({ pathname: "/shopping", search: "" }), false)
})

test("isShopLocation 对其他路由返回 false", () => {
  assert.equal(isShopLocation({ pathname: "/channels/a/b", search: "" }), false)
  assert.equal(isShopLocation({ pathname: "/friends", search: "" }), false)
})

test("isShopInventoryLocation 识别我的装扮子页", () => {
  assert.equal(
    isShopInventoryLocation({ pathname: "/", search: "?tab=shop&view=inventory" }),
    true,
  )
  assert.equal(SHOP_INVENTORY_PATH, "/?tab=shop&view=inventory")
  assert.equal(
    isShopInventoryLocation({ pathname: "/shop/inventory", search: "" }),
    true,
  )
  assert.equal(isShopInventoryLocation({ pathname: "/", search: "?tab=shop" }), false)
  assert.equal(
    isShopInventoryLocation({ pathname: "/", search: "?tab=stickers&view=inventory" }),
    false,
  )
})
