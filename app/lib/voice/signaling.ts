// 客户端 ↔ SFU WSS 信令通道（协议 README §2）。
//
// 职责：
//   - 建连后立即发 auth 首帧（≤5s 硬性要求，token 严禁放 URL）；
//   - 帧编解码 {"op": string, "d": {...}} 与事件回调分发；
//   - 心跳：15s 发 ping，连续 2 次未收到 pong 视为链路死亡（合成 LINK_DEAD 关闭）；
//   - token 刷新：sendAuth 在位重发（不断媒体、不重建连接）。
//
// 连接编排/重连策略在 connection.ts，本文件只做单条 WSS 的生命周期。

import { vlog, vwarn } from "./log"

const PING_INTERVAL_MS = 15_000

/** SFU closed 帧 / WS close reason 中的业务关闭码（协议 §2.4）+ 本地合成码 */
export type VoiceCloseCode =
  | "TOKEN_EXPIRED"
  | "TOKEN_INVALID"
  | "WRONG_NODE"
  | "ROOM_MISMATCH"
  | "CAP_DENIED"
  | "SESSION_REVOKED"
  | "NODE_DRAINING"
  | "AUTH_TIMEOUT"
  /** 迁移收尾：旧会话被服务端摘除（协议/热迁移.md §2.1，不清除重连意愿） */
  | "MIGRATED"
  /** 本地合成：心跳连续丢失判定链路死亡 */
  | "LINK_DEAD"
  /** 本地合成：WSS 异常关闭且无可解析原因 */
  | "UNKNOWN"

const KNOWN_CLOSE_CODES: ReadonlySet<string> = new Set([
  "TOKEN_EXPIRED",
  "TOKEN_INVALID",
  "WRONG_NODE",
  "ROOM_MISMATCH",
  "CAP_DENIED",
  "SESSION_REVOKED",
  "NODE_DRAINING",
  "AUTH_TIMEOUT",
  "MIGRATED",
])

export type VoiceCloseInfo = {
  code: VoiceCloseCode
  message?: string
}

export type ReadyParticipant = {
  user_id: string
  session_id: string
  publishing?: boolean
  publishing_screen?: boolean
}

/**
 * subscribe/unsubscribe 帧的轨类型维度（协议 §2.1 kinds 字段）：
 * audio = 音频轨；video = 屏幕轨 + 系统音频伴轨（伴轨跟随屏幕会话）。
 * 缺省（不传）= 全部轨类型（旧协议行为）。
 */
export type SubscribeKind = "audio" | "video"

export type ReadyPayload = {
  session_id: string
  room_id: string
  participants: ReadyParticipant[]
}

export type IcePayload = {
  candidate: string
  sdp_mid?: string | null
  sdp_mline_index?: number | null
}

export type SignalingCallbacks = {
  onReady: (d: ReadyPayload) => void
  onAnswer: (sdp: string) => void
  /** SFU 主动 renegotiation（房内他人变化） */
  onOffer: (sdp: string) => void
  onIce: (d: IcePayload) => void
  onParticipantJoined: (d: { user_id: string; session_id: string }) => void
  onParticipantLeft: (d: { user_id: string; session_id: string }) => void
  onTrackPublished: (d: { user_id: string; kind: string }) => void
  onTrackEnded: (d: { user_id: string; kind: string }) => void
  onCapsUpdated: (caps: string[]) => void
  /** ~250ms 节流的房间说话人集合 */
  onSpeaking: (userIds: string[]) => void
  /**
   * 通道关闭（closed 帧 / WS 关闭 / 心跳死亡）。
   * 每个 VoiceSignaling 实例至多触发一次。
   */
  onClosed: (info: VoiceCloseInfo) => void
}

/** kinds 非空时才携带该字段（缺省语义 = 全部轨类型，保持帧向后兼容） */
function withKinds(
  d: Record<string, unknown>,
  kinds?: SubscribeKind[]
): Record<string, unknown> {
  return kinds && kinds.length > 0 ? { ...d, kinds } : d
}

export class VoiceSignaling {
  private socket: WebSocket | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private missedPongs = 0
  /** closed 帧先于 WS onclose 到达时暂存原因 */
  private pendingClose: VoiceCloseInfo | null = null
  private closedEmitted = false
  private disposed = false

  constructor(
    private readonly url: string,
    private readonly callbacks: SignalingCallbacks,
  ) {}

  /** 建连并在 open 后立即发送 auth 首帧；open 失败走 onClosed */
  connect(token: string) {
    vlog("signaling 建连", this.url)
    let socket: WebSocket
    try {
      socket = new WebSocket(this.url)
    } catch (error) {
      vwarn("signaling WebSocket 构造失败", error)
      this.emitClosed({ code: "UNKNOWN", message: "WebSocket 构造失败" })
      return
    }
    this.socket = socket

    socket.onopen = () => {
      if (this.disposed) return
      // 协议硬性要求：连接建立后 5s 内首帧必须是 auth
      this.send("auth", { token })
      this.startPing()
    }
    socket.onmessage = (event) => {
      this.handleMessage(String(event.data))
    }
    socket.onerror = () => {
      // 统一走 onclose 收敛
      socket.close()
    }
    socket.onclose = (event) => {
      if (this.socket !== socket) return
      this.stopPing()
      this.socket = null
      const info =
        this.pendingClose ??
        (event.reason && KNOWN_CLOSE_CODES.has(event.reason)
          ? { code: event.reason as VoiceCloseCode }
          : { code: "UNKNOWN" as const, message: event.reason || `ws close ${event.code}` })
      this.emitClosed(info)
    }
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  /** token 刷新：auth 帧在位重发（协议 §2.3.3） */
  sendAuth(token: string) {
    vlog("signaling auth 在位重发（token 刷新）")
    this.send("auth", { token })
  }

  sendOffer(sdp: string) {
    this.send("offer", { sdp })
  }

  sendAnswer(sdp: string) {
    this.send("answer", { sdp })
  }

  sendIce(candidate: RTCIceCandidate) {
    this.send("ice", {
      candidate: candidate.candidate,
      sdp_mid: candidate.sdpMid,
      sdp_mline_index: candidate.sdpMLineIndex,
    })
  }

  /**
   * 恢复订阅某发布者；kinds 缺省 = 全部轨类型（协议 §2.1）。
   * 只订视频（点观看）传 ["video"]，只恢复音频（解除本地静音）传 ["audio"]。
   */
  sendSubscribe(userId: string, kinds?: SubscribeKind[]) {
    this.send("subscribe", withKinds({ user_id: userId }, kinds))
  }

  /** 真实退订（SFU 停止转发）；kinds 缺省 = 全部轨类型 */
  sendUnsubscribe(userId: string, kinds?: SubscribeKind[]) {
    this.send("unsubscribe", withKinds({ user_id: userId }, kinds))
  }

  /** 主动关闭；不再触发 onClosed */
  close() {
    this.disposed = true
    this.closedEmitted = true
    this.stopPing()
    if (this.socket) {
      const socket = this.socket
      this.socket = null
      socket.onclose = null
      socket.onmessage = null
      socket.onerror = null
      try {
        socket.close(1000)
      } catch {
        // 尽力而为
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 内部
  // ---------------------------------------------------------------------------

  private send(op: string, d: Record<string, unknown>) {
    if (!this.isOpen) {
      vwarn(`signaling 通道未就绪，丢弃上行帧 op=${op}`)
      return
    }
    this.socket?.send(JSON.stringify({ op, d }))
  }

  private handleMessage(raw: string) {
    let frame: { op?: string; d?: unknown }
    try {
      frame = JSON.parse(raw) as { op?: string; d?: unknown }
    } catch {
      vwarn("signaling 收到非 JSON 帧，忽略")
      return
    }
    const d = (frame.d ?? {}) as Record<string, unknown>
    switch (frame.op) {
      case "ready":
        this.callbacks.onReady(d as unknown as ReadyPayload)
        break
      case "answer":
        this.callbacks.onAnswer(String(d.sdp ?? ""))
        break
      case "offer":
        this.callbacks.onOffer(String(d.sdp ?? ""))
        break
      case "ice":
        this.callbacks.onIce(d as unknown as IcePayload)
        break
      case "participant_joined":
        this.callbacks.onParticipantJoined(d as { user_id: string; session_id: string })
        break
      case "participant_left":
        this.callbacks.onParticipantLeft(d as { user_id: string; session_id: string })
        break
      case "track_published":
        this.callbacks.onTrackPublished(d as { user_id: string; kind: string })
        break
      case "track_ended":
        this.callbacks.onTrackEnded(d as { user_id: string; kind: string })
        break
      case "caps_updated":
        this.callbacks.onCapsUpdated(Array.isArray(d.caps) ? (d.caps as string[]) : [])
        break
      case "speaking":
        this.callbacks.onSpeaking(Array.isArray(d.user_ids) ? (d.user_ids as string[]) : [])
        break
      case "pong":
        this.missedPongs = 0
        break
      case "closed": {
        const rawCode = String(d.code ?? "")
        const info: VoiceCloseInfo = {
          code: KNOWN_CLOSE_CODES.has(rawCode) ? (rawCode as VoiceCloseCode) : "UNKNOWN",
          message: d.message == null ? rawCode : String(d.message),
        }
        vlog("signaling 收到 closed 帧", info)
        // SFU 随后会关 WS；暂存原因等 onclose 统一触发，若 WS 未及时关闭也能兜底
        this.pendingClose = info
        this.emitClosed(info)
        break
      }
      default:
        vlog(`signaling 未知下行帧 op=${String(frame.op)}`)
    }
  }

  private startPing() {
    this.stopPing()
    this.missedPongs = 0
    this.pingTimer = setInterval(() => {
      if (!this.isOpen) return
      // 上一轮 ping 未见 pong 才累计；连续 2 次（约 30s）判死
      this.missedPongs += 1
      if (this.missedPongs > 2) {
        vwarn("signaling 心跳连续丢失，判定链路死亡")
        this.emitClosed({ code: "LINK_DEAD", message: "连续 2 次未收到 pong" })
        return
      }
      this.send("ping", {})
    }, PING_INTERVAL_MS)
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private emitClosed(info: VoiceCloseInfo) {
    if (this.closedEmitted) return
    this.closedEmitted = true
    this.stopPing()
    // 心跳死亡等本地判定场景下 WS 可能还开着，收口关闭
    if (this.socket) {
      const socket = this.socket
      this.socket = null
      socket.onclose = null
      try {
        socket.close()
      } catch {
        // 尽力而为
      }
    }
    this.callbacks.onClosed(info)
  }
}
