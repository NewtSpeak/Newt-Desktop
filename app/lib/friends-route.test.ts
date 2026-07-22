import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { FRIENDS_PATH, isFriendsLocation } from "./friends-route"

describe("好友页路由", () => {
  test("主入口使用始终存在的首页路由", () => {
    assert.equal(FRIENDS_PATH, "/?tab=friends")
    assert.equal(
      isFriendsLocation({ pathname: "/", search: "?tab=friends" }),
      true,
    )
  })

  test("兼容旧的 /friends 路径", () => {
    assert.equal(
      isFriendsLocation({ pathname: "/friends", search: "" }),
      true,
    )
    assert.equal(
      isFriendsLocation({ pathname: "/friends/pending", search: "" }),
      true,
    )
  })

  test("不把私信首页和频道页误判为好友页", () => {
    assert.equal(isFriendsLocation({ pathname: "/", search: "" }), false)
    assert.equal(
      isFriendsLocation({ pathname: "/", search: "?tab=messages" }),
      false,
    )
    assert.equal(
      isFriendsLocation({
        pathname: "/channels/@me/channel-1",
        search: "?tab=friends",
      }),
      false,
    )
  })
})
