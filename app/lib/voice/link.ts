// VoiceLink：一条完整语音链路（WSS 信令 + PeerConnection + audio 播放）的可实例化单元。
//
// docs 13 双 PC 热切的基础抽象：管理器（connection.ts）同时最多持有两个实例
// （activeLink + pendingLink），迁移 = 创建 pendingLink → CUTOVER 提升为 active →
// 销毁旧实例；同频道内重连（RECOVERING）复用同一抽象（销毁旧实例重建）。
//
// 每个实例内聚：
//   - auth 首帧 / ready → offer/answer/trickle ICE 协商；
//   - ready 后重放本地静音退订集合（audio 维度）、视频默认剪枝 + 观看白名单
//     （video 维度，协议 §2.1 kinds）与每用户音量（FR-21 就绪钩子）；
//   - 上行闸门 uplinkAllowed：pending 链路建立期禁发，CUTOVER 一次性放行（FR-03）；
//   - 下行主静音 setPlaybackMuted：旧链路在新链路接收侧就绪后静音防双声；
//   - destroy 顺序：信令（先停回调）→ RTC（PC/track/audio/定时器）。
//
// 实例生命周期内回调恒定；destroy 后不再触发任何回调（防串台，替代旧 generation 机制）。

import { verror, vlog } from "./log"
import {
  VoiceSignaling,
  type ReadyPayload,
  type VoiceCloseInfo,
} from "./signaling"
import { VoiceRtc, type VoiceMediaDiagnostics } from "./webrtc"
import { useSettingsStore } from "~/stores/settings"

/** 一条链路的接入目标（join 响应 / VOICE_SERVER_UPDATE 载荷解析产物） */
export type VoiceLinkTarget = {
  guildId: string
  channelId: string
  token: string
  wssUrl: string
  nodeId: string | null
  roomId: string | null
  sessionId: string | null
  /** token 过期时刻（epoch ms）；token 刷新定时器跟随 activeLink 的该值 */
  expiresAtMs: number | null
}

export type VoiceLinkCallbacks = {
  /** WSS ready（含房间快照）；此时本地静音/音量已在链路内重放完毕 */
  onReady: (link: VoiceLink, d: ReadyPayload) => void
  /** PC 连通（可能因 ICE restart 恢复而多次触发） */
  onConnected: (link: VoiceLink) => void
  /** 首个下行音频轨到达 = 接收侧就绪（迁移时切换播放的时机，FR-04.4） */
  onFirstRemoteAudio: (link: VoiceLink) => void
  /** 信令关闭（closed 帧 / WS 断 / 心跳死亡）；至多一次 */
  onClosed: (link: VoiceLink, info: VoiceCloseInfo) => void
  /** ICE failed / disconnected>2s；由管理器决定 ICE restart 或重连 */
  onIceFailure: (link: VoiceLink, state: RTCIceConnectionState) => void
  onSelfSpeaking: (link: VoiceLink, speaking: boolean) => void
  onSpeaking: (link: VoiceLink, userIds: string[]) => void
  onCapsUpdated: (link: VoiceLink, caps: string[]) => void
  /** initMic 结果（false = 仅听模式） */
  onMicAvailability: (link: VoiceLink, hasMic: boolean) => void
  /** 下行视频轨（屏幕共享）到达/移除（stream=null 表示结束） */
  onRemoteVideo?: (
    link: VoiceLink,
    userId: string,
    stream: MediaStream | null
  ) => void
}

export type VoiceLinkOptions = {
  /** 建链即允许上行（active 链路 true；迁移 pending 链路 false，CUTOVER 放行） */
  uplinkAllowed: boolean
  /** 会话侧「是否应当发声」（canPublishAudio 收口结果） */
  micWanted: boolean
  /** 闭听状态（下行全静音） */
  deafened: boolean
  /** 本地静音集合快照（ready 后重放 unsubscribe kinds=["audio"]，FR-21） */
  localMuted: Record<string, true>
  /**
   * 正在观看的屏幕共享发布者白名单（ready 后重放视频订阅剪枝）：
   * SFU 进房默认全订（含视频轨），链路就绪后对白名单之外的全员发
   * unsubscribe kinds=["video"]，实现「不点观看不拉视频流」（协议 §2.1 kinds）。
   */
  watchedVideo: Record<string, true>
  /** 每用户音量快照（百分比 0–200，FR-21） */
  userVolumes: Record<string, number>
  /** 日志关联用（迁移链路带 migration_id） */
  migrationId?: string | null
}

export class VoiceLink {
  readonly target: VoiceLinkTarget
  /** 创建时刻（诊断埋点算各阶段耗时） */
  readonly createdAt = Date.now()

  private readonly callbacks: VoiceLinkCallbacks
  private signaling: VoiceSignaling | null = null
  private rtc: VoiceRtc
  private destroyed = false
  private connectedOnce = false

  private uplinkAllowed: boolean
  private micWanted: boolean
  private localMuted: Record<string, true>
  private watchedVideo: Record<string, true>
  private readonly migrationId: string | null

  constructor(
    target: VoiceLinkTarget,
    options: VoiceLinkOptions,
    callbacks: VoiceLinkCallbacks
  ) {
    this.target = { ...target }
    this.callbacks = callbacks
    this.uplinkAllowed = options.uplinkAllowed
    this.micWanted = options.micWanted
    this.localMuted = { ...options.localMuted }
    this.watchedVideo = { ...options.watchedVideo }
    this.migrationId = options.migrationId ?? null

    this.rtc = new VoiceRtc({
      onLocalIceCandidate: (candidate) => {
        if (this.destroyed) return
        this.signaling?.sendIce(candidate)
      },
      onIceFailure: (state) => {
        if (this.destroyed) return
        this.callbacks.onIceFailure(this, state)
      },
      onConnectionStateChange: (state) => {
        if (this.destroyed) return
        vlog("PC 连接状态", state, this.logCtx())
        if (state === "connected") {
          this.connectedOnce = true
          this.callbacks.onConnected(this)
        }
      },
      onSelfSpeaking: (speaking) => {
        if (this.destroyed) return
        this.callbacks.onSelfSpeaking(this, speaking)
      },
      onFirstRemoteAudio: () => {
        if (this.destroyed) return
        this.callbacks.onFirstRemoteAudio(this)
      },
      onRemoteVideo: (userId, stream) => {
        if (this.destroyed) return
        this.callbacks.onRemoteVideo?.(this, userId, stream)
      },
    })
    this.rtc.setDeafened(options.deafened)
    this.rtc.setUserVolumes(this.scaleVolumes(options.userVolumes))
    for (const userId of Object.keys(this.localMuted)) {
      this.rtc.setUserLocallyMuted(userId, true)
    }
    this.applyMicGate()
  }

  /** 曾经连通过（区分「建立中失败」与「连通后故障」） */
  get hasConnected(): boolean {
    return this.connectedOnce
  }

  get hasMic(): boolean {
    return this.rtc.hasMic
  }

  get isMediaConnected(): boolean {
    return this.rtc.connectionState === "connected"
  }

  get isSignalingOpen(): boolean {
    return this.signaling?.isOpen ?? false
  }

  get isDestroyed(): boolean {
    return this.destroyed
  }

  /** 连接诊断（RTT / 电平 / 上下行流量），供语音面板展示 */
  getDiagnostics(): Promise<VoiceMediaDiagnostics> {
    return this.rtc.getDiagnostics()
  }

  /** 设置项变更落到 RTC（输入增益 / 主输出 / 输出设备） */
  applyVoiceSettings(patch: {
    inputVolume?: number
    outputVolume?: number
    outputDeviceId?: string | null
  }) {
    if (typeof patch.inputVolume === "number")
      this.rtc.setInputVolume(patch.inputVolume)
    if (typeof patch.outputVolume === "number")
      this.rtc.setMasterOutputVolume(patch.outputVolume)
    if (patch.outputDeviceId !== undefined)
      void this.rtc.setOutputDevice(patch.outputDeviceId)
  }

  /** 采集麦克风 + 建 WSS（auth 首帧由 signaling 层在 open 时发出） */
  async start(): Promise<void> {
    const hasMic = await this.rtc.initMic()
    if (this.destroyed) return
    // 把设置面板里的输入/输出音量与输出设备落到实际 RTC 链路上
    const voice = useSettingsStore.getState().voice
    this.rtc.setInputVolume(voice.inputVolume ?? 100)
    this.rtc.setMasterOutputVolume(voice.outputVolume ?? 100)
    void this.rtc.setOutputDevice(voice.outputDeviceId ?? null)
    this.callbacks.onMicAvailability(this, hasMic)
    this.applyMicGate()

    const signaling = new VoiceSignaling(this.target.wssUrl, {
      onReady: (d) => void this.handleReady(d),
      onAnswer: (sdp) => {
        void this.rtc
          .applyAnswer(sdp)
          .catch((error) => verror("setRemote(answer) 失败", error))
      },
      onOffer: (sdp) => void this.handleRemoteOffer(sdp),
      onIce: (d) => void this.rtc.addRemoteIce(d),
      onParticipantJoined: (d) => {
        vlog("participant_joined", d.user_id, this.logCtx())
        // 新参与者若在本地静音名单内，补发音频退订
        if (this.localMuted[d.user_id])
          this.signaling?.sendUnsubscribe(d.user_id, ["audio"])
        // 视频默认剪枝：新人不在观看白名单内则退订其视频轨
        //（SFU 默认全订；退订状态持久，其此后开播也不会转发过来）
        if (!this.watchedVideo[d.user_id])
          this.signaling?.sendUnsubscribe(d.user_id, ["video"])
      },
      onParticipantLeft: (d) => {
        vlog("participant_left", d.user_id, this.logCtx())
        this.rtc.removeUserAudio(d.user_id)
        this.rtc.removeUserVideo(d.user_id)
      },
      onTrackPublished: (d) => vlog("track_published", d, this.logCtx()),
      onTrackEnded: (d) => {
        vlog("track_ended", d, this.logCtx())
        if (d.kind === "audio") this.rtc.removeUserAudio(d.user_id)
        // 屏幕轨事件 kind 为 "screen"（协议 §2.2）；兼容旧值 "video"
        if (d.kind === "screen" || d.kind === "video")
          this.rtc.removeUserVideo(d.user_id)
      },
      onCapsUpdated: (caps) => this.callbacks.onCapsUpdated(this, caps),
      onSpeaking: (userIds) => this.callbacks.onSpeaking(this, userIds),
      onClosed: (info) => {
        if (this.destroyed) return
        this.callbacks.onClosed(this, info)
      },
    })
    this.signaling = signaling
    signaling.connect(this.target.token)
  }

  // ---------------------------------------------------------------------------
  // 运行期控制（管理器转发用户操作 / 迁移编排）
  // ---------------------------------------------------------------------------

  /** token 在位更新（刷新 / 同节点 VOICE_SERVER_UPDATE）：auth 帧重发，不断媒体 */
  updateToken(
    token: string,
    expiresAtMs: number | null,
    sessionId?: string | null
  ) {
    this.target.token = token
    this.target.expiresAtMs = expiresAtMs
    if (sessionId) this.target.sessionId = sessionId
    if (this.signaling?.isOpen) this.signaling.sendAuth(token)
  }

  /** 会话侧发声意愿（canPublishAudio 收口结果） */
  setMicWanted(wanted: boolean) {
    this.micWanted = wanted
    this.applyMicGate()
  }

  /** CUTOVER：pending 链路一次性放行上行 */
  allowUplink() {
    this.uplinkAllowed = true
    this.applyMicGate()
  }

  /** CUTOVER：旧链路上行永久停止（track.stop()，不可逆） */
  stopUplink() {
    this.rtc.stopUplink()
  }

  setDeafened(deafened: boolean) {
    this.rtc.setDeafened(deafened)
  }

  /** 迁移期旧链路下行整体静音（防双声） */
  setPlaybackMuted(muted: boolean) {
    this.rtc.setPlaybackMuted(muted)
  }

  /**
   * 本地静音某用户：播放兜底 + 信令按 audio 维度退订/恢复订阅。
   * 只作用于音频轨——与视频观看（video 维度）互相独立，被本地静音的用户
   * 开播后点观看仍只订其视频（协议 §2.1 kinds）。
   */
  setLocalMute(userId: string, muted: boolean) {
    if (muted) this.localMuted[userId] = true
    else delete this.localMuted[userId]
    this.rtc.setUserLocallyMuted(userId, muted)
    if (this.signaling?.isOpen) {
      if (muted) this.signaling.sendUnsubscribe(userId, ["audio"])
      else this.signaling.sendSubscribe(userId, ["audio"])
    }
  }

  /** 每用户音量（百分比 0–200） */
  setUserVolume(userId: string, percent: number) {
    this.rtc.setUserVolume(userId, percent / 100)
  }

  /**
   * 发布屏幕轨（docs 11 FR-04）：客户端主动 addTrack + createOffer 重协商，
   * 经信令 offer 帧发出，SFU 回 answer（信令双向已支持）。
   * 返回是否成功发出 offer（信令不可用 / PC 缺失时 false）。
   * 失败自动重试一次（整屏采集后 PC 偶发非 stable）。
   */
  async publishScreen(
    track: MediaStreamTrack,
    stream: MediaStream
  ): Promise<boolean> {
    if (!this.signaling?.isOpen || this.destroyed) return false
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.destroyed || !this.signaling?.isOpen) return false
      try {
        const sdp = await this.rtc.publishScreenTrack(track, stream)
        if (this.destroyed) return false
        // sdp=null 且已有 sender：replaceTrack 无需重协商
        if (sdp === null) {
          if (this.rtc.hasScreenTrack) return true
        } else if (sdp.length > 0) {
          this.signaling.sendOffer(sdp)
          vlog("屏幕轨 renegotiation offer 已发出", this.logCtx(), {
            attempt: attempt + 1,
          })
          return true
        }
      } catch (error) {
        verror("屏幕轨发布 attempt 失败", error, this.logCtx())
      }
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 350))
      }
    }
    return this.rtc.hasScreenTrack
  }

  /** 停止屏幕轨发布：removeTrack + 重协商（尽力而为，链路已死时静默） */
  async unpublishScreen(): Promise<void> {
    const sdp = await this.rtc.removeScreenTrack().catch(() => null)
    if (this.destroyed || !sdp) return
    if (this.signaling?.isOpen) this.signaling.sendOffer(sdp)
  }

  get hasScreenTrack(): boolean {
    return this.rtc.hasScreenTrack
  }

  /** 本链路已到达的下行视频轨（CUTOVER 提升后回灌 store） */
  getVideoStreams(): ReadonlyMap<string, MediaStream> {
    return this.rtc.getVideoStreams()
  }

  /**
   * 观看端视频订阅开关（协议 §2.1 kinds=["video"]）：
   * watching=true = 点观看订阅其屏幕轨（含伴轨），false = 停止观看退订。
   * 白名单同步维护，供 participant_joined 剪枝与迁移后新链路 ready 重放。
   */
  setVideoSubscription(userId: string, watching: boolean) {
    if (watching) this.watchedVideo[userId] = true
    else delete this.watchedVideo[userId]
    if (this.signaling?.isOpen) {
      if (watching) this.signaling.sendSubscribe(userId, ["video"])
      else this.signaling.sendUnsubscribe(userId, ["video"])
    }
  }

  /**
   * ICE restart（FR-15）：在现有 PC 上生成 iceRestart offer 走原信令通道。
   * 返回是否成功发出（信令不可用 / PC 缺失时 false，调用方转完整重连）。
   */
  async restartIce(): Promise<boolean> {
    if (!this.signaling?.isOpen) return false
    try {
      const sdp = await this.rtc.restartIce()
      if (this.destroyed || !sdp) return false
      this.signaling.sendOffer(sdp)
      return true
    } catch (error) {
      verror("ICE restart offer 生成失败", error, this.logCtx())
      return false
    }
  }

  /**
   * 销毁顺序：1. 置 destroyed（停全部回调）→ 2. 关信令（摘 WS 回调、close(1000)）
   * → 3. 关 RTC（停 mic track、关 PC、拆 GainPipe/AudioContext、移除 audio 元素、
   * 清 ICE/说话检测定时器）。幂等。
   */
  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    vlog("VoiceLink destroy", this.logCtx())
    if (this.signaling) {
      this.signaling.close()
      this.signaling = null
    }
    this.rtc.close()
  }

  // ---------------------------------------------------------------------------
  // 内部
  // ---------------------------------------------------------------------------

  private async handleReady(d: ReadyPayload) {
    if (this.destroyed) return
    vlog("ready", {
      session_id: d.session_id,
      room_id: d.room_id,
      participants: d.participants?.length ?? 0,
      ...this.logCtx(),
    })
    this.target.sessionId = d.session_id ?? this.target.sessionId
    this.target.roomId = d.room_id ?? this.target.roomId

    // 就绪钩子（docs 13 FR-21 + 协议 §2.1 kinds）：
    //   1. 重放本地静音退订集合（audio 维度）；
    //   2. 视频默认剪枝：对观看白名单之外的全员退订视频轨（SFU 进房默认全订，
    //      主动退订实现「不点观看不拉视频流」；白名单内的用户保持默认订阅，
    //      迁移后新链路无需补发 subscribe 即恢复观看）。
    for (const participant of d.participants ?? []) {
      if (this.localMuted[participant.user_id]) {
        this.signaling?.sendUnsubscribe(participant.user_id, ["audio"])
        this.rtc.setUserLocallyMuted(participant.user_id, true)
      }
      if (!this.watchedVideo[participant.user_id]) {
        this.signaling?.sendUnsubscribe(participant.user_id, ["video"])
      }
    }

    this.callbacks.onReady(this, d)

    try {
      const sdp = await this.rtc.createOffer()
      if (this.destroyed) return
      this.signaling?.sendOffer(sdp)
    } catch (error) {
      verror("createOffer 失败", error, this.logCtx())
      if (this.destroyed) return
      // 无法协商 = 链路不可用，统一走关闭路径由管理器决策
      this.callbacks.onClosed(this, {
        code: "UNKNOWN",
        message: "createOffer 失败",
      })
    }
  }

  private async handleRemoteOffer(sdp: string) {
    try {
      const answer = await this.rtc.applyRemoteOffer(sdp)
      if (this.destroyed) return
      this.signaling?.sendAnswer(answer)
    } catch (error) {
      verror("处理 SFU renegotiation offer 失败", error, this.logCtx())
    }
  }

  /** 上行最终闸门：会话意愿 ∧ CUTOVER 放行 */
  private applyMicGate() {
    this.rtc.setMicEnabled(this.micWanted && this.uplinkAllowed)
  }

  /** 百分比音量 → 0–2 倍率 */
  private scaleVolumes(
    percents: Record<string, number>
  ): Record<string, number> {
    const scaled: Record<string, number> = {}
    for (const [userId, percent] of Object.entries(percents))
      scaled[userId] = percent / 100
    return scaled
  }

  private logCtx() {
    return {
      node: this.target.nodeId,
      sid: this.target.sessionId,
      ...(this.migrationId ? { migration_id: this.migrationId } : {}),
    }
  }
}

export type { ReadyPayload, VoiceCloseInfo }
