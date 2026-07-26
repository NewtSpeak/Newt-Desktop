// Gateway 长连接客户端（单例）。
//
// 协议时序（服务端 internal/gateway/protocol.go）：
//   1. 连上后收 HELLO {heartbeat_interval_ms}（10 秒内必须 IDENTIFY/RESUME）；
//   2. 首连发 IDENTIFY {token} → 收 READY {session_id, user, guilds, presences, read_states}；
//      断线重连且有 session_id + last_seq 时发 RESUME {token, session_id, last_seq}：
//        - 成功：服务端按序补发漏掉的 DISPATCH 帧后发 RESUMED（无 d），不触发全量重拉；
//        - 失败：收 INVALID_SESSION 帧随后 4009 关闭 → 清 resume 状态，重连走 IDENTIFY
//          全量对齐（onReady 回调触发 REST 重拉）。
//   3. 周期发 HEARTBEAT，收 HEARTBEAT_ACK（两个周期无心跳服务端判死 4000）；
//   4. DISPATCH 帧带 t=事件名、s=会话内递增序列号（resume 续传游标），经订阅表分发。
//
// 同一 session 被新连接接管时旧连接收 4006（清 resume 状态防抢回死循环）。
// 重连采用指数退避（1s 起、2 倍、封顶 30s、±20% 抖动）。

import { ensureAccessToken, gatewayURL } from "~/lib/api/http"
import { parseJsonPreservingLargeInts } from "~/lib/snowflake"
import {
  GatewayCloseCodes,
  type GatewayEventPayloadMap,
  type GatewayFrame,
  type HelloData,
  type PresenceStatus,
  type ReadyData,
} from "./events"

export type GatewayStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed"

type Listener = (payload: unknown, eventName: string) => void
type StatusListener = (status: GatewayStatus) => void
type ReadyListener = (ready: ReadyData) => void
type ResumedListener = () => void

const IDENTIFY_FALLBACK_INTERVAL_MS = 30_000
const MAX_BACKOFF_MS = 30_000

class GatewayClient {
  private socket: WebSocket | null = null
  private listeners = new Map<string, Set<Listener>>()
  private statusListeners = new Set<StatusListener>()
  private readyListeners = new Set<ReadyListener>()
  private resumedListeners = new Set<ResumedListener>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private desired = false
  private lastAckAt = 0
  private heartbeatIntervalMs = IDENTIFY_FALLBACK_INTERVAL_MS

  // ---- resume 状态（docs 14 §3.1 FR-03/04）----
  private sessionId: string | null = null
  private lastSeq = 0

  status: GatewayStatus = "idle"

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  /** 进入应用壳后调用；幂等 */
  connect() {
    if (typeof window === "undefined") return
    this.desired = true
    if (this.socket || this.reconnectTimer) return
    void this.open()
  }

  /** 登出时调用：断开且不再重连 */
  disconnect() {
    this.desired = false
    this.clearReconnect()
    this.stopHeartbeat()
    this.clearResumeState()
    if (this.socket) {
      const socket = this.socket
      this.socket = null
      socket.onclose = null
      socket.close(1000)
    }
    this.setStatus("closed")
  }

  private clearResumeState() {
    this.sessionId = null
    this.lastSeq = 0
  }

  private async open() {
    this.setStatus(this.attempts > 0 ? "reconnecting" : "connecting")
    // IDENTIFY/RESUME 都需要有效 access token；拿不到（会话失效）就退避后重试，
    // 由 http 层的 onSessionExpired 负责把用户带回登录页。
    const token = await ensureAccessToken()
    if (!this.desired) return
    if (!token) {
      this.scheduleReconnect()
      return
    }

    let socket: WebSocket
    try {
      socket = new WebSocket(gatewayURL())
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onmessage = (event) => {
      let frame: GatewayFrame
      try {
        frame = parseJsonPreservingLargeInts(
          String(event.data),
        ) as GatewayFrame
      } catch {
        return
      }
      this.handleFrame(socket, frame, token)
    }
    socket.onclose = (event) => {
      if (this.socket !== socket) return
      this.socket = null
      this.stopHeartbeat()
      // 4009 = RESUME 被拒；4006 = session 被新连接接管；4003 = token 无效。
      // 三者都不该再带旧 session 重试，清掉 resume 状态走 IDENTIFY 全量。
      if (
        event.code === GatewayCloseCodes.InvalidSession ||
        event.code === GatewayCloseCodes.SessionReplaced ||
        event.code === GatewayCloseCodes.AuthFailed
      ) {
        this.clearResumeState()
      }
      if (this.desired) this.scheduleReconnect()
      else this.setStatus("closed")
    }
    socket.onerror = () => {
      socket.close()
    }
  }

  private handleFrame(socket: WebSocket, frame: GatewayFrame, token: string) {
    switch (frame.op) {
      case "HELLO": {
        const hello = frame.d as HelloData | undefined
        this.heartbeatIntervalMs = hello?.heartbeat_interval_ms ?? IDENTIFY_FALLBACK_INTERVAL_MS
        // 有可续传的会话游标就先尝试 RESUME，否则 IDENTIFY 全量
        if (this.sessionId && this.lastSeq > 0) {
          socket.send(
            JSON.stringify({
              op: "RESUME",
              d: { token, session_id: this.sessionId, last_seq: this.lastSeq },
            }),
          )
        } else {
          socket.send(JSON.stringify({ op: "IDENTIFY", d: { token } }))
        }
        this.startHeartbeat(socket)
        break
      }
      case "READY": {
        this.attempts = 0
        const ready = frame.d as ReadyData
        // 新会话：序列号从 1 重新起算
        this.sessionId = ready.session_id ?? null
        this.lastSeq = 0
        this.setStatus("connected")
        this.readyListeners.forEach((listener) => listener(ready))
        break
      }
      case "RESUMED": {
        // 断连期间的 DISPATCH 已按序补发完毕，事件流连续——不触发全量重拉
        this.attempts = 0
        this.setStatus("connected")
        this.resumedListeners.forEach((listener) => listener())
        break
      }
      case "INVALID_SESSION": {
        // RESUME 被拒：服务端随后会以 4009 关闭；这里先清状态，
        // onclose 的重连路径自然回落到 IDENTIFY 全量同步。
        this.clearResumeState()
        break
      }
      case "HEARTBEAT_ACK":
        this.lastAckAt = Date.now()
        break
      case "DISPATCH":
        if (typeof frame.s === "number" && frame.s > this.lastSeq) {
          this.lastSeq = frame.s
        }
        if (frame.t) this.emit(frame.t, frame.d)
        break
    }
  }

  // -------------------------------------------------------------------------
  // 上行帧
  // -------------------------------------------------------------------------

  /** 上行 Presence：设置本端在线状态（docs 01 §3.4）。未连接时静默忽略。 */
  sendPresence(status: PresenceStatus) {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify({ op: "PRESENCE", d: { status } }))
  }

  // -------------------------------------------------------------------------
  // 心跳
  // -------------------------------------------------------------------------

  private startHeartbeat(socket: WebSocket) {
    this.stopHeartbeat()
    this.lastAckAt = Date.now()
    const interval = Math.max(5_000, this.heartbeatIntervalMs)
    this.heartbeatTimer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return
      // 两个周期没收到 ACK 视为半开连接，主动断开触发重连
      if (Date.now() - this.lastAckAt > interval * 2 + 5_000) {
        socket.close()
        return
      }
      socket.send(JSON.stringify({ op: "HEARTBEAT" }))
    }, interval)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // -------------------------------------------------------------------------
  // 重连（指数退避 + 抖动）
  // -------------------------------------------------------------------------

  private scheduleReconnect() {
    if (!this.desired || this.reconnectTimer) return
    this.setStatus("reconnecting")
    const base = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** this.attempts)
    const delay = base * (0.8 + Math.random() * 0.4)
    this.attempts = Math.min(this.attempts + 1, 5)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.desired) void this.open()
    }, delay)
  }

  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // -------------------------------------------------------------------------
  // 订阅与分发
  // -------------------------------------------------------------------------

  /**
   * 订阅 DISPATCH 事件，返回取消函数。
   * event 传 "*" 订阅全部事件（listener 的第二个参数为事件名）。
   */
  subscribe<K extends keyof GatewayEventPayloadMap>(
    event: K,
    listener: (payload: GatewayEventPayloadMap[K], eventName: string) => void,
  ): () => void
  subscribe(event: string, listener: Listener): () => void
  subscribe(event: string, listener: Listener): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(event)
    }
  }

  /**
   * READY 回调：仅 IDENTIFY 全量路径触发（首连 / resume 失败后重建会话），
   * 用于 REST 全量拉取对齐状态。RESUMED 路径事件已补齐，不触发本回调。
   */
  onReady(listener: ReadyListener): () => void {
    this.readyListeners.add(listener)
    return () => this.readyListeners.delete(listener)
  }

  /** RESUMED 回调：断连期间事件已按序补齐（无需全量重拉，如需上报 presence 可用） */
  onResumed(listener: ResumedListener): () => void {
    this.resumedListeners.add(listener)
    return () => this.resumedListeners.delete(listener)
  }

  /** 连接状态变化回调（UI 状态指示用） */
  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    listener(this.status)
    return () => this.statusListeners.delete(listener)
  }

  private setStatus(status: GatewayStatus) {
    if (this.status === status) return
    this.status = status
    this.statusListeners.forEach((listener) => listener(status))
  }

  private emit(event: string, payload: unknown) {
    const exact = this.listeners.get(event)
    if (!exact?.size && !this.listeners.get("*")?.size) {
      // 尚无 handler 的事件仅打 debug，方便后续功能 agent 接手时观察事件流
      console.debug("[gateway] 未处理事件", event, payload)
      return
    }
    exact?.forEach((listener) => listener(payload, event))
    this.listeners.get("*")?.forEach((listener) => listener(payload, event))
  }
}

/** 全局单例 */
export const gateway = new GatewayClient()

export type { ReadyData }
