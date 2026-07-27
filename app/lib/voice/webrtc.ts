// 单条 RTCPeerConnection 的媒体封装（docs 09 §3.2 / docs 13 双 PC 热切的媒体单元）。
//
// 职责：
//   - getUserMedia 采集麦克风（AEC/NS/AGC 全开），上行音频轨加入 PC；
//     无权限时降级为「仅听」（recvonly transceiver）；
//   - 下行 ontrack 按 user_id（约定 = 远端 MediaStream id）挂到隐藏 <audio> 池播放；
//     首个下行音频轨到达时回调 onFirstRemoteAudio（迁移接收侧就绪信号，FR-04.4）；
//   - 每用户音量 0–500%：≤100% 用 audio.volume，>100% 经 WebAudio GainNode 放大
//     （元素静音、Gain 输出，FR-21）；
//   - 播放侧主静音 setPlaybackMuted：迁移期旧链路下行整体静音防双声；
//   - ICE restart（FR-15）：restartIce() 在现有 PC 上生成 iceRestart offer；
//   - stopUplink：CUTOVER 时旧 PC 上行 track 永久停止（禁止双发，FR-03）；
//   - ICE 监控：disconnected 持续 >2s 或 failed → onIceFailure；
//   - 本地说话检测：WebAudio AnalyserNode RMS 门限。
//
// ice_servers 服务端当前恒为空数组，RTCPeerConnection 用默认配置。

import { vlog, vwarn } from "./log"
import { USER_VOLUME_MAX } from "~/lib/moderation"
import { useSettingsStore } from "~/stores/settings"
import {
  createNsAudioContext,
  createNsNodeWithFallback,
  downlinkWasmModel,
  uplinkWasmModel,
  type DfnTuningParams,
  type DtlnTuningParams,
  type NoiseModelId,
  type NsHandle,
  type WasmNsModelId,
} from "~/lib/noise-suppression"

/** 每用户音量倍率上限（500% = 5） */
const USER_VOLUME_GAIN_MAX = USER_VOLUME_MAX / 100

function voiceDfnTuning(): DfnTuningParams {
  const voice = useSettingsStore.getState().voice
  return {
    attenuationLimitDb: voice.dfnAttenuationLimitDb ?? 48,
    presenceGainDb: voice.dfnPresenceGainDb ?? 2,
  }
}

function voiceDtlnTuning(): DtlnTuningParams {
  const voice = useSettingsStore.getState().voice
  return {
    presenceGainDb: voice.dtlnPresenceGainDb ?? 2,
    makeupGainDb: voice.dtlnMakeupGainDb ?? 0.5,
  }
}

const ICE_DISCONNECTED_GRACE_MS = 2_000
const SPEAKING_POLL_MS = 100
/** 时域 RMS 门限（0–1）；简版 VAD，够用于自我 speaking 指示 */
const SPEAKING_RMS_THRESHOLD = 0.03

/** 单路媒体流统计（上行/下行 × 音频/视频） */
export type VoiceStreamStat = {
  id: string
  kind: "audio" | "video"
  direction: "up" | "down"
  label: string
  bytesTotal: number
  bitrateBps: number
  packetsLost: number
  jitterMs: number | null
}

/** 连接诊断 + 媒体流量（语音面板状态浮窗） */
export type VoiceMediaDiagnostics = {
  rttMs: number | null
  inputLevel: number
  /** 瞬时上行总码率 bit/s */
  bitrateUpBps: number
  /** 瞬时下行总码率 bit/s */
  bitrateDownBps: number
  /** 累计发送字节 */
  bytesSent: number
  /** 累计接收字节 */
  bytesReceived: number
  /** 分流通用明细 */
  streams: VoiceStreamStat[]
  connectionState: string | null
  iceState: string | null
  /** 上行降噪模型（docs 20 FR-D01；null = 关闭 / 浏览器内置约束 / 加载失败直通） */
  nsUplinkModel: string | null
  /** 下行「本地为其降噪」已挂载路数（docs 20 FR-D01） */
  nsDownlinkCount: number
}

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

/**
 * 下行 WebAudio 处理链（元素静音、经 WebAudio 输出）：
 * source → [NS 降噪节点（本地为其降噪，docs 20 FR-R03）] → gain → destination。
 * 「>100% 放大」与「每用户本地降噪」共用此链；顺序定稿先降噪后音量（docs 20 §5.2）。
 */
type PlaybackPipe = {
  source: MediaStreamAudioSourceNode
  gain: GainNode
  stream: MediaStream
  /** 已挂载的降噪节点（null = 直通）；实际 model 可能是回退结果 */
  ns: NsHandle | null
  /** 最近一次期望的模型（与回退后的实际 model 区分，避免重试风暴） */
  nsWanted: WasmNsModelId | null
  /** 降噪节点异步挂载的竞态防护：期望变化即 +1，回调校验后生效 */
  nsEpoch: number
}

export class VoiceRtc {
  private pc: RTCPeerConnection | null = null
  private micStream: MediaStream | null = null
  private micTrack: MediaStreamTrack | null = null
  /** 原始 getUserMedia 流（监听电平用）；上行可能经增益处理后的 micStream */
  private rawMicStream: MediaStream | null = null
  private inputGainCtx: AudioContext | null = null
  private inputGainNode: GainNode | null = null
  /** 上行降噪节点（docs 20 FR-S04；null = 关闭/浏览器内置/加载失败直通） */
  private uplinkNs: NsHandle | null = null
  private audioEls = new Map<string, HTMLAudioElement>()
  private audioStreams = new Map<string, MediaStream>()
  private iceDisconnectTimer: ReturnType<typeof setTimeout> | null = null
  private firstRemoteAudioFired = false
  /** 最近一次本地输入 RMS（0–1），供语音面板电平条 */
  private lastInputRms = 0
  /** 主输出音量 0–2（设置 outputVolume） */
  private masterOutputVolume = 1
  /** 输出设备 id（HTMLMediaElement.setSinkId） */
  private outputDeviceId: string | null = null

  // 屏幕共享上行（docs 11）：sender 用于停止时 removeTrack 重协商
  private screenSender: RTCRtpSender | null = null
  // 下行视频轨（屏幕共享观看端）：user_id → stream
  private videoStreams = new Map<string, MediaStream>()

  // 码率瞬时值：上一采样点累计字节
  private prevStatsAt = 0
  private prevBytesSent = 0
  private prevBytesRecv = 0
  private prevStreamBytes = new Map<string, number>()

  // 播放侧静音状态（信令退订之外的双保险）
  private deafened = false
  private locallyMuted = new Set<string>()
  /** 迁移期整链路下行主静音（旧链路防双声，FR-04.4） */
  private playbackMuted = false
  private micEnabled = true
  /** CUTOVER 后旧链路上行永久停止 */
  private uplinkStopped = false

  // 每用户音量（0–5；1 = 100%，上限 500%）与下行处理链（放大 / 本地降噪）
  private volumes = new Map<string, number>()
  private gainPipes = new Map<string, PlaybackPipe>()
  private playbackContext: AudioContext | null = null

  // 本地说话检测 / 输入电平（独立 monitor 轨，不受 mute/上行闸门影响）
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private monitorTrack: MediaStreamTrack | null = null
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
   * 连接诊断 + 上下行流量统计。
   * 从 RTCPeerConnection.getStats + getSenders/getReceivers 汇总，确认媒体已挂到 SFU。
   */
  async getDiagnostics(): Promise<VoiceMediaDiagnostics> {
    if (this.audioContext?.state === "suspended") {
      void this.audioContext.resume().catch(() => undefined)
    }
    // 输入增益链 AudioContext 也要保持运行，否则上行会静音
    if (this.inputGainCtx?.state === "suspended") {
      void this.inputGainCtx.resume().catch(() => undefined)
    }
    const empty: VoiceMediaDiagnostics = {
      rttMs: null,
      inputLevel: this.lastInputRms,
      bitrateUpBps: 0,
      bitrateDownBps: 0,
      bytesSent: 0,
      bytesReceived: 0,
      streams: [],
      connectionState: this.pc?.connectionState ?? null,
      iceState: this.pc?.iceConnectionState ?? null,
      nsUplinkModel: this.uplinkNs?.model ?? null,
      nsDownlinkCount: [...this.gainPipes.values()].filter((p) => p.ns).length,
    }
    const pc = this.pc
    if (!pc) return empty

    try {
      const report = await pc.getStats()
      let rttMs: number | null = null
      let bytesSent = 0
      let bytesReceived = 0
      const streams: VoiceStreamStat[] = []
      const now = performance.now()
      const dtSec =
        this.prevStatsAt > 0 ? Math.max(0.05, (now - this.prevStatsAt) / 1000) : 0

      // 先登记本端 sender 轨（即使尚未有 RTP 字节也展示，避免“无媒体轨”误判）
      const senderKinds = new Set<string>()
      for (const sender of pc.getSenders()) {
        const track = sender.track
        if (!track) continue
        const kind = (track.kind === "video" ? "video" : "audio") as
          | "audio"
          | "video"
        senderKinds.add(kind)
        const id = `up-${kind}-sender`
        if (!streams.some((s) => s.id === id)) {
          streams.push({
            id,
            kind,
            direction: "up",
            label:
              kind === "video"
                ? "上行 · 屏幕共享"
                : `上行 · 麦克风${track.enabled ? "" : "（静音/闸门关闭）"}`,
            bytesTotal: 0,
            bitrateBps: 0,
            packetsLost: 0,
            jitterMs: null,
          })
        }
      }

      for (const entry of report.values()) {
        const anyEntry = entry as Record<string, unknown>
        const type = String(anyEntry.type ?? "")

        // RTT
        if (
          type === "candidate-pair" &&
          anyEntry.state === "succeeded" &&
          typeof anyEntry.currentRoundTripTime === "number"
        ) {
          const pairRtt = Math.round(
            (anyEntry.currentRoundTripTime as number) * 1000,
          )
          if (anyEntry.nominated === true || anyEntry.selected === true) {
            rttMs = pairRtt
          } else if (rttMs === null) {
            rttMs = pairRtt
          }
        }
        if (
          type === "remote-inbound-rtp" &&
          typeof anyEntry.roundTripTime === "number" &&
          rttMs === null
        ) {
          rttMs = Math.round((anyEntry.roundTripTime as number) * 1000)
        }

        // 上行 RTP（兼容 kind / mediaType；不过滤 remoteId，避免误杀）
        if (type === "outbound-rtp") {
          const media =
            anyEntry.kind === "video" || anyEntry.mediaType === "video"
              ? "video"
              : "audio"
          const total = Number(anyEntry.bytesSent ?? 0)
          bytesSent += total
          const id = `up-${media}-rtp-${String(anyEntry.id ?? anyEntry.ssrc ?? "")}`
          const prev = this.prevStreamBytes.get(id) ?? total
          const bitrateBps =
            dtSec > 0 ? Math.max(0, Math.round(((total - prev) * 8) / dtSec)) : 0
          this.prevStreamBytes.set(id, total)
          // 合并进 sender 占位或新增
          const placeholderId = `up-${media}-sender`
          const existing = streams.find(
            (s) => s.id === placeholderId || s.id === id,
          )
          if (existing) {
            existing.id = id
            existing.bytesTotal = total
            existing.bitrateBps = bitrateBps
            existing.label =
              media === "video"
                ? "上行 · 屏幕共享"
                : this.micEnabled && this.micTrack?.enabled
                  ? "上行 · 麦克风"
                  : "上行 · 麦克风（静音/闸门关闭）"
          } else {
            streams.push({
              id,
              kind: media,
              direction: "up",
              label:
                media === "video" ? "上行 · 屏幕共享" : "上行 · 麦克风",
              bytesTotal: total,
              bitrateBps,
              packetsLost: 0,
              jitterMs: null,
            })
          }
        }

        // 下行 RTP
        if (type === "inbound-rtp") {
          const media =
            anyEntry.kind === "video" || anyEntry.mediaType === "video"
              ? "video"
              : "audio"
          const total = Number(anyEntry.bytesReceived ?? 0)
          bytesReceived += total
          const id = `down-${media}-rtp-${String(anyEntry.id ?? anyEntry.ssrc ?? "")}`
          const prev = this.prevStreamBytes.get(id) ?? total
          const bitrateBps =
            dtSec > 0 ? Math.max(0, Math.round(((total - prev) * 8) / dtSec)) : 0
          this.prevStreamBytes.set(id, total)
          let label =
            media === "video" ? "下行 · 屏幕" : "下行 · 语音"
          const trackId = anyEntry.trackIdentifier as string | undefined
          if (trackId) {
            for (const [userId, stream] of this.audioStreams) {
              if (stream.getAudioTracks().some((t) => t.id === trackId)) {
                label = `下行 · 语音 · ${userId.slice(0, 8)}`
                break
              }
            }
            for (const [userId, stream] of this.videoStreams) {
              if (stream.getVideoTracks().some((t) => t.id === trackId)) {
                label = `下行 · 屏幕 · ${userId.slice(0, 8)}`
                break
              }
            }
          }
          streams.push({
            id,
            kind: media,
            direction: "down",
            label,
            bytesTotal: total,
            bitrateBps,
            packetsLost: Number(anyEntry.packetsLost ?? 0),
            jitterMs:
              typeof anyEntry.jitter === "number"
                ? Math.round((anyEntry.jitter as number) * 1000)
                : null,
          })
        }
      }

      const bitrateUpBps =
        dtSec > 0
          ? Math.max(0, Math.round(((bytesSent - this.prevBytesSent) * 8) / dtSec))
          : streams
              .filter((s) => s.direction === "up")
              .reduce((a, s) => a + s.bitrateBps, 0)
      const bitrateDownBps =
        dtSec > 0
          ? Math.max(
              0,
              Math.round(((bytesReceived - this.prevBytesRecv) * 8) / dtSec),
            )
          : streams
              .filter((s) => s.direction === "down")
              .reduce((a, s) => a + s.bitrateBps, 0)
      this.prevBytesSent = bytesSent
      this.prevBytesRecv = bytesReceived
      this.prevStatsAt = now

      streams.sort((a, b) => {
        if (a.direction !== b.direction)
          return a.direction === "up" ? -1 : 1
        return b.bitrateBps - a.bitrateBps
      })

      return {
        rttMs,
        inputLevel: this.lastInputRms,
        bitrateUpBps,
        bitrateDownBps,
        bytesSent,
        bytesReceived,
        streams,
        connectionState: pc.connectionState,
        iceState: pc.iceConnectionState,
        nsUplinkModel: this.uplinkNs?.model ?? null,
        nsDownlinkCount: [...this.gainPipes.values()].filter((p) => p.ns)
          .length,
      }
    } catch (error) {
      vwarn("getStats 失败", error)
      return empty
    }
  }

  /**
   * 根据语音设置构建麦克风约束。
   * stereo=true 时请求双声道；部分浏览器在 AEC 开启时仍可能给单声道，属平台限制。
   */
  static buildMicConstraints(voice: {
    aec?: boolean
    ns?: boolean
    nsModel?: NoiseModelId
    agc?: boolean
    stereo?: boolean
    inputDeviceId?: string | null
  }): MediaTrackConstraints {
    const stereo = voice.stereo === true
    // FR-S05：浏览器 NS 仅在模型 = browser 时开启；WASM 模型时关闭避免双重处理发闷
    const browserNs =
      voice.ns !== false && (voice.nsModel ?? "rnnoise") === "browser"
    const audio: MediaTrackConstraints = {
      echoCancellation: voice.aec !== false,
      noiseSuppression: browserNs,
      autoGainControl: voice.agc !== false,
      // ideal：设备不支持 2ch 时回退，避免 OverconstrainedError
      channelCount: stereo ? { ideal: 2 } : { ideal: 1 },
      ...(voice.inputDeviceId
        ? { deviceId: { ideal: voice.inputDeviceId } }
        : {}),
    }
    return audio
  }

  /**
   * 采集麦克风：默认 **原始 getUserMedia 轨直接进 PeerConnection**（可靠上到 SFU）。
   * 输入音量 ≠100% 时才走 WebAudio 增益；并持续 resume 防挂起静音。
   * 监听电平始终走 raw 克隆轨，与上行闸门无关。
   */
  async initMic(): Promise<boolean> {
    try {
      const voice = useSettingsStore.getState().voice
      const audio = VoiceRtc.buildMicConstraints(voice)
      let raw: MediaStream
      try {
        raw = await navigator.mediaDevices.getUserMedia({ audio })
      } catch (firstError) {
        // 立体声约束失败时回退不带 channelCount，避免完全进不了麦
        if (voice.stereo) {
          vwarn("立体声 getUserMedia 失败，回退单声道约束", firstError)
          const fallback = VoiceRtc.buildMicConstraints({
            ...voice,
            stereo: false,
          })
          raw = await navigator.mediaDevices.getUserMedia({ audio: fallback })
        } else {
          throw firstError
        }
      }
      if (this.disposed) {
        raw.getTracks().forEach((track) => track.stop())
        return false
      }
      this.stopMicCaptureOnly()
      this.rawMicStream = raw
      // 无处理需求时原始轨直连 SFU（避免 WebAudio Destination 挂起后 0 字节上行）；
      // NS（WASM 模型）/输入增益需求时走 WebAudio 上行链（docs 20 §5.1）
      const uplink = await this.buildUplinkChain(raw, voice)
      if (this.disposed) {
        raw.getTracks().forEach((track) => track.stop())
        this.destroyUplinkNs()
        void this.inputGainCtx?.close().catch(() => undefined)
        this.inputGainCtx = null
        this.inputGainNode = null
        return false
      }
      this.micStream = uplink
      this.micTrack = uplink.getAudioTracks()[0] ?? null
      if (this.micTrack)
        this.micTrack.enabled = this.micEnabled && !this.uplinkStopped
      this.startSpeakingDetection(raw)
      const settings = this.micTrack?.getSettings?.() ?? {}
      const channels =
        typeof settings.channelCount === "number" ? settings.channelCount : null
      vlog("麦克风采集就绪 → 已 addTrack 路径准备", this.micTrack?.label, {
        device: voice.inputDeviceId ?? "default",
        inputVolume: voice.inputVolume,
        stereoRequested: voice.stereo === true,
        channelCount: channels,
        uplinkVia:
          uplink === raw
            ? "raw-getUserMedia"
            : this.uplinkNs
              ? `webaudio-ns-${this.uplinkNs.model}`
              : "webaudio-gain",
        trackReady: this.micTrack?.readyState,
        trackEnabled: this.micTrack?.enabled,
      })
      return this.micTrack !== null
    } catch (error) {
      vwarn("getUserMedia 失败，进入仅听模式", error)
      this.stopMicCaptureOnly()
      this.micStream = null
      this.micTrack = null
      this.rawMicStream = null
      return false
    }
  }

  /** 仅停止本地采集资源（不拆 PC / 远端播放） */
  private stopMicCaptureOnly() {
    this.stopSpeakingDetection()
    const raw = this.rawMicStream
    const mic = this.micStream
    this.rawMicStream = null
    this.micStream = null
    this.micTrack = null
    this.destroyUplinkNs()
    void this.inputGainCtx?.close().catch(() => undefined)
    this.inputGainCtx = null
    this.inputGainNode = null
    try {
      raw?.getTracks().forEach((t) => t.stop())
    } catch {
      // ignore
    }
    if (mic && mic !== raw) {
      try {
        mic.getTracks().forEach((t) => {
          try {
            t.stop()
          } catch {
            // ignore
          }
        })
      } catch {
        // ignore
      }
    }
  }

  /**
   * 通话中按最新设置重采麦克风并 replaceTrack（设备 / AEC·NS·AGC / 立体声）。
   * 无 PC 时只更新本地采集；有 audio sender 时热替换上行轨。
   */
  async reinitMicFromSettings(): Promise<boolean> {
    if (this.uplinkStopped) return false
    const ok = await this.initMic()
    if (!ok || !this.micTrack) return false
    const pc = this.pc
    if (!pc) return true
    const audioSender =
      pc.getSenders().find((s) => s.track?.kind === "audio") ??
      pc.getSenders().find((s) => !s.track && this.micTrack?.kind === "audio") ??
      null
    if (!audioSender) return true
    try {
      await audioSender.replaceTrack(this.micTrack)
      // 尽量提示编码器走立体声（浏览器可能忽略）
      await this.applyAudioSenderPrefs(audioSender)
      vlog("麦克风轨已按新设置 replaceTrack", {
        trackId: this.micTrack.id,
        channelCount: this.micTrack.getSettings?.().channelCount,
      })
      return true
    } catch (error) {
      vwarn("reinitMic replaceTrack 失败", error)
      return false
    }
  }

  /** 给音频 sender 打上可用的编码偏好（立体声由轨声道 + Opus 协商决定） */
  private async applyAudioSenderPrefs(sender: RTCRtpSender) {
    try {
      const params = sender.getParameters()
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}]
      }
      // 不强制 maxBitrate；立体声时略抬一点上限，避免被压成单声道听感发糊
      const stereo = useSettingsStore.getState().voice.stereo === true
      if (stereo) {
        const enc = params.encodings[0] ?? {}
        if (enc.maxBitrate == null || enc.maxBitrate < 64_000) {
          enc.maxBitrate = 96_000
        }
        params.encodings[0] = enc
      }
      await sender.setParameters(params)
    } catch {
      // 协商未完成时 setParameters 可能抛错，可忽略
    }
  }

  /** 设置项变更：输入增益即时生效（已在语音中） */
  setInputVolume(percent: number) {
    if (!this.rawMicStream) {
      if (this.inputGainNode) {
        this.inputGainNode.gain.value = Math.min(2, Math.max(0, percent / 100))
      }
      return
    }
    // 上行降噪链在用（gain 节点恒在链内）或仍需增益：只改 gain 值，不拆链
    if (
      this.inputGainNode &&
      (this.uplinkNs || Math.abs(percent - 100) >= 0.5)
    ) {
      this.inputGainNode.gain.value = Math.min(2, Math.max(0, percent / 100))
      return
    }
    // 切换 raw ↔ 增益链，并 replaceTrack 到已有 audio sender
    const next = this.buildUplinkFromRaw(this.rawMicStream, percent)
    const nextTrack = next.getAudioTracks()[0]
    if (!nextTrack) return
    nextTrack.enabled = this.micEnabled && !this.uplinkStopped
    const audioSender =
      this.pc?.getSenders().find((s) => s.track?.kind === "audio") ??
      this.pc
        ?.getSenders()
        .find((s) => !s.track && this.micTrack?.kind === "audio") ??
      null
    if (audioSender) {
      void audioSender
        .replaceTrack(nextTrack)
        .catch((error) => vwarn("输入增益 replaceTrack 失败", error))
    }
    this.micStream = next
    this.micTrack = nextTrack
  }

  /** 设置项变更：主输出音量（所有远端播放） */
  setMasterOutputVolume(percent: number) {
    this.masterOutputVolume = Math.min(2, Math.max(0, percent / 100))
    this.applyPlaybackAll()
  }

  /** 设置项变更：输出设备 setSinkId */
  async setOutputDevice(deviceId: string | null) {
    this.outputDeviceId = deviceId
    await Promise.all(
      [...this.audioEls.values()].map((el) => this.applySinkId(el)),
    )
  }

  /** 销毁上行降噪节点 */
  private destroyUplinkNs() {
    this.uplinkNs?.destroy()
    this.uplinkNs = null
  }

  /**
   * 构建上行链（docs 20 §5.1）：
   * 采集 → [立体声下混（WASM 模型时，决议 R2）] → [NS 模型节点] → [输入增益] → 编码轨。
   * ns 关闭 / 模型 = browser 时回退 buildUplinkFromRaw（增益或直连）；
   * 模型加载失败直通不降噪，语音不受影响（FR-L02）。
   */
  private async buildUplinkChain(
    raw: MediaStream,
    voice: {
      ns?: boolean
      nsModel?: NoiseModelId
      inputVolume?: number
    },
  ): Promise<MediaStream> {
    this.destroyUplinkNs()
    const selected = voice.nsModel ?? "rnnoise"
    const wantModel =
      voice.ns !== false ? uplinkWasmModel(selected) : null
    const inputVolume = voice.inputVolume ?? 100
    if (!wantModel) return this.buildUplinkFromRaw(raw, inputVolume)
    try {
      vlog("上行降噪链构建开始", {
        selected,
        wantModel,
        inputVolume,
      })
      // 48kHz 上下文：DFN 硬要求，RNNoise 亦按 48kHz 假设（引擎内自动回退默认率）
      void this.inputGainCtx?.close().catch(() => undefined)
      const ctx = createNsAudioContext()
      if (!ctx) {
        this.inputGainCtx = null
        this.inputGainNode = null
        return this.buildUplinkFromRaw(raw, inputVolume)
      }
      this.inputGainCtx = ctx
      const source = ctx.createMediaStreamSource(raw)
      const gain = ctx.createGain()
      gain.gain.value = Math.min(2, Math.max(0, inputVolume / 100))
      this.inputGainNode = gain
      const dest = ctx.createMediaStreamDestination()
      // 强度按「所选模型」记忆（FR-S06）；回退到其他模型时沿用用户意图强度
      const strength =
        useSettingsStore.getState().voice.nsStrengthByModel?.[selected] ?? 100
      const handle = await createNsNodeWithFallback(
        ctx,
        wantModel,
        strength,
        wantModel === "deepfilternet" ? voiceDfnTuning() : null,
        wantModel === "dtln" ? voiceDtlnTuning() : null,
      )
      if (this.disposed || this.inputGainCtx !== ctx) {
        handle?.destroy()
        void ctx.close().catch(() => undefined)
        return raw
      }
      if (handle) {
        this.uplinkNs = handle
        source.connect(handle.input)
        handle.output.connect(gain)
        vlog("上行降噪链就绪", {
          selected,
          actual: handle.model,
          sampleRate: ctx.sampleRate,
        })
      } else {
        vwarn("上行降噪模型全部加载失败，直通不降噪（FR-L02）")
        source.connect(gain)
      }
      gain.connect(dest)
      void ctx.resume().catch(() => undefined)
      return dest.stream
    } catch (error) {
      vwarn("上行降噪链创建失败，回退增益/原始链", error)
      this.destroyUplinkNs()
      return this.buildUplinkFromRaw(raw, inputVolume)
    }
  }

  /**
   * 构建上行流：
   * - 音量 ≈100%：直接返回 raw（最可靠，避免 WebAudio 挂起导致 0 bps）
   * - 需要增益：raw → Gain → Destination，并启动 keep-alive resume
   */
  private buildUplinkFromRaw(
    raw: MediaStream,
    inputVolumePercent: number,
  ): MediaStream {
    // 默认直连：这是“说话能被听见、统计有字节”的关键路径
    if (Math.abs(inputVolumePercent - 100) < 0.5) {
      void this.inputGainCtx?.close().catch(() => undefined)
      this.inputGainCtx = null
      this.inputGainNode = null
      return raw
    }
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!Ctor) return raw
      void this.inputGainCtx?.close().catch(() => undefined)
      this.inputGainCtx = new Ctor()
      const source = this.inputGainCtx.createMediaStreamSource(raw)
      this.inputGainNode = this.inputGainCtx.createGain()
      this.inputGainNode.gain.value = Math.min(
        2,
        Math.max(0, inputVolumePercent / 100),
      )
      const dest = this.inputGainCtx.createMediaStreamDestination()
      source.connect(this.inputGainNode)
      this.inputGainNode.connect(dest)
      void this.inputGainCtx.resume().catch(() => undefined)
      return dest.stream
    } catch (error) {
      vwarn("输入增益链创建失败，回退原始麦流", error)
      this.inputGainCtx = null
      this.inputGainNode = null
      return raw
    }
  }

  private async applySinkId(el: HTMLAudioElement) {
    const anyEl = el as HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>
    }
    if (typeof anyEl.setSinkId !== "function") return
    try {
      await anyEl.setSinkId(this.outputDeviceId ?? "")
    } catch (error) {
      vwarn("setSinkId 失败", error)
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
      const sender = pc.addTrack(this.micTrack, this.micStream)
      void this.applyAudioSenderPrefs(sender)
      vlog("音频轨已 addTrack → SFU 上行", {
        trackId: this.micTrack.id,
        readyState: this.micTrack.readyState,
        enabled: this.micTrack.enabled,
        muted: this.micTrack.muted,
        label: this.micTrack.label,
        channelCount: this.micTrack.getSettings?.().channelCount,
        senderTrack: sender.track?.id,
      })
    } else {
      // 仅听模式：仍声明音频 m-line，收下行
      pc.addTransceiver("audio", { direction: "recvonly" })
      vlog("无麦克风：recvonly 音频 transceiver")
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
   * 等待 PC 信令回到 stable，避免与进行中的 renegotiation 撞车导致
   * setLocalDescription 失败（整屏共享时常触发更复杂的 m-line）。
   */
  private waitForStableSignaling(timeoutMs = 4_000): Promise<boolean> {
    const pc = this.pc
    if (!pc) return Promise.resolve(false)
    if (pc.signalingState === "stable") return Promise.resolve(true)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pc.removeEventListener("signalingstatechange", onChange)
        resolve(pc.signalingState === "stable")
      }, timeoutMs)
      const onChange = () => {
        if (pc.signalingState !== "stable") return
        clearTimeout(timer)
        pc.removeEventListener("signalingstatechange", onChange)
        resolve(true)
      }
      pc.addEventListener("signalingstatechange", onChange)
    })
  }

  /**
   * 发布屏幕轨（docs 11 FR-04）：addTrack 后生成 renegotiation offer SDP。
   * 调用方负责把 SDP 经信令 offer 帧发给 SFU 并等 answer。无 PC 时返回 null。
   * 失败时回滚 sender，避免脏状态导致后续无法再发。
   */
  async publishScreenTrack(
    track: MediaStreamTrack,
    stream: MediaStream
  ): Promise<string | null> {
    const pc = this.pc
    if (!pc) return null
    const stable = await this.waitForStableSignaling()
    if (!stable || this.pc !== pc) return null

    if (this.screenSender) {
      // 每用户同时 1 路（docs 11 AX.4）：先替换旧轨；重连恢复时常走此路径
      await this.screenSender.replaceTrack(track)
      // replaceTrack 不强制重协商；若 transceiver 方向需更新仍做一次 offer
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        return offer.sdp ?? null
      } catch (error) {
        vwarn("屏幕轨 replaceTrack 后 createOffer 失败（轨已替换）", error)
        return null
      }
    }

    try {
      this.screenSender = pc.addTrack(track, stream)
      // 屏幕内容偏静态：尽量提高清晰度预算（平台不支持时忽略）
      try {
        const params = this.screenSender.getParameters()
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}]
        }
        params.encodings[0] = {
          ...params.encodings[0],
          maxFramerate: 30,
          // 优先分辨率（浏览器可能忽略）
          scaleResolutionDownBy: 1,
        }
        await this.screenSender.setParameters(params)
      } catch {
        // 部分环境未协商完成前 setParameters 会抛错，可忽略
      }
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      return offer.sdp ?? null
    } catch (error) {
      vwarn("屏幕轨 addTrack/createOffer 失败，回滚 sender", error)
      if (this.screenSender) {
        try {
          pc.removeTrack(this.screenSender)
        } catch {
          // ignore
        }
        this.screenSender = null
      }
      throw error
    }
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
    try {
      await this.waitForStableSignaling(2_000)
      if (this.pc !== pc) return null
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      return offer.sdp ?? null
    } catch (error) {
      vwarn("移除屏幕轨后 createOffer 失败", error)
      return null
    }
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
    this.rawMicStream?.getTracks().forEach((track) => track.stop())
    this.destroyUplinkNs()
    void this.inputGainCtx?.close().catch(() => undefined)
    this.inputGainCtx = null
    this.inputGainNode = null
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

  /** 每用户音量（0–USER_VOLUME_GAIN_MAX，1 = 100%；>1 经 GainNode 放大） */
  setUserVolume(userId: string, volume: number) {
    const clamped = Math.min(USER_VOLUME_GAIN_MAX, Math.max(0, volume))
    this.volumes.set(userId, clamped)
    this.applyPlayback(userId)
  }

  /** 批量预置音量（链路建立时重放持久化配置，FR-21） */
  setUserVolumes(volumes: Record<string, number>) {
    for (const [userId, volume] of Object.entries(volumes)) {
      this.volumes.set(
        userId,
        Math.min(USER_VOLUME_GAIN_MAX, Math.max(0, volume)),
      )
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
    this.rawMicStream?.getTracks().forEach((track) => track.stop())
    this.rawMicStream = null
    this.destroyUplinkNs()
    void this.inputGainCtx?.close().catch(() => undefined)
    this.inputGainCtx = null
    this.inputGainNode = null
    // 屏幕采集 track 归 screen-share 管理器所有（含 onended 收尾），此处只解引用
    this.screenSender = null
    this.videoStreams.clear()
    this.prevStreamBytes.clear()
    this.prevBytesSent = 0
    this.prevBytesRecv = 0
    this.prevStatsAt = 0
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
    void this.applySinkId(el)
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

  /**
   * 单用户播放收口：静音条件 + 每用户音量 × 主输出音量 + 本地降噪。
   * 处理顺序定稿（docs 20 §5.2）：先降噪、后音量。
   */
  private applyPlayback(userId: string) {
    const el = this.audioEls.get(userId)
    if (!el) return
    const muted =
      this.playbackMuted || this.deafened || this.locallyMuted.has(userId)
    // 用户单独音量（0–5）× 全局输出音量（0–2）
    const volume = (this.volumes.get(userId) ?? 1) * this.masterOutputVolume
    // 决议 R1：ns 总开关关闭时暂停下行降噪（直通），localNs 名单保留；
    // FR-R04 P1：每用户模型覆盖优先于全局模型
    const voice = useSettingsStore.getState().voice
    const wantNsModel =
      voice.ns !== false && voice.localNs?.[userId]
        ? (voice.localNsModels?.[userId] ??
          downlinkWasmModel(voice.nsModel ?? "rnnoise"))
        : null
    const nsStrength = wantNsModel
      ? (voice.nsStrengthByModel?.[wantNsModel] ?? 100)
      : 100

    if (volume <= 1 && !wantNsModel) {
      this.teardownGainPipe(userId)
      el.volume = Math.min(1, Math.max(0, volume))
      el.muted = muted
      return
    }
    // WebAudio 链：元素静音、source → [ns] → gain 输出（保持元素播放使 RTP 持续拉流）
    el.volume = 1
    el.muted = true
    const pipe = this.ensureGainPipe(userId)
    if (!pipe) {
      // WebAudio 不可用时退化为原音量直出（不降噪）；>100% 时无法放大
      el.muted = muted
      el.volume = 1
      return
    }
    // 单用户上限 5× + 主输出 2×，安全封顶 10（=1000%）
    pipe.gain.gain.value = muted ? 0 : Math.min(10, Math.max(0, volume))
    this.syncPipeNs(userId, pipe, wantNsModel, nsStrength)
  }

  private applyPlaybackAll() {
    for (const userId of this.audioEls.keys()) this.applyPlayback(userId)
  }

  /**
   * ns / nsModel / localNs 变化（本端操作或他端设置同步）后重算全部下行链
   * （docs 20 FR-R05：≤500ms 感知；FR-R06 跨端重放）。
   */
  refreshNoiseSuppression() {
    this.applyPlaybackAll()
  }

  /**
   * 挂载/拆除某用户的下行降噪节点（docs 20 FR-R03/R04）。
   * WASM/worklet 加载为异步，用 nsEpoch 防竞态：仅最后一次期望生效。
   * 强度（FR-S06）随每次收口即时更新，不重建节点。
   */
  private syncPipeNs(
    userId: string,
    pipe: PlaybackPipe,
    model: WasmNsModelId | null,
    strengthPercent: number,
  ) {
    if (model === null) {
      if (!pipe.ns) return
      pipe.nsEpoch += 1
      pipe.nsWanted = null
      const prev = pipe.ns
      pipe.ns = null
      try {
        pipe.source.disconnect()
      } catch {
        // ignore
      }
      prev.destroy()
      try {
        pipe.source.connect(pipe.gain)
      } catch {
        // ignore
      }
      return
    }
    if (pipe.nsWanted === model && pipe.ns) {
      pipe.ns.setStrength(strengthPercent)
      return
    }
    if (pipe.nsWanted === model) return // 加载中，等回调
    pipe.nsWanted = model
    const epoch = ++pipe.nsEpoch
    const ctx = this.playbackContext
    if (!ctx) return
    void createNsNodeWithFallback(
      ctx,
      model,
      strengthPercent,
      model === "deepfilternet" ? voiceDfnTuning() : null,
      model === "dtln" ? voiceDtlnTuning() : null,
    ).then((handle) => {
      if (!handle) return
      const current = this.gainPipes.get(userId)
      if (this.disposed || current !== pipe || pipe.nsEpoch !== epoch) {
        handle.destroy()
        return
      }
      const prev = pipe.ns
      pipe.ns = handle
      try {
        pipe.source.disconnect()
      } catch {
        // ignore
      }
      prev?.destroy()
      try {
        pipe.source.connect(handle.input)
        handle.output.connect(pipe.gain)
        vlog("下行本地降噪已挂载", { userId, model: handle.model })
      } catch (error) {
        vwarn("下行降噪节点接线失败，直通", error)
        pipe.ns = null
        handle.destroy()
        try {
          pipe.source.connect(pipe.gain)
        } catch {
          // ignore
        }
      }
    })
  }

  /** FR-S06：上行强度变更即时应用（不重建链） */
  applyUplinkNsStrength(percent: number) {
    this.uplinkNs?.setStrength(percent)
  }

  /** DeepFilterNet 衰减/清晰度热更（不重建链） */
  applyUplinkDfnTuning(params: Partial<DfnTuningParams>) {
    this.uplinkNs?.setDfnTuning?.(params)
  }

  /** 下行所有 DFN 节点同步调参 */
  applyDownlinkDfnTuning(params: Partial<DfnTuningParams>) {
    for (const pipe of this.gainPipes.values()) {
      pipe.ns?.setDfnTuning?.(params)
    }
  }

  /** DTLN 清晰度/输出补偿热更（不重建链） */
  applyUplinkDtlnTuning(params: Partial<DtlnTuningParams>) {
    this.uplinkNs?.setDtlnTuning?.(params)
  }

  /** 下行所有 DTLN 节点同步调参 */
  applyDownlinkDtlnTuning(params: Partial<DtlnTuningParams>) {
    for (const pipe of this.gainPipes.values()) {
      pipe.ns?.setDtlnTuning?.(params)
    }
  }

  private ensureGainPipe(userId: string): PlaybackPipe | null {
    const existing = this.gainPipes.get(userId)
    const stream = this.audioStreams.get(userId)
    if (!stream) return null
    if (existing && existing.stream === stream) return existing
    if (existing) this.teardownGainPipe(userId)
    try {
      // 48kHz：与降噪模型采样率假设一致（DFN 硬要求）
      this.playbackContext ??= createNsAudioContext() ?? new AudioContext()
      void this.playbackContext.resume().catch(() => undefined)
      const source = this.playbackContext.createMediaStreamSource(stream)
      const gain = this.playbackContext.createGain()
      // 初始直通接线；降噪节点由 syncPipeNs 异步插入 source 与 gain 之间
      source.connect(gain)
      gain.connect(this.playbackContext.destination)
      const pipe: PlaybackPipe = {
        source,
        gain,
        stream,
        ns: null,
        nsWanted: null,
        nsEpoch: 0,
      }
      this.gainPipes.set(userId, pipe)
      return pipe
    } catch (error) {
      vwarn("下行处理链创建失败，退化为 100% 直出", error)
      return null
    }
  }

  private teardownGainPipe(userId: string) {
    const pipe = this.gainPipes.get(userId)
    if (!pipe) return
    this.gainPipes.delete(userId)
    pipe.nsEpoch += 1
    pipe.ns?.destroy()
    pipe.ns = null
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
      const sourceTrack = stream.getAudioTracks()[0]
      if (!sourceTrack) return

      const AudioContextCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!AudioContextCtor) return

      // 克隆一条始终 enabled 的监听轨：上行静音/无 publish_audio 时主轨会 enabled=false，
      // 直接听主轨会导致电平条永远为 0；监听轨专供电平/说话检测，不进入 PeerConnection。
      this.monitorTrack?.stop()
      this.monitorTrack = sourceTrack.clone()
      this.monitorTrack.enabled = true
      const monitorStream = new MediaStream([this.monitorTrack])

      this.audioContext = new AudioContextCtor()
      const source = this.audioContext.createMediaStreamSource(monitorStream)
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 1024
      this.analyser.smoothingTimeConstant = 0.6
      source.connect(this.analyser)
      // 进房由用户点击触发，resume 一般能成功；若被挂起后续 tick 会再 resume
      void this.audioContext.resume().catch(() => undefined)

      const timeBuf = new Uint8Array(this.analyser.fftSize)
      this.speakingTimer = setInterval(() => {
        if (!this.analyser || !this.audioContext) return
        // 被浏览器挂起时尽快恢复，否则读到的是静音
        if (this.audioContext.state === "suspended") {
          void this.audioContext.resume().catch(() => undefined)
        }
        // 若走了 WebAudio 增益上行，必须持续 resume，否则 SFU 收不到声音、统计 0 bps
        if (this.inputGainCtx?.state === "suspended") {
          void this.inputGainCtx.resume().catch(() => undefined)
        }
        this.analyser.getByteTimeDomainData(timeBuf)
        let sumSquares = 0
        for (const sample of timeBuf) {
          const normalized = (sample - 128) / 128
          sumSquares += normalized * normalized
        }
        const rms = Math.sqrt(sumSquares / timeBuf.length)
        this.lastInputRms = rms
        // 说话指示仍尊重上行闸门：静音/无权限时不显示「我在说话」
        const canSpeak =
          this.micEnabled &&
          Boolean(this.micTrack?.enabled) &&
          !this.uplinkStopped
        this.emitSelfSpeaking(canSpeak && rms > SPEAKING_RMS_THRESHOLD)
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
    this.lastInputRms = 0
    this.analyser = null
    if (this.monitorTrack) {
      this.monitorTrack.stop()
      this.monitorTrack = null
    }
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
