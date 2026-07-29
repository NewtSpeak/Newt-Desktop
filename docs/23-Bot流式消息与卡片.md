# 23 Bot 流式消息与卡片

| 字段 | 内容 |
|------|------|
| **文档编号** | Newt-Desktop-PRD-23 |
| **版本** | v1.1 |
| **日期** | 2026-07-26 |
| **状态** | 已实现（Desktop 客户端已接入） |
| **对标** | Discord 无原生「AI 打字机流式」协议；本能力为 Owl 扩展（Bot 开放平面） |
| **服务端依据** | `Newt-Server/backend/internal/message/stream.go`、Bot API `/bot-api/v1`、Gateway `MESSAGE_STREAM_*` |
| **SDK 依据** | `NewtBotSdk` / `Newt-Server/sdk`（JS / Python / Go / Rust） |
| **相关文档** | [05 文本消息](./05-文本消息.md)、[14 实时事件](./14-实时事件与状态同步.md)、[15 通知与未读](./15-通知与未读.md)、[19 隐私与私信](./19-隐私设置好友与私信.md) |

---

## 1. 功能概述

本文档定义 **机器人（Bot）流式消息** 与 **消息卡片（card）** 在 Newt-Desktop 中的完整行为，覆盖：

1. **协议真相**：服务端三段式 HTTP + Gateway 事件（与用户端同构可见性过滤）。
2. **Bot 侧用法**：官方 SDK 如何 `startStream → append → end`。
3. **Desktop 客户端**：如何订阅、拼接、纠偏、渲染、计未读。
4. **卡片 schema**：推荐 JSON 结构、安全约束、渲染规则。
5. **验收与手测**：自动化覆盖范围与可选 live 清单。

### 1.1 要解决的问题

AI Bot 生成长回复时，若等全文完成再 `sendMessage`，用户只能干等。流式协议允许：

- 立刻出现占位气泡（`stream_status=STREAMING`）；
- 正文随模型 token **实时增长**；
- 结束时定稿（可附卡片），并兼容「不理解流式」的旧客户端（补发 `MESSAGE_UPDATE`）。

### 1.2 设计原则

| # | 原则 | 说明 |
|---|------|------|
| 1 | **服务端权威** | 正文随分片落库；REST `getMessage` / 历史列表随时可读已生成部分 |
| 2 | **流式不发 MESSAGE_CREATE** | 占位靠 `MESSAGE_STREAM_START`；终态 `END` + 兼容 `MESSAGE_UPDATE` |
| 3 | **未读只计一次** | 仅 START 推进未读/系统通知；DELTA/END 不计 |
| 4 | **seq 有序拼接** | DELTA 带从 1 递增的 `seq`；客户端乱序缓冲，空洞过大 REST 纠偏 |
| 5 | **卡片 schema 客户端约定** | 服务端只校验 JSON 对象 ≤8KB，不解释字段语义 |

---

## 2. 用户故事

| 编号 | 故事 |
|------|------|
| US-01 | 作为频道成员，我向 AI Bot 提问后，立刻看到 Bot 气泡出现并逐字/逐段生成，无需刷新。 |
| US-02 | 作为成员，生成过程中我上翻阅读历史，列表不强制把我拉回底部；我贴底时则跟随滚动。 |
| US-03 | 作为成员，生成结束后我看到完整正文，以及可选的结构化卡片（标题/字段/按钮）。 |
| US-04 | 作为成员，Bot 崩溃或网络中断导致长时间无增量时，我看到「生成较慢/可能已中断」并可手动刷新内容。 |
| US-05 | 作为私信用户，侧栏会话预览随 AI 正文增长更新（节流），结束后为终态摘要。 |
| US-06 | 作为 Bot 开发者，我用官方 SDK 三行 API 即可对接任意 LLM 流。 |

---

## 3. 服务端协议（真相源）

### 3.1 HTTP（Bot 平面 `/bot-api/v1`）

认证：`Authorization: Bot <token>`（兼容 `Bearer`）。

| 步骤 | 方法 | 路径 | 请求体 | 响应 |
|------|------|------|--------|------|
| 开始 | `POST` | `/channels/{cid}/messages/stream` | `{ content?, reply_to_id?, nonce? }` | `201` messageView，`stream_status=STREAMING` |
| 追加 | `POST` | `/channels/{cid}/messages/{mid}/stream` | `{ delta }`（必填） | `{ seq, content_length }` |
| 结束 | `POST` | `/channels/{cid}/messages/{mid}/stream/end` | `{ content?, card? }` | 终态 messageView，`stream_status` 清空 |

约束（服务端）：

- 仅 **消息作者（该 bot）** 可 append/end；
- 非 `STREAMING` 状态操作 → `409 NOT_STREAMING`；
- 正文上限与普通消息一致（约 **4000 字符**）；
- 闲置 **10 分钟**未 end → GC 自动收束并下发 END 类事件；
- `card`：JSON 对象，≤8KB。

实现文件：`Newt-Server/backend/internal/message/stream.go`。

### 3.2 Gateway 事件时序

```text
MESSAGE_STREAM_START  d = messageView（占位，stream_status=STREAMING）
        │
        ▼
MESSAGE_STREAM_DELTA  d = { id, channel_id, guild_id, delta, seq }   // seq 从 1 递增
        │  （可多次）
        ▼
MESSAGE_STREAM_END    d = messageView（终态，可含 card；stream_status 空）
        +
MESSAGE_UPDATE      d = 同一终态 messageView（兼容旧客户端）
```

可见性过滤与普通消息一致（含上锁频道解锁要求）。  
**注意：流式创建不会额外广播 `MESSAGE_CREATE`。**

### 3.3 DELTA 载荷

```json
{
  "id": "123456789012345678",
  "channel_id": "<uuid>",
  "guild_id": "<uuid>",
  "delta": "增量文本",
  "seq": 1
}
```

客户端必须：

1. 按 `seq` 升序拼接 `delta` 到本地 `content`；
2. `seq <= 已应用最大 seq` → 丢弃（重放/重复）；
3. 乱序到达 → 缓冲，待连续后再拼；
4. 空洞过大 → REST `GET /channels/{cid}/messages/{mid}` 纠偏。

### 3.4 messageView 相关字段

| 字段 | 说明 |
|------|------|
| `stream_status` | `""` / 缺省 = 普通或已收束；`"STREAMING"` = 生成中 |
| `author_is_bot` | 作者为机器人时为 true（BOT 徽标） |
| `card` | 任意 JSON 对象（原样透传） |
| `content` | 当前累计正文（DB 随分片追加） |

---

## 4. Bot SDK 用法

### 4.1 语言覆盖

| 语言 | API | 包路径 |
|------|-----|--------|
| JavaScript/TS | `startStream` / `append` / `end` | `NewtBotSdk/javascript`、`Newt-Server/sdk/javascript` |
| Python | `start_stream` / `MessageStream` | `NewtBotSdk/python`、`Newt-Server/sdk/python` |
| Go | `StartStream` / `Append` / `End` | `NewtBotSdk/go`、`Newt-Server/sdk/go` |
| Rust | `start_stream` / `stream_append` / `stream_end` | `NewtBotSdk/rust` |

覆盖清单见 `NewtBotSdk/docs/COVERAGE.md`（流式消息四门语言均为 ✅）。

### 4.2 JavaScript 示例（推荐）

```js
import { OwlBotClient } from "@newtspeak/bot-sdk"

const bot = new OwlBotClient({
  baseUrl: "https://newt.example.com",
  token: process.env.NEWT_BOT_TOKEN,
})

const gateway = bot.connectGateway()
gateway.on("MESSAGE_CREATE", async (message) => {
  if (message.author_is_bot) return
  if (!message.content?.startsWith("!ask ")) return

  await bot.typing(message.channel_id)
  const stream = await bot.startStream(message.channel_id, {
    replyToId: message.id,
    content: "思考中：",
  })

  for await (const chunk of askLLM(message.content.slice(5))) {
    await stream.append(chunk)
  }

  await stream.end({
    card: {
      title: "回答完毕",
      footer: "AI Bot",
      color: "#6366f1",
    },
  })
})
```

### 4.3 终态覆盖

`end({ content })` 可 **整体替换** 已追加正文（bot 做最终修订时使用）。  
若不传 `content`，服务端使用 DB 中分片累计结果。

---

## 5. Desktop 客户端实现

### 5.1 模块地图

| 路径 | 职责 |
|------|------|
| `app/lib/api/types.ts` | `Message.stream_status` / `card` / `author_is_bot` |
| `app/lib/gateway/events.ts` | `MESSAGE_STREAM_*` 常量、payload、`GatewayEventPayloadMap` |
| `app/lib/message-stream.ts` | 纯逻辑：seq 拼接、空洞、idle、REST 合并 |
| `app/lib/stream-delta-batcher.ts` | rAF + 32ms 批处理队列 |
| `app/lib/bot-card.ts` | 卡片解析与 URL/颜色安全 |
| `app/stores/messages.ts` | START/DELTA/END/reconcile、UPDATE upsert |
| `app/stores/gateway-bindings.ts` | 订阅与未读/通知/私信预览副作用 |
| `app/components/messages/message-item.tsx` | 生成中 UI、idle 提示、a11y、BOT 徽标 |
| `app/components/messages/message-card.tsx` | 卡片渲染 |
| `app/components/messages/message-list.tsx` | 流式 content 增长时贴底跟随 |

### 5.2 事件 → Store → 副作用

```text
MESSAGE_STREAM_START
  → applyMessageStreamStart（幂等插入，stream_status=STREAMING）
  → noteIncomingMessage：未读 +1、系统通知一次、私信预览

MESSAGE_STREAM_DELTA
  → StreamDeltaBatcher.enqueue
  →（rAF/32ms）applyStreamDeltasBatch 写 content
  → 私信预览 500ms 节流
  → 空洞跨度 ≥ 3 → 防抖 getMessage 纠偏

MESSAGE_STREAM_END
  → flushNow（避免末尾丢字）
  → applyMessageUpdate(stream_status="")
  → 私信预览终态（不 noteMessageCreate）

MESSAGE_UPDATE（END 兼容补发）
  → applyMessageUpdate（本地无此 id 时 upsert）
```

### 5.3 本地扩展字段（ChatMessage）

| 字段 | 来源 | 说明 |
|------|------|------|
| `streamSeq` | 仅本地 | 已应用最大 DELTA.seq |
| `streamPendingDeltas` | 仅本地 | 乱序缓冲 `Record<seq, delta>` |
| `streamLastActivityAt` | 仅本地 | 最近 START/DELTA/纠偏时间（ms），供 idle UI |

`normalize()` 在非 `STREAMING` 时清空上述字段。

### 5.4 拼接与纠偏算法（摘要）

**applyStreamDelta**

1. 非 `STREAMING` / 非法 seq / 空 delta → 忽略  
2. `seq <= streamSeq` 或已在缓冲中 → 忽略（防重复）  
3. 写入缓冲 → 从 `streamSeq+1` 连续冲刷到 content  

**空洞判定**

```text
streamGapSpan = max(pendingSeq) - streamSeq
shouldReconcile = STREAMING && streamGapSpan >= 3
```

**REST 纠偏 `reconcileStreamMessage`**

1. 请求前 `flushNow`  
2. `GET` 单条消息  
3. 返回后再 `flushNow`（合并往返期间 delta）  
4. `mergeReconciledStreamMessage`：  
   - 远程已终态 → 全量采用远程  
   - 仍 STREAMING：取 **更长 content**（防旧快照盖掉本地超前）；seq 推进到已见最大；清空空洞  

防抖 400ms，同消息冷却 2s。

### 5.5 DELTA 批处理

- 同一帧内多条 delta 合并为 **一次** zustand `set`  
- 调度：`requestAnimationFrame` + 最长 32ms 兜底  
- `END` / `reconcile` / `reset` 路径会 `flushNow` 或 `clear`

### 5.6 未读与通知（与文档 15 对齐）

| 事件 | 未读 | 系统通知 |
|------|------|----------|
| START | ✅ +1（`noteMessageCreate`） | ✅ 一次（`maybeNotifyMessage`） |
| DELTA | ❌ | ❌ |
| END | ❌ | ❌ |
| UPDATE | ❌ | ❌ |

START 与普通 `MESSAGE_CREATE` 共用 `noteIncomingMessage` 路径。

### 5.7 私信预览（文档 19）

- START / END：立即 `noteMessage`  
- DELTA：500ms 节流写预览（截断逻辑沿用 private-channels store）  
- 避免每 token 写侧栏 store

### 5.8 滚动策略（message-list）

在既有「末条 id 变化贴底」之外，增加：

- 快照字段 `lastContentLen`  
- 末条 **id 不变** 但 content 变长（流式）且用户贴底 → `scrollToBottom`  
- 用户上翻（`stickRef=false`）不强制拉回

### 5.9 UI 状态

| 状态 | 条件 | 表现 |
|------|------|------|
| 生成中 | `STREAMING` 且 idle=active | 文末脉冲光标；空正文显示「生成中…」 |
| 生成较慢 | 空闲 ≥ **90s** | 文案 +「刷新内容」按钮 |
| 可能已中断 | 空闲 ≥ **5min** | 文案 +「刷新内容」 |
| 已收束 | 非 STREAMING | 正常消息；可渲染 card |

空闲时间优先 `streamLastActivityAt`，否则回退 `created_at`。  
客户端 5min 提示 **早于** 服务端 10min GC，便于用户主动刷新。

### 5.10 无障碍

- 流式正文容器：`aria-live="polite"`、`aria-busy`（生成中）  
- 慢/中断条：`role="status"`  
- 刷新按钮：`aria-label="从服务器刷新流式消息内容"`  
- 生成中光标：`aria-hidden`

### 5.11 BOT 徽标

`author_is_bot === true` 时在作者名旁显示 `BOT` 小标签。

---

## 6. 消息卡片（card）

### 6.1 服务端（v1.1 更新）

- 要求 **JSON 对象 ≤16KB**（v1.0 为 8KB）  
- **`buttons` 键自 v1.1 起由服务端解析并强校验**（互斥/上限/字符集/可见性裁剪，
  详见 [设计文档 2026-07-26-Bot交互按钮与Ephemeral消息](../../docs/design/2026-07-26-Bot交互按钮与Ephemeral消息.md)）；
  其余键继续原样透传，渲染 schema 仍由客户端约定  
- 可出现在普通 `sendMessage` / `sendCard`，或流式 `end({ card })`

### 6.2 推荐 schema（v1.1：交互按钮）

```json
{
  "title": "部署审批",
  "description": "版本 v1.4.2 等待批准",
  "color": "#22c55e",
  "fields": [
    { "name": "耗时", "value": "42s", "inline": true },
    { "name": "环境", "value": "prod", "inline": true }
  ],
  "buttons": [
    { "label": "查看日志", "url": "https://example.com/logs" },
    { "label": "批准", "custom_id": "deploy:approve:42", "style": "success", "size": "md" },
    { "label": "拒绝", "custom_id": "deploy:reject:42", "style": "danger",
      "visible_to": { "roles": ["<role_uuid>"] } }
  ],
  "footer": "CI Bot",
  "thumbnail": "https://example.com/thumb.png",
  "image": "https://example.com/wide.png"
}
```

| 字段 | 类型 | 渲染 |
|------|------|------|
| `title` | string | 加粗标题 |
| `description` | string | 次要说明（预格式换行） |
| `color` | `#RGB` / `#RRGGBB` / `#RRGGBBAA` | 左侧色条；非法则主题色 |
| `fields[]` | `{name,value,inline?}` | inline 网格 / 块级列表 |
| `buttons[]` | 见下表 | 外链 / 交互按钮，row 分行（缺省每行 5 个自动折行），≤25 个 |
| `footer` | string | 底部弱文案 |
| `thumbnail` | url | 右侧小图 |
| `image` | url | 底部大图 |

`buttons[]` 元素（服务端强校验，违规整卡 `400 INVALID_CARD`）：

| 键 | 规则 | 渲染 |
|----|------|------|
| `label` | 必填 1–40 字符 | 按钮文案（客户端按码位截断） |
| `url` / `custom_id` | **互斥且必居其一**；url 仅 http(s)；custom_id `[A-Za-z0-9_\-:.]{1,64}` 消息内唯一 | url → `<a>` 外链（outline 样式 + 外链图标）；custom_id → 交互按钮（点击回调） |
| `style` | `primary`/`secondary`(默认)/`success`/`danger` | 对应 ui/button 的 default/secondary/success/destructive；url 按钮忽略 style |
| `size` | `xs`/`sm`(默认)/`md`/`lg` | 对应 h-6 / h-8 / h-9 / h-10 |
| `disabled` | bool | 置灰不可点（服务端同样拒绝点击） |
| `row` | 0–4 可选 | 显式分行；无 row 按声明顺序每行 5 个自动折行 |
| `visible_to` | `{users:[uuid]≤20, roles:[uuid]≤10}` | 服务端按接收者裁剪并**剥除该键**——客户端永远收不到不该看的按钮 |

### 6.3 安全（v1.1 更新）

实现：`app/lib/bot-card.ts` + `message-card.tsx` + `message-card-button.tsx`

| 规则 | 行为 |
|------|------|
| 文本字段 | React 文本节点（默认转义，无 `dangerouslySetInnerHTML`） |
| `buttons.url` / 图片 URL | 仅 `http:` / `https:`；拒绝 `javascript:` 等 |
| `url` 与 `custom_id` 双有/双无 | 客户端丢弃该按钮（防御旧数据；服务端发送期已拒绝） |
| 按钮可见性 | 服务端裁剪为最终防线：点击伪造 `custom_id` 一律 404，不泄露隐藏按钮存在性 |
| 非法/空对象 | 不渲染卡片 |
| 支持 | 对象或 JSON **字符串**（部分路径透传） |

---

## 7. 边界情况与正确性约定

| 场景 | 行为 |
|------|------|
| DELTA 早于 START | 本地丢弃该批 delta，防抖 REST 拉全量；短暂空窗后恢复 |
| 仅 END/UPDATE、无 START | `applyMessageUpdate` **upsert** 插入终态（兼容） |
| END 后迟到 DELTA | 忽略（非 STREAMING） |
| 重复 seq | 忽略 |
| 乱序 seq | 缓冲后连续冲刷 |
| 纠偏往返中本地已超前 | 保留更长 content |
| 断线重连 fillGap | 同 ID 可能不重刷中间 STREAMING；靠后续 delta/END/手动刷新 |
| 流式 @提及 | 服务端 stream 路径不解析 mentions（能力边界） |
| 双计未读 | 禁止：仅 START 计一次 |

---

## 8. 功能需求明细（FR）

### 8.1 接收与状态

- **FR-01** 客户端必须订阅 `MESSAGE_STREAM_START` / `DELTA` / `END`，并处理兼容 `MESSAGE_UPDATE`。  
- **FR-02** START 按消息 id 幂等插入；已存在则不降级覆盖更长正文。  
- **FR-03** DELTA 必须按 seq 拼接；支持乱序缓冲与重复丢弃。  
- **FR-04** END 前冲刷未写出 delta；清空 `stream_status` 与本地流式字段。  
- **FR-05** 本地无消息时的 UPDATE 必须 upsert。  

### 8.2 性能与体验

- **FR-06** 高频 DELTA 应批处理写入（目标：同帧合并，避免每 token 一次 React 全表重渲）。  
- **FR-07** 用户贴底时流式增长跟随滚动；上翻不打扰。  
- **FR-08** 空闲 90s / 5min 分级提示，并提供 REST 刷新。  

### 8.3 未读 / 私信 / 通知

- **FR-09** 仅 START 计未读与系统通知一次。  
- **FR-10** 私信预览：START/END 即时；DELTA 节流。  

### 8.4 卡片

- **FR-11** 实现推荐 schema 渲染；未知字段忽略。  
- **FR-12** 外链与图片协议白名单；文本防 XSS。  

### 8.5 无障碍

- **FR-13** 流式区域 `aria-live=polite`；状态变化可被读屏感知且不过度打断。  

---

## 9. 测试与验收

### 9.1 自动化（仓库内）

```bash
cd Newt-Desktop
npx tsx --test \
  app/lib/message-stream.test.ts \
  app/lib/stream-delta-batcher.test.ts \
  app/lib/bot-card.test.ts \
  app/lib/stream-acceptance.test.ts
```

| 文件 | 覆盖 |
|------|------|
| `message-stream.test.ts` | 顺序/乱序/重复 seq、批应用、空洞、idle、纠偏合并 |
| `stream-delta-batcher.test.ts` | 批队列 flush/clear |
| `bot-card.test.ts` | schema 解析、危险 URL、hex 颜色 |
| `stream-acceptance.test.ts` | 协议路径端到端模拟验收 |

服务端：

```bash
cd Newt-Server/backend
go test ./internal/botapi/ -count=1 -run BotFullFlow
```

（`TestBotFullFlow` 含流式 start/append/end 与事件计数。）

### 9.2 验收结论（2026-07-26）

| 项 | 结果 |
|----|------|
| Desktop 相关单测 | 31/31 通过 |
| 服务端 Bot 集成 | ok |
| 独立代码审查 | PASS |
| Live Bot 手测 | 可选（见 §9.3） |

### 9.3 可选 live 手测清单

环境：已安装 bot、签发 token、Desktop 登录同服同频道。

1. 运行 §4.2 示例（或最小 append 循环）。  
2. **期望**：立即出现占位气泡 + BOT 徽标。  
3. **期望**：正文实时增长；贴底时跟随滚动。  
4. **期望**：结束后光标消失，卡片显示（若传 card）。  
5. **期望**：未读角标仅 +1。  
6. 生成中切换频道再返回：历史可见已生成部分。  
7. 生成中断网再连：内容可收敛到终态或可手动刷新。  
8. 纯卡片消息 `sendCard`：无正文时仍渲染卡片，不显示「（无内容）」。

---

## 10. 常量速查

| 常量 | 值 | 位置 |
|------|-----|------|
| 空洞纠偏阈值 | 3 | `STREAM_GAP_RECONCILE_THRESHOLD` |
| 纠偏防抖 | 400ms | `messages.ts` |
| 纠偏冷却 | 2s | `messages.ts` |
| DELTA 批最长延迟 | 32ms | `stream-delta-batcher.ts` |
| 私信预览节流 | 500ms | `messages.ts` |
| UI 较慢 | 90s | `STREAM_SLOW_IDLE_MS` |
| UI 中断提示 | 5min | `STREAM_STALE_IDLE_MS` |
| 服务端 GC | 10min | `stream.go` `streamStaleAfter` |
| 正文上限 | ~4000 字符 | 与普通消息一致 |

---

## 11. 非目标 / 后续可选

| 项 | 状态 |
|----|------|
| 用户（人类）自己流式发送消息 | ❌ 非目标（仅 bot 作者可 append） |
| 服务端解释 card schema | ⚠️ v1.1 起**部分解除**：`buttons` 键由服务端解析/校验/按接收者裁剪（见 §6.1）；其余键仍不解释 |
| ephemeral 流式消息 | ❌ 一期非目标（DELTA 为频道广播，定向裁剪留待二期） |
| 流式路径 mentions 解析 | ❌ 服务端未做；后续若产品需要再补 |
| 半截 Markdown 完美渲染 | 可接受生成中偶发不完整 |
| 多流式并行 aria-live 降噪 | 体验优化，非正确性阻塞 |

---

## 12. 变更记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-07-26 | v1.0 | 首版：协议 + Desktop 实现 + 卡片 + 验收结论 |
| 2026-07-26 | v1.1 | 交互按钮（custom_id/style/size/row/visible_to 服务端裁剪）、card 上限 16KB、ephemeral 消息接入（详见设计文档 2026-07-26-Bot交互按钮与Ephemeral消息） |

---

## 附录 A：端到端数据流图

```text
┌─────────────┐   startStream/append/end    ┌──────────────────┐
│  Bot + LLM  │ ──────────────────────────► │ Newt-Server       │
│  (SDK)      │                             │ message/stream   │
└─────────────┘                             │ + eventbus       │
                                            └────────┬─────────┘
                                                     │ Gateway
                                                     │ MESSAGE_STREAM_*
                                                     ▼
                                            ┌──────────────────┐
                                            │ Newt-Desktop      │
                                            │ gateway-bindings │
                                            │ messages store   │
                                            │ message-item/card│
                                            └──────────────────┘
                                                     │
                                                     ▼
                                            用户看到实时 AI 正文
```

## 附录 B：与普通消息对照

| 维度 | 普通消息 | 流式消息 |
|------|----------|----------|
| 创建事件 | `MESSAGE_CREATE` | `MESSAGE_STREAM_START` |
| 增量 | 无（整段编辑走 UPDATE） | `MESSAGE_STREAM_DELTA` |
| 结束 | — | `MESSAGE_STREAM_END` + `MESSAGE_UPDATE` |
| `stream_status` | 空 | 生成中为 `STREAMING` |
| 未读 | CREATE 计 1 | START 计 1 |
| 作者 | 用户或 bot | 通常为 bot |
| 卡片 | bot 可发 | 常在 end 附带 |
