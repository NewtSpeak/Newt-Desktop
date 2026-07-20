// 屏幕共享发布端编排（docs 11 §5.3 客户端状态机）：
//
//   IDLE ──start()──► REQUESTING（POST screen/start 占坑 RESERVED）
//        ──► 刷新 token（ensureScreenCaps：refreshVoiceToken + auth 在位重发，
//             等 caps 含 publish_screen）
//        ──► CAPTURING（getDisplayMedia 按质量档约束采集）
//        ──► PUBLISHING（PC addTrack + createOffer 重协商）
//        ──► LIVE（SCREEN_SHARE_START 事件为业务权威，本地乐观置 live）
//
// 任何一步失败必须调 stopScreenShare 释放 RESERVED 占坑（docs 11 FR-05）。
// 采集 track onended（用户从系统 UI 停止）→ 自动 stop 收尾（FR-06）。
// 被动停止（SCREEN_SHARE_STOP / 抱下 / caps 回收 / 离开语音）→ handleRemoteStop。
//
// WKWebView 下 getDisplayMedia 可能不可用：isSupported() 为 false 时入口直接提示
// 「当前环境不支持屏幕采集」，其余代码路径照常保留。

import { toast } from "sonner"

import { startScreenShare, stopScreenShare } from "~/lib/api/stage"
import type { ScreenQuality } from "~/lib/api/types"
import { useStageStore } from "~/stores/stage"
import { useVoiceStore } from "~/stores/voice"
import { voiceConnection } from "./connection"
import { verror, vlog, vwarn } from "./log"
import { screenErrorMessage, screenStopReasonMessage } from "./stage-errors"

/** 质量档 → getDisplayMedia 约束（docs 11 FR-03/BA.1；帧率 5–30） */
const QUALITY_CONSTRAINTS: Record<
  ScreenQuality,
  { width: number; height: number; frameRate: number }
> = {
  "480p": { width: 854, height: 480, frameRate: 15 },
  "720p": { width: 1280, height: 720, frameRate: 30 },
  "1080p": { width: 1920, height: 1080, frameRate: 30 },
}

export const SCREEN_QUALITIES: ScreenQuality[] = ["480p", "720p", "1080p"]

class ScreenShareManager {
  private track: MediaStreamTrack | null = null
  private stream: MediaStream | null = null
  /** 每次 start/stop 递增；异步步骤返回后校验，防止过期流程继续推进 */
  private epoch = 0
  private lastSessionId: string | null = null

  constructor() {
    // 会话联动（docs 11 FR-11/FR-12/BB）：
    //   - 离开语音 / 切频道 → 共享随之终止；
    //   - LIVE 中 caps 被回收 publish_screen → 立即停采集（专属提示由 STOP 事件补充）；
    //   - 迁移 CUTOVER 后 sessionId 变化且 token 仍含 publish_screen → 在新链路重发轨。
    useVoiceStore.subscribe((state) => {
      const selfScreen = useStageStore.getState().selfScreen
      if (!selfScreen) {
        this.lastSessionId = state.session?.sessionId ?? null
        return
      }
      const session = state.session
      if (!session || session.channelId !== selfScreen.channelId) {
        vlog("screen-share: 已离开语音频道，本地收口共享")
        this.teardown({ notifyServer: false })
        return
      }
      if (
        selfScreen.phase === "live" &&
        session.caps.length > 0 &&
        !session.caps.includes("publish_screen")
      ) {
        vlog("screen-share: caps 已回收 publish_screen，停止发布")
        this.teardown({ notifyServer: false })
        return
      }
      // 双 PC 热迁移收口后在新链路恢复发布（docs 11 BB.2）
      if (
        selfScreen.phase === "live" &&
        session.phase === "connected" &&
        session.sessionId &&
        this.lastSessionId &&
        session.sessionId !== this.lastSessionId &&
        this.track &&
        this.stream
      ) {
        vlog("screen-share: 链路已切换，重发屏幕轨")
        void voiceConnection
          .publishScreenTrack(this.track, this.stream)
          .catch(() => undefined)
      }
      this.lastSessionId = session.sessionId ?? this.lastSessionId
    })
  }

  /** WKWebView 等环境 getDisplayMedia 支持度探测 */
  isSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getDisplayMedia === "function"
    )
  }

  /**
   * 发起共享（严格按 docs 11 BC.1 时序）。调用方保证已连接语音。
   * 失败路径均已内部 toast + 释放占坑。
   */
  async start(channelId: string, quality: ScreenQuality): Promise<void> {
    const session = useVoiceStore.getState().session
    if (
      !session ||
      session.channelId !== channelId ||
      session.phase !== "connected"
    ) {
      toast.error("请先连接语音后再共享屏幕")
      return
    }
    const existing = useStageStore.getState().selfScreen
    if (existing && existing.phase !== "idle") return // 每用户 1 路（AX.4）
    if (!this.isSupported()) {
      toast.error("当前环境不支持屏幕采集")
      return
    }

    const epoch = ++this.epoch
    const setPhase = (
      phase: "requesting" | "capturing" | "publishing" | "live"
    ) => useStageStore.getState().setSelfScreen({ channelId, quality, phase })

    // 1. REST 占坑（RESERVED）
    setPhase("requesting")
    try {
      await startScreenShare(channelId, quality)
    } catch (error) {
      verror("screen/start 失败", error)
      if (this.epoch === epoch) {
        const quota =
          useStageStore.getState().quotaByGuild[session.guildId] ?? null
        toast.error(screenErrorMessage(error, quota))
        useStageStore.getState().setSelfScreen(null)
      }
      return
    }
    if (this.epoch !== epoch) {
      void this.releaseReservation(channelId)
      return
    }

    // 2. token 刷新（服务端已重算 caps）→ auth 在位重发 → 校验 publish_screen
    const caps = await voiceConnection.ensureScreenCaps()
    if (this.epoch !== epoch) {
      void this.releaseReservation(channelId)
      return
    }
    if (!caps || !caps.includes("publish_screen")) {
      vwarn("screen-share: 刷新后 caps 不含 publish_screen", caps)
      toast.error("屏幕共享授权失败，请稍后再试")
      await this.releaseReservation(channelId)
      if (this.epoch === epoch) useStageStore.getState().setSelfScreen(null)
      return
    }

    // 3. 采集（用户在系统选择器取消 / 系统权限拒绝均在此失败）
    setPhase("capturing")
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: QUALITY_CONSTRAINTS[quality].width },
          height: { ideal: QUALITY_CONSTRAINTS[quality].height },
          frameRate: { ideal: QUALITY_CONSTRAINTS[quality].frameRate, max: 30 },
        },
        audio: false,
      })
    } catch (error) {
      vwarn("getDisplayMedia 失败/取消", error)
      if (this.epoch === epoch) {
        toast.error(
          "屏幕采集已取消或被系统拒绝，如需共享请在系统设置中授权「屏幕录制」"
        )
        useStageStore.getState().setSelfScreen(null)
      }
      await this.releaseReservation(channelId)
      return
    }
    const track = stream.getVideoTracks()[0] ?? null
    if (this.epoch !== epoch || !track) {
      stream.getTracks().forEach((item) => item.stop())
      await this.releaseReservation(channelId)
      if (this.epoch === epoch) useStageStore.getState().setSelfScreen(null)
      return
    }
    // 屏幕内容以文本/静态为主：允许编码器降帧保清晰度（docs 11 FR-23）
    try {
      track.contentHint = "detail"
    } catch {
      // 平台不支持时忽略
    }
    this.track = track
    this.stream = stream
    // 用户从系统 UI（浏览器/系统级停止按钮）结束共享 → 自动收尾（FR-06）
    track.onended = () => {
      vlog("screen-share: 采集 track onended，自动停止")
      void this.stop()
    }

    // 4. PC addTrack + createOffer 重协商发布
    setPhase("publishing")
    const published = await voiceConnection.publishScreenTrack(track, stream)
    if (this.epoch !== epoch) return
    if (!published) {
      toast.error("屏幕画面发布失败，请稍后再试")
      this.stopCapture()
      await this.releaseReservation(channelId)
      useStageStore.getState().setSelfScreen(null)
      return
    }

    // 5. 本地乐观置 LIVE；RESERVED→ACTIVE 与 SCREEN_SHARE_START 广播由服务端收口
    this.lastSessionId = useVoiceStore.getState().session?.sessionId ?? null
    setPhase("live")
    toast.success("屏幕共享已开始")
  }

  /** 本人主动停止（面板按钮 / track onended）：REST stop + 移除本地轨 */
  async stop(): Promise<void> {
    const selfScreen = useStageStore.getState().selfScreen
    if (!selfScreen || selfScreen.phase === "stopping") return
    this.epoch += 1
    useStageStore.getState().setSelfScreen({ ...selfScreen, phase: "stopping" })
    this.stopCapture()
    await voiceConnection.unpublishScreenTrack().catch(() => undefined)
    try {
      await stopScreenShare(selfScreen.channelId)
    } catch (error) {
      // 幂等接口；失败时服务端会按 track ended / 超时最终一致释放
      vwarn("screen/stop 上报失败（忽略）", error)
    }
    useStageStore.getState().setSelfScreen(null)
  }

  /**
   * 被动停止（SCREEN_SHARE_STOP 事件到达本人）：停采集清理 + 按 reason 提示。
   * reason=self 时本端 stop() 已清理完毕，此处自然 no-op。
   */
  handleRemoteStop(reason?: string): void {
    const selfScreen = useStageStore.getState().selfScreen
    if (!selfScreen) return
    vlog("screen-share: 收到远端 STOP", reason)
    this.teardown({ notifyServer: false })
    const message = screenStopReasonMessage(reason)
    if (message) toast.info(message)
  }

  /** 抱下等场景的本地立即收口（不重试恢复，docs 11 FR-10；不另发 toast） */
  stopSilently(): void {
    if (!useStageStore.getState().selfScreen) return
    this.teardown({ notifyServer: true })
  }

  // ---------------------------------------------------------------------------
  // 内部
  // ---------------------------------------------------------------------------

  private teardown(options: { notifyServer: boolean }) {
    const selfScreen = useStageStore.getState().selfScreen
    this.epoch += 1
    this.stopCapture()
    void voiceConnection.unpublishScreenTrack().catch(() => undefined)
    useStageStore.getState().setSelfScreen(null)
    if (options.notifyServer && selfScreen) {
      void stopScreenShare(selfScreen.channelId).catch(() => undefined)
    }
  }

  private stopCapture() {
    if (this.track) {
      this.track.onended = null
      this.track.stop()
      this.track = null
    }
    this.stream?.getTracks().forEach((item) => item.stop())
    this.stream = null
  }

  /** 失败路径释放 RESERVED 占坑（docs 11 FR-05，幂等） */
  private async releaseReservation(channelId: string): Promise<void> {
    try {
      await stopScreenShare(channelId)
    } catch (error) {
      vwarn("释放屏幕共享占坑失败（等待服务端超时回收）", error)
    }
  }
}

/** 全局单例（voice-panel 与 gateway-bindings 共用） */
export const screenShare = new ScreenShareManager()
