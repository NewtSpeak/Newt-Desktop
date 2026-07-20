// 单条 RTCPeerConnection 的媒体封装（docs 09 §3.2 / docs 13 双 PC 热切的媒体单元）。
//
// 职责：
//   - getUserMedia 采集麦克风（AEC/NS/AGC 全开），上行音频轨加入 PC；
//     无权限时降级为「仅听」（recvonly transceiver）；
//   - 下行 ontrack 按 user_id（约定 = 远端 MediaStream id）挂到隐藏 <audio> 池播放；
//     首个下行音频轨到达时回调 onFirstRemoteAudio（迁移接收侧就绪信号，FR-04.4）；
//   - 每用户音量 0–200%：≤100% 用 audio.volume，>100% 经 WebAudio GainNode 放大
//     （元素静音、Gain 输出，FR-21）；
//   - 播放侧主静音 setPlaybackMuted：迁移期旧链路下行整体静音防双声；
//   - ICE restart（FR-15）：restartIce() 在现有 PC 上生成 iceRestart offer；
//   - stopUplink：CUTOVER 时旧 PC 上行 track 永久停止（禁止双发，FR-03）；
//   - ICE 监控：disconnected 持续 >2s 或 failed → onIceFailure；
//   - 本地说话检测：WebAudio AnalyserNode RMS 门限。
//
// ice_servers 服务端当前恒为空数组，RTCPeerConnection 用默认配置。

import { vlog, vwarn } from "./log"

const ICE_DISCONNECTED_GRACE_MS = 2_000
const SPEAKING_POLL_MS = 100
/** 时域 RMS 门限（0–1）；简版 VAD，够用于自我 speaking 指示 */
const SPEAKING_RMS_THRESHOLD = 0.03

export type VoiceRtcCallbacks = {
  onLocalIceCandidate: (candidate: RTCIceCandidate) => void
  /** ICE failed / disconnected>2s，由连接层决定 ICE restart 或重连 */
  onIceFailure: (state: RTCIceConnectionState) => void
  onConnectionStateChange: (state: RTCPeerConnectionState) => void
  /** 本地采集侧说话检测（仅未静音时会为 true） */
  onSelfSpeaking: (speaking: boolean) => void
  /** 首个下行音频轨到达（每实例至多一次；迁移接收侧切换时机） */
  onFirstRemoteAudio: () => void
  /** 下行视频轨（屏幕共享）到达/移除：stream=null 表示该用户视频轨已结束（docs 11 观看端） */
  onRemoteVideo?: (userId: string, stream: MediaStream | null) => void
}

/** 隐藏 audio 池容器（autoplay），全局唯一 */
function ensureAudioPool(): HTMLElement {
  const ID = "owl-voice-audio-pool"
  let pool = document.getElementById(ID)
  if (!pool) {
    pool = document.createElement("div")
    pool.id = ID
    pool.style.display = "none"
    document.body.appendChild(pool)
  }
  return pool
}

/** >100% 音量的 WebAudio 放大链（元素静音、Gain 输出） */
type GainPipe = {
  source: MediaStreamAudioSourceNode
  gain: GainNode
  stream: MediaStream
}

export class VoiceRtc {
  private pc: RTCPeerConnection | null = null
  private micStream: MediaStream | null = null
  private micTrack: MediaStreamTrack | null = null
  private audioEls = new Map<string, HTMLAudioElement>()
  private audioStreams = new Map<string, MediaStream>()
  private iceDisconnectTimer: ReturnType<typeof setTimeout> | null = null
  private firstRemoteAudioFired = false

  // 屏幕共享上行（docs 11）：sender 用于停止时 removeTrack 重协商
  private screenSender: RTCRtpSender | null = null
  // 下行视频轨（屏幕共享观看端）：user_id → stream
  private videoStreams = new Map<string, MediaStream>()

  // 播放侧静音状态（信令退订之外的双保险）
  private deafened = false
  private locallyMuted = new Set<string>()
  /** 迁移期整链路下行主静音（旧链路防双声，FR-04.4） */
  private playbackMuted = false
  private micEnabled = true
  /** CUTOVER 后旧链路上行永久停止 */
  private uplinkStopped = false

  // 每用户音量（0–2；1 = 100%）与 >1 的放大链
  private volumes = new Map<string, number>()
  private gainPipes = new Map<string, GainPipe>()
  private playbackContext: AudioContext | null = null

  // 本地说话检测
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private speakingTimer: ReturnType<typeof setInterval> | null = null
  private lastSpeaking = false

  private disposed = false

  constructor(private readonly callbacks: VoiceRtcCallbacks) {}

  /** 是否拿到了麦克风（false = 仅听模式） */
  get hasMic(): boolean {
    return this.micTrack !== null
  }

  get connectionState(): RTCPeerConnectionState | null {
    return this.pc?.connectionState ?? null
  }

  /**
   * 采集麦克风。失败（无权限/无设备）不抛出，返回 false 表示进入仅听模式。
   */
  async initMic(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      if (this.disposed) {
        stream.getTracks().forEach((track) => track.stop())
        return false
      }
      this.micStream = stream
      this.micTrack = stream.getAudioTracks()[0] ?? null
      if (this.micTrack)
        this.micTrack.enabled = this.micEnabled && !this.uplinkStopped
      this.startSpeakingDetection(stream)
      vlog("麦克风采集就绪", this.micTrack?.label)
      return this.micTrack !== null
    } catch (error) {
      vwarn("getUserMedia 失败，进入仅听模式", error)
      this.micStream = null
      this.micTrack = null
      return false
    }
  }

  /** 建 PC 并生成含上行音频的 offer SDP */
  async createOffer(): Promise<string> {
    const pc = new RTCPeerConnection()
    this.pc = pc

    pc.onicecandidate = (event) => {
      if (event.candidate) this.callbacks.onLocalIceCandidate(event.candidate)
    }
    pc.ontrack = (event) => this.handleRemoteTrack(event)
    pc.oniceconnectionstatechange = () => this.handleIceStateChange()
    pc.onconnectionstatechange = () => {
      if (this.pc === pc)
        this.callbacks.onConnectionStateChange(pc.connectionState)
    }

    if (this.micTrack && this.micStream) {
      pc.addTrack(this.micTrack, this.micStream)
    } else {
      // 仅听模式：仍声明音频 m-line，收下行
      pc.addTransceiver("audio", { direction: "recvonly" })
    }

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    return offer.sdp ?? ""
  }

  /**
   * ICE restart（FR-15）：在现有 PC 上生成 iceRestart offer，走原信令 offer 通道。
   * 无 PC 时返回 null（调用方转完整重连）。
   */
  async restartIce(): Promise<string | null> {
    const pc = this.pc
    if (!pc) return null
    const offer = await pc.createOffer({ iceRestart: true })
    await pc.setLocalDescription(offer)
    return offer.sdp ?? null
  }

  /**
   * 发布屏幕轨（docs 11 FR-04）：addTrack 后生成 renegotiation offer SDP。
   * 调用方负责把 SDP 经信令 offer 帧发给 SFU 并等 answer。无 PC 时返回 null。
   */
  async publishScreenTrack(
    track: MediaStreamTrack,
    stream: MediaStream
  ): Promise<string | null> {
    const pc = this.pc
    if (!pc) return null
    if (this.screenSender) {
      // 每用户同时 1 路（docs 11 AX.4）：先替换旧轨
      await this.screenSender.replaceTrack(track)
      return null
    }
    this.screenSender = pc.addTrack(track, stream)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    return offer.sdp ?? null
  }

  /** 停止屏幕轨发布：removeTrack 后生成 renegotiation offer SDP（无在发轨时返回 null） */
  async removeScreenTrack(): Promise<string | null> {
    const pc = this.pc
    const sender = this.screenSender
    this.screenSender = null
    if (!pc || !sender) return null
    try {
      pc.removeTrack(sender)
    } catch {
      return null
    }
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    return offer.sdp ?? null
  }

  get hasScreenTrack(): boolean {
    return this.screenSender !== null
  }

  /** 应用 SFU 对我方 offer 的 answer */
  async applyAnswer(sdp: string) {
    if (!this.pc) return
    await this.pc.setRemoteDescription({ type: "answer", sdp })
  }

  /** SFU 主动 renegotiation：setRemote(offer) → 返回 answer SDP */
  async applyRemoteOffer(sdp: string): Promise<string> {
    if (!this.pc) throw new Error("PeerConnection 未建立")
    await this.pc.setRemoteDescription({ type: "offer", sdp })
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    return answer.sdp ?? ""
  }

  async addRemoteIce(payload: {
    candidate: string
    sdp_mid?: string | null
    sdp_mline_index?: number | null
  }) {
    if (!this.pc) return
    try {
      await this.pc.addIceCandidate({
        candidate: payload.candidate,
        sdpMid: payload.sdp_mid ?? undefined,
        sdpMLineIndex: payload.sdp_mline_index ?? undefined,
      })
    } catch (error) {
      vwarn("addIceCandidate 失败", error)
    }
  }

  // ---------------------------------------------------------------------------
  // 采集/播放控制
  // ---------------------------------------------------------------------------

  /** 上行采集开关（自我静音主保险，track.enabled 即时生效） */
  setMicEnabled(enabled: boolean) {
    this.micEnabled = enabled
    if (this.micTrack) this.micTrack.enabled = enabled && !this.uplinkStopped
    if (!enabled) this.emitSelfSpeaking(false)
  }

  /**
   * CUTOVER：旧 PC 上行永久停止（track.stop() 释放采集，禁止双发，FR-03）。
   * 与 setMicEnabled 不同：不可逆，随后本实例只收不发直至销毁。
   */
  stopUplink() {
    if (this.uplinkStopped) return
    this.uplinkStopped = true
    this.stopSpeakingDetection()
    this.micStream?.getTracks().forEach((track) => track.stop())
    vlog("上行已永久停止（CUTOVER 旧链路）")
  }

  /** 闭听：静音全部下行播放 */
  setDeafened(deafened: boolean) {
    this.deafened = deafened
    this.applyPlaybackAll()
  }

  /** 迁移期整链路下行主静音（旧链路防双声） */
  setPlaybackMuted(muted: boolean) {
    if (this.playbackMuted === muted) return
    this.playbackMuted = muted
    this.applyPlaybackAll()
  }

  /** 本地静音某用户的播放兜底（真实退订走信令） */
  setUserLocallyMuted(userId: string, muted: boolean) {
    if (muted) this.locallyMuted.add(userId)
    else this.locallyMuted.delete(userId)
    this.applyPlayback(userId)
  }

  /** 每用户音量（0–2，1 = 100%；>1 经 GainNode 放大） */
  setUserVolume(userId: string, volume: number) {
    const clamped = Math.min(2, Math.max(0, volume))
    this.volumes.set(userId, clamped)
    this.applyPlayback(userId)
  }

  /** 批量预置音量（链路建立时重放持久化配置，FR-21） */
  setUserVolumes(volumes: Record<string, number>) {
    for (const [userId, volume] of Object.entries(volumes)) {
      this.volumes.set(userId, Math.min(2, Math.max(0, volume)))
    }
  }

  /** participant_left / track_ended 时清掉对应播放元素 */
  removeUserAudio(userId: string) {
    this.teardownGainPipe(userId)
    this.audioStreams.delete(userId)
    const el = this.audioEls.get(userId)
    if (!el) return
    this.audioEls.delete(userId)
    el.srcObject = null
    el.remove()
  }

  /**
   * 完整清理（destroy 顺序）：
   * 1. 置 disposed / 清 ICE 观察定时器；2. 停说话检测（含 AudioContext）；
   * 3. 摘 PC 事件回调并 close；4. 停麦克风 track；
   * 5. 拆全部 GainPipe 与播放 AudioContext；6. 移除全部 audio 元素。
   */
  close() {
    this.disposed = true
    if (this.iceDisconnectTimer) {
      clearTimeout(this.iceDisconnectTimer)
      this.iceDisconnectTimer = null
    }
    this.stopSpeakingDetection()
    if (this.pc) {
      const pc = this.pc
      this.pc = null
      pc.onicecandidate = null
      pc.ontrack = null
      pc.oniceconnectionstatechange = null
      pc.onconnectionstatechange = null
      try {
        pc.close()
      } catch {
        // 尽力而为
      }
    }
    this.micStream?.getTracks().forEach((track) => track.stop())
    this.micStream = null
    this.micTrack = null
    // 屏幕采集 track 归 screen-share 管理器所有（含 onended 收尾），此处只解引用
    this.screenSender = null
    this.videoStreams.clear()
    for (const userId of [...this.gainPipes.keys()])
      this.teardownGainPipe(userId)
    if (this.playbackContext) {
      void this.playbackContext.close().catch(() => undefined)
      this.playbackContext = null
    }
    for (const el of this.audioEls.values()) {
      el.srcObject = null
      el.remove()
    }
    this.audioEls.clear()
    this.audioStreams.clear()
  }

  // ---------------------------------------------------------------------------
  // 内部
  // ---------------------------------------------------------------------------

  private handleRemoteTrack(event: RTCTrackEvent) {
    if (event.track.kind === "video") {
      this.handleRemoteVideoTrack(event)
      return
    }
    if (event.track.kind !== "audio") return
    const stream = event.streams[0]
    // 约定：SFU 侧远端 stream id = 发布者 user_id；无 stream 时退化为 track id
    const userId = stream?.id ?? event.track.id
    vlog("下行音频轨到达", userId)

    const pool = ensureAudioPool()
    let el = this.audioEls.get(userId)
    if (!el) {
      el = document.createElement("audio")
      el.autoplay = true
      el.dataset.userId = userId
      pool.appendChild(el)
      this.audioEls.set(userId, el)
    }
    const mediaStream = stream ?? new MediaStream([event.track])
    el.srcObject = mediaStream
    // 流变化后旧放大链失效，重建
    if (this.audioStreams.get(userId) !== mediaStream)
      this.teardownGainPipe(userId)
    this.audioStreams.set(userId, mediaStream)
    this.applyPlayback(userId)
    void el.play().catch(() => {
      // autoplay 被策略拦截时（理论上进房是用户手势触发，不应发生）记录即可
      vwarn("audio.play() 被拒绝", userId)
    })

    if (!this.firstRemoteAudioFired) {
      this.firstRemoteAudioFired = true
      this.callbacks.onFirstRemoteAudio()
    }

    event.track.onended = () => {
      // 同一用户可能重协商换轨；仅当元素仍指向该轨所在流时移除
      const current = this.audioEls.get(userId)
      if (current && current.srcObject === (stream ?? null)) {
        this.removeUserAudio(userId)
      }
    }
  }

  /** 下行视频轨（屏幕共享观看端）：按 user_id 关联并回调，渲染与否由 UI 决定 */
  private handleRemoteVideoTrack(event: RTCTrackEvent) {
    const stream = event.streams[0]
    // 约定同音频：远端 stream id = 发布者 user_id
    const userId = stream?.id ?? event.track.id
    vlog("下行视频轨到达", userId)
    const mediaStream = stream ?? new MediaStream([event.track])
    this.videoStreams.set(userId, mediaStream)
    this.callbacks.onRemoteVideo?.(userId, mediaStream)

    event.track.onended = () => {
      if (this.videoStreams.get(userId) === mediaStream) {
        this.removeUserVideo(userId)
      }
    }
  }

  /** track_ended(kind=video) / participant_left 时移除下行视频 */
  removeUserVideo(userId: string) {
    if (!this.videoStreams.delete(userId)) return
    this.callbacks.onRemoteVideo?.(userId, null)
  }

  /** 当前已到达的下行视频轨快照（迁移 CUTOVER 后回灌 store 用） */
  getVideoStreams(): ReadonlyMap<string, MediaStream> {
    return this.videoStreams
  }

  /** 单用户播放收口：静音条件 + 音量（≤1 元素直出，>1 走 GainNode） */
  private applyPlayback(userId: string) {
    const el = this.audioEls.get(userId)
    if (!el) return
    const muted =
      this.playbackMuted || this.deafened || this.locallyMuted.has(userId)
    const volume = this.volumes.get(userId) ?? 1

    if (volume <= 1) {
      this.teardownGainPipe(userId)
      el.volume = volume
      el.muted = muted
    } else {
      // 放大：元素静音、经 GainNode 输出（保持元素播放使 RTP 持续拉流）
      el.volume = 1
      el.muted = true
      const pipe = this.ensureGainPipe(userId)
      if (pipe) {
        pipe.gain.gain.value = muted ? 0 : volume
      } else {
        // WebAudio 不可用时退化为原音量直出
        el.muted = muted
      }
    }
  }

  private applyPlaybackAll() {
    for (const userId of this.audioEls.keys()) this.applyPlayback(userId)
  }

  private ensureGainPipe(userId: string): GainPipe | null {
    const existing = this.gainPipes.get(userId)
    const stream = this.audioStreams.get(userId)
    if (!stream) return null
    if (existing && existing.stream === stream) return existing
    if (existing) this.teardownGainPipe(userId)
    try {
      this.playbackContext ??= new AudioContext()
      void this.playbackContext.resume().catch(() => undefined)
      const source = this.playbackContext.createMediaStreamSource(stream)
      const gain = this.playbackContext.createGain()
      source.connect(gain)
      gain.connect(this.playbackContext.destination)
      const pipe: GainPipe = { source, gain, stream }
      this.gainPipes.set(userId, pipe)
      return pipe
    } catch (error) {
      vwarn("音量放大链创建失败，退化为 100%", error)
      return null
    }
  }

  private teardownGainPipe(userId: string) {
    const pipe = this.gainPipes.get(userId)
    if (!pipe) return
    this.gainPipes.delete(userId)
    try {
      pipe.source.disconnect()
      pipe.gain.disconnect()
    } catch {
      // 尽力而为
    }
  }

  private handleIceStateChange() {
    const pc = this.pc
    if (!pc) return
    const state = pc.iceConnectionState
    vlog("ICE 状态", state)
    if (state === "failed") {
      if (this.iceDisconnectTimer) {
        clearTimeout(this.iceDisconnectTimer)
        this.iceDisconnectTimer = null
      }
      this.callbacks.onIceFailure(state)
      return
    }
    if (state === "disconnected") {
      this.iceDisconnectTimer ??= setTimeout(() => {
        this.iceDisconnectTimer = null
        if (this.pc?.iceConnectionState === "disconnected") {
          this.callbacks.onIceFailure("disconnected")
        }
      }, ICE_DISCONNECTED_GRACE_MS)
      return
    }
    if (
      this.iceDisconnectTimer &&
      (state === "connected" || state === "completed")
    ) {
      clearTimeout(this.iceDisconnectTimer)
      this.iceDisconnectTimer = null
    }
  }

  private startSpeakingDetection(stream: MediaStream) {
    try {
      const AudioContextCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!AudioContextCtor) return
      this.audioContext = new AudioContextCtor()
      const source = this.audioContext.createMediaStreamSource(stream)
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 1024
      source.connect(this.analyser)
      // 进房由用户点击触发，resume 一般能成功
      void this.audioContext.resume().catch(() => undefined)

      const buffer = new Uint8Array(this.analyser.fftSize)
      this.speakingTimer = setInterval(() => {
        if (!this.analyser) return
        if (!this.micEnabled || !this.micTrack?.enabled) {
          this.emitSelfSpeaking(false)
          return
        }
        this.analyser.getByteTimeDomainData(buffer)
        let sumSquares = 0
        for (const sample of buffer) {
          const normalized = (sample - 128) / 128
          sumSquares += normalized * normalized
        }
        const rms = Math.sqrt(sumSquares / buffer.length)
        this.emitSelfSpeaking(rms > SPEAKING_RMS_THRESHOLD)
      }, SPEAKING_POLL_MS)
    } catch (error) {
      vwarn("本地说话检测初始化失败", error)
    }
  }

  private stopSpeakingDetection() {
    if (this.speakingTimer) {
      clearInterval(this.speakingTimer)
      this.speakingTimer = null
    }
    this.emitSelfSpeaking(false)
    this.analyser = null
    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined)
      this.audioContext = null
    }
  }

  private emitSelfSpeaking(speaking: boolean) {
    if (this.lastSpeaking === speaking) return
    this.lastSpeaking = speaking
    this.callbacks.onSelfSpeaking(speaking)
  }
}
