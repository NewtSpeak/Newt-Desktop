import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { channelUnreadCount, useReadStatesStore } from "./read-states"
import { usePrivateChannelsStore } from "./private-channels"

const privateChannel = (overrides: Record<string, unknown> = {}) => ({
  id: "dm-channel-1",
  type: "DM" as const,
  recipients: [],
  message_request: false,
  hidden: false,
  created_at: "2026-07-22T00:00:00Z",
  ...overrides,
})

describe("read states 的普通未读计数", () => {
  test("READY 的精确 unread_count 不退化为保底 1，并继续累加实时消息", () => {
    const store = useReadStatesStore.getState()
    store.reset()
    store.applySnapshot(
      [
        {
          channel_id: "channel-1",
          last_read_message_id: "100",
          last_message_id: "103",
          mention_count: 0,
          unread_count: 3,
        },
      ],
      { "channel-1": "guild-1" },
    )

    assert.equal(
      channelUnreadCount(useReadStatesStore.getState(), "channel-1"),
      3,
    )

    useReadStatesStore.getState().noteMessageCreate(
      {
        id: "104",
        channel_id: "channel-1",
        guild_id: "guild-1",
        author_id: "another-user",
        author_username: "another-user",
        type: "DEFAULT",
        content: "new message",
        attachments: [],
        edit_count: 0,
        created_at: "2026-07-22T00:00:00Z",
      },
      "self",
      false,
    )

    assert.equal(
      channelUnreadCount(useReadStatesStore.getState(), "channel-1"),
      4,
    )
  })

  test("READY 的精确零未读不会被最新消息游标回退成 1", () => {
    const store = useReadStatesStore.getState()
    store.reset()
    store.applySnapshot(
      [
        {
          channel_id: "channel-1",
          last_read_message_id: "103",
          last_message_id: "103",
          mention_count: 0,
          unread_count: 0,
        },
      ],
      { "channel-1": "guild-1" },
    )

    assert.equal(
      channelUnreadCount(useReadStatesStore.getState(), "channel-1"),
      0,
    )
  })

  test("好友私信使用精确计数，已读后刷新和重连不复活未读角标", () => {
    useReadStatesStore.getState().reset()
    usePrivateChannelsStore.getState().reset()

    usePrivateChannelsStore.getState().setFromReady([
      privateChannel({
        last_message_id: "203",
        last_read_message_id: "200",
        unread_count: 3,
      }),
    ])
    assert.equal(
      channelUnreadCount(useReadStatesStore.getState(), "dm-channel-1"),
      3,
    )

    useReadStatesStore.getState().noteMessageCreate(
      {
        id: "204",
        channel_id: "dm-channel-1",
        guild_id: "00000000-0000-0000-0000-000000000000",
        author_id: "friend",
        author_username: "friend",
        type: "DEFAULT",
        content: "another message",
        attachments: [],
        edit_count: 0,
        created_at: "2026-07-22T00:00:00Z",
      },
      "self",
      false,
    )
    assert.equal(
      channelUnreadCount(useReadStatesStore.getState(), "dm-channel-1"),
      4,
    )

    // READ_STATE_UPDATE 是打开会话或“标为已读”后服务端的确认事件。
    useReadStatesStore.getState().applyReadStateUpdate({
      user_id: "self",
      channel_id: "dm-channel-1",
      last_read_message_id: "204",
      mention_count: 0,
      event_at: "2026-07-22T00:00:00Z",
    })
    assert.equal(
      channelUnreadCount(useReadStatesStore.getState(), "dm-channel-1"),
      0,
    )

    usePrivateChannelsStore.getState().setFromReady([
      privateChannel({
        last_message_id: "204",
        last_read_message_id: "200",
        unread_count: 4,
      }),
    ])
    assert.equal(
      channelUnreadCount(useReadStatesStore.getState(), "dm-channel-1"),
      0,
      "晚到的旧私信列表不能让已清零角标复活",
    )

    // REST refresh 与下一次 READY 都必须接受服务端精确的 0，而不是再回退成 1。
    const readSnapshot = privateChannel({
      last_message_id: "204",
      last_read_message_id: "204",
      unread_count: 0,
    })
    usePrivateChannelsStore.getState().setFromReady([readSnapshot])
    assert.equal(
      channelUnreadCount(useReadStatesStore.getState(), "dm-channel-1"),
      0,
    )

    useReadStatesStore.getState().reset()
    usePrivateChannelsStore.getState().setFromReady([readSnapshot])
    assert.equal(
      channelUnreadCount(useReadStatesStore.getState(), "dm-channel-1"),
      0,
    )
  })
})
